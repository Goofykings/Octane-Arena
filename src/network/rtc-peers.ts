import type { PartyClient } from "../game/party";
import {
  RtcChunkReceiver,
  rtcChunks,
  type IceConfig,
  type RtcChunk,
  type RtcEnvelope,
  type RtcSignal,
} from "../../shared/rtc";

interface Peer {
  id: string;
  connectionId: string;
  pc: RTCPeerConnection;
  control?: RTCDataChannel;
  state?: RTCDataChannel;
  bulk?: RTCDataChannel;
  queue: RtcChunk[];
  receiver: RtcChunkReceiver;
  candidates: RTCIceCandidateInit[];
  signalChain: Promise<unknown>;
  created: number;
  seen: number;
  pingAt: number;
}
/** Star topology: every guest connects to the party host. Signaling never
 * transports game inputs or snapshots. Peer identity comes from party sessions. */
export class RtcPeers {
  readonly peers = new Map<string, Peer>();
  status = "CONNECTING TO PLAYERS";
  private context = "";
  private configuration: IceConfig | null = null;
  private loading = false;
  private configuredAt = 0;
  private retryAt = 0;
  private recoveryAt = 0;
  private recoveryBusy = false;
  private peerRetry = new Map<string, number>();
  private receiveChain: Promise<unknown> = Promise.resolve();
  onData: (id: string, data: unknown) => void = () => {};
  onClose: (id: string) => void = () => {};
  constructor(private party: PartyClient) {
    party.onSignal = (signal) => {
      this.receiveChain = this.receiveChain
        .then(() => this.signal(signal))
        .catch(() => {
          this.status = "PLAYER CONNECTION UNAVAILABLE — RETRYING";
        });
    };
  }
  ready(id: string) {
    const p = this.peers.get(id);
    return (
      !!p &&
      p.control?.readyState === "open" &&
      p.state?.readyState === "open" &&
      p.bulk?.readyState === "open"
    );
  }
  send(id: string, data: unknown, fast = false) {
    const p = this.peers.get(id),
      channel = fast ? p?.state : p?.control;
    if (
      !channel ||
      channel.readyState !== "open" ||
      channel.bufferedAmount > 16000
    )
      return false;
    const serialized = JSON.stringify(data);
    if (serialized.length > 16000) return false;
    try {
      channel.send(serialized);
      return true;
    } catch {
      return false;
    }
  }
  sendReplay(id: string, data: unknown) {
    const p = this.peers.get(id);
    if (!p || !this.ready(id)) return false;
    try {
      p.queue = rtcChunks(JSON.stringify(data), crypto.randomUUID());
      return true;
    } catch {
      this.status = "REPLAY TRANSFER UNAVAILABLE";
      return false;
    }
  }
  private remove(id: string) {
    const p = this.peers.get(id);
    if (!p) return;
    this.peers.delete(id);
    this.peerRetry.set(id, performance.now() + 1500);
    p.pc.onconnectionstatechange = null;
    p.control?.close();
    p.state?.close();
    p.bulk?.close();
    p.pc.close();
    this.onClose(id);
  }
  private bind(p: Peer, channel: RTCDataChannel) {
    if (!["control", "state", "replay"].includes(channel.label)) {
      channel.close();
      return;
    }
    const key =
      channel.label === "replay"
        ? "bulk"
        : (channel.label as "control" | "state");
    if (p[key]) {
      channel.close();
      return;
    }
    p[key] = channel;
    channel.onopen = () => {
      p.seen = performance.now();
      this.status = "";
    };
    channel.onmessage = (event) => {
      if (
        this.peers.get(p.id) !== p ||
        typeof event.data !== "string" ||
        event.data.length > 24000
      )
        return;
      try {
        let data = JSON.parse(event.data);
        p.seen = performance.now();
        if (channel.label === "replay") {
          const payload = p.receiver.accept(data);
          if (!payload) return;
          data = JSON.parse(payload);
        }
        if (data.type !== "ping") this.onData(p.id, data);
      } catch {
        this.status = "INVALID PLAYER CONNECTION DATA";
      }
    };
    channel.onclose = () => {
      if (this.peers.get(p.id) === p) this.remove(p.id);
    };
    channel.onerror = () => {
      this.status = "PLAYER CONNECTION UNAVAILABLE — RETRYING";
    };
  }
  private create(id: string, connectionId: string, offer: boolean) {
    this.remove(id);
    const config = this.configuration!;
    const pc = new RTCPeerConnection({
      iceServers: config.iceServers,
      iceTransportPolicy: config.iceTransportPolicy,
    });
    const p: Peer = {
      id,
      connectionId,
      pc,
      queue: [],
      receiver: new RtcChunkReceiver(),
      candidates: [],
      signalChain: Promise.resolve(),
      created: performance.now(),
      seen: performance.now(),
      pingAt: 0,
    };
    this.peers.set(id, p);
    pc.onicecandidate = (event) => {
      if (event.candidate)
        this.sendSignal(p, {
          kind: "candidate",
          candidate: {
            ...event.candidate.toJSON(),
            candidate: event.candidate.candidate,
          },
        });
    };
    pc.ondatachannel = (event) => this.bind(p, event.channel);
    pc.onconnectionstatechange = () => {
      if (this.peers.get(id) !== p) return;
      if (pc.connectionState === "failed" || pc.connectionState === "closed")
        this.remove(id);
    };
    if (offer) {
      this.bind(p, pc.createDataChannel("control", { ordered: true }));
      this.bind(
        p,
        pc.createDataChannel("state", { ordered: false, maxRetransmits: 0 }),
      );
      this.bind(p, pc.createDataChannel("replay", { ordered: true }));
    }
    return p;
  }
  private sendSignal(p: Peer, data: RtcSignal["data"]) {
    p.signalChain = p.signalChain
      .then(async () => {
        if (this.peers.get(p.id) !== p) return;
        await this.party.signal({
          to: p.id,
          connectionId: p.connectionId,
          data,
        });
      })
      .catch(() => {
        this.status = "CONNECTION SETUP FAILED — RETRYING";
      });
  }
  private async signal(signal: RtcEnvelope) {
    this.pump(performance.now());
    const party = this.party.state;
    if (
      !party ||
      party.transport !== "webrtc" ||
      signal.code !== party.code ||
      signal.to !== this.party.playerId ||
      !party.members.some((m) => m.id === signal.from)
    )
      return;
    if (!this.configuration) {
      const expected = this.context;
      const config = await this.party.iceConfig();
      if (this.context !== expected) return;
      this.configuration = config;
      this.configuredAt = performance.now();
    }
    let p = this.peers.get(signal.from);
    if (
      signal.data.kind === "description" &&
      signal.data.description.type === "offer"
    ) {
      if (signal.from !== party.hostId || party.hostId === this.party.playerId)
        return;
      if (!p || p.connectionId !== signal.connectionId)
        p = this.create(signal.from, signal.connectionId, false);
      await p.pc.setRemoteDescription(signal.data.description);
      for (const candidate of p.candidates.splice(0))
        await p.pc.addIceCandidate(candidate);
      await p.pc.setLocalDescription(await p.pc.createAnswer());
      this.sendSignal(p, {
        kind: "description",
        description: { type: "answer", sdp: p.pc.localDescription!.sdp },
      });
    } else if (signal.data.kind === "description") {
      if (
        !p ||
        p.connectionId !== signal.connectionId ||
        party.hostId !== this.party.playerId ||
        p.pc.signalingState !== "have-local-offer"
      )
        return;
      await p.pc.setRemoteDescription(signal.data.description);
      for (const candidate of p.candidates.splice(0))
        await p.pc.addIceCandidate(candidate);
    } else {
      // ICE can arrive before the offer HTTP request, so retain it for that peer.
      if (
        !p &&
        signal.from === party.hostId &&
        party.hostId !== this.party.playerId
      )
        p = this.create(signal.from, signal.connectionId, false);
      if (!p || p.connectionId !== signal.connectionId) return;
      if (p.pc.remoteDescription)
        await p.pc.addIceCandidate(signal.data.candidate);
      else if (p.candidates.length < 64)
        p.candidates.push(signal.data.candidate);
    }
  }
  pump(now: number) {
    const party = this.party.state;
    const context =
      party?.transport === "webrtc"
        ? `${party.code}:${party.hostId}:${this.party.playerId}`
        : "";
    if (context !== this.context) {
      for (const id of [...this.peers.keys()]) this.remove(id);
      this.context = context;
      this.configuration = null;
      this.retryAt = 0;
      this.peerRetry.clear();
    }
    if (!context || !party) return;
    if (typeof RTCPeerConnection === "undefined") {
      this.status = "THIS BROWSER DOES NOT SUPPORT MULTIPLAYER CONNECTIONS";
      return;
    }
    if (!this.configuration && !this.loading && now >= this.retryAt) {
      this.loading = true;
      const expected = context;
      void this.party
        .iceConfig()
        .then((config) => {
          if (this.context === expected) {
            this.configuration = config;
            this.configuredAt = performance.now();
          }
        })
        .catch(() => {
          this.status = "CONNECTION SETUP UNAVAILABLE — RETRYING";
          this.retryAt = performance.now() + 3000;
        })
        .finally(() => {
          this.loading = false;
        });
    }
    const wanted =
      party.hostId === this.party.playerId
        ? party.members.filter((m) => m.id !== party.hostId).map((m) => m.id)
        : [party.hostId];
    for (const [id, p] of this.peers) {
      if (
        !wanted.includes(id) ||
        (this.ready(id) ? now - p.seen > 10000 : now - p.created > 20000)
      ) {
        this.remove(id);
        continue;
      }
      if (this.ready(id)) {
        if (now - p.pingAt > 1000) {
          this.send(id, { type: "ping" });
          p.pingAt = now;
        }
        while (p.queue.length && p.bulk!.bufferedAmount < 32768) {
          try {
            p.bulk!.send(JSON.stringify(p.queue[0]));
            p.queue.shift();
          } catch {
            break;
          }
        }
      }
    }
    if (this.configuration && party.hostId === this.party.playerId)
      for (const id of wanted)
        if (!this.peers.has(id) && now >= (this.peerRetry.get(id) ?? 0)) {
          const p = this.create(id, crypto.randomUUID(), true);
          void (async () => {
            await p.pc.setLocalDescription(await p.pc.createOffer());
            if (this.peers.get(id) !== p) return;
            this.sendSignal(p, {
              kind: "description",
              description: { type: "offer", sdp: p.pc.localDescription!.sdp },
            });
          })().catch(() => {
            this.remove(id);
            this.status = "PLAYER CONNECTION UNAVAILABLE — RETRYING";
          });
        }
    if (!this.party.streaming && !this.recoveryBusy && now >= this.recoveryAt) {
      this.recoveryBusy = true;
      this.recoveryAt = now + 1000;
      void this.party
        .recoverSignals()
        .catch(() => {})
        .finally(() => {
          this.recoveryBusy = false;
        });
    }
    // Refresh temporary TURN credentials for future reconnections.
    if (this.configuration && now - this.configuredAt > 3000000)
      this.configuration = null;
  }
  close() {
    for (const id of [...this.peers.keys()]) this.remove(id);
    this.context = "";
    this.configuration = null;
  }
}
