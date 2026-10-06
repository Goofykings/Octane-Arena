import type { Garage } from "./inventory";
import type { PartyReply, PartyState, PartyActions } from "../../shared/party";
import { loadBackendEndpoints } from "./backend";
import type { IceConfig, RtcEnvelope, RtcSignal } from "../../shared/rtc";
const unavailable = "Unable to connect to multiplayer server. Try again.";
const lost = "Multiplayer connection lost. Retrying…";
export class PartyClient {
  state: PartyState | null = null;
  playerId = "local";
  message = "";
  busy = false;
  private url = "";
  private websocketUrl = "";
  private configurationError = "";
  private lastPresence = 0;
  private lastEvent = 0;
  private connected = false;
  private fingerprint = "";
  private ready: Promise<void>;
  private token = "";
  private stream: AbortController | null = null;
  private streamHealthy = false;
  connection: "offline" | "connected" = "offline";
  onSignal: (signal: RtcEnvelope) => void = () => {};
  private signalCursor = 0;
  get streaming() {
    return this.streamHealthy;
  }
  get matchConnection() {
    return {
      url: this.websocketUrl + "/api/match/socket",
      token: this.token,
    };
  }
  constructor(
    private garage: Garage,
    public changed = () => {},
  ) {
    try {
      this.token = sessionStorage.getItem("arena-party-session") ?? "";
    } catch {
      /* Isolated in-memory identity if browser storage is disabled. */
    }
    this.ready = this.initialize();
    window.setInterval(() => void this.poll(), 2000);
    window.addEventListener("pagehide", () => {
      this.stream?.abort();
      if (this.url && this.connected)
        void fetch(this.url + "/api/party/disconnect", {
          method: "POST",
          credentials: "include",
          keepalive: true,
          headers: {
            "Content-Type": "application/json",
            "X-Arena-Client": "1",
            "X-Arena-Party": this.token,
          },
          body: "{}",
        }).catch(() => {});
    });
  }
  private async initialize() {
    try {
      const endpoints = await loadBackendEndpoints();
      this.url = endpoints.apiUrl;
      this.websocketUrl = endpoints.websocketUrl;
      this.configurationError = "";
      if (!this.url) return;
      await this.connect();
    } catch (error) {
      if (!this.url) this.configurationError = (error as Error).message;
      /* Local menus remain usable when the configured backend is offline. */
    }
  }
  private apply(reply: PartyReply) {
    if (this.playerId !== reply.playerId) this.signalCursor = 0;
    this.playerId = reply.playerId;
    this.state = reply.party;
    if (reply.sessionToken) {
      this.token = reply.sessionToken;
      try {
        sessionStorage.setItem("arena-party-session", this.token);
      } catch {
        /* Party can still run in this tab. */
      }
    }
    if (reply.notice) this.message = reply.notice;
    this.changed();
  }
  private async request(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<PartyReply> {
    if (!this.url)
      throw Error(
        this.configurationError || "Multiplayer server is not configured yet.",
      );
    let r: Response;
    try {
      r = await fetch(this.url + "/api/party" + path, {
        method,
        credentials: "include",
        headers: {
          ...(method === "GET"
            ? {}
            : { "Content-Type": "application/json", "X-Arena-Client": "1" }),
          ...(this.token ? { "X-Arena-Party": this.token } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(7000),
      });
    } catch {
      throw Error(unavailable);
    }
    const data = await r.json().catch(() => null);
    if (!r.ok) {
      if (r.status >= 500 || r.status === 401) this.connection = "offline";
      if (r.status === 401) {
        this.connected = false;
        this.state = null;
        this.changed();
      }
      // Fastify's missing-route response has a string `error`, unlike our
      // structured application errors. An older running API has no party routes.
      if (r.status === 404 && data?.error?.code !== "PARTY")
        throw Error(
          "PARTY SERVER NEEDS AN UPDATE — RESTART THE BACKEND OR RUN npm run lan",
        );
      throw Error(
        data?.error?.message ??
          (typeof data?.message === "string"
            ? data.message
            : `PARTY REQUEST FAILED (${r.status})`),
      );
    }
    this.lastPresence = Date.now();
    if (r.status === 204)
      return { playerId: this.playerId, party: this.state, notice: "" };
    if (!data || typeof data.playerId !== "string" || !("party" in data))
      throw Error("INVALID PARTY SERVER RESPONSE — CHECK THE API ADDRESS");
    return data;
  }
  private async connect() {
    this.apply(
      await this.request("/session", "POST", {
        preset: this.garage.current,
        profile: this.identity(),
        newSession: !this.token,
      }),
    );
    this.connected = true;
    this.connection = "connected";
    this.fingerprint = this.signature();
    this.lastPresence = Date.now();
    this.openStream();
  }
  private openStream() {
    if (this.stream || !this.connected) return;
    const controller = new AbortController();
    this.stream = controller;
    this.streamHealthy = false;
    this.lastEvent = Date.now();
    void (async () => {
      try {
        const response = await fetch(this.url + "/api/party/events", {
          credentials: "include",
          headers: { "X-Arena-Party": this.token },
          signal: controller.signal,
        });
        if (
          !response.ok ||
          !response.body ||
          !response.headers.get("content-type")?.includes("text/event-stream")
        )
          return;
        this.streamHealthy = true;
        const reader = response.body.getReader(),
          decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          this.lastEvent = Date.now();
          buffer += decoder.decode(value, { stream: true });
          let end: number;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const event = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            if (event.startsWith("data: "))
              this.apply(JSON.parse(event.slice(6)));
            else if (event.startsWith("event: signal\ndata: "))
              this.deliverSignal(
                JSON.parse(event.slice("event: signal\ndata: ".length)),
              );
          }
        }
      } catch {
        // The existing poll reconnects and remains a fallback on older APIs.
      } finally {
        if (this.stream === controller) {
          this.stream = null;
          this.streamHealthy = false;
        }
      }
    })();
  }
  private signature() {
    return JSON.stringify([this.garage.current, this.garage.profile]);
  }
  private deliverSignal(signal: RtcEnvelope) {
    if (
      !Number.isSafeInteger(signal.sequence) ||
      signal.sequence <= this.signalCursor
    )
      return;
    this.signalCursor = signal.sequence;
    this.onSignal(signal);
  }
  async signal(signal: RtcSignal) {
    await this.ready;
    await this.request("/signal", "POST", signal);
  }
  private async rtcRequest<T>(path: string): Promise<T> {
    await this.ready;
    if (!this.url || !this.token) throw Error(unavailable);
    const response = await fetch(this.url + "/api/party/" + path, {
      credentials: "include",
      headers: { "X-Arena-Party": this.token },
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw Error(unavailable);
    return response.json();
  }
  iceConfig() {
    return this.rtcRequest<IceConfig>("rtc-config");
  }
  async recoverSignals() {
    const result = await this.rtcRequest<{ signals: RtcEnvelope[] }>(
      "signals?after=" + this.signalCursor,
    );
    for (const signal of result.signals) this.deliverSignal(signal);
  }
  private identity() {
    const p = this.garage.profile;
    return {
      localPlayerId: p.localPlayerId,
      name: p.name,
      avatarId: p.avatarId,
      avatarColor: p.avatarColor,
    };
  }
  async action(
    action: keyof PartyActions,
    data: PartyActions[keyof PartyActions] = {},
  ) {
    if (this.busy) return false;
    this.busy = true;
    this.message = "";
    this.changed();
    try {
      await this.ready;
      if (!this.connected) await this.connect();
      this.apply(await this.request("/" + action, "POST", data));
      return true;
    } catch (e) {
      if ((e as Error).message === unavailable) this.connection = "offline";
      this.message = e instanceof Error ? e.message : "PARTY REQUEST FAILED";
      return false;
    } finally {
      this.busy = false;
      this.changed();
    }
  }
  async retry() {
    if (this.busy) return;
    this.busy = true;
    this.message = "";
    this.changed();
    try {
      await this.ready;
      this.stream?.abort();
      this.stream = null;
      this.streamHealthy = false;
      this.connected = false;
      this.url = "";
      const endpoints = await loadBackendEndpoints();
      this.url = endpoints.apiUrl;
      this.websocketUrl = endpoints.websocketUrl;
      this.configurationError = "";
      await this.connect();
    } catch (error) {
      this.connection = "offline";
      this.message = (error as Error).message;
    } finally {
      this.busy = false;
      this.changed();
    }
  }
  private async poll() {
    await this.ready;
    if (!this.url || this.busy) return;
    if (this.stream && Date.now() - this.lastEvent > 15000) {
      this.stream.abort();
      this.stream = null;
      this.streamHealthy = false;
    }
    const signature = this.signature();
    if (
      this.streamHealthy &&
      signature === this.fingerprint &&
      Date.now() - this.lastPresence < 10000
    )
      return;
    this.busy = true;
    this.changed();
    try {
      if (!this.connected) await this.connect();
      this.openStream();
      const streaming = this.streamHealthy;
      const reply =
        signature !== this.fingerprint
          ? await this.request("/appearance", "PUT", {
              preset: this.garage.current,
              profile: this.identity(),
            })
          : streaming
            ? await this.request("/heartbeat", "POST", {})
            : await this.request("");
      this.fingerprint = signature;
      this.connection = "connected";
      this.apply(reply);
      if (this.message === lost || this.message === unavailable)
        this.message = "";
    } catch (e) {
      this.connection = "offline";
      if (this.state || this.message)
        this.message = this.connected ? lost : (e as Error).message;
      this.changed();
    } finally {
      this.busy = false;
      this.changed();
    }
  }
}
