import { PerspectiveCamera, Vector3, Quaternion, MathUtils } from "three";
import { P } from "../config/physics";
import type { ReplayGoal, SlowInterval } from "../../shared/replay";

/** Original continuous broadcast shot. Car orientation is deliberately absent. */
export class ReplayDirectorCamera {
  readonly desiredPosition = new Vector3();
  readonly target = new Vector3();
  readonly debug = {
    replayTime: 0,
    speed: 1,
    goalTime: 0,
    touchTime: null as number | null,
    intervals: [] as SlowInterval[],
    desired: this.desiredPosition,
    target: this.target,
    actual: new Vector3(),
    ballScreen: new Vector3(),
    scorerScreen: new Vector3(),
    goalScreen: new Vector3(),
  };
  private initialized = false;
  private side = 1;
  private probe = new PerspectiveCamera();
  private desiredRotation = new Quaternion();
  private ball = new Vector3();
  private scorer = new Vector3();
  private goal = new Vector3();
  private velocity = new Vector3();
  private blendedTarget = new Vector3();
  constructor(readonly camera: PerspectiveCamera) {}
  reset() {
    this.initialized = false;
  }
  update(
    ball: Vector3,
    velocity: Vector3,
    scorer: Vector3,
    goal: ReplayGoal,
    dt: number,
    time: number,
    speed: number,
    intervals: SlowInterval[],
  ) {
    this.ball.copy(ball);
    this.velocity.copy(velocity);
    this.scorer.copy(scorer);
    this.goal.copy(goal.focus);
    if (!this.initialized) this.side = ball.x >= 0 ? -1 : 1;
    const goalDistance = ball.distanceTo(this.goal);
    const scorerDistance = ball.distanceTo(scorer);
    const scorerWeight = MathUtils.lerp(
      0.3,
      0.08,
      MathUtils.clamp(scorerDistance / 35, 0, 1),
    );
    const goalWeight = MathUtils.lerp(
      0.26,
      0.05,
      MathUtils.clamp(goalDistance / 55, 0, 1),
    );
    this.blendedTarget
      .copy(ball)
      .multiplyScalar(1 - scorerWeight - goalWeight)
      .addScaledVector(scorer, scorerWeight)
      .addScaledVector(this.goal, goalWeight);
    const points = [this.ball, this.scorer, this.goal];
    // Move the composition toward the action's bounds when subjects spread.
    const center = new Vector3();
    for (const p of points) center.add(p);
    center.multiplyScalar(1 / points.length);
    this.blendedTarget.lerp(
      center,
      MathUtils.clamp(scorerDistance / 45, 0.1, 0.65),
    );
    if (!this.initialized) this.target.copy(this.blendedTarget);
    else this.target.lerp(this.blendedTarget, 1 - Math.exp(-dt * 9));
    const goalSign = Math.sign(goal.focus.z) || -1;
    // Ball travel adds a modest lead, without letting bounces reverse the shot.
    const lead = this.velocity
      .clone()
      .setY(0)
      .clampLength(0, 2)
      .multiplyScalar(0.16);
    const direction = new Vector3(
      this.side * 0.8 * MathUtils.clamp(this.camera.aspect / (16 / 9), 0.28, 1),
      0.58,
      -goalSign * 0.65,
    ).normalize();
    let distance = 13,
      fov = 60;
    this.probe.aspect = this.camera.aspect;
    this.probe.up.set(0, 1, 0);
    for (let i = 0; i < 20; i++) {
      this.desiredPosition
        .copy(this.target)
        .addScaledVector(direction, distance)
        .add(lead);
      this.desiredPosition.x = MathUtils.clamp(
        this.desiredPosition.x,
        -P.arena.halfWidth + 2,
        P.arena.halfWidth - 2,
      );
      this.desiredPosition.z = MathUtils.clamp(
        this.desiredPosition.z,
        -P.arena.halfLength + 2,
        P.arena.halfLength - 2,
      );
      this.desiredPosition.y = MathUtils.clamp(
        this.desiredPosition.y,
        5,
        P.arena.height - 1.5,
      );
      this.probe.position.copy(this.desiredPosition);
      this.probe.fov = fov;
      this.probe.lookAt(this.target);
      this.probe.updateProjectionMatrix();
      this.probe.updateMatrixWorld(true);
      if (
        points.every((p) => {
          const screen = p.clone().project(this.probe);
          return (
            screen.z < 1 &&
            screen.z > -1 &&
            Math.abs(screen.x) < 0.8 &&
            Math.abs(screen.y) < 0.67
          );
        })
      )
        break;
      distance *= 1.1;
      fov = Math.min(76, fov + 0.8);
    }
    this.desiredRotation.copy(this.probe.quaternion);
    this.camera.clearViewOffset();
    this.camera.up.set(0, 1, 0);
    if (!this.initialized) {
      this.camera.position.copy(this.desiredPosition);
      this.camera.quaternion.copy(this.desiredRotation);
      this.camera.fov = fov;
      this.initialized = true;
    } else {
      this.camera.position.lerp(this.desiredPosition, 1 - Math.exp(-dt * 5));
      this.camera.quaternion.slerp(this.desiredRotation, 1 - Math.exp(-dt * 8));
      this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-dt * 3));
    }
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
    Object.assign(this.debug, {
      replayTime: time,
      speed,
      goalTime: goal.time,
      touchTime: goal.touchTime,
      intervals,
    });
    this.debug.actual.copy(this.camera.position);
    this.debug.ballScreen.copy(ball).project(this.camera);
    this.debug.scorerScreen.copy(scorer).project(this.camera);
    this.debug.goalScreen.copy(this.goal).project(this.camera);
  }
}
