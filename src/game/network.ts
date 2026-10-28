import { PacketImpairment } from "../network/impairment";
import { SnapshotBuffer } from "../network/snapshot-buffer";
import {
  SnapshotPublisher,
  motionFrame,
  readMotionFrame,
  type MotionFrame,
} from "../../shared/network-stream";
import { packInputTick, type InputTick } from "../../shared/network-events";
import { NETWORK } from "../../shared/network-tuning";
import { NetworkMetrics } from "../network/metrics";
import { sameMutators, DEFAULT_MUTATORS } from "../../shared/mutators";
import type { PartyClient } from "./party";
import { neutralInput, type PlayerInput } from "../../shared/player";
import type {
  ClientMessage,
  MatchSnapshot,
  MatchParticipant,
  ServerMessage,
} from "../../shared/network";
import { decodeReplay, type ReplayClip } from "../../shared/replay";
import { RtcPeers } from "../network/rtc-peers";
import { partyRoster } from "../../shared/match-roster";
import type { AuthorityCommand } from "../network/authority-worker";
import { peerSnapshot } from "../../shared/rtc";
import {
  CHAT,
  chatText,
  chatMessageSchema,
  type ChatMessage,
} from "../../shared/chat";

export class NetworkClient {
  readonly chatLog: ChatMessage[] = [];
  chatError = "";
  private chatSent = -Infinity;
  private pingAt = 0;
  sendChat(raw: string) {
    const text = chatText(raw),
      now = performance.now();
    if (!this.latest || !text) {
      this.chatError = "Enter a message of up to 180 characters.";
      return false;
    }
    if (now - this.chatSent < CHAT.intervalMs) {
      this.chatError = "Please wait before sending another message.";
      return false;
    }
    if (this.party.state?.transport === "webrtc") {
      const host = this.party.state.matchHostId ?? this.party.state.hostId;
      if (
        host === this.party.playerId ? !this.authority : !this.rtc.ready(host)
      ) {
        this.chatError = "Chat connection unavailable.";
        return false;
      }
    }
    if (!this.send({ type: "chat-send", matchId: this.desired, text })) {
      this.chatError = "Chat connection unavailable.";
      return false;
    }
    this.chatError = "";
    this.chatSent = now;
    return true;
  }
  setStatsDebug(enabled: boolean) {
    if (this.party.state?.hostId === this.party.playerId)
      this.command({ type: "stats-debug", enabled });
  }
  private addChat(raw: unknown) {
    const parsed = chatMessageSchema.safeParse(raw);
    if (!parsed.success) return;
    const msg = parsed.data;
    if (
      !(
        this.latest?.sessionMembers ??
        this.latest?.players ??
        (this.party.state ? partyRoster(this.party.state) : [])
      ).some((p) => p.id === msg.playerId)
    )
      return;
    if (this.chatLog.some((m) => m.id === msg.id)) return;
    this.chatLog.push(msg);
    this.chatLog.sort((a, b) => a.id - b.id);
    if (this.chatLog.length > CHAT.history)
      this.chatLog.splice(0, this.chatLog.length - CHAT.history);
  }
  private sessionMembers: MatchParticipant[] = [];
  readonly buffer = new SnapshotBuffer();
  readonly testNetwork = new PacketImpairment();
  readonly metrics = new NetworkMetrics();
  get snapshots() {
    return this.buffer.snapshots;
  }
  readonly publishers = new Map<string, SnapshotPublisher>();
  get inputSequence() {
    return this.commandSequence;
  }
  get playerInput() {
    return this.lastInput;
  }
  get roundTripMs() {
    const p = this.party.state;
    return p ? this.rtc.latency(p.matchHostId ?? p.hostId) : null;
  }
  diagnostics() {
    return {
      ...this.rtc.diagnostics(),
      ...this.metrics.report(),
      physicsTickHz: NETWORK.physicsHz,
      snapshotTargetHz: NETWORK.snapshotHz,
      roundTripMs: this.roundTripMs,
      artificialDrops: this.testNetwork.dropped,
      interpolationDelayMs: NETWORK.interpolationSeconds * 1000,
      extrapolationLimitMs: NETWORK.extrapolationSeconds * 1000,
      bufferLength: this.snapshots.length,
      droppedPackets: this.buffer.dropped,
      duplicatePackets: this.buffer.duplicates,
      outOfOrderPackets: this.buffer.outOfOrder,
    };
  }
  latest: MatchSnapshot | null = null;
  replayClip: ReplayClip | null = null;
  arrived = 0;
  status = "CONNECTING TO MATCH";
  private sequence = 0;
  private commandSequence = 0;
  private localTick = 0;
  private commands: InputTick[] = [];
  private metadata: MatchSnapshot | null = null;
  private lastInput = neutralInput();
  private inputTime = 0;
  private desired = "";
  private retryAt = 0;
  private skipSent = "";
  readonly rtc: RtcPeers;
  private authority: Worker | null = null;
  private readyPeers = new Set<string>();
  private sceneReadyPeers = new Set<string>();
  scenePrepared = false;
  private simulationStarted = false;
  prepared() {
    this.scenePrepared = true;
  }
  private replaySent = new Map<string, string>();
  private rtcReplay: ServerMessage | null = null;
  private rtcStartedAt = 0;
  private readyAt = 0;
  private endAt = 0;
  private reportedFinished = false;
  constructor(private party: PartyClient) {
    this.rtc = new RtcPeers(party);
    this.rtc.onData = (id, data) => {
      this.metrics.recordWire("receive", data);
      this.testNetwork.receive(data, () => this.peerData(id, data));
    };
    this.rtc.onClose = (id) => {
      this.readyPeers.delete(id);
      this.sceneReadyPeers.delete(id);
      this.replaySent.delete(id);
      this.publishers.delete(id);
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
    const edge =
      value.jump !== this.lastInput.jump ||
      !!value.usePowerup !== !!this.lastInput.usePowerup;
    this.lastInput = { ...value };
    this.inputTime = performance.now();
    if (edge) this.sendInput();
  }
  recordInputTick(input: PlayerInput) {
    const sequence = ++this.commandSequence;
    this.commands.push({
      sequence,
      tick: ++this.localTick,
      input: { ...input },
    });
    if (this.commands.length > NETWORK.inputBatchSize) this.commands.shift();
    return sequence;
  }
  clearInput() {
    this.commands = [];
    this.lastInput = neutralInput();
    this.inputTime = 0;
    this.sendInput();
  }
  skipReplay() {
    const replay = this.latest?.replay;
    if (
      this.latest?.phase !== "replay" ||
      !replay ||
      !replay.eligible.includes(this.party.playerId) ||
      replay.votes.includes(this.party.playerId) ||
      this.skipSent === replay.id
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
    const party = this.party.state;
    if (!party) return false;
    const host = party.matchHostId ?? party.hostId;
    if (host === this.party.playerId) {
      this.peerData(host, message);
      return true;
    }
    const sent = this.rtc.send(host, message, message.type === "input");
    if (sent) this.metrics.recordWire("send", message);
    return sent;
  }
  private sendInput() {
    if (
      !this.latest ||
      !this.latest.players.some((p) => p.id === this.party.playerId)
    )
      return;
    this.send({
      type: "input",
      matchId: this.latest.matchId,
      sequence: ++this.sequence,
      commands: this.commands.map(packInputTick),
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
      this.sessionMembers = structuredClone(this.party.state?.members ?? []);
      this.retryAt = 0;
      this.rtcStartedAt = performance.now();
    }
    if (!desired) return;
    if (this.party.state?.gameMode === "dropshot")
      for (const member of this.party.state.members)
        if (!this.sessionMembers.some((m) => m.id === member.id))
          this.sessionMembers.push(structuredClone(member));
    this.pumpRtc();
  }
  private invalidReplayId = "";
  private receive(message: ServerMessage | MotionFrame) {
    const raw = message;
    if (message.type === "frame") {
      const decoded = readMotionFrame(message, this.metadata ?? this.latest);
      if (!decoded) return;
      message = decoded;
    }
    if (message.type === "latency-probe") {
      this.send({ type: "latency-reply", nonce: message.nonce });
      return;
    }
    if (message.type === "chat-message" && message.matchId === this.desired) {
      this.addChat(message.message);
      return;
    }
    if (message.type === "chat-history" && message.matchId === this.desired) {
      for (const m of message.messages.slice(-CHAT.history)) this.addChat(m);
      return;
    }
    if (message.type === "chat-error" && message.matchId === this.desired) {
      if (message.playerId === this.party.playerId)
        this.chatError = message.message;
      return;
    }
    if (message.type === "replay" && message.matchId === this.desired) {
      try {
        this.replayClip = decodeReplay(message);
        this.invalidReplayId = "";
      } catch {
        this.replayClip = null;
        this.invalidReplayId = message.clip?.goal?.id ?? "";
        this.skipReplay();
      }
    } else if (
      message.type === "snapshot" &&
      message.matchId === this.desired
    ) {
      const now = performance.now();
      if (
        raw.type === "snapshot" &&
        (!this.metadata || raw.tick >= this.metadata.tick)
      ) {
        this.metadata = raw;
        // A reliable metadata update may follow a newer unordered motion frame.
        // Apply its roster/phase/events without rewinding any moving object.
        if (
          this.latest &&
          raw.reset === this.latest.reset &&
          raw.tick <= this.latest.tick
        ) {
          this.latest = {
            ...raw,
            tick: this.latest.tick,
            time: this.latest.time,
            cars: this.latest.cars,
            ball: this.latest.ball,
            contacts: this.latest.contacts,
          };
          for (const m of raw.chat ?? []) this.addChat(m);
          return;
        }
      }
      if (!this.buffer.push(message, now)) return;
      this.metrics.record("receive", raw, message.tick, now);
      if (this.latest && message.tick < this.latest.tick) return;
      if (this.latest && this.latest.reset !== message.reset)
        this.commands = [];
      this.latest = message;
      const ack =
        message.cars.find((c) => c.id === this.party.playerId)?.inputSequence ??
        0;
      this.commands = this.commands.filter((c) => c.sequence > ack);
      for (const m of message.chat ?? []) this.addChat(m);
      if (!message.replay) {
        this.replayClip = null;
        this.invalidReplayId = "";
        this.skipSent = "";
      }
      if (message.replay?.id === this.invalidReplayId) this.skipReplay();
      this.arrived = performance.now();
      this.status = "";
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
        if (!this.readyPeers.has(id)) {
          const member = party.members.find((m) => m.id === id);
          if (party.gameMode === "dropshot" && member?.team === "spectator")
            this.command({ type: "session-joined", member });
          this.command({ type: "connected", id });
          this.rtc.send(id, {
            type: "chat-history",
            matchId: this.desired,
            messages: this.chatLog,
          });
        }
        this.readyPeers.add(id);
      } else if ((value as { type: string }).type === "match-scene-ready") {
        this.sceneReadyPeers.add(id);
      } else if (message.type === "chat-send")
        this.command({ type: "chat", id, text: message.text });
      else if (
        message.type === "input" &&
        partyRoster(party).some((p) => p.id === id && p.controller !== "bot")
      )
        this.command({
          type: "input",
          id,
          sequence: message.sequence,
          input: message.input,
          commands: message.commands,
        });
      else if (message.type === "REPLAY_SKIP_REQUEST")
        this.command({ type: "skip", id, replayId: message.replayId });
    } else if (id === host) {
      try {
        const incoming = value as ServerMessage;
        if ((incoming as { type: string }).type === "frame") {
          this.receive(incoming as unknown as MotionFrame);
          return;
        }
        if (incoming.type === "snapshot") {
          const roster = partyRoster(party);
          const parsed = peerSnapshot(
            incoming,
            this.desired,
            roster.map((p) => p.id),
            this.sessionMembers.map((m) => m.id),
          );
          if (
            !parsed ||
            parsed.arenaId !== party.matchArenaId ||
            (parsed.gameMode ?? "soccar") !== (party.gameMode ?? "soccar") ||
            !sameMutators(
              parsed.mutators ?? DEFAULT_MUTATORS,
              party.mutators ?? DEFAULT_MUTATORS,
            )
          )
            return;
          parsed.players = roster;
          parsed.sessionMembers = this.sessionMembers;
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
        if (this.scenePrepared)
          this.rtc.send(host, {
            type: "match-scene-ready",
            matchId: this.desired,
          });
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
    for (const id of this.readyPeers)
      if (!party.members.some((m) => m.id === id)) {
        this.readyPeers.delete(id);
        this.sceneReadyPeers.delete(id);
        this.command({ type: "session-left", id });
      }
    const guests = party.members.filter((m) => m.id !== host);
    if (now - this.pingAt > 1000) {
      this.pingAt = now;
      for (const guest of guests)
        this.command({
          type: "ping",
          id: guest.id,
          value: this.rtc.latency(guest.id),
        });
    }
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
              if (guest.id !== host && this.readyPeers.has(guest.id)) {
                let publisher = this.publishers.get(guest.id);
                if (!publisher) {
                  publisher = new SnapshotPublisher();
                  this.publishers.set(guest.id, publisher);
                }
                const packet = publisher.packet(message, guest.id);
                if (packet.type === "snapshot") {
                  const motion = motionFrame(message, guest.id);
                  if (this.rtc.send(guest.id, motion, true))
                    this.metrics.recordWire("send", motion);
                }
                if (this.rtc.send(guest.id, packet, packet.type === "frame")) {
                  this.metrics.record("send", packet, message.tick);
                  this.metrics.recordWire("send", packet);
                } else publisher.invalidate();
              }
          if (message.type === "chat-message")
            for (const guest of this.party.state?.members ?? [])
              if (guest.id !== host) this.rtc.send(guest.id, message);
          if (message.type === "chat-error" && message.playerId !== host)
            this.rtc.send(message.playerId, message);
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
          mutators: party.mutators,
          players: partyRoster(party),
          sessionMembers: structuredClone(party.members),
        });
      } catch {
        this.status = "MATCH COULD NOT START";
        this.reportEnd("disconnect");
      }
    }
    if (
      this.authority &&
      !this.simulationStarted &&
      this.scenePrepared &&
      guests.every(
        (g) => this.sceneReadyPeers.has(g.id) && this.rtc.ready(g.id),
      )
    ) {
      this.simulationStarted = true;
      this.command({ type: "ready" });
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
    this.testNetwork.clear();
    this.authority?.terminate();
    this.authority = null;
    this.readyPeers.clear();
    this.sceneReadyPeers.clear();
    this.scenePrepared = false;
    this.simulationStarted = false;
    this.replaySent.clear();
    this.rtcReplay = null;
    this.readyAt = this.endAt = this.arrived = 0;
    this.reportedFinished = false;
    this.latest = null;
    this.metadata = null;
    this.commands = [];
    this.commandSequence = this.localTick = 0;
    this.sessionMembers = [];
    this.chatLog.length = 0;
    this.chatError = "";
    this.chatSent = -Infinity;
    this.pingAt = 0;
    this.replayClip = null;
    this.skipSent = "";
    this.buffer.clear();
    this.metrics.reset();
    this.publishers.clear();
    this.sequence = 0;
    this.clearInput();
  }
  sample() {
    return this.buffer.sample();
  }
}
