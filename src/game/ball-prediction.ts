import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { P } from "../config/physics";
import { Heatseeker, isBackboard } from "./heatseeker";
import type { HeatseekerState } from "../../shared/soccer";
import { STAT_TUNING } from "../../shared/match-stats";
import { scoringTeam } from "./goals";
export interface BallSample {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  heat: HeatseekerState | null;
}
export interface GoalPrediction {
  team: 0 | 1;
  time: number;
  point: { x: number; y: number; z: number };
}
/** Read-only sphere sweep against actual static arena geometry. No simulation step. */
export function predictGoal(
  sample: BallSample,
  world: RAPIER.World,
  horizon: number = STAT_TUNING.predictionHorizon,
): GoalPrediction | null {
  const position = new Vector3().copy(sample.position),
    velocity = new Vector3().copy(sample.velocity);
  if (![...position.toArray(), ...velocity.toArray()].every(Number.isFinite))
    return null;
  const scored = scoringTeam(position);
  if (scored !== null)
    return {
      team: scored === 0 ? 1 : 0,
      time: 0,
      point: { x: position.x, y: position.y, z: position.z },
    };
  if (velocity.lengthSq() < 0.01 && !sample.heat?.active) return null;
  const sphere = new RAPIER.Ball(P.ball.radius),
    rotation = { x: 0, y: 0, z: 0, w: 1 },
    dt = STAT_TUNING.predictionStep;
  const heat = sample.heat ? new Heatseeker() : null;
  if (heat) heat.state = { ...sample.heat! };
  const proxy = {
    isEnabled: () => true,
    translation: () => position,
    linvel: () => velocity,
    applyImpulse: (impulse: RAPIER.Vector) =>
      velocity.addScaledVector(new Vector3().copy(impulse), 1 / P.ball.mass),
  } as unknown as RAPIER.RigidBody;
  for (let time = 0; time < horizon; time += dt) {
    heat?.steer(proxy, dt);
    velocity.y -= P.gravity * dt;
    velocity.multiplyScalar(1 / (1 + P.ball.drag * dt));
    const duration = Math.min(dt, horizon - time);
    let remaining = duration;
    for (let collision = 0; collision < 3 && remaining > 1e-6; collision++) {
      const hit = world.castShape(
        position,
        rotation,
        velocity,
        sphere,
        0.001,
        remaining,
        false,
        undefined,
        undefined,
        undefined,
        undefined,
        (col) => col.parent() === null,
      );
      const limit = hit ? Math.max(0, hit.time_of_impact) : remaining;
      for (const team of [0, 1] as const) {
        const plane =
          (team === 0 ? 1 : -1) * (P.arena.halfLength + P.ball.radius);
        if ((team === 0 && velocity.z <= 0) || (team === 1 && velocity.z >= 0))
          continue;
        const crossing = (plane - position.z) / velocity.z;
        if (crossing < 0 || crossing > limit) continue;
        const point = position.clone().addScaledVector(velocity, crossing);
        if (
          Math.abs(point.x) + P.ball.radius < P.arena.goalHalf &&
          point.y + P.ball.radius < P.arena.goalHeight &&
          point.y >= P.ball.radius - 0.02
        )
          return {
            team,
            time: time + (duration - remaining) + crossing,
            point: { x: point.x, y: point.y, z: point.z },
          };
      }
      if (hit) {
        position.addScaledVector(velocity, limit);
        // Rapier's normal1 is on the static target, outward toward the swept sphere.
        const normal = new Vector3().copy(hit.normal1).normalize();
        if (heat && hit.collider.shape.type === RAPIER.ShapeType.TriMesh)
          for (const team of [0, 1] as const)
            if (isBackboard(hit.witness1, normal, team)) heat.backboard(team);
        const incoming = velocity.dot(normal);
        if (incoming < 0)
          velocity.addScaledVector(
            normal,
            -(1 + P.ball.restitution) * incoming,
          );
        position.addScaledVector(normal, 0.004);
        if (limit < 1e-5 && incoming >= 0) return null;
        remaining -= limit;
      } else {
        position.addScaledVector(velocity, remaining);
        break;
      }
    }
  }
  return null;
}
