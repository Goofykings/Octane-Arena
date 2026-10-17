import type { Simulation } from "../physics/simulation";
import type { Pads } from "../game/pads";
import { P } from "../config/physics";
import {
  BALL_STRIDE,
  CAR_STRIDE,
  RC,
  ReplayBuffer,
  REPLAY_POST_GOAL,
  type ReplayGoal,
} from "../../shared/replay";
import type { Vec } from "../../shared/network";

import { RUMBLE_CONFIG as R } from "../config/rumble";
export class ReplayRecorder {
  private mutators = null as
    | import("../../shared/mutators").MatchMutators
    | null;
  private rumbleHistory: NonNullable<
    import("../../shared/replay").ReplayClip["rumble"]
  > = [];
  private dropshotHistory:NonNullable<import("../../shared/replay").ReplayClip["dropshot"]>=[];
  pendingGoal: ReplayGoal | null = null;
  private recordedGoalId: string | null = null;
  private resetSequences: number[] = [];
  buffer: ReplayBuffer | null = null;
  private touchSequence = -1;
  private heatHistory: NonNullable<
    import("../../shared/replay").ReplayClip["heatseeker"]
  > = [];
  private wheelStates = new Float64Array(4 * 6);
  private padCooldowns = new Float32Array(20);
  reset() {
    this.rumbleHistory = [];
    this.dropshotHistory = [];
    this.pendingGoal = null;
    this.recordedGoalId = null;
    this.resetSequences = [];
    this.heatHistory = [];
    this.buffer?.reset();
    this.touchSequence = -1;
    this.wheelStates.fill(0);
    this.padCooldowns.fill(0);
  }
  prepare(s: Simulation) {
    if (
      !this.buffer ||
      this.buffer.carIds.length !== s.cars.length ||
      this.buffer.carIds.some((id, i) => id !== s.cars[i].id)
    ) {
      this.buffer = new ReplayBuffer(
        s.cars.map((c) => c.id),
        20,
      );
      this.wheelStates = new Float64Array(s.cars.length * 6);
      this.reset();
    }
  }
  capture(s: Simulation, reset: number, pads?: Pads) {
    this.mutators = s.mutators;
    if (
      !this.buffer ||
      this.buffer.carIds.some((id, i) => id !== s.cars[i]?.id) ||
      this.buffer.carIds.length !== s.cars.length
    ) {
      this.buffer = new ReplayBuffer(
        s.cars.map((c) => c.id),
        20,
      );
      this.wheelStates = new Float64Array(s.cars.length * 6);
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
      if (
        c.flipResetSequence > 0 &&
        c.flipResetSequence !== this.resetSequences[i]
      )
        b.event({
          kind: "flip-reset",
          playerId: c.id,
          time: s.clock,
          point: { ...c.flipResetOrigin },
          normal: { ...c.flipResetNormal },
        });
      this.resetSequences[i] = c.flipResetSequence;
      const offset = base + BALL_STRIDE + i * CAR_STRIDE;
      rigid(offset, c.body);
      data[offset + RC.teleport] = c.teleportSequence;
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
    if (
      s.rumble &&
      (s.clock - (this.rumbleHistory.at(-1)?.time ?? -Infinity) >=
        1 / R.history.hz - 1e-8 ||
        s.rumble.events.at(-1)?.id !==
          this.rumbleHistory.at(-1)?.state.events.at(-1)?.id)
    ) {
      this.rumbleHistory.push({ time: s.clock, state: s.rumble.snapshot() });
      while (
        this.rumbleHistory.length > 1 &&
        this.rumbleHistory[1].time < s.clock - R.history.seconds
      )
        this.rumbleHistory.shift();
    }
    if (s.dropshot && (s.clock-(this.dropshotHistory.at(-1)?.time ?? -Infinity) >= .1 || s.dropshot.revision!==this.dropshotHistory.at(-1)?.state.revision)){
      this.dropshotHistory.push({time:s.clock,state:s.dropshot.snapshot(s.clock,true)});
      while(this.dropshotHistory.length>1 && this.dropshotHistory[1].time<s.clock-8)this.dropshotHistory.shift();
    }
    if (s.heatseeker) {
      const previous = this.heatHistory.at(-1)?.state,
        state = s.heatseeker.state;
      if (
        !previous ||
        previous.tier !== state.tier ||
        previous.active !== state.active
      )
        this.heatHistory.push({ time: s.clock, state: { ...state } });
      while (
        this.heatHistory.length > 1 &&
        this.heatHistory[1].time < s.clock - 6.1
      )
        this.heatHistory.shift();
    }
  }
  private markGoal(goal: ReplayGoal) {
    if (this.recordedGoalId === goal.id) return;
    this.recordedGoalId = goal.id;
    this.buffer!.event({
      kind: "goal",
      playerId: goal.scorerId,
      time: goal.time,
    });
  }
  beginGoal(goal: ReplayGoal) {
    this.markGoal(goal);
    this.pendingGoal = goal;
  }
  capturePostGoal(s: Simulation, reset: number, pads?: Pads) {
    const goal = this.pendingGoal;
    if (!goal) return null;
    this.capture(s, reset, pads);
    if (s.clock - goal.time < REPLAY_POST_GOAL - 1e-8) return null;
    this.pendingGoal = null;
    return this.clip(goal);
  }
  clip(goal: ReplayGoal) {
    this.markGoal(goal);
    const clip = this.buffer!.clip(goal);
    if (this.mutators) clip.mutators = this.mutators;
    if(this.dropshotHistory.length)clip.dropshot=structuredClone(this.dropshotHistory);
    if (this.heatHistory.length)
      clip.heatseeker = this.heatHistory.map((entry) => ({
        time: entry.time,
        state: { ...entry.state },
      }));
    if (this.rumbleHistory.length)
      clip.rumble = this.rumbleHistory.map((e) => ({
        time: e.time,
        state: structuredClone(e.state),
      }));
    return clip;
  }
  wheels(index: number) {
    return {
      angle: this.wheelStates[index * 6],
      steer: this.wheelStates[index * 6 + 1],
    };
  }
}
