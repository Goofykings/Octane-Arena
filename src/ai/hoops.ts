import { Vector3 } from "three";
import { HOOPS_CONFIG as H } from "../../shared/hoops";
import type { Car } from "../car/car";
import type { Simulation } from "../physics/simulation";
import type { BotDifficulty } from "../../shared/bots";
import type { BotRole, BotTarget } from "./decision";
import type { BotPerception } from "./perception";
import type { Pads } from "../game/pads";
/** Mode-specific targets only: shared controller drives/jumps/boosts using ordinary
 * PlayerInput. No teleports, hidden lift, impulses or privileged ball changes. */
export function chooseHoopsTarget(
  car: Car,
  s: Simulation,
  perception: BotPerception,
  difficulty: BotDifficulty,
  role: BotRole,
  pads?: Pads,
): BotTarget {
  const ownSign = car.team === 0 ? 1 : -1,
    own = new Vector3(0, H.hoopHeight, ownSign * H.hoopZ),
    goal = new Vector3(0, H.hoopHeight + 2.5, -ownSign * H.hoopZ),
    ball = new Vector3().copy(s.ball.translation());
  const threat =
    perception.goal?.team === car.team ||
    (Math.hypot(ball.x, ball.z - own.z) < H.hoopRadius + 2 &&
      ball.y > H.hoopHeight &&
      s.ball.linvel().y < 0);
  const hash = [...car.id].reduce((n, c) => n + c.charCodeAt(0), 0),
    side = hash % 2 ? 1 : -1;
  let point = ball.clone(),
    aerial = false,
    intent: BotTarget["intent"] = threat ? "defend" : "attack",
    arrival = 0;
  if (role !== "first" && !threat) {
    point = ball.clone().lerp(own, role === "third" ? 0.68 : 0.42);
    point.x += side * (role === "third" ? 4 : 7);
    point.y = 0.4;
    intent = "support";
  } else {
    const maxHeight =
      difficulty === "advanced" ? 11 : difficulty === "intermediate" ? 7 : 2;
    const candidates = perception.samples.filter(
      (p) => p.time > 0.15 && p.position.y < maxHeight,
    );
    const intercept =
      candidates.find(
        (p) =>
          Math.hypot(
            p.position.x - car.body.translation().x,
            p.position.z - car.body.translation().z,
          ) /
            Math.max(7, Math.abs(car.forwardSpeed) + 5) <
          p.time + 0.4,
      ) ?? candidates[0];
    if (intercept) {
      point.copy(intercept.position);
      arrival = intercept.time;
    }
    if (threat && role !== "first") {
      point.copy(own);
      point.x = side * 3;
      point.z -= ownSign * 2;
      point.y = Math.min(maxHeight, Math.max(1.6, ball.y - 0.8));
    } else if (!threat) {
      // Contact beneath/behind the ball sets a rising path above the raised rim.
      const direction = goal.clone().sub(point).normalize();
      point.addScaledVector(direction, -(ball.y > 2 ? 1.1 : 1.7));
      if (ball.y < 1.5 && Math.abs(ball.z) > 12 && difficulty !== "beginner")
        point.y = 2;
    }
    if (
      !threat &&
      Math.abs(ball.z) < 3 &&
      ball.y > 2 &&
      difficulty !== "beginner"
    )
      point.copy(ball);
    aerial =
      difficulty !== "beginner" &&
      point.y > 1.6 &&
      point.y < maxHeight &&
      car.boost > 8;
  }
  if (car.boost < 10 && role !== "first" && !threat) {
    const p = pads?.items
      .filter((p) => p.large && !p.cooldown)
      .sort(
        (a, b) =>
          Math.hypot(
            a.x - car.body.translation().x,
            a.z - car.body.translation().z,
          ) -
          Math.hypot(
            b.x - car.body.translation().x,
            b.z - car.body.translation().z,
          ),
      )[0];
    if (p) {
      point.set(p.x, 0.4, p.z);
      intent = "boost";
      aerial = false;
    }
  }
  point.x = Math.max(
    -H.arenaWidth / 2 + 3,
    Math.min(H.arenaWidth / 2 - 3, point.x),
  );
  point.z = Math.max(
    -H.arenaLength / 2 + 3,
    Math.min(H.arenaLength / 2 - 3, point.z),
  );
  if (difficulty === "beginner") point.y = Math.min(point.y, 2.3);
  return {
    point,
    shot: goal,
    role,
    intent,
    aerial,
    arrival,
    value: threat ? 50 : 25,
  };
}
