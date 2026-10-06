import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3, Quaternion, Matrix4, Group } from "three";
import assert from "node:assert/strict";
import { Simulation } from "../src/physics/simulation";
import { neutral } from "../src/input/types";
import { P } from "../src/config/physics";
import { bodies } from "../shared/catalog";
import { carModel, animateWheels, disposeModel } from "../src/render/models";
import { wheelRadius, wheelHalfWidth } from "../src/car/wheels";
await RAPIER.init();
let failed = false;
function check(name: string, fn: () => unknown) {
  try {
    console.log("PASS", name, JSON.stringify(fn()));
  } catch (e) {
    failed = true;
    console.log("FAIL", name, String(e));
  }
}
function fixture(flat = false) {
  const s = new Simulation(flat);
  s.ball.setEnabled(false);
  s.ballCollider.setCollisionGroups(0);
  s.cars[1].body.setEnabled(false);
  s.cars[1].collider.setCollisionGroups(0);
  return s;
}
const step = (
  s: Simulation,
  input: Partial<ReturnType<typeof neutral>> = {},
  n = 1,
) => {
  for (let i = 0; i < n; i++) s.step([{ ...neutral(), ...input }, neutral()]);
};
function orient(s: Simulation, p: Vector3, up: Vector3, forward: Vector3) {
  const c = s.cars[0];
  c.reset(p.x, p.z, 0, p.y);
  c.body.setRotation(
    new Quaternion().setFromRotationMatrix(
      new Matrix4().makeBasis(
        forward.clone().cross(up),
        up,
        forward.clone().negate(),
      ),
    ),
    true,
  );
  s.world.step();
}
for (const id of ["ion", "vector"] as const) {
  for (const mode of [
    "stationary",
    "accelerate",
    "high speed",
    "powerslide",
  ] as const)
    check(`${id} planted floor ${mode}`, () => {
      const s = fixture(true),
        c = s.cars[0];
      c.setBody(id);
      c.reset(0, 0, 0);
      step(s, {}, 120);
      if (mode === "high speed") c.body.setLinvel({ x: 0, y: 0, z: -23 }, true);
      if (mode === "powerslide") c.body.setLinvel({ x: 12, y: 0, z: 0 }, true);
      let min = Infinity,
        max = -Infinity,
        vy = 0;
      for (let i = 0; i < 480; i++) {
        step(s, {
          throttle: mode === "accelerate" ? 1 : 0,
          boost: mode === "high speed",
          slide: mode === "powerslide",
        });
        min = Math.min(min, c.body.translation().y);
        max = Math.max(max, c.body.translation().y);
        vy = Math.max(vy, Math.abs(c.body.linvel().y));
        assert.ok(c.contacts === 4);
      }
      assert.ok(max - min < 0.002, `oscillation ${max - min}`);
      assert.ok(vy < 0.01);
      assert.ok(min > 0.3);
      s.dispose();
      return { min, max, vy };
    });
  check(`${id} floor curve wall ceiling visual and chassis clearance`, () => {
    const s = fixture(),
      c = s.cars[0];
    c.setBody(id);
    c.reset(29, 0, -Math.PI / 2);
    c.body.setLinvel({ x: 23, y: 0, z: 0 }, true);
    const model = carModel(0xffffff, id),
      pose = new Group();
    let worst: unknown;
    let minWheel = Infinity,
      minBody = Infinity,
      ceiling = 0,
      wall = 0,
      curve = 0;
    const sample = (p: Vector3) => {
      // Analytic side-wall profile is independent of the controller raycast.
      const a = P.arena,
        dx = p.x - (a.halfWidth - a.ramp);
      if (dx <= 0) return Math.min(p.y, a.height - p.y);
      if (p.y < a.ramp) return a.ramp - Math.hypot(dx, p.y - a.ramp);
      if (p.y > a.height - a.ramp)
        return a.ramp - Math.hypot(dx, p.y - (a.height - a.ramp));
      return a.halfWidth - p.x;
    };
    for (let i = 0; i < 600; i++) {
      c.boost = 100;
      step(s, { throttle: 1, boost: true });
      c.pose.render(pose, 1);
      animateWheels(model, c.forwardSpeed, c.steerAngle, P.dt, c, pose);
      if (c.up.y < -0.9 && pose.position.y > P.arena.height - 0.6) ceiling++;
      if (
        pose.position.x > P.arena.halfWidth - 1.5 &&
        pose.position.y > 4 &&
        pose.position.y < 15
      ) {
        wall++;
        assert.ok(
          c.contacts >= 2,
          JSON.stringify({
            i,
            position: c.body.translation(),
            velocity: c.body.linvel(),
            rotation: c.body.rotation(),
            contacts: c.contacts,
          }),
        );
      }
      if (pose.position.x > 38 && pose.position.y < 2.4) curve++;
      for (const pivot of model.userData.wheelMounts as Group[])
        for (const side of [-1, 1])
          for (let k = 0; k < 16; k++) {
            const p = new Vector3(
              side * wheelHalfWidth,
              wheelRadius * Math.cos((k * Math.PI) / 8),
              wheelRadius * Math.sin((k * Math.PI) / 8),
            )
              .applyQuaternion(pivot.quaternion)
              .add(pivot.position)
              .applyQuaternion(pose.quaternion)
              .add(pose.position);
            if (sample(p) < minWheel)
              worst = {
                i,
                car: pose.position.toArray(),
                rotation: pose.quaternion.toArray(),
                pivot: pivot.position.toArray(),
                point: p.toArray(),
                contacts: c.contacts,
              };
            minWheel = Math.min(minWheel, sample(p));
          }
      const d = bodies[id];
      for (const x of [-d.halfWidth, d.halfWidth])
        for (const y of [d.hitboxY - d.halfHeight, d.hitboxY + d.halfHeight])
          for (const z of [-d.halfLength, d.halfLength])
            minBody = Math.min(
              minBody,
              sample(
                new Vector3(x, y, z)
                  .applyQuaternion(pose.quaternion)
                  .add(pose.position),
              ),
            );
      if (ceiling > 0 && !c.grounded && pose.position.y < P.arena.height - 1)
        break;
    }
    assert.ok(
      curve > 0 && wall > 25 && ceiling > 0 && !c.grounded,
      `path counts ${curve}/${wall}/${ceiling}`,
    );
    assert.ok(
      minWheel > -0.001,
      `wheel penetration ${minWheel} ${JSON.stringify(worst)}`,
    );
    assert.ok(minBody > -0.001, `body penetration ${minBody}`);
    disposeModel(model);
    s.dispose();
    return { minWheel, minBody, curve, wall, ceiling };
  });
}
check("normal constraint preserves tangent and allows outward impact", () => {
  const s = fixture(true),
    c = s.cars[0];
  c.reset(0, 0, 0, 0.3);
  c.body.setLinvel({ x: 12, y: -3, z: 7 }, true);
  s.world.step();
  const before = c.body.linvel();
  c.constrainSurface(true);
  const after = c.body.linvel();
  assert.ok(
    Math.abs(after.x - before.x) < 1e-6 && Math.abs(after.z - before.z) < 1e-6,
  );
  assert.ok(after.y >= 0);
  c.body.setLinvel({ x: 0, y: 6, z: 0 }, true);
  step(s, {}, 30);
  assert.ok(c.body.translation().y > 1 && c.contacts === 0);
  s.dispose();
  return { before, after };
});
for (const wall of [false, true])
  check(`${wall ? "wall" : "floor"} jump detaches`, () => {
    const s = fixture(),
      c = s.cars[0];
    if (wall)
      orient(
        s,
        new Vector3(P.arena.halfWidth - 0.31, 10, 0),
        new Vector3(-1, 0, 0),
        new Vector3(0, 1, 0),
      );
    else {
      c.reset(0, 0, 0);
      step(s, {}, 120);
    }
    step(s, {}, 1);
    const origin = new Vector3().copy(c.body.translation()),
      normal = c.up.clone();
    step(s, { jump: true });
    step(s, {}, 20);
    const separation = new Vector3()
      .copy(c.body.translation())
      .sub(origin)
      .dot(normal);
    assert.ok(separation > 0.4 && !c.grounded);
    s.dispose();
    return { separation };
  });
for (const sideways of [false, true])
  check(
    `aerial landing ${sideways ? "sideways powerslide" : "straight"}`,
    () => {
      const s = fixture(true),
        c = s.cars[0];
      c.reset(0, 0, 0);
      step(s, {}, 120);
      c.reset(0, 0, 0, 4);
      c.body.setLinvel(
        { x: sideways ? 12 : 0, y: -8, z: sideways ? 0 : -12 },
        true,
      );
      let touched = false,
        maxRebound = 0,
        minHeight = Infinity;
      for (let i = 0; i < 480; i++) {
        step(s, { slide: sideways });
        if (c.grounded) touched = true;
        if (touched) {
          maxRebound = Math.max(maxRebound, c.body.linvel().y);
          minHeight = Math.min(minHeight, c.body.translation().y);
        }
      }
      assert.ok(
        touched && minHeight > 0.3 && maxRebound < 0.05,
        `landing ${minHeight}/${maxRebound}`,
      );
      if (sideways) {
        // The user-adjustable minimum handbrake grip controls coast-down.
        // A fixed >4 m/s expectation assumed the original 0.006 tuning.
        const minimum =
          12 *
          Math.exp(-P.car.grip * P.powerslide.minimumLateralGrip * 480 * P.dt) *
          0.9;
        assert.ok(
          c.body.linvel().x > minimum,
          "normal correction killed tangential powerslide velocity",
        );
      }
      s.dispose();
      return { minHeight, maxRebound };
    },
  );
check("ceiling drive then loss of contact falls freely", () => {
  const s = fixture(),
    c = s.cars[0];
  orient(
    s,
    new Vector3(0, P.arena.height - 0.31, 0),
    new Vector3(0, -1, 0),
    new Vector3(0, 0, -1),
  );
  step(s, { throttle: 1 }, 120);
  // Current rule: ceiling contact must shed naturally even while throttling.
  assert.ok(!c.grounded && c.body.translation().y < P.arena.height - 2);
  s.dispose();
});
for (const id of ["ion", "vector"] as const)
  for (const sign of [-1, 1])
    check(`${id} goal interior curve ${sign}`, () => {
      const s = fixture(),
        c = s.cars[0];
      c.setBody(id);
      const a = P.arena,
        n = new Vector3(-Math.SQRT1_2, -Math.SQRT1_2, 0),
        forward = new Vector3(0, 0, -sign);
      const position = new Vector3(
        a.goalHalf - a.goalCurve + a.goalCurve * Math.SQRT1_2,
        a.goalHeight - a.goalCurve + a.goalCurve * Math.SQRT1_2,
        sign * (a.halfLength + 3.5),
      ).addScaledVector(n, 0.34);
      orient(s, position, n, forward);
      c.body.setLinvel(forward.clone().multiplyScalar(8), true);
      const pose = new Group(),
        model = carModel(0xffffff, id);
      let min = Infinity,
        samples = 0,
        supported = 0;
      for (let i = 0; i < 100; i++) {
        step(s, { throttle: 1 });
        c.pose.render(pose, 1);
        animateWheels(model, c.forwardSpeed, c.steerAngle, P.dt, c, pose);
        if (c.contacts) supported++;
        const up = new Vector3(0, 1, 0).applyQuaternion(pose.quaternion);
        const inspect = (point: Vector3) => {
          point.applyQuaternion(pose.quaternion).add(pose.position);
          const hit = s.world.castRayAndGetNormal(
            new RAPIER.Ray(
              point.clone().addScaledVector(up, 0.3),
              up.clone().negate(),
            ),
            0.6,
            true,
            undefined,
            undefined,
            c.collider,
            c.body,
            (col) => col.parent() === null,
          );
          if (hit && up.dot(hit.normal) > 0.25) {
            min = Math.min(min, (hit.timeOfImpact - 0.3) * up.dot(hit.normal));
            samples++;
          }
        };
        for (const pivot of model.userData.wheelMounts as Group[])
          for (const side of [-1, 1])
            for (let k = 0; k < 16; k++)
              inspect(
                new Vector3(
                  side * wheelHalfWidth,
                  wheelRadius * Math.cos((k * Math.PI) / 8),
                  wheelRadius * Math.sin((k * Math.PI) / 8),
                )
                  .applyQuaternion(pivot.quaternion)
                  .add(pivot.position),
              );
        const d = bodies[id];
        for (const x of [-d.halfWidth, d.halfWidth])
          for (const y of [d.hitboxY - d.halfHeight, d.hitboxY + d.halfHeight])
            for (const z of [-d.halfLength, d.halfLength])
              inspect(new Vector3(x, y, z));
      }
      assert.ok(samples > 100 && supported > 10);
      assert.ok(min > -0.005, `goal clearance ${min}`);
      assert.ok(sign * c.body.translation().z < a.halfLength - 0.5);
      disposeModel(model);
      s.dispose();
      return { min, samples, supported };
    });
if (failed) process.exitCode = 1;
