import { Vector3 } from "three";
import type { MatchSnapshot } from "../../shared/network";
import { interpolateTransform, type SnapshotSample } from "./snapshot-buffer";

type Ball = MatchSnapshot["ball"];
type Checkpoint = { tick: number; time: number; ball: Ball };
/** Present confirmed impacts on the same delayed clock as remote cars. This
 * never applies impulses or writes host/gameplay state. */
export class AuthoritativeBallCorrection {
  private epoch = "";
  private resetPose: Checkpoint | undefined;
  private previous: MatchSnapshot | undefined;
  private contacts = new Map<number, Checkpoint>();
  private sequence = -1;
  authoritative = true;
  contactSequence = -1;
  sample(latest: MatchSnapshot, sample: SnapshotSample) {
    const epoch = `${latest.matchId}:${latest.reset}:${latest.ball.enabled}`;
    if (epoch !== this.epoch) {
      this.epoch = epoch;
      this.contacts.clear();
      this.sequence = -1;
      this.resetPose = {
        tick: latest.tick,
        time: latest.time,
        ball: latest.ball,
      };
      this.previous = undefined;
    }
    for (const event of latest.contacts ?? [])
      if (event.sequence > this.sequence) {
        this.contacts.set(event.tick, event);
        this.sequence = Math.max(this.sequence, event.sequence);
      }
    // A lost contact checkpoint must not leave a large velocity discontinuity
    // blended across a packet interval. Modes/power-up outcomes still come from host.
    if (
      this.previous &&
      latest.tick > this.previous.tick &&
      !(latest.contacts ?? []).some((e) => e.tick > this.previous!.tick) &&
      new Vector3()
        .copy(latest.ball.velocity ?? new Vector3())
        .distanceTo(this.previous.ball.velocity ?? new Vector3()) > 4
    ) {
      this.contacts.set(latest.tick, {
        tick: latest.tick,
        time: latest.time,
        ball: latest.ball,
      });
    }
    if (!this.previous || latest.tick >= this.previous.tick)
      this.previous = latest;
    const events = [...this.contacts.values()].sort((a, b) => a.tick - b.tick);
    for (const e of events)
      if (e.time < sample.time - 0.4) this.contacts.delete(e.tick);
    this.contactSequence = this.sequence;
    this.authoritative =
      events.some((e) => e.time >= sample.time - 0.18) ||
      sample.time < this.resetPose!.time + 0.1 ||
      latest.rumble?.players.some(
        (p) => p.phase === "active" || !!p.attachment,
      ) === true;
    if (sample.time < this.resetPose!.time) {
      return interpolateTransform(
        this.resetPose!.ball,
        this.resetPose!.ball,
        1,
      );
    }
    let a = sample.older.ball,
      b = sample.newer.ball,
      ta = sample.older.time,
      tb = sample.newer.time;
    const past = events.filter((e) => e.time <= sample.time).at(-1);
    if (past && past.time > ta) {
      a = past.ball;
      ta = past.time;
    }
    const future = events.find((e) => e.time > sample.time && e.time <= tb);
    if (future) {
      b = future.ball;
      tb = future.time;
    }
    if (tb < ta) {
      b = a;
      tb = ta;
    }
    const extra = Math.min(0.1, Math.max(0, sample.time - tb));
    const pose = interpolateTransform(
      a,
      b,
      tb === ta ? 1 : Math.max(0, Math.min(1, (sample.time - ta) / (tb - ta))),
      extra,
    );
    // A collision changes velocity at its checkpoint, not gradually beforehand.
    if (future) {
      pose.velocity.copy(a.velocity ?? new Vector3());
      pose.angularVelocity.copy(a.angularVelocity ?? new Vector3());
    }
    return pose;
  }
  blendSmallPrediction(
    pose: ReturnType<typeof interpolateTransform>,
    prediction: {
      position: Vector3;
      rotation: import("three").Quaternion;
      velocity: Vector3;
    },
    amount: number,
  ) {
    if (
      this.authoritative ||
      pose.position.distanceTo(prediction.position) > 1.5 ||
      pose.velocity.distanceTo(prediction.velocity) > 4
    )
      return pose;
    // Fade speculative influence before the hard threshold, avoiding a second
    // visible jump as a formerly large error becomes small enough to blend.
    const weight =
      amount *
      Math.min(1, 1.5 - pose.position.distanceTo(prediction.position)) *
      Math.min(1, (4 - pose.velocity.distanceTo(prediction.velocity)) / 2);
    pose.position.lerp(prediction.position, weight);
    pose.rotation.slerp(prediction.rotation, weight);
    return pose;
  }
}
