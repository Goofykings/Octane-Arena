import RAPIER from "@dimforge/rapier3d-compat";
import { Group, PerspectiveCamera, Quaternion, Vector3 } from "three";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { GameCamera } from "../src/camera/camera";
import { Simulation } from "../src/physics/simulation";
import { P } from "../src/config/physics";

await RAPIER.init();
const results: Record<string, unknown> = {};
let failed = false;
function check(name: string, run: () => unknown) {
  try {
    results[name] = run();
    console.log("PASS", name, results[name]);
  } catch (error) {
    failed = true;
    results[name] = String(error);
    console.log("FAIL", name, String(error));
  }
}
function fixture() {
  const simulation = new Simulation(),
    car = new Group(),
    ball = new Group();
  const camera = new PerspectiveCamera(76, 16 / 9, 0.05, 340),
    control = new GameCamera(camera);
  simulation.cars[0].body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  simulation.cars[0].grounded = true;
  car.position.set(0, 0.34, 0);
  ball.position.set(0, 1, -12);
  return { simulation, car, ball, camera, control };
}
for (const sign of [-1, 1])
  check(`wall heading noise ${sign}`, () => {
    const { simulation, car, ball, camera, control } = fixture();
    car.position.set(sign * (P.arena.halfWidth - 0.34), 10, 0);
    ball.position.set(0, 1, 0);
    let maxStep = 0;
    for (let i = 0; i < 420; i++) {
      car.quaternion.setFromAxisAngle(
        new Vector3(1, 0, 0),
        Math.PI / 2 + (i % 2 ? 0.003 : -0.003),
      );
      const previous = camera.position.clone();
      control.update(car, ball, simulation, 1 / 60, false, i / 60);
      if (i > 180)
        maxStep = Math.max(maxStep, previous.distanceTo(camera.position));
    }
    simulation.dispose();
    assert.ok(
      maxStep < 0.03,
      `stationary camera oscillation ${maxStep} m/frame`,
    );
    return { maxStep };
  });
check("overhead ball retains orbit", () => {
  const { simulation, car, ball, camera, control } = fixture();
  for (let i = 0; i < 180; i++)
    control.update(car, ball, simulation, 1 / 60, false, 0);
  const before = camera.position.clone();
  for (let i = 0; i < 240; i++) {
    ball.position.set(0.7 * Math.sin(i * 0.15), 5, 0.7 * Math.cos(i * 0.15));
    control.update(car, ball, simulation, 1 / 60, false, 0);
  }
  const movement = before.distanceTo(camera.position);
  simulation.dispose();
  assert.ok(movement < 0.1, `near-overhead orbit moved ${movement} m`);
  return { movement };
});
check("high speed car retains camera distance", () => {
  const { simulation, car, ball, camera, control } = fixture();
  control.ballMode = false;
  simulation.cars[0].body.setLinvel({ x: 0, y: 0, z: -23 }, true);
  for (let i = 0; i < 180; i++) {
    car.position.z = 30 - 23 * i / 60;
    control.update(car, ball, simulation, 1 / 60, false, i / 60);
    const distance = camera.position.distanceTo(car.position);
    assert.ok(distance > 3 && distance < 9, `camera distance ${distance}`);
  }
  simulation.dispose();
  return { distance: camera.position.distanceTo(car.position) };
});
for (const fps of [30, 60, 144])
  check(`circling ball ${fps} fps`, () => {
    const { simulation, car, ball, camera, control } = fixture();
    let maxTurn = 0;
    for (let i = 0; i < fps * 12; i++) {
      const angle = i / fps;
      ball.position.set(12 * Math.sin(angle), 1, -12 * Math.cos(angle));
      const rotation = camera.quaternion.clone();
      control.update(car, ball, simulation, 1 / fps, false, angle);
      if (i > fps)
        maxTurn = Math.max(maxTurn, rotation.angleTo(camera.quaternion) * fps);
      assert.ok(camera.position.distanceTo(car.position) > 4);
    }
    simulation.dispose();
    assert.ok(maxTurn < 1.5, `bearing wrap caused ${maxTurn} rad/s`);
    return { maxTurn };
  });
for (const sign of [-1, 1])
  for (const fps of [30, 60, 144])
    for (const ballMode of [false, true])
      check(`wall ${sign} transition ${fps} fps ball=${ballMode}`, () => {
        const { simulation, car, ball, camera, control } = fixture();
        control.ballMode = ballMode;
        let maxSpeed = 0,
          maxTurn = 0,
          minDistance = Infinity,
          worst: unknown;
        for (let i = 0; i < fps * 10; i++) {
          const time = i / fps;
          // A smooth floor -> wall -> floor trajectory through the actual curved arena.
          const angle = (Math.sin((Math.PI * time) / 10) ** 2 * Math.PI) / 2;
          const radius = P.arena.ramp - 0.34;
          car.position.set(
            sign *
              (P.arena.halfWidth - P.arena.ramp + radius * Math.sin(angle)),
            P.arena.ramp - radius * Math.cos(angle),
            0,
          );
          car.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), sign * angle);
          car.quaternion.multiply(
            new Quaternion().setFromAxisAngle(
              new Vector3(0, 1, 0),
              (-sign * Math.PI) / 2,
            ),
          );
          ball.position.set(4 * Math.sin(time), 1, 5 * Math.cos(time));
          const previous = camera.position.clone(),
            rotation = camera.quaternion.clone();
          control.update(car, ball, simulation, 1 / fps, false, time);
          if (i > fps) {
            const stepSpeed = previous.distanceTo(camera.position) * fps;
            if (stepSpeed > maxSpeed)
              worst = {
                time,
                car: car.position.toArray(),
                before: previous.toArray(),
                after: camera.position.toArray(),
                wall: (control as any).wallBlend,
              };
            maxSpeed = Math.max(maxSpeed, stepSpeed);
            maxTurn = Math.max(
              maxTurn,
              rotation.angleTo(camera.quaternion) * fps,
            );
            minDistance = Math.min(
              minDistance,
              camera.position.distanceTo(car.position),
            );
          }
          assert.ok(Math.abs(camera.rotation.z) < 1e-8);
          assert.ok(Math.abs(camera.position.x) < P.arena.halfWidth);
          const offset = camera.position.clone().sub(car.position),
            distance = offset.length();
          const blocked = simulation.world.castRay(
            new RAPIER.Ray(car.position, offset.normalize()),
            distance - 0.02,
            true,
            undefined,
            undefined,
            simulation.cars[0].collider,
            simulation.cars[0].body,
            (col) => col.parent() === null,
          );
          assert.equal(
            blocked,
            null,
            "smoothed camera remains on the visible side of the arena",
          );
        }
        simulation.dispose();
        assert.ok(
          maxSpeed < 14,
          `camera jump ${maxSpeed} m/s ${JSON.stringify(worst)}`,
        );
        assert.ok(maxTurn < 4, `camera rotation jump ${maxTurn} rad/s`);
        assert.ok(minDistance > 2.1);
        return { maxSpeed, maxTurn, minDistance };
      });
writeFileSync(
  "docs/camera-stability.json",
  JSON.stringify(results, null, 2) + "\n",
);
if (failed) process.exitCode = 1;
