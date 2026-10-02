import type { Preset } from "./catalog.js";
export const partyAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const normalizePartyCode = (code: string) =>
  code.replace(/\s/g, "").toUpperCase();
export const validPartyCode = (code: string) =>
  /^[A-HJKMNP-Z2-9]{5,6}$/.test(code);
export type PartyMode = "1v1" | "2v2" | "2v2bots";
export type PartyStage = "home" | "mode" | "teams" | "match";
export const partyModes: { id: PartyMode; label: string }[] = [
  { id: "1v1", label: "1 VS 1" },
  { id: "2v2", label: "2 VS 2" },
  { id: "2v2bots", label: "2 VS 2 BOTS" },
];
export const teamCapacity = (mode: PartyMode, team: 0 | 1) =>
  mode === "2v2bots" && team === 1 ? 0 : mode === "1v1" ? 1 : 2;
export type PartyTeam = 0 | 1 | null;
export interface PartyMember {
  id: string;
  name: string;
  title: string;
  avatarId: string;
  preset: Preset;
  team: PartyTeam;
  ready: boolean;
}
export interface PartyState {
  code: string;
  hostId: string;
  members: PartyMember[];
  mode: PartyMode;
  stage: PartyStage;
  matchId?: string;
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
  stage: { stage: PartyStage };
  disconnect: Record<string, never>;
  launch: Record<string, never>;
  return: Record<string, never>;
}
