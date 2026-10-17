import { DROPSHOT_SUPPORT_GROUP } from "../physics/collision-groups";
import { floorEntry, DROPSHOT_CONFIG as D } from "../../shared/dropshot";
import { hoopsCrossing, HOOPS_CONFIG as H } from "../../shared/hoops";
import type { SoccerMode } from "../../shared/soccer";
import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import type { MatchPhysics } from "../config/mutators";
import { P } from "../config/physics";
import { Heatseeker, isBackboard } from "./heatseeker";
import type { HeatseekerState } from "../../shared/soccer";
import { STAT_TUNING } from "../../shared/match-stats";
import { scoringTeam } from "./goals";
export interface BallSample {
  mode?: SoccerMode;
  dropshot?: { tiles: string };
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  heat: HeatseekerState | null;
  physics?: MatchPhysics;
}
export interface GoalPrediction {
  team: 0 | 1;
  time: number;
  point: { x: number; y: number; z: number };
}
export interface TrajectoryPoint {
  time: number;
  position: Vector3;
  velocity: Vector3;
}
export function predictBallTrajectory(
  sample: BallSample,
  world: RAPIER.World,
  horizon: number,
) {
  const samples: TrajectoryPoint[] = [];
  const goal = predictGoal(sample, world, horizon, (time, position, velocity) =>
    samples.push({
      time,
      position: position.clone(),
      velocity: velocity.clone(),
    }),
  );
  return { samples, goal };
}
/** Read-only sphere sweep against actual static arena geometry. No simulation step. */
export function predictGoal(
  sample: BallSample,
  world: RAPIER.World,
  horizon: number = STAT_TUNING.predictionHorizon,
  onSample?: (time: number, position: Vector3, velocity: Vector3) => void,
): GoalPrediction | null {
  const physics = sample.physics ?? P;
  const position = new Vector3().copy(sample.position),
    velocity = new Vector3().copy(sample.velocity);
  if (![...position.toArray(), ...velocity.toArray()].every(Number.isFinite))
    return null;
  const scored =
    sample.mode === "hoops" || sample.mode === "dropshot"
      ? null
      : scoringTeam(position, physics.ball.radius);
  if (scored !== null)
    return {
      team: scored === 0 ? 1 : 0,
      time: 0,
      point: { x: position.x, y: position.y, z: position.z },
    };
  onSample?.(0, position, velocity);
  if (
    !onSample &&
    velocity.lengthSq() < 0.01 &&
    !sample.heat?.active &&
    sample.mode !== "hoops" &&
    sample.mode !== "dropshot"
  )
    return null;
  const sphere = new RAPIER.Ball(physics.ball.radius),
    rotation = { x: 0, y: 0, z: 0, w: 1 },
    dt = STAT_TUNING.predictionStep;
  const heat = sample.heat ? new Heatseeker(0, physics) : null;
  if (heat) heat.state = { ...sample.heat! };
  const proxy = {
    mass: () => physics.ball.mass,
    isEnabled: () => true,
    translation: () => position,
    linvel: () => velocity,
    applyImpulse: (impulse: RAPIER.Vector) =>
      velocity.addScaledVector(
        new Vector3().copy(impulse),
        1 / physics.ball.mass,
      ),
  } as unknown as RAPIER.RigidBody;
  let floorTeam: 0 | 1 | null = null;
  for (let time = 0; time < horizon; time += dt) {
    heat?.steer(proxy, dt);
    velocity.y -= physics.gravity * dt;
    velocity.multiplyScalar(1 / (1 + P.ball.drag * dt));
    velocity.clampLength(0, physics.ball.maxSpeed);
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
        (col) =>
          col.parent() === null &&
          col.collisionGroups() !== DROPSHOT_SUPPORT_GROUP,
      );
      const limit = hit ? Math.max(0, hit.time_of_impact) : remaining;
      if (sample.mode === "dropshot" && sample.dropshot) {
        const end = position.clone().addScaledVector(velocity, limit);
        floorTeam =
          floorEntry(
            position,
            end,
            physics.ball.radius,
            sample.dropshot.tiles,
          ) ?? floorTeam;
        if (
          floorTeam !== null &&
          end.y < -D.tileThickness - physics.ball.radius - D.goalClearance
        )
          return {
            team: floorTeam,
            time: time + duration - remaining + limit,
            point: { ...end },
          };
      }
      if (sample.mode === "hoops") {
        const end = position.clone().addScaledVector(velocity, limit);
        const scored = hoopsCrossing(position, end, physics.ball.radius);
        if (scored !== null) {
          const fraction = (position.y - H.hoopHeight) / (position.y - end.y);
          const point = position.clone().lerp(end, fraction);
          return {
            team: scored === 0 ? 1 : 0,
            time: time + (duration - remaining) + limit * fraction,
            point: { ...point },
          };
        }
      }
      for (const team of (sample.mode === "hoops" || sample.mode === "dropshot"
        ? []
        : [0, 1]) as (0 | 1)[]) {
        const plane =
          (team === 0 ? 1 : -1) * (P.arena.halfLength + physics.ball.radius);
        if ((team === 0 && velocity.z <= 0) || (team === 1 && velocity.z >= 0))
          continue;
        const crossing = (plane - position.z) / velocity.z;
        if (crossing < 0 || crossing > limit) continue;
        const point = position.clone().addScaledVector(velocity, crossing);
        if (
          Math.abs(point.x) + physics.ball.radius < P.arena.goalHalf &&
          point.y + physics.ball.radius < P.arena.goalHeight &&
          point.y >= physics.ball.radius - 0.02
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
            -(1 + physics.ball.restitution) * incoming,
          );
        position.addScaledVector(normal, 0.004);
        if (limit < 1e-5 && incoming >= 0) return null;
        remaining -= limit;
      } else {
        position.addScaledVector(velocity, remaining);
        break;
      }
    }
    onSample?.(time + duration, position, velocity);
  }
  return null;
}
