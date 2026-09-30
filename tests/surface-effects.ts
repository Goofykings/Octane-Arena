import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3, Quaternion, Group, Scene, Mesh } from "three";
import assert from "node:assert/strict";
import { Simulation } from "../src/physics/simulation";
import { neutral } from "../src/input/types";
import { P } from "../src/config/physics";
import { bodies } from "../shared/catalog";
import { carModel, animateWheels, ballModel } from "../src/render/models";
import { wheelRadius, wheelHalfWidth } from "../src/car/wheels";
import { BallTrails, FlipTrails } from "../src/effects/motion-trails";
import { Pads, padRecharge, padRespawn } from "../src/game/pads";
import { PadRecharge } from "../src/render/pad-recharge";
import { goalShell } from "../src/arena/geometry";
await RAPIER.init();
let failed = false;
function check(name: string, run: () => unknown) {
  try {
    console.log("PASS", name, run());
  } catch (e) {
    failed = true;
    console.log("FAIL", name, String(e));
  }
}
for (const id of ["ion", "vector"] as const)
  for (const speed of [3, 23])
    check(`wheel tread clearance ${id} ${speed}m/s`, () => {
      const s = new Simulation(),
        c = s.cars[0],
        pose = new Group(),
        model = carModel(0xffffff, id);
      s.ball.setEnabled(false);
      s.cars[1].body.setEnabled(false);
      c.setBody(id);
      c.reset(33, 0, -Math.PI / 2);
      c.body.setLinvel({ x: speed, y: 0, z: 0 }, true);
      let min = Infinity,
        samples = 0;
      for (let i = 0; i < 480; i++) {
        s.step([{ ...neutral(), throttle: 1, boost: speed > 20 }, neutral()]);
        c.pose.render(pose, 1);
        animateWheels(model, c.forwardSpeed, c.steerAngle, P.dt, c, pose);
        if (pose.position.y > 4) break;
        if (pose.position.x < 37) continue;
        for (const pivot of model.userData.wheelMounts as Group[])
          for (const side of [-1, 1])
            for (let k = 0; k < 24; k++) {
              const angle = (k * Math.PI) / 12;
              const p = new Vector3(
                side * wheelHalfWidth,
                wheelRadius * Math.cos(angle),
                wheelRadius * Math.sin(angle),
              )
                .applyQuaternion(pivot.quaternion)
                .add(pivot.position)
                .applyQuaternion(pose.quaternion)
                .add(pose.position);
              const center = P.arena.halfWidth - P.arena.ramp;
              const clearance =
                p.x < center
                  ? p.y
                  : p.y < P.arena.ramp
                    ? P.arena.ramp -
                      Math.hypot(p.x - center, p.y - P.arena.ramp)
                    : P.arena.halfWidth - p.x;
              min = Math.min(min, clearance);
              samples++;
            }
      }
      s.dispose();
      assert.ok(samples > 100);
      assert.ok(min > -0.025, `penetration ${min}`);
      return { min, samples };
    });
for (const id of ["ion", "vector"] as const)
  for (const side of [-1, 1])
    check(`side recovery contact manifold ${id} ${side}`, () => {
      const s = new Simulation(true),
        c = s.cars[0];
      s.ball.setEnabled(false);
      s.cars[1].body.setEnabled(false);
      c.setBody(id);
      c.reset(0, 0, 0, 0.5);
      c.body.setRotation(
        new Quaternion().setFromAxisAngle(
          new Vector3(0, 0, 1),
          (side * Math.PI) / 2,
        ),
        true,
      );
      // Exercise the actual-contact fallback rather than the old center-only probe.
      const ray = s.world.castRayAndGetNormal.bind(s.world);
      s.world.castRayAndGetNormal = ((r, ...args) =>
        Math.abs(r.dir.y) > 0.9 && Math.abs(r.dir.x) < 0.1
          ? null
          : ray(r, ...args)) as typeof s.world.castRayAndGetNormal;
      let recovered = false;
      for (let i = 0; i < 480; i++) {
        s.step([{ ...neutral(), throttle: -1 }, neutral()]);
        recovered ||= c.grounded && c.up.y > 0.8;
      }
      s.dispose();
      assert.ok(recovered);
    });
check(
  "recovery excludes aerials, brief side landings and normal cornering",
  () => {
    for (const [height, roll, speed, slide] of [
      [8, 90, 0, false],
      [0.5, 90, 0, false],
      [0.5, 35, 9, true],
    ] as const) {
      const s = new Simulation(true),
        c = s.cars[0];
      s.ball.setEnabled(false);
      s.cars[1].body.setEnabled(false);
      c.reset(0, 0, 0, height);
      c.body.setRotation(
        new Quaternion().setFromAxisAngle(
          new Vector3(0, 0, 1),
          (roll * Math.PI) / 180,
        ),
        true,
      );
      c.body.setLinvel({ x: 0, y: 0, z: -speed }, true);
      for (let i = 0; i < 24; i++) {
        s.step([
          { ...neutral(), throttle: 1, slide, steer: slide ? 0.3 : 0 },
          neutral(),
        ]);
        assert.equal(c.recovering, false);
      }
      s.dispose();
    }
  },
);
check("ball reference dimensions and speed cap", () => {
  const s = new Simulation(true),
    ball = ballModel();
  assert.equal(P.ball.radius, 0.9125);
  assert.ok(Math.abs(s.ballCollider.radius() - 0.9125) < 1e-6);
  let max = 0;
  ball.traverse((o) => {
    if (o instanceof Mesh) {
      const p = o.geometry.attributes.position;
      for (let i = 0; i < p.count; i++)
        max = Math.max(max, new Vector3().fromBufferAttribute(p, i).length());
    }
  });
  assert.ok(Math.abs(max - P.ball.radius) < 1e-6);
  s.ball.setTranslation({ x: 0, y: 10, z: 0 }, true);
  s.ball.setLinvel({ x: 90, y: 0, z: 0 }, true);
  s.step([neutral(), neutral()]);
  assert.ok(Math.abs(new Vector3().copy(s.ball.linvel()).length() - 60) < 1e-4);
  s.dispose();
  return {
    radius: max,
    carDimensions: Object.fromEntries(
      Object.entries(bodies).map(([id, d]) => [
        id,
        [2 * d.halfLength, 2 * d.halfWidth, 2 * d.halfHeight],
      ]),
    ),
  };
});
check("rotating ball streaks, team colors and low-speed suppression", () => {
  const trails = new BallTrails(new Scene()),
    ball = new Group();
  for (let i = 0; i < 20; i++) {
    ball.position.z = -i * 0.3;
    ball.rotation.x = i * 0.2;
    trails.updateBall(ball, 18, 0, 1 / 60, true);
  }
  assert.ok(trails.mesh.visible);
  assert.equal(trails.mesh.material.uniforms.color.value.getHex(), 0x69cfff);
  assert.ok(trails.tracks[1].some((p) => Math.abs(p.point.y) > 0.3));
  trails.updateBall(ball, 18, 1, 1 / 60, true);
  assert.equal(trails.mesh.material.uniforms.color.value.getHex(), 0xffa34a);
  trails.updateBall(ball, 18, null, 1 / 60, true);
  assert.equal(trails.mesh.material.uniforms.color.value.getHex(), 0xc4c4c4);
  for (let i = 0; i < 30; i++) trails.updateBall(ball, 0, null, 1 / 60, true);
  assert.equal(trails.mesh.visible, false);
});
check("flip streaks only during physical flip, fast expiry", () => {
  const s = new Simulation(true),
    c = s.cars[0],
    pose = new Group(),
    trails = new FlipTrails(new Scene());
  for (let i = 0; i < 20; i++) {
    pose.rotation.x = i * 0.1;
    trails.updateCar(c, pose, 1 / 60, true);
  }
  assert.equal(trails.mesh.visible, false);
  c.jump.flipLeft = 0.4;
  for (let i = 0; i < 10; i++) {
    pose.rotation.x = i * 0.1;
    trails.updateCar(c, pose, 1 / 60, true);
  }
  assert.ok(trails.mesh.visible);
  c.jump.flipLeft = 0;
  for (let i = 0; i < 8; i++) trails.updateCar(c, pose, 1 / 60, true);
  assert.equal(trails.mesh.visible, false);
  s.dispose();
});
for (const large of [false, true])
  check(`pad recharge ${large ? 10 : 4}s`, () => {
    const pads = new Pads(),
      pad = pads.items.find((p) => p.large === large)!,
      view = new PadRecharge(new Group(), large);
    pad.cooldown = padRespawn(pad);
    view.update(pad);
    assert.equal(padRecharge(pad), 0);
    for (let i = 0; i < padRespawn(pad) / P.dt / 2; i++) pads.tick([]);
    view.update(pad);
    assert.ok(
      Math.abs(view.mesh.material.uniforms.progress.value - 0.5) < 1e-8,
    );
    for (let i = 0; i <= padRespawn(pad) / P.dt / 2; i++) pads.tick([]);
    view.update(pad);
    assert.equal(pad.cooldown, 0);
    assert.equal(view.mesh.visible, false);
  });
for (const sign of [-1, 1])
  check(`rectangular goal mouth ${sign}`, () => {
    const mesh = goalShell(sign),
      v = mesh.vertices;
    for (const x of [-P.arena.goalHalf, P.arena.goalHalf])
      for (const y of [0, P.arena.goalHeight]) {
        let found = false;
        for (let i = 0; i < v.length; i += 3)
          found ||=
            Math.abs(v[i] - x) < 1e-5 &&
            Math.abs(v[i + 1] - y) < 1e-5 &&
            Math.abs(v[i + 2] - sign * P.arena.halfLength) < 1e-5;
        assert.ok(found, `missing corner ${x},${y}`);
      }
  });
if (failed) process.exitCode = 1;
