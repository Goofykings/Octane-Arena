import type { Preset } from "./catalog.js";
import type { ArenaId } from "./arenas.js";
import type { SoccerMode } from "./soccer.js";
export const partyAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const partyMaxPlayers = 8;
export const normalizePartyCode = (code: string) =>
  code.replace(/\s/g, "").toUpperCase();
export const validPartyCode = (code: string) =>
  /^[A-HJKMNP-Z2-9]{5,6}$/.test(code);
export type PartyMode = "1v1" | "2v2" | "3v3" | "1v2" | "1v3" | "2v2bots";
export type PartyStage = "home" | "mode" | "teams" | "match";
export const partyModes: { id: PartyMode; label: string }[] = [
  { id: "1v1", label: "1 VS 1" },
  { id: "2v2", label: "2 VS 2" },
  { id: "3v3", label: "3 VS 3" },
  { id: "1v2", label: "1 VS 2" },
  { id: "1v3", label: "1 VS 3" },
  { id: "2v2bots", label: "2 VS 2 BOTS" },
];
export const teamCapacity = (mode: PartyMode, team: 0 | 1) =>
  mode === "2v2bots"
    ? team === 1
      ? 0
      : 2
    : mode === "1v1"
      ? 1
      : mode === "3v3"
        ? 3
        : mode === "1v2"
          ? team === 0
            ? 1
            : 2
          : mode === "1v3"
            ? team === 0
              ? 1
              : 3
            : 2;
export type PartyTeam = 0 | 1 | "spectator" | null;
export interface PartyMember {
  id: string;
  localPlayerId?: string;
  name: string;
  title: string;
  avatarId: string;
  avatarColor?: string;
  preset: Preset;
  team: PartyTeam;
  ready: boolean;
}
export interface PartyState {
  code: string;
  hostId: string;
  maxPlayers: number;
  members: PartyMember[];
  mode: PartyMode;
  mutators?: import("./mutators").MatchMutators;
  gameMode?: SoccerMode;
  stage: PartyStage;
  transport?: "server" | "webrtc";
  matchId?: string;
  matchArenaId?: ArenaId;
  matchHostId?: string;
  matchFinished?: boolean;
}
export interface PartyReply {
  playerId: string;
  party: PartyState | null;
  notice: string;
  sessionToken?: string;
}
export interface PartyActions {
  create: Record<string, never>;
  join: { code: string };
  leave: Record<string, never>;
  kick: { playerId: string };
  team: { team: PartyTeam };
  ready: { ready: boolean };
  mode: { mode: PartyMode };
  mutators: { mutators: import("./mutators").MatchMutators };
  gamemode: { gameMode: SoccerMode };
  stage: { stage: PartyStage };
  disconnect: Record<string, never>;
  launch: Record<string, never>;
  return: Record<string, never>;
  rematch: Record<string, never>;
  "rtc-end": { matchId: string; reason: "finished" | "disconnect" };
}

/** Match participants are independent of session members. Unassigned members watch. */
export const isTeam = (team: PartyTeam): team is 0 | 1 =>
  team === 0 || team === 1;
export function canStartParty(s: PartyState) {
  return ([0, 1] as const).every((t) => {
    const n = s.members.filter((m) => m.team === t).length;
    return s.mode === "2v2bots" && t === 1
      ? n === 0
      : n >= 1 && n <= teamCapacity(s.mode, t);
  });
}
export function assignPartyTeams(s: PartyState) {
  const counts = [0, 0];
  for (const m of s.members) {
    if (isTeam(m.team) && counts[m.team] < teamCapacity(s.mode, m.team))
      counts[m.team]++;
    else if (m.team !== "spectator") m.team = null;
  }
  for (const m of s.members)
    if (m.team === null) {
      const t = ([0, 1] as const).find(
        (t) => counts[t] < teamCapacity(s.mode, t),
      );
      m.team = t ?? "spectator";
      if (t !== undefined) counts[t]++;
    }
}
