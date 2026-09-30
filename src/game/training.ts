import { Quaternion, Vector3 } from "three";
import { bodies } from "../../shared/catalog";
import type { TrainingAction } from "../../shared/controls";
import { P } from "../config/physics";
import type { Simulation } from "../physics/simulation";
import type { Match } from "./match";

/** Training actions never enter the car input/force controller or affect match modes. */
export function trainingAction(
  action: TrainingAction,
  match: Match,
  s: Simulation,
) {
  if (!match.rules.training || match.phase !== "playing") return false;
  if (action === "trainingReset") {
    match.kickoff(s);
    return true;
  }
  const c = s.cars[0],
    ball = s.ball;
  if (action === "launch") {
    const v = new Vector3().copy(ball.linvel());
    v.y = Math.min(P.training.maxLaunchSpeed, v.y + P.training.launchSpeed);
    ball.setLinvel(v.clampLength(0, P.ball.maxSpeed), true);
  } else {
    const q = new Quaternion().copy(c.body.rotation()),
      d = bodies[c.bodyId];
    const forward = new Vector3(0, 0, -1).applyQuaternion(q),
      up = new Vector3(0, 1, 0).applyQuaternion(q);
    const p = new Vector3().copy(c.body.translation());
    if (action === "possession")
      p.addScaledVector(
        forward,
        d.halfLength + P.ball.radius + 0.65,
      ).addScaledVector(up, P.ball.radius + 0.04);
    else
      p.addScaledVector(forward, d.halfLength * 0.6).addScaledVector(
        up,
        d.hitboxY + d.halfHeight + P.ball.radius + 0.04,
      );
    ball.setTranslation(p, true);
    ball.setLinvel(c.body.linvel(), true);
    ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
    ball.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  }
  s.ballPose.snap();
  return true;
}
