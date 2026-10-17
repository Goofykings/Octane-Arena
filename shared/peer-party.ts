import {
  mutatorsSchema,
  DEFAULT_MUTATORS,
  matchMutators,
  type MatchMutators,
} from "./mutators";
import { newLocalPlayerId as newPacketId } from "./local-profile";
import { z } from "zod";
import { localIdentitySchema } from "./local-profile";
import { presetSchema } from "./accounts";
import {
  teamCapacity,
  isTeam,
  canStartParty,
  assignPartyTeams,
  partyMaxPlayers,
  partyModes,
  type PartyState,
  type PartyMember,
  type PartyActions,
} from "./party";
import { chooseMatchArena, type ArenaId } from "./arenas";
export const PEER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const validPeerCode = (value: string) =>
  /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(value);
export function generatePeerCode() {
  // Rejection sampling avoids modulo bias while keeping all six symbols random.
  let code = "";
  const bytes = new Uint8Array(16),
    limit = 256 - (256 % PEER_CODE_ALPHABET.length);
  while (code.length < 6) {
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b < limit) code += PEER_CODE_ALPHABET[b % PEER_CODE_ALPHABET.length];
      if (code.length === 6) break;
    }
  }
  return code;
}
export const helloSchema = z
  .object({
    type: z.literal("party-hello"),
    version: z.string().max(40),
    profile: localIdentitySchema,
    preset: presetSchema,
  })
  .strict();
export const memberSchema = localIdentitySchema.extend({
  id: z.string().uuid(),
  title: z.string().max(40),
  preset: presetSchema,
  team: z.union([z.literal(0), z.literal(1), z.literal("spectator"), z.null()]),
  ready: z.boolean(),
});
export const peerPartySchema = z
  .object({
    code: z.string().refine(validPeerCode),
    hostId: z.string().uuid(),
    maxPlayers: z.literal(partyMaxPlayers),
    members: z.array(memberSchema).min(1).max(partyMaxPlayers),
    mode: z.enum(["1v1", "2v2", "3v3", "1v2", "1v3", "2v2bots"]),
    mutators: mutatorsSchema.default(() => DEFAULT_MUTATORS),
    gameMode: z.enum(["soccar", "heatseeker", "rumble", "hoops", "dropshot"]),
    stage: z.enum(["home", "mode", "teams", "match"]),
    transport: z.literal("webrtc"),
    matchId: z.string().uuid().optional(),
    matchArenaId: z
      .enum(["city", "beach", "stadium", "circuit", "hoops", "dropshot"])
      .optional(),
    matchHostId: z.string().uuid().optional(),
    matchFinished: z.boolean().optional(),
  })
  .refine(
    (s) =>
      new Set(s.members.map((m) => m.id)).size === s.members.length &&
      s.members.some((m) => m.id === s.hostId) &&
      s.members.every((m) => m.id === m.localPlayerId),
  );
export function peerMember(hello: z.infer<typeof helloSchema>): PartyMember {
  return {
    id: hello.profile.localPlayerId,
    ...hello.profile,
    title: "Rookie",
    preset: hello.preset,
    team: null,
    ready: false,
  };
}
export function createPeerParty(
  code: string,
  host: PartyMember,
  mutators: MatchMutators = DEFAULT_MUTATORS,
): PartyState {
  return {
    code,
    hostId: host.id,
    maxPlayers: partyMaxPlayers,
    members: [{ ...host, team: 0 }],
    mode: "1v1",
    mutators: matchMutators(mutators),
    gameMode: "soccar",
    stage: "home",
    transport: "webrtc",
  };
}
export function endPeerMatch(s: PartyState) {
  s.stage = "teams";
  delete s.matchId;
  s.matchArenaId = chooseMatchArena(s.matchArenaId, Math.random, s.gameMode);
  delete s.matchHostId;
  delete s.matchFinished;
  s.members.forEach((m) => (m.ready = false));
}
/** Lobby authority only. Physics/input/replay packets remain unchanged. */
export class PeerPartyAuthority {
  private previousArena?: ArenaId;
  constructor(public state: PartyState) {}
  join(member: PartyMember) {
    const s = this.state;
    if (s.stage === "match" && s.gameMode !== "dropshot")
      throw Error("MATCH IN PROGRESS");
    if (s.members.some((m) => m.id === member.id))
      throw Error("PROFILE ALREADY IN PARTY — USE A SEPARATE PROFILE");
    if (s.members.length >= partyMaxPlayers) throw Error("PARTY FULL");
    member.team =
      s.stage === "match"
        ? "spectator"
        : s.stage === "teams"
          ? null
          : (([0, 1] as const).find(
              (t) =>
                s.members.filter((m) => m.team === t).length <
                teamCapacity(s.mode, t),
            ) ?? null);
    s.members.push(member);
  }
  remove(id: string) {
    const s = this.state;
    const active = s.members.find((m) => m.id === id);
    s.members = s.members.filter((m) => m.id !== id);
    if (s.stage === "match" && active && isTeam(active.team)) endPeerMatch(s);
  }
  appearance(id: string, hello: z.infer<typeof helloSchema>) {
    const m = this.state.members.find((m) => m.id === id);
    if (m && this.state.stage !== "match")
      Object.assign(m, peerMember(hello), { team: m.team, ready: m.ready });
  }
  action(id: string, action: keyof PartyActions, data: any) {
    const s = this.state,
      m = s.members.find((m) => m.id === id);
    if (!m) throw Error("JOIN A PARTY FIRST");
    const host = () => {
      if (id !== s.hostId) throw Error("ONLY THE HOST CAN DO THIS");
    };
    if (
      [
        "mode",
        "gamemode",
        "mutators",
        "stage",
        "launch",
        "kick",
        "return",
        "rematch",
        "rtc-end",
      ].includes(action)
    )
      host();
    if (action === "rtc-end") {
      if (data.matchId !== s.matchId) throw Error("MATCH IS NO LONGER ACTIVE");
      if (data.reason === "finished") s.matchFinished = true;
      else if (data.reason === "disconnect") endPeerMatch(s);
      else throw Error("INVALID MATCH RESULT");
      return;
    }
    if (action === "rematch") {
      if (!s.matchFinished) throw Error("MATCH IS STILL PLAYING");
      s.matchId = newPacketId();
      s.matchHostId = s.hostId;
      s.matchArenaId = chooseMatchArena(
        this.previousArena,
        Math.random,
        s.gameMode,
      );
      this.previousArena = s.matchArenaId;
      s.matchFinished = false;
      s.members.forEach((m) => (m.ready = false));
      return;
    }
    if (action === "return") {
      if (!s.matchFinished) throw Error("MATCH IS STILL PLAYING");
      endPeerMatch(s);
      return;
    }
    if (
      s.stage === "match" &&
      !["leave", "disconnect", "kick"].includes(action)
    )
      throw Error("MATCH IN PROGRESS");
    switch (action) {
      case "team": {
        const t = data.team;
        if (t !== null && t !== 0 && t !== 1 && t !== "spectator")
          throw Error("INVALID TEAM");
        if (
          isTeam(t) &&
          s.members.filter((p) => p.id !== id && p.team === t).length >=
            teamCapacity(s.mode, t)
        )
          throw Error("TEAM FULL");
        m.team = t;
        m.ready = false;
        break;
      }
      case "ready":
        if (typeof data.ready !== "boolean") throw Error("INVALID READY STATE");
        if (data.ready && m.team === null) throw Error("CHOOSE A TEAM FIRST");
        m.ready = data.ready;
        break;
      case "mode":
        if (!partyModes.some((p) => p.id === data.mode))
          throw Error("INVALID MODE");
        if (s.stage === "teams") throw Error("RETURN TO MATCH SETUP FIRST");
        s.mode = data.mode;
        {
          const counts = [0, 0];
          s.members.forEach((m) => {
            m.ready = false;
            if (
              isTeam(m.team) &&
              ++counts[m.team] > teamCapacity(s.mode, m.team)
            )
              m.team = null;
          });
        }
        break;
      case "mutators":
        if (s.stage === "teams") throw Error("RETURN TO MATCH SETUP FIRST");
        s.mutators = matchMutators(data.mutators);
        s.members.forEach((m) => (m.ready = false));
        break;
      case "gamemode":
        if (
          !["soccar", "heatseeker", "rumble", "hoops", "dropshot"].includes(
            data.gameMode,
          )
        )
          throw Error("INVALID GAMEMODE");
        if (s.stage === "teams") throw Error("RETURN TO MATCH SETUP FIRST");
        s.gameMode = data.gameMode;
        delete s.matchArenaId;
        if (data.gameMode === "hoops") s.mode = "2v2";
        if (data.gameMode === "dropshot") s.mode = "3v3";
        s.members.forEach((m) => (m.ready = false));
        break;
      case "stage":
        if (!["home", "mode", "teams"].includes(data.stage))
          throw Error("INVALID LOBBY STAGE");
        if (data.stage === "teams") {
          if (s.stage !== "mode") throw Error("CHOOSE A MODE FIRST");
          s.matchArenaId = chooseMatchArena(
            this.previousArena,
            Math.random,
            s.gameMode,
          );
          s.members.forEach((m) => {
            m.team = null;
            m.ready = false;
          });
        }
        s.stage = data.stage;
        break;
      case "launch": {
        if (s.stage === "mode") {
          assignPartyTeams(s);
        } else if (s.stage !== "teams") throw Error("OPEN MATCH SETUP FIRST");
        if (!canStartParty(s))
          throw Error("CHOOSE AT LEAST ONE PLAYER PER TEAM");
        s.members.forEach((m) => {
          if (m.team === null) m.team = "spectator";
        });
        s.matchId = newPacketId();
        s.matchHostId = s.hostId;
        s.matchArenaId =
          s.matchArenaId ??
          chooseMatchArena(this.previousArena, Math.random, s.gameMode);
        this.previousArena = s.matchArenaId;
        s.matchFinished = false;
        s.stage = "match";
        break;
      }
      case "leave":
      case "disconnect":
        this.remove(id);
        break;
      case "kick":
        if (data.playerId === id) throw Error("CANNOT KICK YOURSELF");
        if (!s.members.some((m) => m.id === data.playerId))
          throw Error("PLAYER NOT FOUND");
        this.remove(data.playerId);
        break;
      default:
        throw Error("INVALID PARTY ACTION");
    }
  }
}
