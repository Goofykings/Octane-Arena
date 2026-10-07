import { Vector3, Quaternion } from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import type { HeatseekerState } from "../../shared/soccer";
import { HEATSEEKER as H } from "../config/heatseeker";
import { P } from "../config/physics";
export function heatseekerServeSpawn(team: 0 | 1) {
  const side = team === 0 ? 1 : -1;
  return {
    x: side * H.kickoffBallSpawn.right,
    y: P.ball.radius + 0.02,
    z: side * (H.kickoffCarDistance - H.kickoffBallSpawn.forward),
  };
}
export function isBackboard(
  point: RAPIER.Vector,
  normal: RAPIER.Vector,
  team: 0 | 1,
) {
  const sign = team === 0 ? 1 : -1;
  return (
    Math.abs(point.z - sign * P.arena.halfLength) < H.backboardTolerance &&
    Math.abs(normal.z) > H.backboardNormal &&
    Math.abs(point.x) < H.backboardWidth &&
    point.y > P.arena.ramp + 0.1 &&
    point.y < H.backboardHeight &&
    (Math.abs(point.x) > P.arena.goalHalf + P.arena.postRadius + 0.1 ||
      point.y > P.arena.goalHeight + P.arena.postRadius + 0.1)
  );
}
export class Heatseeker {
  state: HeatseekerState;
  private touches = new Map<string, number>();
  constructor(team: 0 | 1 = 0) {
    this.state = this.neutral(team);
  }
  private neutral(team: 0 | 1): HeatseekerState {
    return {
      active: false,
      ownerTeam: null,
      targetTeam: null,
      lastTouchPlayerId: null,
      tier: 0,
      speed: H.initialSpeed,
      kickoffTeam: team,
      backboardSequence: 0,
    };
  }
  reset(team: 0 | 1) {
    this.state = this.neutral(team);
    this.touches.clear();
  }
  private speedUp() {
    this.state.tier++;
    this.state.speed = Math.min(
      H.maxSpeed,
      H.initialSpeed + (this.state.tier - 1) * H.speedIncrement,
    );
  }
  touch(id: string, team: 0 | 1, time: number) {
    if (time - (this.touches.get(id) ?? -Infinity) < H.touchCooldown)
      return false;
    this.touches.set(id, time);
    this.state.active = true;
    this.state.ownerTeam = team;
    this.state.targetTeam = team === 0 ? 1 : 0;
    this.state.lastTouchPlayerId = id;
    this.speedUp();
    return true;
  }
  backboard(team: 0 | 1) {
    if (!this.state.active || this.state.targetTeam !== team) return false;
    this.state.ownerTeam = team;
    this.state.targetTeam = team === 0 ? 1 : 0;
    this.state.backboardSequence++;
    this.speedUp();
    return true;
  }
  steer(ball: RAPIER.RigidBody, dt: number) {
    if (
      !this.state.active ||
      this.state.targetTeam === null ||
      !ball.isEnabled()
    )
      return;
    const target = new Vector3(
      0,
      P.arena.goalHeight / 2,
      (this.state.targetTeam === 0 ? 1 : -1) *
        (P.arena.halfLength + H.targetDepth),
    );
    const desired = target.sub(ball.translation()).normalize(),
      velocity = new Vector3().copy(ball.linvel());
    const speed = velocity.length(),
      direction =
        speed > 0.01 ? velocity.clone().divideScalar(speed) : desired.clone();
    const angle = direction.angleTo(desired),
      axis = new Vector3().crossVectors(direction, desired);
    if (axis.lengthSq() < 1e-8 && direction.dot(desired) < 0)
      axis.crossVectors(direction, new Vector3(0, 1, 0));
    if (axis.lengthSq() < 1e-8 && direction.dot(desired) < 0) axis.set(1, 0, 0);
    if (axis.lengthSq() > 1e-8)
      direction.applyQuaternion(
        new Quaternion().setFromAxisAngle(
          axis.normalize(),
          Math.min(angle, H.maxTurnRate * dt, angle * H.homingStrength * dt),
        ),
      );
    const nextSpeed =
      speed +
      Math.max(
        -H.acceleration * dt,
        Math.min(H.acceleration * dt, this.state.speed - speed),
      );
    // A bounded delta impulse adds homing to the existing rigid-body velocity.
    // No pose/spin changes, and collision impulses run afterward unmodified.
    const delta = direction
      .multiplyScalar(nextSpeed)
      .sub(velocity)
      .multiplyScalar(P.ball.mass);
    ball.applyImpulse(delta, true);
  }
}
