import type { PartyClient } from "./party";
import { neutralInput, type PlayerInput } from "../../shared/player";
import type {
  ClientMessage,
  MatchSnapshot,
  ServerMessage,
} from "../../shared/network";

export class NetworkClient {
  snapshots: MatchSnapshot[] = [];
  latest: MatchSnapshot | null = null;
  arrived = 0;
  status = "CONNECTING TO MATCH";
  private socket: WebSocket | null = null;
  private sequence = 0;
  private lastInput = neutralInput();
  private inputTime = 0;
  private desired = "";
  private retryAt = 0;
  constructor(private party: PartyClient) {
    window.setInterval(() => this.pump(), 33);
    window.addEventListener("pagehide", () => this.close());
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
  private send(message: ClientMessage) {
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
    const desired =
      this.party.state?.stage === "match"
        ? (this.party.state.matchId ?? "")
        : "";
    if (desired !== this.desired) {
      this.close();
      this.desired = desired;
      this.retryAt = 0;
    }
    if (!desired) return;
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
        const message = JSON.parse(e.data) as ServerMessage;
        if (message.type === "snapshot" && message.matchId === this.desired) {
          if (this.latest && message.tick <= this.latest.tick) return;
          if (this.latest && message.reset !== this.latest.reset)
            this.snapshots = [];
          this.latest = message;
          this.arrived = performance.now();
          this.status = "";
          this.snapshots.push(message);
          if (this.snapshots.length > 8) this.snapshots.shift();
        } else if (message.type === "error") this.status = message.message;
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
  close() {
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.close();
    }
    this.latest = null;
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
