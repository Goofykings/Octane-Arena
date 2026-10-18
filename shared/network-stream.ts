import type { MatchSnapshot, CarSnapshot } from "./network";
import { NETWORK } from "./network-tuning";
import { predictionStateSchema, type CarPredictionState } from "./prediction";
export interface MotionFrame {
  type: "frame";
  matchId: string;
  tick: number;
  time: number;
  reset: number;
  replay?: MatchSnapshot["replay"];
  cars: {
    id: string;
    motion: number[];
    prediction?: CarPredictionState;
    flipReset?: CarSnapshot["flipReset"];
    normalJump?: CarSnapshot["normalJump"];
  }[];
  ball: number[];
}
const vec = (v: { x: number; y: number; z: number } | undefined) => [
  v?.x ?? 0,
  v?.y ?? 0,
  v?.z ?? 0,
];
function pack(c: CarSnapshot, recipient?: string): MotionFrame["cars"][number] {
  return {
    id: c.id,
    motion: [
      ...vec(c.position),
      ...vec(c.rotation),
      c.rotation.w,
      ...vec(c.velocity),
      ...vec(c.angularVelocity),
      c.boost,
      +c.boosting,
      +c.grounded,
      +c.supersonic,
      c.speed,
      c.steer,
      c.skid,
      ...vec(c.normal),
      c.wheels.reduce((mask, on, i) => mask | (+on << i), 0),
      ...c.wheelHits.flatMap(vec),
      c.flipLeft,
      +c.enabled,
      c.teleportSequence ?? 0,
      c.wheelAngle ?? 0,
      c.wheelSteer ?? c.steer,
      c.inputSequence ?? 0,
    ],
    prediction: c.id === recipient ? c.prediction : undefined,
    flipReset: c.flipReset?.sequence ? c.flipReset : undefined,
    normalJump: c.normalJump?.sequence ? c.normalJump : undefined,
  };
}
export function motionFrame(s: MatchSnapshot, recipient?: string): MotionFrame {
  return {
    type: "frame",
    matchId: s.matchId,
    tick: s.tick,
    time: s.time,
    reset: s.reset,
    replay: s.replay,
    cars: s.cars.map((c) => pack(c, recipient)),
    ball: [
      ...vec(s.ball.position),
      ...vec(s.ball.rotation),
      s.ball.rotation.w,
      ...vec(s.ball.velocity),
      ...vec(s.ball.angularVelocity),
      +s.ball.enabled,
    ],
  };
}
export function recipientSnapshot(
  s: MatchSnapshot,
  id?: string,
): MatchSnapshot {
  return {
    ...s,
    cars: s.cars.map((c) => ({
      ...c,
      prediction: c.id === id ? c.prediction : undefined,
    })),
  };
}
/** Essential live state at 30 Hz; roster/UI/tile deltas at 5 Hz or immediately on events. */
export class SnapshotPublisher {
  private fullAt = -Infinity;
  private key = "";
  invalidate() {
    this.fullAt = -Infinity;
    this.key = "";
  }
  packet(s: MatchSnapshot, id?: string): MatchSnapshot | MotionFrame {
    const key = JSON.stringify([
      s.phase,
      s.reset,
      s.score,
      s.touchTeam,
      s.dropshot?.chargeLevel,
      s.players.map((p) => p.id),
      s.sessionMembers?.map((p) => p.id),
      s.ball.enabled,
      s.cars.map((c) => [c.id, c.enabled, c.teleportSequence]),
      s.statEvents?.at(-1)?.id,
      s.chat?.at(-1)?.id,
      s.dropshot?.epoch,
      s.dropshot?.revision,
      s.heatseeker?.ownerTeam,
      s.heatseeker?.tier,
      s.heatseeker?.backboardSequence,
      s.rumble?.events.at(-1)?.id,
      s.rumble?.players.map((p) => [
        p.playerId,
        p.item,
        p.phase,
        p.targetPlayerId,
      ]),
    ]);
    if (
      s.dropshot?.tiles !== undefined ||
      key !== this.key ||
      s.time - this.fullAt >= NETWORK.metadataSeconds - 1e-8
    ) {
      this.key = key;
      this.fullAt = s.time;
      return recipientSnapshot(s, id);
    }
    return motionFrame(s, id);
  }
}
const finite = (a: unknown, n: number): a is number[] =>
  Array.isArray(a) &&
  a.length === n &&
  a.every(
    (v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e9,
  );
/** Validate the small motion payload, then reuse trusted metadata from the last full state. */
export function readMotionFrame(
  raw: unknown,
  base: MatchSnapshot | null,
): MatchSnapshot | null {
  if (!base || !raw || typeof raw !== "object") return null;
  const f = raw as MotionFrame;
  if (
    f.type !== "frame" ||
    f.matchId !== base.matchId ||
    f.reset !== base.reset ||
    !Number.isSafeInteger(f.tick) ||
    f.tick < 0 ||
    !Number.isFinite(f.time) ||
    Math.abs(f.time - f.tick / NETWORK.physicsHz) > 1e-5 ||
    !finite(f.ball, 14) ||
    (f.ball[13] !== 0 && f.ball[13] !== 1) ||
    !Array.isArray(f.cars) ||
    f.cars.length !== base.cars.length ||
    f.cars.some((c) => !c || typeof c !== "object") ||
    new Set(f.cars.map((c) => c.id)).size !== base.cars.length
  )
    return null;
  if (
    f.replay &&
    (!base.replay ||
      f.replay.id !== base.replay.id ||
      !Number.isFinite(f.replay.time) ||
      !Number.isFinite(f.replay.speed) ||
      f.replay.speed < 0 ||
      f.replay.speed > 2 ||
      !Array.isArray(f.replay.eligible) ||
      !Array.isArray(f.replay.votes) ||
      [...f.replay.eligible, ...f.replay.votes].some(
        (id) => !base.players.some((p) => p.id === id),
      ))
  )
    return null;
  const v = (a: number[], i: number) => ({ x: a[i], y: a[i + 1], z: a[i + 2] });
  const cars: CarSnapshot[] = [];
  for (const c of f.cars) {
    const a = c.motion;
    if (
      !base.cars.some((p) => p.id === c.id) ||
      !finite(a, 42) ||
      a[13] < 0 ||
      a[13] > 100 ||
      ![14, 15, 16, 37].every((i) => a[i] === 0 || a[i] === 1) ||
      !Number.isSafeInteger(a[23]) ||
      a[23] < 0 ||
      a[23] > 15 ||
      ![38, 41].every((i) => Number.isSafeInteger(a[i]) && a[i] >= 0)
    )
      return null;
    if (c.prediction && !predictionStateSchema.safeParse(c.prediction).success)
      return null;
    for (const event of [c.flipReset, c.normalJump])
      if (
        event &&
        (!Number.isSafeInteger(event.sequence) ||
          event.sequence < 0 ||
          !Number.isFinite(event.age) ||
          !finite(vec(event.origin), 3) ||
          !finite(vec(event.normal), 3))
      )
        return null;
    cars.push({
      id: c.id,
      position: v(a, 0),
      rotation: { ...v(a, 3), w: a[6] },
      velocity: v(a, 7),
      angularVelocity: v(a, 10),
      boost: a[13],
      boosting: !!a[14],
      grounded: !!a[15],
      supersonic: !!a[16],
      speed: a[17],
      steer: a[18],
      skid: a[19],
      normal: v(a, 20),
      wheels: [0, 1, 2, 3].map((i) => !!(a[23] & (1 << i))),
      wheelHits: [24, 27, 30, 33].map((i) => v(a, i)),
      flipLeft: a[36],
      enabled: !!a[37],
      teleportSequence: a[38],
      wheelAngle: a[39],
      wheelSteer: a[40],
      inputSequence: a[41],
      prediction: c.prediction,
      flipReset: c.flipReset,
      normalJump: c.normalJump,
    });
  }
  return {
    ...base,
    tick: f.tick,
    time: f.time,
    replay: f.replay ?? base.replay,
    cars,
    ball: {
      position: v(f.ball, 0),
      rotation: { ...v(f.ball, 3), w: f.ball[6] },
      velocity: v(f.ball, 7),
      angularVelocity: v(f.ball, 10),
      enabled: !!f.ball[13],
    },
  };
}
