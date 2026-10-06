import type { Simulation } from "../physics/simulation";
import type { Pads } from "../game/pads";
import { P } from "../config/physics";
import {
  BALL_STRIDE,
  CAR_STRIDE,
  RC,
  ReplayBuffer,
  type ReplayGoal,
} from "../../shared/replay";
import type { Vec } from "../../shared/network";

export class ReplayRecorder {
  buffer: ReplayBuffer | null = null;
  private touchSequence = -1;
  private wheelStates = new Float64Array(4 * 6);
  private padCooldowns = new Float32Array(20);
  reset() {
    this.buffer?.reset();
    this.touchSequence = -1;
    this.wheelStates.fill(0);
    this.padCooldowns.fill(0);
  }
  capture(s: Simulation, reset: number, pads?: Pads) {
    if (
      !this.buffer ||
      this.buffer.carIds.some((id, i) => id !== s.cars[i]?.id) ||
      this.buffer.carIds.length !== s.cars.length
    ) {
      this.buffer = new ReplayBuffer(
        s.cars.map((c) => c.id),
        20,
      );
      this.reset();
    }
    const b = this.buffer,
      data = b.frames,
      base = b.write(s.clock, reset);
    const vector = (offset: number, v: Vec) => {
      data[offset] = v.x;
      data[offset + 1] = v.y;
      data[offset + 2] = v.z;
    };
    const rigid = (offset: number, body: Simulation["ball"]) => {
      vector(offset, body.translation());
      const q = body.rotation();
      vector(offset + 3, q);
      data[offset + 6] = q.w;
      vector(offset + 7, body.linvel());
      vector(offset + 10, body.angvel());
      data[offset + 13] = Number(body.isEnabled());
    };
    rigid(base, s.ball);
    s.cars.forEach((c, i) => {
      const offset = base + BALL_STRIDE + i * CAR_STRIDE;
      rigid(offset, c.body);
      data[offset + RC.boost] = c.boost;
      data[offset + RC.boosting] = Number(c.boosting);
      data[offset + RC.grounded] = Number(c.grounded);
      data[offset + RC.sonic] = Number(c.supersonic);
      data[offset + RC.speed] = c.forwardSpeed;
      data[offset + RC.steer] = c.steerAngle;
      data[offset + RC.skid] = c.skidIntensity;
      vector(offset + RC.normal, c.normal);
      data[offset + RC.wheels] = c.wheelContact.reduce(
        (mask, hit, j) => mask | (Number(hit) << j),
        0,
      );
      c.wheelHits.forEach((point, j) =>
        vector(offset + RC.wheelHits + j * 3, point),
      );
      data[offset + RC.flip] = c.jump.flipLeft;
      data[offset + RC.jumpSequence] = c.normalJumpSequence;
      data[offset + RC.jumpAge] = Number.isFinite(c.normalJumpAge)
        ? c.normalJumpAge
        : 1000;
      vector(offset + RC.jumpOrigin, c.normalJumpOrigin);
      vector(offset + RC.jumpNormal, c.normalJumpNormal);
      data[offset + RC.demolition] =
        c.demolitionState === "active"
          ? 0
          : c.demolitionState === "demolished"
            ? 1
            : 2;
      const w = i * 6;
      if (c.grounded && c.wheelContact.some(Boolean)) {
        this.wheelStates[w + 2] = this.wheelStates[w + 3] = c.forwardSpeed;
        this.wheelStates[w + 4] = 0;
      } else {
        this.wheelStates[w + 4] = Math.min(
          P.car.wheelSpinCoastTime,
          this.wheelStates[w + 4] + P.dt,
        );
        this.wheelStates[w + 2] =
          this.wheelStates[w + 3] *
          Math.max(0, 1 - this.wheelStates[w + 4] / P.car.wheelSpinCoastTime);
      }
      this.wheelStates[w] -= (this.wheelStates[w + 2] * P.dt) / 0.18;
      this.wheelStates[w + 1] +=
        (c.steerAngle - this.wheelStates[w + 1]) * (1 - Math.exp(-P.dt * 20));
      data[offset + RC.wheelAngle] = this.wheelStates[w];
      data[offset + RC.wheelSteer] = this.wheelStates[w + 1];
      data[offset + RC.wheelSpeed] = this.wheelStates[w + 2];
      data[offset + RC.contactSpeed] = this.wheelStates[w + 3];
      data[offset + RC.airborneTime] = this.wheelStates[w + 4];
      if (
        c.demolitionState !== "active" &&
        s.demolitions.some((d) => d.victimId === c.id && d.age === 0)
      )
        b.event({ kind: "demolition", playerId: c.id, time: s.clock });
    });
    const padOffset = base + BALL_STRIDE + s.cars.length * CAR_STRIDE;
    for (let i = 0; i < 20; i++) {
      const cooldown = pads?.items[i]?.cooldown ?? 0;
      data[padOffset + i] = cooldown;
      if (cooldown > this.padCooldowns[i] + 0.1) {
        const pad = pads?.items[i];
        const car =
          pad &&
          s.cars.find(
            (c) =>
              Math.hypot(
                c.body.translation().x - pad.x,
                c.body.translation().z - pad.z,
              ) < 2.1,
          );
        b.event({
          kind: "pickup",
          playerId: car?.id ?? "",
          time: s.clock,
          index: i,
        });
      }
      this.padCooldowns[i] = cooldown;
    }
    if (s.touchSequence !== this.touchSequence)
      for (const event of s.touchEvents)
        if (event.time === s.clock) b.event({ kind: "touch", ...event });
    this.touchSequence = s.touchSequence;
  }
  clip(goal: ReplayGoal) {
    this.buffer!.event({
      kind: "goal",
      playerId: goal.scorerId,
      time: goal.time,
    });
    return this.buffer!.clip(goal);
  }
  wheels(index: number) {
    return {
      angle: this.wheelStates[index * 6],
      steer: this.wheelStates[index * 6 + 1],
    };
  }
}
