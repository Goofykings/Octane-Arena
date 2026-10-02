import type { PlayerEntity, PlayerInput } from "./player";
import type { Preset } from "./catalog";
export type Vec = { x: number; y: number; z: number };
export type Rotation = Vec & { w: number };
export type NetPlayer = PlayerEntity & { preset: Preset };
export interface CarSnapshot {
  id: string;
  position: Vec;
  rotation: Rotation;
  velocity: Vec;
  boost: number;
  boosting: boolean;
  grounded: boolean;
  supersonic: boolean;
  speed: number;
  steer: number;
  skid: number;
  normal: Vec;
  wheels: boolean[];
  wheelHits: Vec[];
  flipLeft: number;
  enabled: boolean;
}
export interface MatchSnapshot {
  type: "snapshot";
  matchId: string;
  tick: number;
  time: number;
  reset: number;
  players: NetPlayer[];
  cars: CarSnapshot[];
  ball: { position: Vec; rotation: Rotation; enabled: boolean };
  pads: number[];
  touchTeam: number | null;
  phase: "countdown" | "playing" | "goal" | "finished";
  score: number[];
  remaining: number;
  countdown: number;
  goTime: number;
  overtime: boolean;
  message: string;
  goalFocus: Vec | null;
}
export type ClientMessage =
  | { type: "auth"; token: string }
  | { type: "input"; matchId: string; sequence: number; input: PlayerInput }
  | { type: "ping" };
export type ServerMessage =
  | MatchSnapshot
  | { type: "connected" }
  | { type: "error"; message: string };
