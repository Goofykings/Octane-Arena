import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3, Quaternion, Triangle } from "three";
import { initializeSimulation, Simulation } from "../src/physics/simulation";
import { DribblePhysics, DRIBBLE_GROUPS } from "../src/extra/dribble/physics";
import { DribbleRun } from "../src/extra/dribble/run";
import { buildDribbleCourse, dribbleLevels } from "../src/extra/dribble/levels";
import { LocalProfile, localProfileKey } from "../src/game/local-profile";
import { neutralInput } from "../shared/player";
import { P } from "../src/config/physics";
await initializeSimulation();
const n = neutralInput();
const map = new Map<string, string>(),
  storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
const profile = new LocalProfile(storage);
assert.equal(dribbleLevels.length, 20);
assert.deepEqual(
  dribbleLevels.map((l) => l.id),
  Array.from({ length: 20 }, (_, i) => i + 1),
);
// Launch a sphere across the visible vertical finish using real physics steps.
function shoot(p: DribblePhysics, x = 0, y = 3, z = 0.1, speed = 60) {
  const f = p.course.finish,
    q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -f.heading);
  p.ball.setTranslation(
    new Vector3(x, y, z).applyQuaternion(q).add(f.center),
    true,
  );
  p.ball.setLinvel(new Vector3(0, 0, -speed).applyQuaternion(q), true);
  p.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
}
for (const level of dribbleLevels) {
  const p = new DribblePhysics(buildDribbleCourse(level));
  try {
    for (let i = 0; i < 240; i++) p.step(n);
    assert.ok(p.car.grounded, `Level ${level.id}: car spawn support`);
    assert.ok(
      Math.abs(
        p.ball.translation().y - (p.course.start.center.y + P.ball.radius),
      ) < 0.03,
    );
    assert.ok(Math.abs(p.ball.linvel().y) < 0.1);
    assert.equal(p.failed(), null);
    assert.equal(p.car.collider.collisionGroups(), DRIBBLE_GROUPS.car);
    const supported = p.course.nodes.filter(
      (_, i, nodes) =>
        i > 30 &&
        i < nodes.length - 3 &&
        nodes.slice(i - 2, i + 3).every((node) => node.connected),
    );
    const road = supported[Math.floor(supported.length / 2)];
    p.car.reset(
      road.center.x,
      road.center.z,
      -road.heading,
      road.center.y + 0.34,
    );
    for (let i = 0; i < 120; i++) p.step(n);
    assert.ok(
      p.car.grounded && p.car.contacts >= 2,
      `Level ${level.id}: car road support`,
    );
    // Keep the car well away from the finish. Both slow rolls and one-step
    // flicks must succeed without a roof contact or a car in the target.
    for (const speed of [2, P.ball.maxSpeed]) {
      shoot(p, 0, 3, speed === 2 ? 0.01 : 0.1, speed);
      p.step(n);
      assert.equal(
        p.finished(),
        true,
        `Level ${level.id}: ball-only crossing at ${speed}`,
      );
      assert.ok(
        p.ball.linvel().z * Math.cos(p.course.finish.heading) -
          p.ball.linvel().x * Math.sin(p.course.finish.heading) <
          0,
        "Goal wall must not bounce the ball",
      );
    }
    for (const [x, y, z, speed] of [
      [p.course.finish.width / 2 + 0.1, 3, 0.1, 60],
      [0, 8, 0.1, 60],
      [0, 0.2, 0.1, 60],
      [0, 3, -0.1, -60],
      [0, 3, 1, 0],
    ]) {
      shoot(p, x, y, z, speed);
      p.step(n);
      assert.equal(
        p.finished(),
        false,
        "Outside, below, above, backward or no-crossing shot must fail",
      );
    }
    shoot(p, 0, 3, 0, 0);
    p.step(n);
    assert.equal(p.finished(), false, "Touching the plane is not crossing");
    const f = p.course.finish;
    p.reset();
    p.car.reset(f.center.x, f.center.z, -f.heading, f.center.y + 0.34);
    for (let i = 0; i < 120; i++) p.step(n);
    assert.equal(p.finished(), false, "Car alone must not finish");
    // Radius-aware failure uses the exact local top triangle, including ramps.
    const i = p.course.nodes.findIndex(
      (b, i, nodes) =>
        i > 30 &&
        b.connected &&
        nodes[i - 1].connected &&
        b.center.y !== nodes[i - 1].center.y,
    );
    const j = i > 0 ? i : 35,
      a = p.course.nodes[j - 1],
      b = p.course.nodes[j];
    const edge = (node: typeof a, side: number) =>
      node.center
        .clone()
        .addScaledVector(
          new Vector3(Math.cos(node.heading), 0, Math.sin(node.heading)),
          (side * node.width) / 2,
        );
    const tri = new Triangle(edge(a, -1), edge(a, 1), edge(b, -1));
    const center = tri.getMidpoint(new Vector3()),
      normal = tri.getNormal(new Vector3());
    p.reset();
    for (const depth of [0, 0.5 * P.ball.radius, 0.99 * P.ball.radius]) {
      p.ball.setTranslation(
        center.clone().addScaledVector(normal, -depth),
        true,
      );
      assert.equal(
        p.failed(),
        null,
        `Level ${level.id}: entering surface must not reset (depth ${depth})`,
      );
    }
    p.ball.setTranslation(
      center.clone().addScaledVector(normal, -P.ball.radius - 0.04),
      true,
    );
    assert.equal(
      p.failed(),
      "ball-dropped",
      `Level ${level.id}: whole sphere below local floor`,
    );
    // Actual unassisted fall through the car-solid road.
    p.ball.setTranslation(center.clone().addScaledVector(normal, 3), true);
    p.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    let partial = false,
      failed = false;
    for (let t = 0; t < 240; t++) {
      p.step(n);
      const d = new Vector3()
        .copy(p.ball.translation())
        .sub(center)
        .dot(normal);
      if (d < 0 && d > -P.ball.radius) {
        partial = true;
        assert.equal(p.failed(), null);
      }
      if (p.failed()) {
        assert.ok(d < -P.ball.radius);
        failed = true;
        break;
      }
    }
    assert.ok(
      partial && failed,
      "Ball must visibly fall through before failure",
    );
    const gap = p.course.nodes.findIndex((node, i) => i > 0 && !node.connected);
    if (gap > 0) {
      let end = gap;
      while (
        end + 1 < p.course.nodes.length &&
        !p.course.nodes[end + 1].connected
      )
        end++;
      const point = p.course.nodes[gap - 1].center
        .clone()
        .lerp(p.course.nodes[end].center, 0.5)
        .add(new Vector3(0, 1, 0));
      assert.equal(
        p.world.castRay(
          new RAPIER.Ray(point, { x: 0, y: -1, z: 0 }),
          1.5,
          true,
          undefined,
          DRIBBLE_GROUPS.car,
          undefined,
          undefined,
          (col) => col.parent() === null,
        ),
        null,
      );
    }
  } finally {
    p.dispose();
  }
}
console.log(
  "PASS all 20 levels: gray ball rest, car support, local radius-aware delayed drops, actual floor fall-through, real gaps, ball-only directional finish and high-speed/out-of-bounds shots",
);
// Clean transition: car rolls across without bounce; ball rolls off and falls.
for (const body of ["ion", "vector"] as const) {
  const p = new DribblePhysics(buildDribbleCourse(dribbleLevels[0]), body);
  try {
    p.ball.setEnabled(false);
    for (let i = 0; i < 120; i++) p.step(n);
    let arrived = false;
    for (let i = 0; i < 1200; i++) {
      p.step({ ...n, throttle: 0.12 });
      assert.ok(
        Math.abs(p.car.body.linvel().y) < 0.6,
        "Spawn boundary must not launch car",
      );
      if (p.car.body.translation().z < 2) {
        arrived = true;
        break;
      }
    }
    assert.ok(
      arrived && p.car.grounded,
      "Car must drive off gray onto car-solid road",
    );
    p.ball.setEnabled(true);
    p.reset();
    for (let i = 0; i < 120; i++) p.step(n);
    p.ball.setLinvel({ x: 0, y: 0, z: -2 }, true);
    let entered = false,
      failed = false;
    for (let i = 0; i < 600; i++) {
      p.step(n);
      const b = p.ball.translation();
      assert.ok(p.ball.linvel().y < 0.6, "Gray boundary must not launch ball");
      if (b.y < 2 && b.y + P.ball.radius > 2) {
        entered = true;
        assert.equal(p.failed(), null);
      }
      if (p.failed()) {
        failed = true;
        assert.ok(b.y + P.ball.radius < 2);
        break;
      }
    }
    assert.ok(
      entered && failed,
      "Rolling ball leaves safe floor, visibly enters course, then fails",
    );
  } finally {
    p.dispose();
  }
}
const physics = new DribblePhysics(buildDribbleCourse(dribbleLevels[0])),
  run = new DribbleRun(physics, profile);
try {
  assert.equal(run.select(2), false);
  for (let level = 1; level <= 20; level++) {
    assert.equal(run.select(level), true);
    shoot(physics);
    run.step(n);
    assert.equal(run.phase, "complete");
    assert.equal(
      new LocalProfile(storage).challengeProgress("dribble", 20),
      level,
    );
    assert.equal(run.unlocked, Math.min(20, level + 1));
    if (level < 20) {
      assert.equal(run.advance(1), true);
      assert.equal(run.level, level + 1);
    }
  }
  assert.equal(run.complete, true);
  assert.equal(run.select(21), false);
  assert.equal(run.select(7), true);
  physics.car.body.setLinvel({ x: 2, y: 3, z: 4 }, true);
  physics.ball.setTranslation({ x: 0, y: -20, z: 0 }, true);
  run.step(n);
  assert.equal(run.level, 7);
  assert.equal(run.phase, "ready");
  assert.equal(run.best, 20);
  assert.equal(new Vector3().copy(physics.car.body.linvel()).length(), 0);
  assert.equal(new Vector3().copy(physics.ball.linvel()).length(), 0);
  assert.equal(physics.finished(), false, "Reset clears finish history");
  physics.car.body.setTranslation({ x: 0, y: -20, z: 0 }, true);
  run.step(n);
  assert.equal(run.reason, "car-fell");
  assert.equal(run.level, 7);
} finally {
  physics.dispose();
}
for (const bad of [999, -1, 4.5, "8", null]) {
  map.set(localProfileKey, JSON.stringify({ challenges: { dribble: bad } }));
  assert.equal(new LocalProfile(storage).challengeProgress("dribble", 20), 0);
}
const soccer = new Simulation(true);
soccer.cars.forEach((c) => c.collider.setCollisionGroups(0));
soccer.ball.setTranslation({ x: 0, y: 3, z: 0 }, true);
for (let i = 0; i < 240; i++) soccer.step([n, n]);
assert.ok(soccer.ball.translation().y >= P.ball.radius - 0.02);
soccer.dispose();
console.log(
  "PASS both-body clean spawn transition, unassisted ball roll/drop, completion/save/unlock/autonext, navigation, fast reset and unchanged soccer floor",
);
