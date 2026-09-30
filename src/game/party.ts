import type { Garage } from "./inventory";
import type { PartyReply, PartyState, PartyActions } from "../../shared/party";
import { loadBackendEndpoints } from "./backend";
export class PartyClient {
  state: PartyState | null = null;
  playerId = "local";
  message = "";
  busy = false;
  private url = "";
  private connected = false;
  private fingerprint = "";
  private ready: Promise<void>;
  private token = "";
  private stream: AbortController | null = null;
  connection: "offline" | "connected" = "offline";
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
      this.url = (await loadBackendEndpoints()).apiUrl;
      if (!this.url) return;
      await this.connect();
    } catch {
      /* Local menus remain usable when the configured backend is offline. */
    }
  }
  private apply(reply: PartyReply) {
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
      throw Error("PARTIES ARE NOT CONNECTED — SET THE API ADDRESS");
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
      throw Error("PARTY SERVICE UNAVAILABLE");
    }
    const data = await r.json().catch(() => null);
    if (!r.ok) {
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
    if (!data || typeof data.playerId !== "string" || !("party" in data))
      throw Error("INVALID PARTY SERVER RESPONSE — CHECK THE API ADDRESS");
    return data;
  }
  private async connect() {
    this.apply(
      await this.request("/session", "POST", {
        preset: this.garage.current,
        newSession: !this.token,
      }),
    );
    this.connected = true;
    this.connection = "connected";
    this.fingerprint = this.signature();
    this.openStream();
  }
  private openStream() {
    if (this.stream || !this.connected) return;
    const controller = new AbortController();
    this.stream = controller;
    void (async () => {
      try {
        const response = await fetch(this.url + "/api/party/events", {
          credentials: "include",
          headers: { "X-Arena-Party": this.token },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) return;
        const reader = response.body.getReader(),
          decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let end: number;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const event = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            if (event.startsWith("data: "))
              this.apply(JSON.parse(event.slice(6)));
          }
        }
      } catch {
        // The existing poll reconnects and remains a fallback on older APIs.
      } finally {
        if (this.stream === controller) this.stream = null;
      }
    })();
  }
  private signature() {
    return JSON.stringify([this.garage.current, this.garage.profile]);
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
      this.message = e instanceof Error ? e.message : "PARTY REQUEST FAILED";
      return false;
    } finally {
      this.busy = false;
      this.changed();
    }
  }
  private async poll() {
    await this.ready;
    if (!this.url || this.busy) return;
    this.busy = true;
    try {
      if (!this.connected) await this.connect();
      this.openStream();
      const signature = this.signature();
      const reply =
        signature !== this.fingerprint
          ? await this.request("/appearance", "PUT", {
              preset: this.garage.current,
            })
          : await this.request("");
      this.fingerprint = signature;
      this.connection = "connected";
      this.apply(reply);
      if (this.message === "PARTY CONNECTION LOST — RETRYING")
        this.message = "";
    } catch (e) {
      this.connection = "offline";
      if (this.state || this.message)
        this.message = this.connected
          ? "PARTY CONNECTION LOST — RETRYING"
          : (e as Error).message;
      this.changed();
    } finally {
      this.busy = false;
      this.changed();
    }
  }
}
