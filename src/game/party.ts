import { newLocalPlayerId as newPacketId } from "../../shared/local-profile";
import type { Garage } from "./inventory";
import type { PartyState, PartyActions } from "../../shared/party";
import { normalizePartyCode } from "../../shared/party";
import {
  localIdentitySchema,
  defaultAvatarColor,
} from "../../shared/local-profile";
import {
  generatePeerCode,
  validPeerCode,
  helloSchema,
  peerMember,
  peerPartySchema,
  createPeerParty,
  PeerPartyAuthority,
} from "../../shared/peer-party";
import { localMutators } from "./mutator-store";
import { GAME_VERSION } from "../config/version";
import { PeerTransport, type PeerLink } from "../network/peer-transport";
export class PartyClient {
  state: PartyState | null = null;
  playerId: string;
  message = "";
  busy = false;
  connection: "offline" | "connected" = "offline";
  readonly transport = new PeerTransport();
  private authority: PeerPartyAuthority | null = null;
  private hostLink: PeerLink | null = null;
  private leaving = false;
  private joinResolve: (() => void) | null = null;
  private joinReject: ((error: Error) => void) | null = null;
  private pending = new Map<
    string,
    { resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private fingerprint = "";
  private joinCode = "";
  private intent: "create" | "join" | null = null;
  private joinTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    private garage: Garage,
    public changed = () => {},
  ) {
    this.playerId = this.hello().profile.localPlayerId;
    this.transport.onOpen = (link) => {
      if (!this.authority && link === this.hostLink) {
        this.transport.sendLink(link, this.hello());
        this.transport.trace("HELLO sent");
      }
    };
    this.transport.onParty = (link, message) => this.receive(link, message);
    this.transport.onClose = (id) => {
      if (this.leaving) return;
      if (this.authority && id) {
        this.authority.remove(id);
        this.message = "PLAYER DISCONNECTED";
        this.publish();
      } else if (this.hostLink) {
        this.failJoin("HOST DISCONNECTED");
        this.dispose("HOST DISCONNECTED");
      }
    };
    this.transport.onSignaling = (online, message) => {
      this.connection =
        online || this.transport.peers.size > 0 ? "connected" : "offline";
      if (!online && message) {
        this.message = message;
        if (this.joinReject && !this.state) this.failJoin(message);
      }
      if (
        online &&
        this.state &&
        /SIGNALING|CONNECTION FAILED/.test(this.message)
      )
        this.message = this.authority ? "PARTY READY" : "CONNECTED";
      this.changed();
    };
    window.setInterval(() => this.pump(), 250);
    window.addEventListener("pagehide", () => this.dispose(""));
  }
  get streaming() {
    return this.connection === "connected";
  }
  private hello() {
    const p = this.garage.profile;
    const profile = localIdentitySchema.parse({
      localPlayerId: p.localPlayerId,
      name: p.name,
      avatarId: p.avatarId ?? "helmet",
      avatarColor: p.avatarColor ?? defaultAvatarColor,
    });
    return {
      type: "party-hello" as const,
      version: GAME_VERSION,
      profile,
      preset: structuredClone(this.garage.current),
    };
  }
  private failJoin(message: string) {
    const reject = this.joinReject;
    this.joinReject = this.joinResolve = null;
    if (this.joinTimer) clearTimeout(this.joinTimer);
    this.joinTimer = null;
    reject?.(Error(message));
  }
  private publish() {
    if (!this.authority) return;
    this.state = this.authority.state;
    for (const [id] of this.transport.peers)
      this.transport.send(id, { type: "party-state", party: this.state });
    this.changed();
  }
  private receive(link: PeerLink, packet: Record<string, unknown>) {
    if (this.authority) {
      if (packet.type === "party-hello") {
        try {
          const hello = helloSchema.parse(packet);
          if (hello.version !== GAME_VERSION)
            throw Error("GAME VERSION MISMATCH");
          if (link.playerId) throw Error("ALREADY JOINED");
          this.authority.join(peerMember(hello));
          this.transport.associate(link, hello.profile.localPlayerId);
          this.transport.sendLink(link, {
            type: "party-welcome",
            version: GAME_VERSION,
            playerId: hello.profile.localPlayerId,
            slot: this.state!.members.findIndex(
              (m) => m.id === hello.profile.localPlayerId,
            ),
            party: this.state,
          });
          this.publish();
        } catch (error) {
          this.transport.sendLink(link, {
            type: "party-rejected",
            message:
              error instanceof Error &&
              error.message === "GAME VERSION MISMATCH"
                ? error.message
                : error instanceof Error && !("issues" in error)
                  ? error.message
                  : "INVALID PLAYER PROFILE",
          });
          setTimeout(() => this.transport.remove(link), 150);
        }
        return;
      }
      const id = link.playerId;
      if (!id || !this.state?.members.some((m) => m.id === id)) return;
      if (packet.type === "party-appearance") {
        const parsed = helloSchema.safeParse(packet.hello);
        if (
          parsed.success &&
          parsed.data.profile.localPlayerId === id &&
          parsed.data.version === GAME_VERSION
        ) {
          this.authority.appearance(id, parsed.data);
          this.publish();
        }
        return;
      }
      if (
        packet.type === "party-action" &&
        typeof packet.requestId === "string" &&
        packet.requestId.length < 80
      ) {
        try {
          this.hostAction(
            id,
            packet.action as keyof PartyActions,
            packet.data ?? {},
          );
          this.transport.sendLink(link, {
            type: "party-result",
            requestId: packet.requestId,
            ok: true,
          });
        } catch (error) {
          this.transport.sendLink(link, {
            type: "party-result",
            requestId: packet.requestId,
            ok: false,
            message:
              error instanceof Error ? error.message : "PARTY REQUEST FAILED",
          });
        }
      }
    } else if (link === this.hostLink) {
      if (packet.type === "party-rejected") {
        this.failJoin(
          typeof packet.message === "string"
            ? packet.message
            : "CONNECTION FAILED",
        );
        return;
      }
      if (packet.type === "party-closed" || packet.type === "party-kicked") {
        this.dispose(
          packet.type === "party-kicked"
            ? "YOU WERE REMOVED FROM THE PARTY"
            : "HOST DISCONNECTED",
        );
        return;
      }
      if (packet.type === "party-welcome" || packet.type === "party-state") {
        const parsed = peerPartySchema.safeParse(packet.party);
        if (
          !parsed.success ||
          parsed.data.code !== this.joinCode ||
          !parsed.data.members.some((m) => m.id === this.playerId)
        )
          return;
        if (packet.type === "party-welcome") {
          if (
            packet.version !== GAME_VERSION ||
            packet.playerId !== this.playerId
          ) {
            this.failJoin("GAME VERSION MISMATCH");
            return;
          }
          this.transport.associate(link, parsed.data.hostId);
          if (this.joinTimer) clearTimeout(this.joinTimer);
          this.joinTimer = null;
          this.joinResolve?.();
          this.joinResolve = this.joinReject = null;
        } else if (!link.playerId) return;
        this.state = parsed.data;
        this.connection = "connected";
        this.message = "CONNECTED";
        this.changed();
      }
      if (
        packet.type === "party-result" &&
        typeof packet.requestId === "string"
      ) {
        const pending = this.pending.get(packet.requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(packet.requestId);
        if (!packet.ok)
          this.message =
            typeof packet.message === "string"
              ? packet.message
              : "PARTY REQUEST FAILED";
        pending.resolve(packet.ok === true);
        this.changed();
      }
    }
  }
  private hostAction(id: string, action: keyof PartyActions, data: any) {
    const s = this.state!;
    this.authority!.action(id, action, data);
    if (action === "kick") {
      this.transport.send(data.playerId, { type: "party-kicked" });
      const link = this.transport.peers.get(data.playerId);
      if (link) setTimeout(() => this.transport.remove(link), 150);
    }
    if (action === "leave" || action === "disconnect") {
      const link = this.transport.peers.get(id);
      if (link) setTimeout(() => this.transport.remove(link), 150);
    }
    this.state = s;
    this.publish();
  }
  async action(
    action: keyof PartyActions,
    data: PartyActions[keyof PartyActions] = {},
  ) {
    if (this.busy) return false;
    this.busy = true;
    this.changed();
    try {
      if (action === "create") {
        this.intent = "create";
        this.dispose("");
        this.busy = true;
        this.message = "CREATING PARTY";
        this.changed();
        for (let attempt = 0; attempt < 7; attempt++) {
          const code = generatePeerCode();
          try {
            await this.transport.register(code);
            this.authority = new PeerPartyAuthority(
              createPeerParty(
                code,
                peerMember(this.hello()),
                localMutators.value,
              ),
            );
            this.state = this.authority.state;
            this.message = "PARTY READY";
            this.connection = "connected";
            this.changed();
            return true;
          } catch (error) {
            this.transport.close();
            if ((error as { type?: string }).type !== "unavailable-id")
              throw error;
          }
        }
        throw Error("COULD NOT RESERVE A PARTY CODE — TRY AGAIN");
      }
      if (action === "join") {
        this.intent = "join";
        const code = normalizePartyCode((data as { code: string }).code ?? "");
        if (!validPeerCode(code))
          throw Error("ENTER A VALID SIX-CHARACTER PARTY CODE");
        this.dispose("");
        this.busy = true;
        this.joinCode = code;
        this.message = `JOINING ${code}...`;
        this.changed();
        await this.transport.register();
        await new Promise<void>((resolve, reject) => {
          this.joinResolve = resolve;
          this.joinReject = reject;
          this.joinTimer = setTimeout(
            () =>
              this.failJoin(
                "CONNECTION FAILED — THIS NETWORK MAY BLOCK WEBRTC",
              ),
            12000,
          );
          this.hostLink = this.transport.connect(code);
        });
        this.message = "CONNECTED";
        return true;
      }
      if (action === "leave" || action === "disconnect") {
        if (this.authority)
          for (const [id] of this.transport.peers)
            this.transport.send(id, { type: "party-closed" });
        else if (this.hostLink)
          this.transport.sendLink(this.hostLink, {
            type: "party-action",
            requestId: newPacketId(),
            action: "leave",
            data: {},
          });
        this.dispose("");
        return true;
      }
      if (!this.state) throw Error("JOIN A PARTY FIRST");
      if (this.authority) {
        this.hostAction(this.playerId, action, data);
        this.message = "PARTY READY";
        return true;
      }
      const requestId = newPacketId();
      return await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          this.pending.delete(requestId);
          this.message = "PARTY REQUEST TIMED OUT";
          resolve(false);
          this.changed();
        }, 7000);
        this.pending.set(requestId, { resolve, timer });
        if (
          !this.transport.send(this.state!.hostId, {
            type: "party-action",
            requestId,
            action,
            data,
          })
        ) {
          clearTimeout(timer);
          this.pending.delete(requestId);
          throw Error("CONNECTION FAILED");
        }
      });
    } catch (error) {
      this.message =
        error instanceof Error ? error.message : "CONNECTION FAILED";
      if (!this.state) this.dispose(this.message);
      return false;
    } finally {
      this.busy = false;
      this.changed();
    }
  }
  async retry() {
    if (this.transport.peer?.disconnected) {
      try {
        this.transport.peer.reconnect();
      } catch {
        this.message = "CONNECTION FAILED";
      }
    } else if (!this.state && this.intent === "create")
      await this.action("create");
    else if (this.joinCode && !this.state)
      await this.action("join", { code: this.joinCode });
  }
  private pump() {
    this.transport.pump(performance.now());
    const signature = JSON.stringify([
      this.garage.current,
      this.garage.profile,
    ]);
    if (signature === this.fingerprint) return;
    this.fingerprint = signature;
    if (!this.state) return;
    try {
      const hello = this.hello();
      if (this.authority) {
        this.authority.appearance(this.playerId, hello);
        this.publish();
      } else
        this.transport.send(this.state.hostId, {
          type: "party-appearance",
          hello,
        });
    } catch {
      /* Keep current validated identity. */
    }
  }
  private dispose(message: string) {
    this.leaving = true;
    this.transport.close();
    this.leaving = false;
    this.state = null;
    this.authority = null;
    this.hostLink = null;
    this.connection = "offline";
    this.failJoin(message || "PARTY CLOSED");
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.resolve(false);
    }
    this.pending.clear();
    this.message = message;
    this.changed();
  }
}
