import { z } from "zod";
import type { MatchSnapshot } from "./network";
import { arenaIds } from "./arenas";

const description = z
  .object({
    type: z.enum(["offer", "answer"]),
    sdp: z.string().min(1).max(24000),
  })
  .strict();
const candidate = z
  .object({
    candidate: z.string().max(2048),
    sdpMid: z.string().max(128).nullable().optional(),
    sdpMLineIndex: z.number().int().min(0).max(64).nullable().optional(),
    usernameFragment: z.string().max(256).nullable().optional(),
  })
  .strict();
export const rtcSignalSchema = z
  .object({
    to: z.string().uuid(),
    connectionId: z.string().uuid(),
    data: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("description"), description }).strict(),
      z.object({ kind: z.literal("candidate"), candidate }).strict(),
    ]),
  })
  .strict();
export type RtcSignal = z.infer<typeof rtcSignalSchema>;
export type RtcEnvelope = RtcSignal & {
  from: string;
  code: string;
  sequence: number;
  expires: number;
};
export interface IceConfig {
  iceServers: { urls: string[]; username?: string; credential?: string }[];
  iceTransportPolicy: "all" | "relay";
  relayAvailable: boolean;
}
const finite = z.number().finite();
const vec = z.object({ x: finite, y: finite, z: finite });
const rotation = vec.extend({ w: finite });
const car = z
  .object({
    id: z.string().min(1).max(80),
    position: vec,
    rotation,
    velocity: vec,
    angularVelocity: vec.optional(),
    wheelAngle: finite.optional(),
    wheelSteer: finite.optional(),
    boost: finite.min(0).max(100),
    boosting: z.boolean(),
    grounded: z.boolean(),
    supersonic: z.boolean(),
    speed: finite,
    steer: finite,
    skid: finite,
    normal: vec,
    wheels: z.array(z.boolean()).length(4),
    wheelHits: z.array(vec).length(4),
    flipLeft: finite,
    enabled: z.boolean(),
    normalJump: z
      .object({
        sequence: z.number().int().nonnegative(),
        age: finite,
        origin: vec,
        normal: vec,
      })
      .optional(),
  })
  .passthrough();
const snapshot = z
  .object({
    type: z.literal("snapshot"),
    matchId: z.string().uuid(),
    arenaId: z.enum(arenaIds),
    gameMode: z.enum(["soccar", "heatseeker"]).optional(),
    heatseeker: z
      .object({
        active: z.boolean(),
        ownerTeam: z.union([z.literal(0), z.literal(1)]).nullable(),
        targetTeam: z.union([z.literal(0), z.literal(1)]).nullable(),
        lastTouchPlayerId: z.string().max(80).nullable(),
        tier: z.number().int().nonnegative(),
        speed: finite.nonnegative(),
        kickoffTeam: z.union([z.literal(0), z.literal(1)]),
        backboardSequence: z.number().int().nonnegative(),
      })
      .nullable()
      .optional(),
    tick: z.number().int().nonnegative(),
    time: finite,
    reset: z.number().int().nonnegative(),
    kickoffFormationId: z.string().max(80).nullable(),
    players: z.array(z.unknown()).min(1).max(4),
    cars: z.array(car).min(1).max(4),
    ball: z.object({
      position: vec,
      rotation,
      enabled: z.boolean(),
      velocity: vec.optional(),
      angularVelocity: vec.optional(),
    }),
    pads: z.array(finite.nonnegative()).max(64),
    touchTeam: z.number().int().nullable(),
    phase: z.enum(["countdown", "playing", "goal", "replay", "finished"]),
    score: z.array(z.number().int().nonnegative()).length(2),
    remaining: finite,
    countdown: finite,
    goTime: finite,
    overtime: z.boolean(),
    message: z.string().max(512),
    goalFocus: vec.nullable(),
    replay: z
      .object({
        id: z.string().max(80),
        time: finite,
        speed: finite,
        eligible: z.array(z.string()).max(4),
        votes: z.array(z.string()).max(4),
      })
      .nullable()
      .optional(),
    lastGoal: z
      .object({
        scorerId: z.string().max(80),
        team: z.number().int(),
        ownGoal: z.boolean(),
      })
      .nullable()
      .optional(),
  })
  .passthrough();
export function peerSnapshot(
  value: unknown,
  matchId: string,
  playerIds: string[],
) {
  const result = snapshot.safeParse(value);
  if (
    !result.success ||
    result.data.matchId !== matchId ||
    result.data.cars.length !== playerIds.length ||
    new Set(result.data.cars.map((c) => c.id)).size !== playerIds.length ||
    result.data.cars.some((c) => !playerIds.includes(c.id))
  )
    return null;
  return result.data as unknown as MatchSnapshot;
}

// SCTP peers commonly negotiate a 64 KiB message maximum. Keep fragments small
// and bounded; reliable replay transfers use a separate channel from inputs.
export const RTC_CHUNK_SIZE = 7680;
export const RTC_MAX_PAYLOAD = 4 * 1024 * 1024;
export interface RtcChunk {
  type: "chunk";
  id: string;
  index: number;
  total: number;
  data: string;
}
export function rtcChunks(payload: string, id: string): RtcChunk[] {
  if (payload.length > RTC_MAX_PAYLOAD)
    throw Error("Peer payload is too large");
  const total = Math.ceil(payload.length / RTC_CHUNK_SIZE);
  return Array.from({ length: total }, (_, index) => ({
    type: "chunk",
    id,
    index,
    total,
    data: payload.slice(index * RTC_CHUNK_SIZE, (index + 1) * RTC_CHUNK_SIZE),
  }));
}
export class RtcChunkReceiver {
  private id = "";
  private parts: string[] = [];
  private received = 0;
  private size = 0;
  private expires = 0;
  accept(value: RtcChunk, now = performance.now()) {
    if (
      !value ||
      value.type !== "chunk" ||
      typeof value.id !== "string" ||
      value.id.length > 80 ||
      !Number.isInteger(value.total) ||
      value.total < 1 ||
      value.total > Math.ceil(RTC_MAX_PAYLOAD / RTC_CHUNK_SIZE) ||
      !Number.isInteger(value.index) ||
      value.index < 0 ||
      value.index >= value.total ||
      typeof value.data !== "string" ||
      value.data.length > RTC_CHUNK_SIZE
    )
      throw Error("Invalid peer fragment");
    if (now > this.expires || value.id !== this.id) {
      this.id = value.id;
      this.parts = new Array(value.total);
      this.received = this.size = 0;
      this.expires = now + 30000;
    }
    if (this.parts.length !== value.total)
      throw Error("Inconsistent peer transfer");
    if (this.parts[value.index] === undefined) {
      this.parts[value.index] = value.data;
      this.received++;
      this.size += value.data.length;
      if (this.size > RTC_MAX_PAYLOAD)
        throw Error("Peer transfer is too large");
    }
    if (this.received !== value.total) return null;
    const payload = this.parts.join("");
    this.parts = [];
    this.id = "";
    this.received = this.size = 0;
    return payload;
  }
}
