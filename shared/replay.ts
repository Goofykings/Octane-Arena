import { Quaternion } from "three";
import type { Vec } from "./network";

export const REPLAY_HZ = 120;
export const REPLAY_CAPACITY = 6 * REPLAY_HZ + 1;
export const BALL_STRIDE = 14;
export const CAR_STRIDE = 52;
// Offsets into each packed car row. No arena meshes or cosmetic assets here.
export const RC = {
  position: 0,
  rotation: 3,
  velocity: 7,
  angular: 10,
  enabled: 13,
  boost: 14,
  boosting: 15,
  grounded: 16,
  sonic: 17,
  speed: 18,
  steer: 19,
  skid: 20,
  normal: 21,
  wheels: 24,
  wheelHits: 25,
  flip: 37,
  jumpSequence: 38,
  jumpAge: 39,
  jumpOrigin: 40,
  jumpNormal: 43,
  wheelAngle: 46,
  wheelSteer: 47,
  demolition: 48,
  wheelSpeed: 49,
  contactSpeed: 50,
  airborneTime: 51,
} as const;
export interface ReplayGoal {
  id: string;
  time: number;
  scorerId: string;
  team: number;
  ownGoal: boolean;
  lastTouchId: string | null;
  touchTime: number | null;
  ballSpeed: number; // SI velocity magnitude captured by the scoring authority.
  focus: Vec;
}
export interface ReplayEvent {
  time: number;
  kind: "touch" | "pickup" | "demolition" | "goal";
  playerId: string;
  index?: number;
}
export interface ReplayClip {
  goal: ReplayGoal;
  carIds: string[];
  padCount: number;
  stride: number;
  count: number;
  start: number;
  end: number;
  times: Float64Array;
  frames: Float32Array;
  events: ReplayEvent[];
}
export interface ReplayState {
  id: string;
  time: number;
  speed: number;
  eligible: string[];
  votes: string[];
}
export interface ReplayMessage {
  type: "replay";
  matchId: string;
  clip: Omit<ReplayClip, "times" | "frames"> & {
    times: number[];
    frames: number[];
  };
}
export const replayMessage = (
  matchId: string,
  clip: ReplayClip,
): ReplayMessage => ({
  type: "replay",
  matchId,
  clip: {
    ...clip,
    times: Array.from(clip.times),
    frames: Array.from(clip.frames),
  },
});
export function decodeReplay(message: ReplayMessage): ReplayClip {
  const c = message.clip;
  if (
    c.count < 1 ||
    c.count > REPLAY_CAPACITY ||
    c.carIds.length > 4 ||
    c.stride !== BALL_STRIDE + c.carIds.length * CAR_STRIDE + c.padCount ||
    c.times.length !== c.count ||
    c.frames.length !== c.count * c.stride
  )
    throw Error("Invalid replay buffer dimensions");
  return {
    ...c,
    times: new Float64Array(c.times),
    frames: new Float32Array(c.frames),
  };
}

/** Bounded storage reused every authoritative tick. Only a goal creates a clip copy. */
export class ReplayBuffer {
  readonly stride: number;
  readonly frames: Float32Array;
  readonly times = new Float64Array(REPLAY_CAPACITY);
  readonly resets = new Uint32Array(REPLAY_CAPACITY);
  private head = 0;
  count = 0;
  private eventHead = 0;
  private eventCount = 0;
  private events: (ReplayEvent | undefined)[] = new Array(REPLAY_CAPACITY * 4);
  constructor(
    readonly carIds: string[],
    readonly padCount: number,
  ) {
    this.stride = BALL_STRIDE + carIds.length * CAR_STRIDE + padCount;
    this.frames = new Float32Array(REPLAY_CAPACITY * this.stride);
  }
  reset() {
    this.count = this.head = this.eventHead = this.eventCount = 0;
  }
  write(time: number, reset: number) {
    const index = this.head;
    this.times[index] = time;
    this.resets[index] = reset;
    this.head = (this.head + 1) % REPLAY_CAPACITY;
    this.count = Math.min(this.count + 1, REPLAY_CAPACITY);
    return index * this.stride;
  }
  event(event: ReplayEvent) {
    this.events[this.eventHead] = event;
    this.eventHead = (this.eventHead + 1) % this.events.length;
    this.eventCount = Math.min(this.eventCount + 1, this.events.length);
  }
  clip(goal: ReplayGoal): ReplayClip {
    const indices: number[] = [];
    const newest = (this.head + REPLAY_CAPACITY - 1) % REPLAY_CAPACITY;
    for (let n = 0; n < this.count; n++) {
      const i =
        (this.head + REPLAY_CAPACITY - this.count + n) % REPLAY_CAPACITY;
      if (
        this.times[i] >= goal.time - 5 - 1 / REPLAY_HZ &&
        this.resets[i] === this.resets[newest]
      )
        indices.push(i);
    }
    const times = new Float64Array(indices.length);
    const frames = new Float32Array(indices.length * this.stride);
    indices.forEach((i, n) => {
      times[n] = this.times[i];
      frames.set(
        this.frames.subarray(i * this.stride, (i + 1) * this.stride),
        n * this.stride,
      );
    });
    const start = times[0] ?? goal.time;
    const events: ReplayEvent[] = [];
    for (let n = 0; n < this.eventCount; n++) {
      const e =
        this.events[
          (this.eventHead + this.events.length - this.eventCount + n) %
            this.events.length
        ];
      if (e && e.time >= start && e.time <= goal.time) events.push({ ...e });
    }
    return {
      goal,
      carIds: [...this.carIds],
      padCount: this.padCount,
      stride: this.stride,
      count: times.length,
      start,
      end: goal.time,
      times,
      frames,
      events,
    };
  }
  get bytes() {
    return (
      this.frames.byteLength + this.times.byteLength + this.resets.byteLength
    );
  }
}

export type SlowInterval = { start: number; end: number };
export function slowIntervals(clip: ReplayClip): SlowInterval[] {
  const goal = clip.goal;
  const regions = [
    { start: Math.max(clip.start, goal.time - 0.5), end: goal.time + 0.2 },
  ];
  if (
    !goal.ownGoal &&
    goal.lastTouchId === goal.scorerId &&
    goal.touchTime !== null &&
    goal.touchTime >= clip.start
  )
    regions.push({
      start: Math.max(clip.start, goal.touchTime - 0.5),
      end: Math.min(goal.time + 0.2, goal.touchTime + 0.5),
    });
  regions.sort((a, b) => a.start - b.start);
  const merged: SlowInterval[] = [];
  for (const r of regions) {
    const previous = merged[merged.length - 1];
    if (previous && r.start <= previous.end + 0.15)
      previous.end = Math.max(previous.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
}
export class ReplayClock {
  time: number;
  speed = 1;
  readonly intervals: SlowInterval[];
  constructor(readonly clip: ReplayClip) {
    this.time = clip.start;
    this.intervals = slowIntervals(clip);
  }
  advance(dt: number) {
    // Integrate in small steps so both authority and tests have consistent timing.
    while (dt > 1e-9 && !this.done) {
      const step = Math.min(dt, 1 / REPLAY_HZ);
      const slow = this.intervals.some(
        (i) => this.time >= i.start - 0.08 && this.time <= i.end,
      );
      this.speed +=
        ((slow ? 0.4 : 1) - this.speed) * (1 - Math.exp(-step * 16));
      this.time = Math.min(this.clip.end + 0.65, this.time + step * this.speed);
      dt -= step;
    }
  }
  get done() {
    return this.time >= this.clip.end + 0.65 - 1e-8;
  }
}

/** Reusable output row. Every rotation uses slerp; discrete state uses the older tick. */
export class ReplaySampler {
  readonly frame: Float32Array;
  private qa = new Quaternion();
  private qb = new Quaternion();
  constructor(readonly clip: ReplayClip) {
    this.frame = new Float32Array(clip.stride);
  }
  sample(time: number) {
    const c = this.clip;
    let lo = 0,
      hi = c.count - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (c.times[mid] < time) lo = mid + 1;
      else hi = mid;
    }
    const b = lo,
      a = Math.max(0, b - 1);
    const alpha =
      a === b
        ? 1
        : Math.max(
            0,
            Math.min(1, (time - c.times[a]) / (c.times[b] - c.times[a])),
          );
    const rowA = a * c.stride,
      rowB = b * c.stride;
    for (let j = 0; j < c.stride; j++)
      this.frame[j] =
        c.frames[rowA + j] + (c.frames[rowB + j] - c.frames[rowA + j]) * alpha;
    const rigid = (offset: number, enabled: number, discrete: number[]) => {
      const teleported =
        c.frames[rowA + enabled] !== c.frames[rowB + enabled] ||
        Math.hypot(
          ...[0, 1, 2].map(
            (n) => c.frames[rowB + offset + n] - c.frames[rowA + offset + n],
          ),
        ) > 8;
      if (teleported) {
        this.frame.set(
          c.frames.subarray(
            rowB + offset,
            rowB + offset + (offset ? CAR_STRIDE : BALL_STRIDE),
          ),
          offset,
        );
        return;
      }
      this.qa.fromArray(c.frames, rowA + offset + 3);
      this.qb.fromArray(c.frames, rowB + offset + 3);
      this.qa
        .slerp(this.qb, alpha)
        .normalize()
        .toArray(this.frame, offset + 3);
      for (const n of discrete)
        this.frame[offset + n] =
          c.frames[(alpha >= 1 ? rowB : rowA) + offset + n];
    };
    rigid(0, 13, [13]);
    for (let i = 0; i < c.carIds.length; i++) {
      const offset = BALL_STRIDE + i * CAR_STRIDE;
      rigid(offset, offset + RC.enabled, [
        RC.enabled,
        RC.boosting,
        RC.grounded,
        RC.sonic,
        RC.wheels,
        RC.jumpSequence,
        RC.demolition,
      ]);
    }
    return this.frame;
  }
}
