import { Quaternion, Vector3 } from "three";
import type {
  MatchSnapshot,
  CarSnapshot,
  Vec,
  Rotation,
} from "../../shared/network";
import { NETWORK as N } from "../../shared/network-tuning";
export interface SnapshotSample {
  older: MatchSnapshot;
  newer: MatchSnapshot;
  alpha: number;
  extrapolation: number;
  time: number;
}
export class SnapshotBuffer {
  readonly snapshots: MatchSnapshot[] = [];
  duplicates = 0;
  outOfOrder = 0;
  dropped = 0;
  private offset = NaN;
  private lastNow = NaN;
  private rendered = NaN;
  clear() {
    this.snapshots.length = 0;
    this.offset = this.lastNow = this.rendered = NaN;
  }
  push(s: MatchSnapshot, now = performance.now()) {
    const list = this.snapshots,
      last = list.at(-1);
    if (last && (s.reset < last.reset || s.matchId !== last.matchId)) {
      this.dropped++;
      return false;
    }
    if (last && s.reset !== last.reset) this.clear();
    if (list.some((x) => x.tick === s.tick)) {
      this.duplicates++;
      return false;
    }
    if (list.length && s.tick < list.at(-1)!.tick) {
      this.outOfOrder++;
      if (s.time < this.rendered - 0.05) {
        this.dropped++;
        return false;
      }
    }
    let i = list.findIndex((x) => x.tick > s.tick);
    if (i < 0) i = list.length;
    list.splice(i, 0, s);
    if (i === list.length - 1) {
      const measured = s.time - now / 1000;
      if (
        !Number.isFinite(this.offset) ||
        Math.abs(measured - this.offset) > 0.5
      ) {
        this.offset = measured;
        this.rendered = s.time - N.interpolationSeconds;
        this.lastNow = now;
      } else
        this.offset += Math.max(
          -0.002,
          Math.min(0.002, measured - this.offset),
        );
    }
    while (list.length > N.bufferSize) {
      list.shift();
      this.dropped++;
    }
    if (!Number.isFinite(this.rendered)) {
      this.rendered = s.time - N.interpolationSeconds;
      this.lastNow = now;
    }
    return true;
  }
  sample(now = performance.now()): SnapshotSample | null {
    const list = this.snapshots,
      last = list.at(-1);
    if (!last) return null;
    const dt = Math.max(0, Math.min(0.1, (now - this.lastNow) / 1000));
    this.lastNow = now;
    const desired = now / 1000 + this.offset - N.interpolationSeconds;
    if (desired - this.rendered > 1) {
      this.rendered = last.time - N.interpolationSeconds;
    } else
      this.rendered +=
        dt * Math.max(0.9, Math.min(1.1, 1 + (desired - this.rendered) * 2));
    this.rendered = Math.min(this.rendered, last.time + N.extrapolationSeconds);
    const time = this.rendered;
    let index = list.findIndex((s) => s.time >= time);
    if (index < 0) index = list.length - 1;
    const newer = list[index],
      older = list[Math.max(0, index - 1)];
    const alpha =
      newer === older
        ? 1
        : Math.max(
            0,
            Math.min(1, (time - older.time) / (newer.time - older.time)),
          );
    const extrapolation =
      time > last.time ? Math.min(N.extrapolationSeconds, time - last.time) : 0;
    if (index > 1) list.splice(0, index - 1);
    return { older, newer, alpha, extrapolation, time };
  }
  get delay() {
    return N.interpolationSeconds;
  }
}
export function interpolateTransform(
  a: {
    position: Vec;
    rotation: Rotation;
    velocity?: Vec;
    angularVelocity?: Vec;
  },
  b: typeof a,
  alpha: number,
  extra = 0,
) {
  const p = new Vector3().lerpVectors(
      a.position as Vector3,
      b.position as Vector3,
      alpha,
    ),
    q = new Quaternion().slerpQuaternions(
      new Quaternion().copy(a.rotation),
      new Quaternion().copy(b.rotation),
      alpha,
    ),
    velocity = new Vector3().lerpVectors(
      (a.velocity ?? { x: 0, y: 0, z: 0 }) as Vector3,
      (b.velocity ?? { x: 0, y: 0, z: 0 }) as Vector3,
      alpha,
    ),
    angular = new Vector3().lerpVectors(
      (a.angularVelocity ?? { x: 0, y: 0, z: 0 }) as Vector3,
      (b.angularVelocity ?? { x: 0, y: 0, z: 0 }) as Vector3,
      alpha,
    );
  if (extra > 0) {
    p.addScaledVector(velocity, Math.min(extra, N.extrapolationSeconds));
    const speed = angular.length();
    if (speed > 1e-6)
      q.premultiply(
        new Quaternion().setFromAxisAngle(
          angular.clone().divideScalar(speed),
          speed * Math.min(extra, N.extrapolationSeconds),
        ),
      );
  }
  return { position: p, rotation: q, velocity, angularVelocity: angular };
}
export function interpolateCar(
  a: CarSnapshot,
  b: CarSnapshot,
  s: SnapshotSample,
): CarSnapshot {
  if (a.teleportSequence !== b.teleportSequence || a.enabled !== b.enabled)
    return b;
  const pose = interpolateTransform(a, b, s.alpha, s.extrapolation),
    lerp = (a: number, b: number) => a + (b - a) * s.alpha;
  return {
    ...b,
    ...pose,
    normal: new Vector3()
      .lerpVectors(a.normal as Vector3, b.normal as Vector3, s.alpha)
      .normalize(),
    speed: lerp(a.speed, b.speed),
    steer: lerp(a.steer, b.steer),
    wheelAngle: lerp(a.wheelAngle ?? 0, b.wheelAngle ?? 0),
    wheelSteer: lerp(a.wheelSteer ?? a.steer, b.wheelSteer ?? b.steer),
    wheelHits: b.wheelHits.map((hit, i) =>
      new Vector3()
        .lerpVectors(a.wheelHits[i] as Vector3, hit as Vector3, s.alpha)
        .addScaledVector(pose.velocity, s.extrapolation),
    ),
  };
}
