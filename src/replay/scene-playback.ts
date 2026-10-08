import { heatseekerBall, heatIntensity } from "../effects/heatseeker-ball";
import { Vector3, Quaternion, type Group, type PerspectiveCamera } from "three";
import type { Car } from "../car/car";
import { animateBall, animateWheels } from "../render/models";
import type { VehicleEffects } from "../effects/vehicle-effects";
import type { BallTrails, FlipTrails } from "../effects/motion-trails";
import type { JumpBurst } from "../effects/jump-burst";
import type { SkidMarks } from "../effects/skid-marks";
import type { DemolitionFlash } from "../effects/demolition-flash";
import type { GoalExplosion } from "../effects/goal-explosion";
import {
  BALL_STRIDE,
  CAR_STRIDE,
  RC,
  ReplaySampler,
  slowIntervals,
  type ReplayClip,
} from "../../shared/replay";
import { ReplayDirectorCamera } from "./director-camera";

export interface ReplayEffects {
  vehicles: VehicleEffects[];
  ball: BallTrails;
  flips: FlipTrails[];
  jumps: JumpBurst[];
  skids: SkidMarks[];
  demos: DemolitionFlash[];
  explosion: GoalExplosion;
}
/** Render-only proxy; no Rapier world, setters, force APIs, scores or event logic. */
function visualCar(source: Car, model: Group) {
  const velocity = new Vector3(),
    angular = new Vector3();
  const proxy = {
    id: source.id,
    team: source.team,
    bodyId: source.bodyId,
    boost: 0,
    boosting: false,
    grounded: false,
    supersonic: false,
    forwardSpeed: 0,
    steerAngle: 0,
    skidIntensity: 0,
    normal: new Vector3(),
    forward: new Vector3(),
    right: new Vector3(),
    up: new Vector3(),
    wheelContact: [false, false, false, false],
    wheelHits: Array.from({ length: 4 }, () => new Vector3()),
    jump: { flipLeft: 0 },
    normalJumpSequence: 0,
    normalJumpAge: 1000,
    normalJumpOrigin: new Vector3(),
    normalJumpNormal: new Vector3(),
    body: {
      translation: () => model.position,
      rotation: () => model.quaternion,
      linvel: () => velocity,
      angvel: () => angular,
      isEnabled: () => model.visible,
    },
  };
  return { car: proxy as unknown as Car, velocity, angular };
}
export class ReplayScenePlayback {
  readonly director: ReplayDirectorCamera;
  private sampler: ReplaySampler | null = null;
  private proxies: ReturnType<typeof visualCar>[];
  private previousTime = 0;
  private goalShown = false;
  private ballVelocity = new Vector3();
  private intervals = [] as ReturnType<typeof slowIntervals>;
  private frame: Float32Array | null = null;
  constructor(
    camera: PerspectiveCamera,
    private models: Group[],
    private visuals: Group[],
    private ball: Group,
    private sources: Car[],
    private effects: ReplayEffects,
  ) {
    this.director = new ReplayDirectorCamera(camera);
    this.proxies = sources.map((c, i) => visualCar(c, models[i]));
  }
  get active() {
    return !!this.sampler;
  }
  resetEffects() {
    heatseekerBall(this.ball, null);
    const e = this.effects;
    e.vehicles.forEach((v) => v.reset());
    e.ball.reset();
    e.flips.forEach((v) => v.reset());
    e.jumps.forEach((v) => v.reset());
    e.skids.forEach((v) => v.reset());
    e.demos.forEach((v) => v.reset());
    e.explosion.reset();
  }
  stop() {
    if (!this.sampler) return;
    this.resetEffects();
    this.sampler = null;
    this.frame = null;
    this.director.reset();
  }
  render(clip: ReplayClip, time: number, speed: number, realDt: number) {
    if (this.sampler?.clip.goal.id !== clip.goal.id) {
      this.resetEffects();
      this.director.reset();
      this.sampler = new ReplaySampler(clip);
      this.intervals = slowIntervals(clip);
      this.previousTime = clip.start;
      this.goalShown = false;
    }
    // Never rewind effect history on an out-of-order packet. A new clip resets it.
    time = Math.max(this.previousTime, time);
    const frame = this.sampler!.sample(time);
    const effectDt = Math.max(0, Math.min(0.1, time - this.previousTime));
    this.previousTime = time;
    this.frame = frame;
    this.ball.position.fromArray(frame, 0);
    this.ball.quaternion.fromArray(frame, 3).normalize();
    this.ball.visible = !!frame[13] && time < clip.goal.time;
    this.ballVelocity.fromArray(frame, 7);
    animateBall(this.ball, time);
    let heat: import("../../shared/soccer").HeatseekerState | undefined;
    for (const entry of clip.heatseeker ?? [])
      if (entry.time <= time) heat = entry.state;
    heatseekerBall(this.ball, heat, effectDt);
    this.sources.forEach((source, i) => {
      const index = clip.carIds.indexOf(source.id);
      if (index < 0) {
        this.models[i].visible = false;
        return;
      }
      const o = BALL_STRIDE + index * CAR_STRIDE;
      const model = this.models[i],
        p = this.proxies[i],
        c = p.car;
      c.id = source.id;
      c.team = source.team;
      c.bodyId = source.bodyId;
      const wasVisible = model.visible;
      model.position.fromArray(frame, o);
      model.quaternion.fromArray(frame, o + RC.rotation).normalize();
      model.visible = !!frame[o + RC.enabled];
      if (wasVisible && !model.visible)
        this.effects.demos[i].trigger(model.position);
      p.velocity.fromArray(frame, o + RC.velocity);
      p.angular.fromArray(frame, o + RC.angular);
      c.boost = frame[o + RC.boost];
      c.boosting = !!frame[o + RC.boosting];
      c.grounded = !!frame[o + RC.grounded];
      c.supersonic = !!frame[o + RC.sonic];
      c.forwardSpeed = frame[o + RC.speed];
      c.steerAngle = frame[o + RC.steer];
      c.skidIntensity = frame[o + RC.skid];
      c.normal.fromArray(frame, o + RC.normal);
      c.forward.set(0, 0, -1).applyQuaternion(model.quaternion);
      c.right.set(1, 0, 0).applyQuaternion(model.quaternion);
      c.up.set(0, 1, 0).applyQuaternion(model.quaternion);
      c.wheelContact.forEach((_, j) => {
        c.wheelContact[j] = !!(frame[o + RC.wheels] & (1 << j));
        c.wheelHits[j].fromArray(frame, o + RC.wheelHits + j * 3);
      });
      c.jump.flipLeft = frame[o + RC.flip];
      c.normalJumpSequence = frame[o + RC.jumpSequence];
      c.normalJumpAge = frame[o + RC.jumpAge];
      c.normalJumpOrigin.fromArray(frame, o + RC.jumpOrigin);
      c.normalJumpNormal.fromArray(frame, o + RC.jumpNormal);
      animateWheels(
        this.visuals[i],
        c.forwardSpeed,
        c.steerAngle,
        0,
        c,
        model,
        { angle: frame[o + RC.wheelAngle], steer: frame[o + RC.wheelSteer] },
      );
      this.effects.vehicles[i].update(c, effectDt, time, model.visible);
      this.effects.flips[i].updateCar(
        c,
        model,
        effectDt,
        model.visible,
        this.director.camera.position,
      );
      this.effects.jumps[i].update(
        c,
        effectDt,
        model.visible,
        this.director.camera.position,
      );
      this.effects.skids[i].update(c, effectDt, model.visible);
      this.effects.demos[i].update(effectDt);
    });
    const scorer =
      this.models[this.sources.findIndex((c) => c.id === clip.goal.scorerId)] ??
      this.ball;
    this.director.update(
      this.ball.position,
      this.ballVelocity,
      scorer.position,
      clip.goal,
      realDt,
      time,
      speed,
      this.intervals,
    );
    let touch: ReplayClip["events"][number] | undefined;
    for (let i = clip.events.length - 1; i >= 0; i--) {
      const e = clip.events[i];
      if (e.kind === "touch" && e.time <= time) {
        touch = e;
        break;
      }
    }
    const team =
      this.sources.find((c) => c.id === touch?.playerId)?.team ?? null;
    this.effects.ball.updateBall(
      this.ball,
      this.ballVelocity.length(),
      heat?.active ? heat.ownerTeam : team,
      effectDt,
      this.ball.visible,
      this.director.camera.position,
      heatIntensity(heat),
      heat,
    );
    if (time >= clip.goal.time && !this.goalShown) {
      this.effects.explosion.trigger(
        this.ball.position,
        clip.goal.team === 0 ? 0x69e9ff : 0xffb654,
      );
      this.goalShown = true;
    }
    this.effects.explosion.update(effectDt);
    return frame.subarray(BALL_STRIDE + clip.carIds.length * CAR_STRIDE);
  }
}
