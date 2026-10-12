import { z } from "zod";
import { RUMBLE_CONFIG as R } from "../src/config/rumble.js";
import type { Vec, Rotation } from "./network";
export const rumbleItems = [
  "HAYMAKER",
  "GRAPPLING_HOOK",
  "POWER_HITTER",
  "PLUNGER",
  "SPIKES",
] as const;
export type RumbleItem = (typeof rumbleItems)[number];
export const rumbleNames: Record<RumbleItem, string> = {
  HAYMAKER: "HAYMAKER",
  GRAPPLING_HOOK: "GRAPPLE",
  POWER_HITTER: "POWER HITTER",
  PLUNGER: "PLUNGER",
  SPIKES: "SPIKES",
};
export interface RumblePlayerState {
  playerId: string;
  phase: "cooldown" | "ready" | "active";
  item: RumbleItem | null;
  cooldown: number;
  remaining: number;
  attachment?: { local: Vec; contact: Vec; rotation: Rotation; age: number };
}
export interface RumbleEvent {
  id: number;
  time: number;
  playerId: string;
  kind:
    | "POWERUP_GRANTED"
    | "POWERUP_USED"
    | "POWERUP_STARTED"
    | "POWERUP_ENDED"
    | "SPIKE_ATTACHED"
    | "SPIKE_DETACHED";
  item: RumbleItem;
  point: Vec;
}
export interface RumbleSnapshot {
  players: RumblePlayerState[];
  events: RumbleEvent[];
}
const finite = z.number().finite(),
  vec = z.object({ x: finite, y: finite, z: finite }),
  rotation = vec.extend({ w: finite });
export const rumbleSnapshotSchema = z
  .object({
    players: z
      .array(
        z.object({
          playerId: z.string().min(1).max(80),
          phase: z.enum(["cooldown", "ready", "active"]),
          item: z.enum(rumbleItems).nullable(),
          cooldown: finite.min(0).max(R.cooldown),
          remaining: finite
            .min(0)
            .max(
              Math.max(
                R.powerHitter.duration,
                R.spikes.duration,
                R.grapple.duration,
                R.plunger.duration,
              ),
            ),
          attachment: z
            .object({
              local: vec,
              contact: vec,
              rotation,
              age: finite.nonnegative(),
            })
            .optional(),
        }),
      )
      .max(R.visual.maxPlayers),
    events: z
      .array(
        z.object({
          id: z.number().int().nonnegative(),
          time: finite,
          playerId: z.string().min(1).max(80),
          kind: z.enum([
            "POWERUP_GRANTED",
            "POWERUP_USED",
            "POWERUP_STARTED",
            "POWERUP_ENDED",
            "SPIKE_ATTACHED",
            "SPIKE_DETACHED",
          ]),
          item: z.enum(rumbleItems),
          point: vec,
        }),
      )
      .max(R.history.eventCapacity),
  })
  .strict();
