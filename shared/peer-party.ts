import { newLocalPlayerId as newPacketId } from "./local-profile";
import { z } from "zod";
import { localIdentitySchema } from "./local-profile";
import { presetSchema } from "./accounts";
import {
  teamCapacity,
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
  team: z.union([z.literal(0), z.literal(1), z.null()]),
  ready: z.boolean(),
});
export const peerPartySchema = z
  .object({
    code: z.string().refine(validPeerCode),
    hostId: z.string().uuid(),
    maxPlayers: z.literal(4),
    members: z.array(memberSchema).min(1).max(4),
    mode: z.enum(["1v1", "2v2", "2v2bots"]),
    gameMode: z.enum(["soccar", "heatseeker"]),
    stage: z.enum(["home", "mode", "teams", "match"]),
    transport: z.literal("webrtc"),
    matchId: z.string().uuid().optional(),
    matchArenaId: z.enum(["city", "beach", "stadium", "circuit"]).optional(),
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
export function createPeerParty(code: string, host: PartyMember): PartyState {
  return {
    code,
    hostId: host.id,
    maxPlayers: 4,
    members: [{ ...host, team: 0 }],
    mode: "1v1",
    gameMode: "soccar",
    stage: "home",
    transport: "webrtc",
  };
}
export function endPeerMatch(s: PartyState) {
  s.stage = "teams";
  delete s.matchId;
  delete s.matchArenaId;
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
    if (s.stage === "match") throw Error("MATCH IN PROGRESS");
    if (s.members.some((m) => m.id === member.id))
      throw Error("PROFILE ALREADY IN PARTY — USE A SEPARATE PROFILE");
    if (s.members.length >= 4) throw Error("PARTY FULL");
    if (s.stage === "teams" && s.mode !== "2v2" && s.members.length >= 2)
      throw Error("THIS MODE HAS TWO PLAYER SLOTS");
    member.team =
      s.stage === "teams"
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
    s.members = s.members.filter((m) => m.id !== id);
    if (s.stage === "match") endPeerMatch(s);
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
        "stage",
        "launch",
        "kick",
        "return",
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
        if (t !== null && t !== 0 && t !== 1) throw Error("INVALID TEAM");
        if (
          t !== null &&
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
              m.team !== null &&
              ++counts[m.team] > teamCapacity(s.mode, m.team)
            )
              m.team = null;
          });
        }
        break;
      case "gamemode":
        if (!["soccar", "heatseeker"].includes(data.gameMode))
          throw Error("INVALID GAMEMODE");
        if (s.stage === "teams") throw Error("RETURN TO MATCH SETUP FIRST");
        s.gameMode = data.gameMode;
        s.members.forEach((m) => (m.ready = false));
        break;
      case "stage":
        if (!["home", "mode", "teams"].includes(data.stage))
          throw Error("INVALID LOBBY STAGE");
        if (data.stage === "teams") {
          if (s.stage !== "mode") throw Error("CHOOSE A MODE FIRST");
          if (s.mode !== "2v2" && s.members.length > 2)
            throw Error("CHOOSE 2V2 FOR FOUR PLAYERS");
          s.members.forEach((m) => {
            m.team = null;
            m.ready = false;
          });
        }
        s.stage = data.stage;
        break;
      case "launch": {
        if (s.stage === "mode") {
          if (
            s.members.length !==
            teamCapacity(s.mode, 0) + teamCapacity(s.mode, 1)
          )
            throw Error("THIS FORMAT NEEDS MORE PLAYERS");
          const counts = [0, 0];
          for (const m of s.members) {
            if (
              m.team !== null &&
              counts[m.team] < teamCapacity(s.mode, m.team)
            )
              counts[m.team]++;
            else m.team = null;
          }
          for (const m of s.members)
            if (m.team === null) {
              m.team = counts[0] < teamCapacity(s.mode, 0) ? 0 : 1;
              counts[m.team]++;
            }
        } else if (s.stage !== "teams") throw Error("OPEN MATCH SETUP FIRST");
        if (
          s.members.some((m) => m.team === null) ||
          ([0, 1] as const).some(
            (t) =>
              s.members.filter((m) => m.team === t).length !==
              teamCapacity(s.mode, t),
          )
        )
          throw Error("FILL BOTH TEAMS BEFORE STARTING");
        s.matchId = newPacketId();
        s.matchHostId = s.hostId;
        s.matchArenaId = chooseMatchArena(this.previousArena);
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
