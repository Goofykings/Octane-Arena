import Peer, { DataConnection } from "peerjs";
import type { PlayerInput } from "../../shared/player";
import type { MatchSnapshot } from "../../shared/network";

export type PeerMessage =
  | { type: "input"; input: PlayerInput; tick: number }
  | { type: "snapshot"; snapshot: MatchSnapshot }
  | { type: "ping"; time: number }
  | { type: "pong"; time: number }
  | { type: "join"; preset: unknown }
  | { type: "ready" }
  | { type: "start" }
  | { type: "state"; phase: string; score: number[] }
  | { type: "goal"; scorerId: string; team: number }
  | { type: "replay"; clip: unknown };

export interface PeerConnectionEvents {
  onConnect: (peerId: string) => void;
  onDisconnect: (peerId: string) => void;
  onMessage: (peerId: string, message: PeerMessage) => void;
  onError: (error: Error) => void;
  onCodeGenerated: (code: string) => void;
}

export class PeerConnection {
  private peer: Peer | null = null;
  private connections = new Map<string, DataConnection>();
  private events: Partial<PeerConnectionEvents> = {};
  private myCode = "";
  private targetCode = "";
  private isHost = false;
  private pendingConnections = new Set<string>();
  private pingInterval: number | null = null;
  private lastPing = 0;
  private rtt = 0;

  on<K extends keyof PeerConnectionEvents>(
    event: K,
    handler: PeerConnectionEvents[K],
  ) {
    this.events[event] = handler;
  }

  private emit<K extends keyof PeerConnectionEvents>(
    event: K,
    ...args: Parameters<PeerConnectionEvents[K]>
  ) {
    const handler = this.events[event] as ((...args: Parameters<PeerConnectionEvents[K]>) => void) | undefined;
    if (handler) handler(...args);
  }

  generateCode(): string {
    this.myCode = Math.floor(100000 + Math.random() * 900000).toString();
    this.isHost = true;
    this.initPeer(this.myCode);
    return this.myCode;
  }

  joinCode(code: string): Promise<void> {
    this.targetCode = code;
    this.isHost = false;
    this.initPeer(this.generateTempId());
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Connection timeout")), 15000);
      const checkConnection = () => {
        if (this.connections.has(code)) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(checkConnection, 100);
        }
      };
      checkConnection();
    });
  }

  private generateTempId(): string {
    return "temp-" + Math.random().toString(36).substring(2, 10);
  }

  private initPeer(id: string) {
    this.peer = new Peer(id, {
      debug: 1,
      config: {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun2.l.google.com:19302" },
        ],
        iceCandidatePoolSize: 10,
      },
    });

    this.peer.on("open", (peerId) => {
      console.log("[Peer] My peer ID:", peerId);
      if (!this.isHost) {
        this.connectToHost();
      }
    });

    this.peer.on("connection", (conn) => this.setupConnection(conn));

    this.peer.on("error", (err) => {
      console.error("[Peer] Error:", err);
      this.emit("onError", err);
    });

    this.peer.on("close", () => {
      console.log("[Peer] Peer closed");
    });
  }

  private connectToHost() {
    if (!this.peer || !this.targetCode) return;
    console.log("[Peer] Connecting to host:", this.targetCode);
    const conn = this.peer.connect(this.targetCode, {
      reliable: true,
      metadata: { code: this.targetCode },
    });
    this.setupConnection(conn);
  }

  private setupConnection(conn: DataConnection) {
    conn.on("open", () => {
      console.log("[Peer] Connection opened with:", conn.peer);
      this.connections.set(conn.peer, conn);
      this.pendingConnections.delete(conn.peer);
      this.emit("onConnect", conn.peer);
      this.startPing(conn.peer);
      if (this.isHost) {
        this.send(conn.peer, { type: "ready" });
      }
    });

    conn.on("data", (data: unknown) => {
      this.handleMessage(conn.peer, data as PeerMessage);
    });

    conn.on("close", () => {
      console.log("[Peer] Connection closed with:", conn.peer);
      this.connections.delete(conn.peer);
      this.stopPing(conn.peer);
      this.emit("onDisconnect", conn.peer);
    });

    conn.on("error", (err: Error) => {
      console.error("[Peer] Connection error:", err);
      this.emit("onError", err);
    });
  }

  private handleMessage(peerId: string, message: PeerMessage) {
    if (message.type === "pong") {
      this.rtt = performance.now() - message.time;
      return;
    }
    if (message.type === "ping") {
      this.send(peerId, { type: "pong", time: message.time });
      return;
    }
    this.emit("onMessage", peerId, message);
  }

  private startPing(peerId: string) {
    this.pingInterval = window.setInterval(() => {
      const conn = this.connections.get(peerId);
      if (conn && conn.open) {
        this.lastPing = performance.now();
        this.send(peerId, { type: "ping", time: this.lastPing });
      }
    }, 1000);
  }

  private stopPing(peerId: string) {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  send(peerId: string, message: PeerMessage) {
    const conn = this.connections.get(peerId);
    if (conn && conn.open) {
      conn.send(message);
    }
  }

  broadcast(message: PeerMessage) {
    for (const [peerId, conn] of this.connections) {
      if (conn.open) conn.send(message);
    }
  }

  sendInput(input: PlayerInput, tick: number) {
    this.broadcast({ type: "input", input, tick });
  }

  sendSnapshot(snapshot: MatchSnapshot) {
    this.broadcast({ type: "snapshot", snapshot });
  }

  sendState(phase: string, score: number[]) {
    this.broadcast({ type: "state", phase, score });
  }

  sendGoal(scorerId: string, team: number) {
    this.broadcast({ type: "goal", scorerId, team });
  }

  sendReplay(clip: unknown) {
    this.broadcast({ type: "replay", clip });
  }

  getRTT(): number {
    return this.rtt;
  }

  getConnectedPeers(): string[] {
    return Array.from(this.connections.keys()).filter(
      (id) => this.connections.get(id)?.open,
    );
  }

  isConnected(): boolean {
    return this.connections.size > 0 && this.getConnectedPeers().length > 0;
  }

  close() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    for (const conn of this.connections.values()) {
      conn.close();
    }
    this.connections.clear();
    this.peer?.destroy();
    this.peer = null;
  }

  getMyCode(): string {
    return this.myCode;
  }

  getTargetCode(): string {
    return this.targetCode;
  }

  getIsHost(): boolean {
    return this.isHost;
  }
}

export const peerConnection = new PeerConnection();