import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import type { Group } from "three";
import { Simulation } from "../src/physics/simulation";
import { carModel, animateWheels, disposeModel } from "../src/render/models";
import { P } from "../src/config/physics";

await RAPIER.init();
const simulation = new Simulation(true);
const models = simulation.cars.map(() => carModel(0x0088ff));
function frame(index: number, speed: number, dt: number, contacted: boolean) {
  const car = simulation.cars[index],
    model = models[index];
  car.grounded = contacted;
  car.wheelContact.fill(contacted);
  const wheel = (model.userData.wheels as Group[])[0];
  const before = wheel.rotation.x;
  animateWheels(model, speed, 0.2, dt, car);
  return dt > 0 ? (-(wheel.rotation.x - before) * 0.18) / dt : 0;
}
const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
try {
  // A car that starts airborne must not derive spin from its flying velocity.
  close(frame(0, 100, 1 / 60, false), 0);
  close(frame(0, 12, 1 / 60, true), 12);
  close(frame(1, -8, 1 / 60, true), -8);
  const seconds = P.car.wheelSpinCoastTime;
  for (let i = 1; i <= seconds * 60; i++) {
    // Boost and aerial rotation can reverse/increase forward velocity, but
    // the wheels continue coasting in their original direction independently.
    close(
      frame(0, i % 2 ? 100 : -100, 1 / 60, false),
      12 * Math.max(0, 1 - i / (seconds * 60)),
    );
    close(
      frame(1, 100, 1 / 60, false),
      -8 * Math.max(0, 1 - i / (seconds * 60)),
    );
  }
  close(frame(0, 100, 1, false), 0);
  close(frame(1, 100, 1, false), 0);
  console.log(
    "PASS independent forward/reverse wheel spin coasts to zero in",
    seconds,
    "seconds",
  );
  close(frame(0, -6, 1 / 60, true), -6);
  frame(0, 300, 0, false); // Pausing does not advance the coast clock.
  close(frame(0, 300, seconds / 2, false), -3);
  close(frame(0, 0, 1 / 60, true), 0);
  close(frame(0, 300, 1 / 60, false), 0);
  console.log(
    "PASS landing, stationary takeoff, pause and frame-rate independence",
  );
} finally {
  models.forEach(disposeModel);
  simulation.dispose();
}
