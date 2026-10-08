import type { PlayerEntity, PlayerInput } from "./player";
import type { Preset } from "./catalog";
import type { ArenaId } from "./arenas";
import type { ReplayMessage, ReplayState } from "./replay";
import type { SoccerMode, HeatseekerState } from "./soccer";
import type { PlayerMatchStats, MatchStatEvent } from "./match-stats";
import type { ChatMessage } from "./chat";
export type Vec = { x: number; y: number; z: number };
export type Rotation = Vec & { w: number };
export type NetPlayer = PlayerEntity & { preset: Preset };
export interface CarSnapshot {
  id: string;
  position: Vec;
  rotation: Rotation;
  velocity: Vec;
  angularVelocity?: Vec;
  wheelAngle?: number;
  wheelSteer?: number;
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
  normalJump?: { sequence: number; age: number; origin: Vec; normal: Vec };
  enabled: boolean;
}
export interface MatchSnapshot {
  type: "snapshot";
  matchId: string;
  arenaId: ArenaId;
  gameMode?: SoccerMode;
  heatseeker?: HeatseekerState | null;
  stats?: PlayerMatchStats[];
  statEvents?: MatchStatEvent[];
  chat?: ChatMessage[];
  tick: number;
  time: number;
  reset: number;
  kickoffFormationId: string | null;
  players: NetPlayer[];
  cars: CarSnapshot[];
  ball: {
    position: Vec;
    rotation: Rotation;
    enabled: boolean;
    velocity?: Vec;
    angularVelocity?: Vec;
  };
  pads: number[];
  touchTeam: number | null;
  phase: "countdown" | "playing" | "goal" | "replay" | "finished";
  replay?: ReplayState | null;
  score: number[];
  remaining: number;
  countdown: number;
  goTime: number;
  overtime: boolean;
  message: string;
  goalFocus: Vec | null;
  lastGoal?: { scorerId: string; team: number; ownGoal: boolean } | null;
}
export type ClientMessage =
  | { type: "auth"; token: string }
  | { type: "input"; matchId: string; sequence: number; input: PlayerInput }
  | { type: "REPLAY_SKIP_REQUEST"; matchId: string; replayId: string }
  | { type: "chat-send"; matchId: string; text: string }
  | { type: "latency-reply"; nonce: string }
  | { type: "ping" };
export type ServerMessage =
  | MatchSnapshot
  | ReplayMessage
  | { type: "chat-message"; matchId: string; message: ChatMessage }
  | { type: "chat-history"; matchId: string; messages: ChatMessage[] }
  | { type: "chat-error"; matchId: string; playerId: string; message: string }
  | { type: "latency-probe"; nonce: string }
  | { type: "connected" }
  | { type: "error"; message: string };
