import { newLocalPlayerId as newPacketId } from "../../shared/local-profile";
import { Peer, type PeerOptions, type DataConnection } from "peerjs";
import { RtcChunkReceiver, rtcChunks, type RtcChunk } from "../../shared/rtc";
export interface PeerLink {
  connection: DataConnection;
  motion?: RTCDataChannel;
  motionCleanup?: () => void;
  motionDrops?: number;
  playerId: string | null;
  receiver: RtcChunkReceiver;
  queue: RtcChunk[];
  opened: number;
  lastSeen: number;
  nonce: string;
  probeAt: number;
  latency: number | null;
  measured: number;
  probesSent: number;
  probesReceived: number;
  repliesReceived: number;
}
import { peerErrorMessage } from "../../shared/peer-errors";
export { peerErrorMessage } from "../../shared/peer-errors";
/** Sole owner of PeerJS objects. Party and gameplay exchange normal objects. */
export class PeerTransport {
  constructor(private options: PeerOptions = { secure: true, debug: 0 }) {}
  peer: Peer | null = null;
  readonly links = new Set<PeerLink>();
  readonly peers = new Map<string, PeerLink>();
  status = "";
  debug = false;
  onOpen: (link: PeerLink) => void = () => {};
  onParty: (link: PeerLink, value: Record<string, unknown>) => void = () => {};
  onData: (id: string, value: unknown) => void = () => {};
  onClose: (id: string | null) => void = () => {};
  onSignaling: (online: boolean, message: string) => void = () => {};
  private reconnectAt = 0;
  private closed = false;
  private log(event: string, detail?: string) {
    if (this.debug) console.debug("[PeerJS]", event, detail ?? "");
  }
  trace(event: string) {
    this.log(event);
  }
  async register(id?: string) {
    this.close();
    this.closed = false;
    const peer = (this.peer = id
      ? new Peer(id, this.options)
      : new Peer(this.options));
    peer.on("connection", (conn) => {
      if (this.peer !== peer || this.closed) {
        conn.close();
        return;
      }
      this.log("incoming connection");
      this.bind(conn);
    });
    peer.on("disconnected", () => {
      if (this.peer !== peer || this.closed) return;
      this.status = "SIGNALING DISCONNECTED — RECONNECTING";
      this.onSignaling(false, this.status);
      this.reconnectAt = performance.now() + 500;
    });
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.peer === peer) this.close();
        reject(Error("CONNECTION TIMED OUT"));
      }, 12000);
      let opened = false;
      peer.on("open", (value) => {
        if (this.peer !== peer) return;
        opened = true;
        clearTimeout(timer);
        this.status = "";
        this.log("peer opened", value);
        this.onSignaling(true, "");
        resolve(value);
      });
      peer.on("error", (error) => {
        if (this.peer !== peer) return;
        this.log("peer error", error.type);
        this.status = peerErrorMessage(error.type);
        if (!opened) {
          clearTimeout(timer);
          reject(Object.assign(Error(this.status), { type: error.type }));
        } else this.onSignaling(false, this.status);
      });
    });
  }
  connect(host: string) {
    if (!this.peer || !this.peer.open) throw Error("SIGNALING IS NOT READY");
    this.log("outgoing connection", host);
    return this.bind(
      this.peer.connect(host, {
        reliable: true,
        serialization: "json",
        label: "octane-arena-data",
      }),
    );
  }
  private bind(connection: DataConnection) {
    const link: PeerLink = {
      connection,
      playerId: null,
      receiver: new RtcChunkReceiver(),
      queue: [],
      opened: performance.now(),
      lastSeen: performance.now(),
      nonce: "",
      probeAt: 0,
      latency: null,
      measured: 0,
      probesSent: 0,
      probesReceived: 0,
      repliesReceived: 0,
    };
    this.links.add(link);
    // Keep control/replay reliable. Motion uses a separate unordered, no-retry
    // SCTP stream on PeerJS's authenticated peer connection.
    const pc = connection.peerConnection;
    // PeerJS installs an ondatachannel property handler before bind(). Route
    // by label here: a later listener cannot reliably precede its handler.
    const controlChannel = pc?.ondatachannel;
    const incoming = (event: RTCDataChannelEvent) => {
      if (event.channel.label === "octane-arena-motion")
        this.bindMotion(link, event.channel);
      else controlChannel?.call(pc, event);
    };
    if (pc) pc.ondatachannel = incoming;
    link.motionCleanup = () => {
      if (pc?.ondatachannel === incoming)
        pc.ondatachannel = controlChannel ?? null;
    };
    connection.on("open", () => {
      if (!this.links.has(link)) return;
      this.log("connection opened");
      link.lastSeen = performance.now();
      if (pc?.localDescription?.type === "offer") {
        this.bindMotion(
          link,
          pc.createDataChannel("octane-arena-motion", {
            ordered: false,
            maxRetransmits: 0,
          }),
        );
      }
      this.onOpen(link);
      this.probe(link);
    });
    connection.on("data", (raw) => {
      if (!this.links.has(link) || !raw || typeof raw !== "object") return;
      let data = raw as Record<string, unknown>;
      link.lastSeen = performance.now();
      if (
        data.type === "peer-ping" &&
        typeof data.nonce === "string" &&
        data.nonce.length < 80
      ) {
        link.probesReceived++;
        this.sendLink(link, { type: "peer-pong", nonce: data.nonce });
        return;
      }
      if (data.type === "peer-pong" && data.nonce === link.nonce) {
        link.repliesReceived++;
        link.latency = performance.now() - link.probeAt;
        link.measured = performance.now();
        link.nonce = "";
        return;
      }
      if (typeof data.type === "string" && data.type.startsWith("party-")) {
        this.log("handshake/lobby packet", data.type);
        this.onParty(link, data);
        return;
      }
      if (!link.playerId) return;
      if (data.type === "chunk") {
        try {
          const payload = link.receiver.accept(data as unknown as RtcChunk);
          if (!payload) return;
          data = JSON.parse(payload);
        } catch {
          return;
        }
      }
      this.onData(link.playerId, data);
    });
    const remove = () => this.remove(link);
    connection.on("close", remove);
    connection.on("error", () => {
      this.status = "CONNECTION FAILED";
      remove();
    });
    return link;
  }
  associate(link: PeerLink, id: string) {
    if (this.peers.has(id) && this.peers.get(id) !== link)
      throw Error("PROFILE ALREADY CONNECTED");
    link.playerId = id;
    this.peers.set(id, link);
    this.log("player associated");
  }
  private bindMotion(link: PeerLink, channel: RTCDataChannel) {
    link.motion?.close();
    link.motion = channel;
    channel.onmessage = (event) => {
      if (
        !this.links.has(link) ||
        !link.playerId ||
        typeof event.data !== "string" ||
        event.data.length > 64000
      )
        return;
      try {
        const value = JSON.parse(event.data);
        if (value?.type !== "frame" && value?.type !== "input") return;
        link.lastSeen = performance.now();
        this.onData(link.playerId, value);
      } catch {
        /* Malformed motion never changes party/control state. */
      }
    };
  }
  sendLink(link: PeerLink, value: unknown, fast = false) {
    const type = (value as { type?: string })?.type;
    if (
      fast &&
      (type === "input" || type === "frame") &&
      link.motion?.readyState === "open"
    ) {
      if (link.motion.bufferedAmount > 8000) {
        link.motionDrops = (link.motionDrops ?? 0) + 1;
        return false;
      }
      try {
        link.motion.send(JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    }
    if (
      !link.connection.open ||
      link.connection.dataChannel?.bufferedAmount > (fast ? 24000 : 256000)
    )
      return false;
    try {
      link.connection.send(value);
      return true;
    } catch {
      return false;
    }
  }
  send(id: string, value: unknown, fast = false) {
    const link = this.peers.get(id);
    return !!link && this.sendLink(link, value, fast);
  }
  ready(id: string) {
    const p = this.peers.get(id);
    return (
      !!p && p.connection.open && p.probesReceived > 0 && p.repliesReceived > 0
    );
  }
  latency(id: string) {
    const p = this.peers.get(id);
    return p && performance.now() - p.measured < 5000 ? p.latency : null;
  }
  sendReplay(id: string, data: unknown) {
    const p = this.peers.get(id);
    if (!p || !this.ready(id)) return false;
    try {
      p.queue = rtcChunks(JSON.stringify(data), newPacketId());
      return true;
    } catch {
      return false;
    }
  }
  private probe(link: PeerLink) {
    if (!link.connection.open || link.nonce) return;
    link.nonce = newPacketId();
    link.probeAt = performance.now();
    if (this.sendLink(link, { type: "peer-ping", nonce: link.nonce }))
      link.probesSent++;
    else link.nonce = "";
  }
  pump(now: number) {
    if (this.peer?.disconnected && !this.closed && now >= this.reconnectAt) {
      this.reconnectAt = now + 2500;
      try {
        this.peer.reconnect();
      } catch {}
    }
    for (const link of this.links) {
      if (link.nonce && now - link.probeAt > 4000) link.nonce = "";
      if (link.connection.open && now - link.probeAt > 1000) this.probe(link);
      if (now - link.lastSeen > 12000) {
        this.remove(link);
        continue;
      }
      for (let i = 0; i < 2 && link.queue.length; i++) {
        if (!this.sendLink(link, link.queue[0])) break;
        link.queue.shift();
      }
    }
  }
  remove(link: PeerLink) {
    if (!this.links.delete(link)) return;
    if (link.playerId && this.peers.get(link.playerId) === link)
      this.peers.delete(link.playerId);
    link.queue = [];
    link.motionCleanup?.();
    link.motion?.close();
    link.connection.close();
    this.log("connection closed");
    this.onClose(link.playerId);
  }
  diagnostics() {
    return {
      signalingPeerId: this.peer?.id ?? null,
      signalingConnected: !!this.peer?.open && !this.peer.disconnected,
      status: this.status,
      peers: [...this.peers.entries()].map(([id, p]) => ({
        peerId: id,
        signalingPeerId: p.connection.peer,
        connectionId: p.connection.connectionId,
        connectionState:
          p.connection.peerConnection?.connectionState ?? "unknown",
        channels: {
          control: p.connection.open ? "open" : "closed",
          state: p.motion?.readyState ?? "connecting",
          replay: p.connection.open ? "open" : "closed",
        },
        motionOrdered: p.motion?.ordered,
        motionMaxRetransmits: p.motion?.maxRetransmits,
        motionBufferedBytes: p.motion?.bufferedAmount ?? 0,
        motionDropped: p.motionDrops ?? 0,
        bidirectionalVerified: p.probesReceived > 0 && p.repliesReceived > 0,
        probesSent: p.probesSent,
        probesReceived: p.probesReceived,
        repliesReceived: p.repliesReceived,
        roundTripMs: p.latency,
      })),
    };
  }
  close() {
    this.closed = true;
    const peer = this.peer;
    this.peer = null;
    for (const link of [...this.links]) this.remove(link);
    peer?.destroy();
    this.status = "";
  }
}
