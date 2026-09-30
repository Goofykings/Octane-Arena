import RAPIER from "@dimforge/rapier3d-compat";
import { Group, PerspectiveCamera, Vector3, Quaternion } from "three";
import assert from "node:assert/strict";
import { Simulation } from "../src/physics/simulation";
import { GameCamera } from "../src/camera/camera";
import { Match } from "../src/game/match";
import { neutral } from "../src/input/types";
import { P } from "../src/config/physics";
await RAPIER.init();
let failed = false;
function check(name: string, run: () => unknown) {
  try {
    console.log("PASS", name, JSON.stringify(run()));
  } catch (e) {
    failed = true;
    console.log("FAIL", name, String(e));
  }
}
function slideRun(release: boolean) {
  const s = new Simulation(true),
    c = s.cars[0];
  s.ball.setEnabled(false);
  s.cars[1].body.setEnabled(false);
  c.reset(0, 0, 0);
  for (let i = 0; i < 120; i++) s.step([neutral(), neutral()]);
  c.reset(0, 0, 0, 2);
  c.body.setLinvel({ x: 12, y: -1, z: 0 }, true);
  const samples: number[] = [];
  let previous = 12,
    maxDrop = 0;
  for (let i = 0; i < 120 * 24; i++) {
    s.step([{ ...neutral(), slide: !release || i < 120 }, neutral()]);
    const speed = Math.abs(c.body.linvel().x);
    maxDrop = Math.max(maxDrop, previous - speed);
    previous = speed;
    if ([119, 359, 719, 959, 2879].includes(i)) samples.push(speed);
  }
  s.dispose();
  return { samples, maxDrop };
}
check("sideways drift decays and releasing grip stops it faster", () => {
  const held = slideRun(false),
    released = slideRun(true);
  console.log("DRIFT MEASUREMENTS", JSON.stringify({ held, released }));
  assert.ok(held.samples[0] > 6 && held.samples[0] < 12);
  assert.ok(held.samples[1] < held.samples[0] * 0.8);
  assert.ok(held.samples[3] < 5);
  assert.ok(held.samples[4] < 0.5);
  assert.ok(released.samples[1] < held.samples[1] * 0.1);
  assert.ok(held.maxDrop < 0.15);
  return { held, released };
});
function fixture() {
  const s = new Simulation(),
    car = new Group(),
    ball = new Group(),
    camera = new PerspectiveCamera(73, 16 / 9, 0.05, 340),
    control = new GameCamera(camera);
  car.position.set(0, 0.34, 0);
  ball.position.set(10, 3, 5);
  s.cars[0].grounded = true;
  return { s, car, ball, camera, control };
}
for (const toBall of [false, true])
  check(
    `transition setting affects ${toBall ? "car to ball" : "ball to car"}`,
    () => {
      const results = [];
      for (const transition of [0.3, 1.2, 3]) {
        const f = fixture();
        f.control.settings.transition = transition;
        f.control.ballMode = !toBall;
        const tick = () =>
          f.control.update(f.car, f.ball, f.s, 1 / 60, false, 0);
        for (let i = 0; i < 600; i++) tick();
        const start = f.camera.quaternion.clone();
        f.control.ballMode = toBall;
        let maxStep = 0;
        for (let i = 0; i < 12; i++) {
          const q = f.camera.quaternion.clone();
          tick();
          maxStep = Math.max(maxStep, q.angleTo(f.camera.quaternion));
        }
        results.push({
          transition,
          angle: start.angleTo(f.camera.quaternion),
          maxStep,
        });
        assert.ok(maxStep < 0.18, `toggle snap ${maxStep}`);
        f.s.dispose();
      }
      assert.ok(results[2].angle > results[0].angle * 1.4);
      return results;
    },
  );
for (const mode of ["bot", "freeplay"] as const)
  check(`goal focus persists through ${mode} celebration`, () => {
    const f = fixture(),
      m = new Match();
    m.start(f.s, mode);
    m.phase = "playing";
    f.s.ball.setTranslation({ x: 2, y: 1, z: -53 }, true);
    f.ball.position.copy(f.s.ball.translation());
    for (let i = 0; i < 120; i++)
      f.control.update(f.car, f.ball, f.s, 1 / 60, false, 0);
    m.tick(f.s);
    assert.equal(m.phase, "goal");
    assert.ok(m.goalFocus);
    assert.equal(f.s.ball.isEnabled(), false);
    f.car.rotation.y = Math.PI;
    const previous = f.camera.quaternion.clone();
    f.control.update(f.car, f.ball, f.s, 1 / 60, false, 0, m.goalFocus);
    assert.ok(previous.angleTo(f.camera.quaternion) < 0.1);
    for (let i = 0; i < 120; i++)
      f.control.update(f.car, f.ball, f.s, 1 / 60, false, 0, m.goalFocus);
    f.camera.updateMatrixWorld(true);
    const goal = new Vector3().copy(m.goalFocus!).project(f.camera);
    assert.ok(Math.abs(goal.x) < 0.9 && Math.abs(goal.y) < 0.9 && goal.z < 1);
    m.kickoff(f.s);
    assert.equal(m.goalFocus, null);
    f.s.dispose();
    return { goal: goal.toArray() };
  });
check("localized goal shoulder has continuous normals at arena seam", () => {
  const s = new Simulation(),
    W = P.arena.goalHalf + P.arena.goalLip,
    L = P.arena.halfLength,
    r = P.arena.ramp;
  let worst = 0;
  // Rays at matching heights on either side of the join must hit continuous surfaces.
  for (const sign of [-1, 1])
    for (const side of [-1, 1])
      for (const angle of [0.2, 0.5, 0.9, 1.3]) {
        const y = r * (1 - Math.cos(angle));
        const hits = [-0.005, 0.005].map((dx) =>
          s.world.castRayAndGetNormal(
            new RAPIER.Ray(
              { x: side * (W + dx), y, z: sign * (L - r - 2) },
              { x: 0, y: 0, z: sign },
            ),
            r + 4,
            true,
            undefined,
            undefined,
            undefined,
            undefined,
            (col) => col.parent() === null,
          ),
        );
        assert.ok(hits[0] && hits[1]);
        const n0 = new Vector3().copy(hits[0]!.normal),
          n1 = new Vector3().copy(hits[1]!.normal);
        const error = Math.acos(Math.min(1, Math.abs(n0.dot(n1))));
        worst = Math.max(worst, error);
        assert.ok(error < 0.2, `sharp shoulder ${error}`);
        assert.ok(
          Math.abs(hits[0]!.timeOfImpact - hits[1]!.timeOfImpact) < 0.015,
        );
      }
  s.dispose();
  return { worstNormalAngle: worst, ramp: r };
});
check("smaller ramps reflect the ball without a seam kick", () => {
  const rebounds: number[] = [];
  for (const side of [-1, 1])
    for (const angle of [0.4, 0.8, 1.2]) {
      const s = new Simulation();
      s.cars.forEach((c) => c.body.setEnabled(false));
      s.world.gravity = { x: 0, y: 0, z: 0 };
      const normal = new Vector3(-side * Math.sin(angle), Math.cos(angle), 0);
      const point = new Vector3(
        side *
          (P.arena.halfWidth - P.arena.ramp + P.arena.ramp * Math.sin(angle)),
        P.arena.ramp * (1 - Math.cos(angle)),
        0,
      );
      s.ball.setTranslation(
        point.addScaledVector(normal, P.ball.radius + 0.08),
        true,
      );
      s.ball.setLinvel(normal.clone().multiplyScalar(-8), true);
      for (let i = 0; i < 20; i++) s.step([neutral(), neutral()]);
      const velocity = new Vector3().copy(s.ball.linvel()),
        rebound = velocity.dot(normal);
      assert.ok(rebound > 3 && rebound < 5, `unexpected rebound ${rebound}`);
      assert.ok(
        velocity.clone().addScaledVector(normal, -rebound).length() < 1,
      );
      rebounds.push(rebound);
      s.dispose();
    }
  return rebounds;
});
if (failed) process.exitCode = 1;
