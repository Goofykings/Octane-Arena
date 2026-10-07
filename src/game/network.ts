import type { PartyClient } from "./party";
import { neutralInput, type PlayerInput } from "../../shared/player";
import type {
  ClientMessage,
  MatchSnapshot,
  ServerMessage,
} from "../../shared/network";
import { decodeReplay, type ReplayClip } from "../../shared/replay";
import { RtcPeers } from "../network/rtc-peers";
import { partyRoster } from "../../shared/match-roster";
import type { AuthorityCommand } from "../network/authority-worker";
import { peerSnapshot } from "../../shared/rtc";

export class NetworkClient {
  snapshots: MatchSnapshot[] = [];
  latest: MatchSnapshot | null = null;
  replayClip: ReplayClip | null = null;
  arrived = 0;
  status = "CONNECTING TO MATCH";
  private socket: WebSocket | null = null;
  private sequence = 0;
  private lastInput = neutralInput();
  private inputTime = 0;
  private desired = "";
  private retryAt = 0;
  private skipSent = "";
  readonly rtc: RtcPeers;
  private authority: Worker | null = null;
  private readyPeers = new Set<string>();
  private replaySent = new Map<string, string>();
  private rtcReplay: ServerMessage | null = null;
  private rtcStartedAt = 0;
  private readyAt = 0;
  private endAt = 0;
  private reportedFinished = false;
  constructor(private party: PartyClient) {
    this.rtc = new RtcPeers(party);
    this.rtc.onData = (id, data) => this.peerData(id, data);
    this.rtc.onClose = (id) => {
      this.readyPeers.delete(id);
      this.replaySent.delete(id);
      this.command({ type: "disconnected", id });
    };
    window.setInterval(() => this.pump(), 33);
    window.addEventListener("pagehide", () => {
      this.close();
      this.rtc.close();
    });
    window.addEventListener("blur", () => this.clearInput());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.clearInput();
    });
  }
  input(value: PlayerInput) {
    const edge = value.jump !== this.lastInput.jump;
    this.lastInput = { ...value };
    this.inputTime = performance.now();
    if (edge) this.sendInput();
  }
  clearInput() {
    this.lastInput = neutralInput();
    this.inputTime = 0;
    this.sendInput();
  }
  skipReplay() {
    const replay = this.latest?.replay;
    if (
      this.latest?.phase !== "replay" ||
      !replay ||
      replay.votes.includes(this.party.playerId) ||
      this.skipSent === replay.id ||
      (this.party.state?.transport !== "webrtc" &&
        this.socket?.readyState !== WebSocket.OPEN)
    )
      return;
    this.send({
      type: "REPLAY_SKIP_REQUEST",
      matchId: this.latest.matchId,
      replayId: replay.id,
    });
    this.skipSent = replay.id;
  }
  private send(message: ClientMessage) {
    if (this.party.state?.transport === "webrtc") {
      const host = this.party.state.matchHostId ?? this.party.state.hostId;
      if (host === this.party.playerId) this.peerData(host, message);
      else this.rtc.send(host, message);
      return;
    }
    if (
      this.socket?.readyState === WebSocket.OPEN &&
      this.socket.bufferedAmount < 16000
    )
      this.socket.send(JSON.stringify(message));
  }
  private sendInput() {
    if (!this.latest) return;
    this.send({
      type: "input",
      matchId: this.latest.matchId,
      sequence: ++this.sequence,
      input:
        performance.now() - this.inputTime < 150
          ? this.lastInput
          : neutralInput(),
    });
  }
  private pump() {
    this.rtc.pump(performance.now());
    const desired =
      this.party.state?.stage === "match"
        ? (this.party.state.matchId ?? "")
        : "";
    if (desired !== this.desired) {
      this.close();
      this.desired = desired;
      this.retryAt = 0;
      this.rtcStartedAt = performance.now();
    }
    if (!desired) return;
    if (this.party.state?.transport === "webrtc") {
      this.pumpRtc();
      return;
    }
    if (!this.socket && performance.now() >= this.retryAt) this.connect();
    this.sendInput();
    if (this.latest && performance.now() - this.arrived > 1500)
      this.status = "CONNECTION LOST — RECONNECTING";
    if (this.socket && this.arrived && performance.now() - this.arrived > 4000)
      this.socket.close();
  }
  private connect() {
    const credentials = this.party.matchConnection;
    if (!credentials.token) return;
    const socket = (this.socket = new WebSocket(credentials.url));
    this.status = "CONNECTING TO MATCH";
    this.arrived = performance.now();
    socket.onopen = () => this.send({ type: "auth", token: credentials.token });
    socket.onmessage = (e) => {
      if (this.socket !== socket) return;
      try {
        this.receive(JSON.parse(e.data) as ServerMessage);
      } catch {
        this.status = "INVALID MATCH RESPONSE";
      }
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.retryAt = performance.now() + 800;
      this.status = "CONNECTION LOST — RECONNECTING";
    };
    socket.onerror = () => {
      this.status = "MATCH CONNECTION UNAVAILABLE";
    };
  }
  private receive(message: ServerMessage) {
    if (message.type === "replay" && message.matchId === this.desired) {
      this.replayClip = decodeReplay(message);
    } else if (
      message.type === "snapshot" &&
      message.matchId === this.desired
    ) {
      if (this.latest && message.tick <= this.latest.tick) return;
      if (this.latest && message.reset !== this.latest.reset)
        this.snapshots = [];
      this.latest = message;
      if (!message.replay) {
        this.replayClip = null;
        this.skipSent = "";
      }
      this.arrived = performance.now();
      this.status = "";
      this.snapshots.push(message);
      if (this.snapshots.length > 8) this.snapshots.shift();
    } else if (message.type === "error") this.status = message.message;
  }
  private command(message: AuthorityCommand) {
    this.authority?.postMessage(message);
  }
  private peerData(id: string, value: unknown) {
    const party = this.party.state;
    if (
      party?.transport !== "webrtc" ||
      party.stage !== "match" ||
      !value ||
      typeof value !== "object"
    )
      return;
    const message = value as ClientMessage & { type: string; matchId?: string };
    const host = party.matchHostId ?? party.hostId;
    if (message.matchId !== this.desired) return;
    if (host === this.party.playerId) {
      if (!party.members.some((m) => m.id === id)) return;
      if ((value as { type: string }).type === "match-ready") {
        if (!this.readyPeers.has(id)) this.command({ type: "connected", id });
        this.readyPeers.add(id);
      } else if (message.type === "input")
        this.command({
          type: "input",
          id,
          sequence: message.sequence,
          input: message.input,
        });
      else if (message.type === "REPLAY_SKIP_REQUEST")
        this.command({ type: "skip", id, replayId: message.replayId });
    } else if (id === host) {
      try {
        const incoming = value as ServerMessage;
        if (incoming.type === "snapshot") {
          const roster = partyRoster(party);
          const parsed = peerSnapshot(
            incoming,
            this.desired,
            roster.map((p) => p.id),
          );
          if (!parsed || parsed.arenaId !== party.matchArenaId ||
            (parsed.gameMode ?? "soccar") !== (party.gameMode ?? "soccar")) return;
          parsed.players = roster;
          this.receive(parsed);
          return;
        }
        this.receive(incoming);
      } catch {
        this.status = "INVALID MATCH RESPONSE";
      }
    }
  }
  private reportEnd(reason: "finished" | "disconnect") {
    const now = performance.now();
    if (now < this.endAt || this.party.busy || !this.desired) return;
    this.endAt = now + 1000;
    void this.party
      .action("rtc-end", { matchId: this.desired, reason })
      .then((ok) => {
        if (ok && reason === "finished") this.reportedFinished = true;
      });
  }
  private pumpRtc() {
    const party = this.party.state!;
    const now = performance.now(),
      host = party.matchHostId ?? party.hostId;
    if (host !== this.party.playerId) {
      if (this.rtc.ready(host) && now >= this.readyAt) {
        this.rtc.send(host, { type: "match-ready", matchId: this.desired });
        this.readyAt = now + 500;
      }
      this.sendInput();
      if (!this.latest)
        this.status = this.rtc.status || "WAITING FOR HOST TO START THE MATCH";
      else if (now - this.arrived > 1500)
        this.status = "PLAYER CONNECTION LOST — RECONNECTING";
      if (now - Math.max(this.arrived, this.rtcStartedAt) > 30000)
        this.reportEnd("disconnect");
      return;
    }
    const guests = party.members.filter((m) => m.id !== host);
    for (const guest of guests)
      if (this.rtc.ready(guest.id)) {
        if (
          this.rtcReplay?.type === "replay" &&
          this.latest?.replay?.id === this.rtcReplay.clip.goal.id &&
          this.replaySent.get(guest.id) !== this.rtcReplay.clip.goal.id
        ) {
          if (this.rtc.sendReplay(guest.id, this.rtcReplay))
            this.replaySent.set(guest.id, this.rtcReplay.clip.goal.id);
        }
      }
    if (
      !this.authority &&
      guests.every((g) => this.readyPeers.has(g.id) && this.rtc.ready(g.id))
    ) {
      try {
        const authority = (this.authority = new Worker(
          new URL("../network/authority-worker.ts", import.meta.url),
          { type: "module" },
        ));
        authority.onmessage = (event) => {
          if (this.authority !== authority) return;
          const message = event.data as ServerMessage;
          try {
            this.receive(message);
          } catch {
            this.status = "INVALID MATCH RESPONSE";
          }
          if (message.type === "replay") {
            this.rtcReplay = message;
            this.replaySent.clear();
          }
          if (message.type === "snapshot")
            for (const guest of this.party.state?.members ?? [])
              if (guest.id !== host && this.readyPeers.has(guest.id))
                this.rtc.send(guest.id, message, true);
          if (message.type === "error") this.reportEnd("disconnect");
        };
        authority.onerror = () => {
          this.status = "MATCH COULD NOT START";
          this.reportEnd("disconnect");
        };
        this.command({
          type: "start",
          matchId: this.desired,
          arenaId: party.matchArenaId!,
          gameMode: party.gameMode ?? "soccar",
          players: partyRoster(party),
        });
      } catch {
        this.status = "MATCH COULD NOT START";
        this.reportEnd("disconnect");
      }
    }
    this.sendInput();
    if (this.latest?.phase === "finished" && !this.reportedFinished)
      this.reportEnd("finished");
    if (!this.latest) this.status = this.rtc.status || "WAITING FOR PLAYERS";
    if (!this.latest && now - this.rtcStartedAt > 30000)
      this.reportEnd("disconnect");
    if (this.authority && guests.some((g) => !this.rtc.ready(g.id))) {
      if (!this.retryAt) this.retryAt = now + 15000;
      this.status = "PLAYER CONNECTION LOST — RECONNECTING";
      if (now > this.retryAt) this.reportEnd("disconnect");
    } else this.retryAt = 0;
  }
  close() {
    this.authority?.terminate();
    this.authority = null;
    this.readyPeers.clear();
    this.replaySent.clear();
    this.rtcReplay = null;
    this.readyAt = this.endAt = this.arrived = 0;
    this.reportedFinished = false;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.close();
    }
    this.latest = null;
    this.replayClip = null;
    this.skipSent = "";
    this.snapshots = [];
    this.sequence = 0;
    this.clearInput();
  }
  sample() {
    if (!this.latest) return null;
    const target =
      this.latest.time +
      Math.min((performance.now() - this.arrived) / 1000, 0.1) -
      0.05;
    const newer = this.snapshots.find((s) => s.time >= target) ?? this.latest;
    const index = this.snapshots.indexOf(newer),
      older = this.snapshots[Math.max(0, index - 1)] ?? newer;
    const alpha =
      older === newer
        ? 1
        : Math.max(
            0,
            Math.min(1, (target - older.time) / (newer.time - older.time)),
          );
    return { older, newer, alpha };
  }
}
