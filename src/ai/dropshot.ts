import { Vector3 } from "three";
import {
  dropshotTiles,
  tileAt,
  DROPSHOT_CONFIG as D,
} from "../../shared/dropshot";
import type { Car } from "../car/car";
import type { Simulation } from "../physics/simulation";
import type { BotDifficulty } from "../../shared/bots";
import type { BotRole, BotTarget } from "./decision";
import type { BotPerception } from "./perception";
/** Tile-aware tactical targets. The existing controller supplies ordinary inputs. */
export function chooseDropshotTarget(
  car: Car,
  s: Simulation,
  p: BotPerception,
  difficulty: BotDifficulty,
  role: BotRole,
): BotTarget {
  const ds = s.dropshot!,
    ball = new Vector3().copy(s.ball.translation()),
    sign = car.team === 0 ? 1 : -1;
  const enemy = dropshotTiles.filter((t) => t.team !== car.team),
    own = dropshotTiles.filter((t) => t.team === car.team);
  const value = (t: (typeof enemy)[number]) => {
    let score = ds.states[t.id] === 2 ? 22 : ds.states[t.id] === 1 ? 12 : 2;
    if (difficulty === "advanced" && ds.chargeLevel > 0)
      score += t.clusters[ds.chargeLevel].reduce(
        (sum, id) => sum + (ds.states[id] < 2 ? 3 : 0),
        0,
      );
    return score - Math.hypot(t.x - ball.x, t.z - ball.z) * 0.2;
  };
  const target =
    difficulty === "beginner"
      ? enemy[20]
      : enemy.reduce((a, b) => (value(a) > value(b) ? a : b));
  const danger = own
    .filter((t) => ds.states[t.id] > 0)
    .sort(
      (a, b) =>
        ds.states[b.id] - ds.states[a.id] ||
        Math.hypot(a.x - ball.x, a.z - ball.z) -
          Math.hypot(b.x - ball.x, b.z - ball.z),
    )[0];
  const threat =
    p.goal?.team === car.team ||
    (ball.z * sign > 0 &&
      s.ball.linvel().y < -1 &&
      danger &&
      Math.hypot(ball.x - danger.x, ball.z - danger.z) < 12);
  const maxHeight =
    difficulty === "advanced" ? 14 : difficulty === "intermediate" ? 8 : 2;
  const intercept = p.samples.find(
    (v) =>
      v.time > 0.12 &&
      v.position.y < maxHeight &&
      v.position.distanceTo(car.body.translation()) /
        Math.max(8, Math.abs(car.forwardSpeed) + 6) <
        v.time + 0.4,
  );
  const point = intercept?.position.clone() ?? ball.clone(),
    shot = new Vector3(target.x, -3, target.z);
  let intent: BotTarget["intent"] = threat ? "defend" : "attack";
  if (role !== "first" && !(threat && role === "third")) {
    point.lerp(
      new Vector3((role === "second" ? 1 : -1) * 8, 0.4, sign * 20),
      role === "third" ? 0.72 : 0.38,
    );
    point.y = 0.4;
    intent = "support";
  } else if (threat && role === "third" && danger) {
    point.set(
      danger.x,
      Math.min(maxHeight, Math.max(2, ball.y - 0.3)),
      danger.z,
    );
  } else {
    // Contact above the ball for a downward strike; clear forward from own half.
    const direction = shot.clone().sub(point).normalize();
    point.addScaledVector(direction, -1.2);
    if (ball.z * sign < 0 && ball.y > 2 && difficulty !== "beginner")
      point.y = Math.min(maxHeight, ball.y + 0.45);
  }
  const under = tileAt(point.x, point.z);
  if (under && ds.states[under.id] === 2 && point.y < 1.5 && !threat) {
    const safe = under.neighbors
      .map((id) => dropshotTiles[id])
      .find((t) => ds.states[t.id] < 2);
    if (safe) {
      point.x = safe.x;
      point.z = safe.z;
    }
  }
  const len = Math.hypot(point.x, point.z);
  if (len > D.arenaRadius - 8) point.multiplyScalar((D.arenaRadius - 8) / len);
  return {
    point,
    shot,
    role,
    intent,
    aerial:
      difficulty !== "beginner" &&
      point.y > 1.6 &&
      point.y < maxHeight &&
      car.boost > 8,
    arrival: intercept?.time ?? 0,
    value: threat ? 60 : value(target),
  };
}
