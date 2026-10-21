import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3, Quaternion } from "three";
import { P } from "../../config/physics";
import { insideArena } from "../../arena/physics";
import { scoringTeam } from "../../game/goals";
import type { Simulation } from "../../physics/simulation";
import type { TrainingShot } from "../../../shared/custom-training";
import type { PlayerInput } from "../../../shared/player";
export function constrainTrainingPosition(
  s: Simulation,
  position: Vector3,
  ball: boolean,
  rotation = new Quaternion(),
) {
  const a = P.arena;
  position.x = Math.max(-a.halfWidth, Math.min(a.halfWidth, position.x));
  position.y = Math.max(0, Math.min(a.height, position.y));
  position.z = Math.max(
    -a.halfLength - a.goalDepth,
    Math.min(a.halfLength + a.goalDepth, position.z),
  );
  const shell = s.arenaCollider!;
  if (!insideArena(shell, position, 0.001)) {
    const point = shell.projectPoint(position, false)?.point;
    if (point) {
      const inward = new Vector3().copy(point).sub(position).normalize();
      position
        .copy(point)
        .addScaledVector(inward, ball ? P.ball.radius + 0.03 : 1.2);
    }
  }
  const offset = new Vector3(
    0,
    ball ? 0 : s.cars[0].collider.translationWrtParent()!.y,
    0,
  ).applyQuaternion(rotation);
  const shape = ball
    ? new RAPIER.Ball(P.ball.radius)
    : s.cars[0].collider.shape;
  const center = new Vector3();
  for (let i = 0; i < 8; i++) {
    let corrected = false;
    center.copy(position).add(offset);
    s.world.forEachCollider((col) => {
      if (col.parent() !== null) return;
      const contact = col.contactShape(shape, center, rotation, 0.01);
      if (contact && contact.distance < 0.005) {
        const push = new Vector3()
          .copy(contact.normal1)
          .multiplyScalar(0.008 - contact.distance);
        position.add(push);
        center.add(push);
        corrected = true;
      }
    });
    if (!corrected) break;
  }
  return position;
}
export class CustomTrainingRun {
  elapsed = 0;
  result = "";
  delay = 0;
  resetSequence = 0;
  goalPosition: Vector3 | null = null;
  constructor(readonly physics: Simulation) {}
  reset(shot: TrainingShot) {
    const s = this.physics,
      c = s.cars[0];
    s.reset();
    c.reset(shot.carPosition.x, shot.carPosition.z, 0, shot.carPosition.y);
    c.body.setRotation(shot.carRotation, true);
    c.body.setLinvel(shot.carVelocity, true);
    c.boost = 100;
    s.ball.setTranslation(shot.ballPosition, true);
    s.ball.setLinvel(
      {
        x: shot.ballLaunchDirection.x * shot.ballLaunchSpeed,
        y: shot.ballLaunchDirection.y * shot.ballLaunchSpeed,
        z: shot.ballLaunchDirection.z * shot.ballLaunchSpeed,
      },
      true,
    );
    s.ball.setAngvel(shot.ballAngularVelocity, true);
    s.ball.setGravityScale(1, true);
    s.ball.setEnabled(true);
    c.pose.snap();
    s.ballPose.snap();
    this.elapsed = 0;
    this.result = "";
    this.goalPosition = null;
    this.delay = 0;
    this.resetSequence++;
  }
  step(input: PlayerInput, shot: TrainingShot) {
    this.physics.step([input]);
    this.elapsed += P.dt;
    if (!this.result) {
      if (
        scoringTeam(this.physics.ball.translation(), P.ball.radius) !== null
      ) {
        this.result = "GOAL";
        this.goalPosition = new Vector3().copy(this.physics.ball.translation());
        this.physics.explode(this.goalPosition);
      } else if (this.elapsed >= shot.timeLimit) this.result = "SHOT COMPLETE";
    }
    if (this.result) this.delay += P.dt;
  }
}
