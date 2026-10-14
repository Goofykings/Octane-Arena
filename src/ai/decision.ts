import { Vector3, Quaternion } from "three";
import { P } from "../config/physics";
import type { Car } from "../car/car";
import type { Simulation } from "../physics/simulation";
import type { Pads } from "../game/pads";
import type { BotDifficulty } from "../../shared/bots";
import { BOT_TUNING, BotPerception } from "./perception";
export type BotRole = "first" | "second" | "third";
export interface BotTarget {
  point: Vector3;
  role: BotRole;
  intent: "attack" | "defend" | "support" | "boost" | "carry";
  aerial: boolean;
  arrival: number;
  shot: Vector3;
  value: number;
}
export function reachCost(car: Car, point: Vector3) {
  const delta = point.clone().sub(car.body.translation()),
    distance = Math.hypot(delta.x, delta.z),
    local = delta.applyQuaternion(
      new Quaternion().copy(car.body.rotation()).invert(),
    );
  const turn = Math.abs(Math.atan2(local.x, -local.z));
  return (
    distance / Math.max(5, Math.min(23, Math.abs(car.forwardSpeed) + 6)) +
    turn * 0.28
  );
}
export class BotDecision {
  readonly roles = new Map<string, BotRole>();
  private first = new Map<number, string>();
  private targets = new Map<string, BotTarget>();
  constructor(readonly difficulty: BotDifficulty) {}
  assign(s: Simulation, perception: BotPerception) {
    this.roles.clear();
    const point =
      perception.samples.find((p) => p.time >= 0.4)?.position ??
      new Vector3().copy(s.ball.translation());
    for (const team of [0, 1]) {
      const members = s.cars
        .filter((c) => c.team === team && c.body.isEnabled())
        .sort((a, b) => reachCost(a, point) - reachCost(b, point));
      const previous = members.find((c) => c.id === this.first.get(team));
      if (
        previous &&
        members[0] &&
        reachCost(previous, point) < reachCost(members[0], point) + 0.28
      ) {
        members.splice(members.indexOf(previous), 1);
        members.unshift(previous);
      }
      if (members[0]) this.first.set(team, members[0].id);
      members.forEach((c, i) =>
        this.roles.set(c.id, i === 0 ? "first" : i === 1 ? "second" : "third"),
      );
    }
  }
  choose(
    car: Car,
    s: Simulation,
    perception: BotPerception,
    pads?: Pads,
  ): BotTarget {
    const config = BOT_TUNING[this.difficulty],
      role = this.roles.get(car.id) ?? "first",
      own = new Vector3(
        0,
        0,
        car.team === 0 ? P.arena.halfLength : -P.arena.halfLength,
      ),
      ball = new Vector3().copy(s.ball.translation());
    const threat = perception.goal?.team === car.team;
    const enemies = s.cars.filter(
      (c) => c.team !== car.team && c.body.isEnabled(),
    );
    const goal = new Vector3(0, 1, -own.z);
    if (this.difficulty !== "beginner") {
      let best = -Infinity;
      for (const x of [-P.arena.goalHalf * 0.65, 0, P.arena.goalHalf * 0.65]) {
        const candidate = goal.clone().setX(x),
          clearance = Math.min(
            ...enemies.map((c) => candidate.distanceTo(c.body.translation())),
            30,
          ),
          angle = Math.abs(x - ball.x) * 0.12;
        if (clearance - angle > best) {
          best = clearance - angle;
          goal.copy(candidate);
        }
      }
    }
    let target: BotTarget = {
      point: ball.clone(),
      shot: goal,
      role,
      intent: threat ? "defend" : "attack",
      aerial: false,
      arrival: 0,
      value: -Infinity,
    };
    if (role !== "first") {
      target.point = ball.clone().lerp(own, role === "third" ? 0.65 : 0.38);
      target.point.x +=
        (car.id.length % 2 ? 1 : -1) * (role === "second" ? 6 : 3);
      target.intent = threat ? "defend" : "support";
    } else {
      for (const p of perception.samples) {
        if (p.time < 0.15 || p.position.y > Math.max(2.4, config.aerialHeight))
          continue;
        const direction = goal.clone().sub(p.position).setY(0).normalize();
        const approach = p.position
          .clone()
          .addScaledVector(direction, p.position.y > 2.4 ? -1 : -2.2);
        const elevation = Math.max(0, p.position.y - car.body.translation().y);
        const upward = car.grounded
          ? P.jump.impulse + P.jump.holdAcceleration * P.jump.holdTime
          : Math.max(0, car.body.linvel().y);
        const lift = Math.max(
          0.5,
          car.physics.car.boostAir - car.physics.gravity,
        );
        const verticalTime =
          elevation > 1.5
            ? (Math.sqrt(upward * upward + 2 * lift * elevation) - upward) /
                lift +
              0.2
            : 0;
        const arrival = Math.max(reachCost(car, approach), verticalTime);
        if (
          verticalTime > 0.4 &&
          (verticalTime - 0.4) * P.car.boostUse > car.boost
        )
          continue;
        if (arrival > p.time + 0.45) continue;
        const shotValue = 30 - p.position.distanceTo(goal) * 0.1;
        const opponentTime = Math.min(
          ...enemies.map((c) => reachCost(c, p.position)),
          4,
        );
        const raceValue =
          this.difficulty === "advanced"
            ? Math.max(-4, Math.min(4, (opponentTime - arrival) * 2))
            : 0;
        const value =
          raceValue +
          shotValue -
          p.time * 3 -
          arrival * 2 -
          Math.max(0, p.position.y - 2) * 0.6 +
          (threat ? 12 : 0);
        if (value > target.value)
          target = {
            ...target,
            point: approach,
            aerial:
              p.position.y > 2.4 && config.aerialHeight > 0 && car.boost > 16,
            arrival: p.time,
            value,
          };
      }
      if (target.value === -Infinity) {
        const p =
          perception.samples.find((p) => p.time >= 0.4) ??
          perception.samples[0];
        target.point = p?.position.clone() ?? ball;
        target.point.y = 0;
      }
      if (
        threat &&
        this.difficulty === "advanced" &&
        reachCost(car, target.point) > Math.max(0.15, perception.goal!.time)
      ) {
        target.point = ball.clone().lerp(own, 0.6);
        target.intent = "defend";
        target.aerial = false;
      }
      const roof = ball.clone().sub(car.body.translation());
      if (
        this.difficulty === "advanced" &&
        car.grounded &&
        Math.hypot(roof.x, roof.z) < 1.1 &&
        roof.y > 0.8 &&
        roof.y < 2.3
      ) {
        target.intent = "carry";
        target.point = goal.clone();
      }
    }
    if (
      role === "first" &&
      target.intent === "attack" &&
      this.difficulty !== "beginner"
    ) {
      const shot = goal.clone().sub(ball).setY(0).normalize(),
        from = new Vector3().copy(car.body.translation()).sub(ball).setY(0);
      if (from.dot(shot) > 1.2 && from.length() < 12) {
        const side = new Vector3(-shot.z, 0, shot.x);
        if (side.dot(from) < 0) side.negate();
        target.point
          .copy(ball)
          .addScaledVector(side, 6)
          .addScaledVector(shot, -3);
        target.aerial = false;
      }
    }
    // Recovery/support pads only: never leave an obvious goal threat for boost.
    if (
      pads &&
      !threat &&
      this.difficulty !== "beginner" &&
      car.boost < 25 &&
      (role !== "first" || reachCost(car, ball) > 1.5)
    ) {
      const pad = pads.items
        .filter((p) => p.cooldown === 0)
        .map((p) => ({
          p,
          d: Math.hypot(
            p.x - car.body.translation().x,
            p.z - car.body.translation().z,
          ),
        }))
        .filter((p) => p.d < 12)
        .sort((a, b) => a.d - b.d)[0];
      if (pad) {
        target.point.set(pad.p.x, 0, pad.p.z);
        target.intent = "boost";
        target.aerial = false;
      }
    }
    const sign = car.id.split("").reduce((n, c) => n + c.charCodeAt(0), 0);
    target.point.x += Math.sin(s.clock * 2 + sign) * config.error;
    target.point.x = Math.max(
      -P.arena.halfWidth + 5,
      Math.min(P.arena.halfWidth - 5, target.point.x),
    );
    target.point.z = Math.max(
      -P.arena.halfLength + 3,
      Math.min(P.arena.halfLength - 3, target.point.z),
    );
    for (const ally of s.cars.filter(
      (c) => c.id !== car.id && c.team === car.team && c.body.isEnabled(),
    )) {
      const gap = target.point.clone().sub(ally.body.translation()).setY(0);
      if (gap.length() < 2.5 && role !== "first")
        target.point.addScaledVector(gap.normalize(), 2.5);
    }
    const previous = this.targets.get(car.id);
    if (
      previous &&
      previous.role === role &&
      previous.intent === target.intent &&
      previous.point.distanceTo(target.point) < 1.1 &&
      !threat
    )
      target.point.lerp(previous.point, 0.45);
    this.targets.set(car.id, target);
    return target;
  }
}
