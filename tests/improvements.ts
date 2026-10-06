import RAPIER from "@dimforge/rapier3d-compat";
import {
  Vector3,
  Quaternion,
  PerspectiveCamera,
  Group,
  Scene,
  Box3,
  Matrix4,
} from "three";
import { Simulation } from "../src/physics/simulation";
import { neutral } from "../src/input/types";
import { P, curvature } from "../src/config/physics";
import { bodies } from "../src/game/inventory";
import { carModel } from "../src/render/models";
import { GameCamera } from "../src/camera/camera";
import { VehicleEffects } from "../src/effects/vehicle-effects";
import { Pads } from "../src/game/pads";
await RAPIER.init();
let failures = 0;
function check(name: string, pass: boolean, data: unknown) {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}: ${JSON.stringify(data)}`);
  if (!pass) failures++;
}
for (const id of ["ion", "vector"] as const) {
  const s = new Simulation(true),
    c = s.cars[0],
    d = bodies[id];
  c.setBody(id);
  c.reset(0, 0, 0, d.hitboxY + d.halfHeight + 0.01);
  c.body.setRotation(
    new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI),
    true,
  );
  for (let i = 0; i < 120; i++) s.step([neutral(), neutral()]);
  const model = carModel(0x33eeff, id);
  model.position.copy(c.body.translation());
  model.quaternion.copy(c.body.rotation());
  model.updateMatrixWorld(true);
  const bottom = new Box3().setFromObject(model).min.y;
  check(`${id} inverted roof clears floor`, bottom > -0.018, {
    bottom,
    y: c.body.translation().y,
  });
  check(
    `${id} collider dimensions`,
    Math.abs(
      Math.max(
        ...Array.from(c.collider.vertices()).filter((_, i) => i % 3 === 2),
      ) - d.halfLength,
    ) < 1e-6,
    c.collider.vertices(),
  );
  s.step([{ ...neutral(), jump: true }, neutral()]);
  let landed = false;
  for (let i = 0; i < 180; i++) {
    s.step([neutral(), neutral()]);
    if (c.grounded && c.up.y > 0.7) landed = true;
  }
  check(`${id} input-driven roof recovery`, landed, {
    up: c.up.toArray(),
    position: c.body.translation(),
  });
  s.dispose();
}
{
  const s = new Simulation(true),
    c = s.cars[0];
  c.reset(0, 0, 0, 8);
  c.jump.used = true;
  c.jump.age = 0.3;
  s.step([{ ...neutral(), jump: true, throttle: 1 }, neutral()]);
  let reversed = false;
  for (let i = 0; i < 100; i++) {
    s.step([{ ...neutral(), pitch: -1 }, neutral()]);
    if (c.body.angvel().x > 0.01) reversed = true;
  }
  check("cancel cannot reverse pitch during lock", !reversed, {
    omega: c.body.angvel(),
    age: c.jump.flipAge,
  });
  c.jump.flipLeft = 0.5;
  c.jump.flipAge = 0.16;
  c.body.setLinvel({ x: 0, y: 4, z: 0 }, true);
  s.step([neutral(), neutral()]);
  const vertical = c.body.linvel().y;
  check(
    "dodge uses multiplicative vertical damping",
    vertical > 2.4 && vertical < 2.65,
    vertical,
  );
  c.jump.flipAge = 1.1;
  c.jump.flipLeft = 0;
  const priorPitch = c.body.angvel().x;
  s.step([{ ...neutral(), pitch: -1 }, neutral()]);
  check(
    "pitch control returns after lock",
    c.body.angvel().x > priorPitch + 0.09,
    { before: priorPitch, after: c.body.angvel().x },
  );
  s.dispose();
}
for (const sign of [-1, 1]) {
  const s = new Simulation(),
    c = s.cars[0];
  c.reset(0, sign * 52, sign < 0 ? 0 : Math.PI);
  c.body.setLinvel({ x: 0, y: 0, z: sign * 12 }, true);
  c.boost = 100;
  let maxY = 0,
    invertedContact = 0,
    returned = false;
  const samples: unknown[] = [];
  for (let i = 0; i < 600; i++) {
    s.step([{ ...neutral(), throttle: 1, boost: i < 120 }, neutral()]);
    maxY = Math.max(maxY, c.body.translation().y);
    if (c.up.y < -0.5 && c.contacts >= 2) invertedContact++;
    if (invertedContact > 0 && sign * c.body.translation().z < 51.2)
      returned = true;
    if (i % 60 === 0)
      samples.push({
        t: i / 120,
        p: c.body.translation(),
        up: c.up.toArray(),
        contacts: c.contacts,
      });
  }
  check(
    "goal " + sign + " rear curve reaches ceiling and exits",
    maxY > 5.5 && invertedContact > 5 && returned,
    { maxY, invertedContact, returned, samples },
  );
  s.dispose();
}
{
  const s = new Simulation(true),
    car = new Group(),
    ball = new Group(),
    camera = new PerspectiveCamera(),
    control = new GameCamera(camera);
  control.ballMode = false;
  car.position.set(0, 8, 0);
  ball.position.set(0, 1, -20);
  s.cars[0].body.setLinvel({ x: 0, y: 0, z: -10 }, true);
  control.update(car, ball, s, 1 / 60, false, 0);
  let worst = 0,
    roll = 0;
  for (let i = 1; i < 600; i++) {
    const prior = camera.quaternion.clone();
    car.quaternion.setFromAxisAngle(new Vector3(0, 0, -1), i * 0.12);
    control.update(car, ball, s, 1 / 60, false, i / 60);
    worst = Math.max(worst, prior.angleTo(camera.quaternion));
    roll = Math.max(roll, Math.abs(camera.rotation.z));
  }
  check(
    "repeated aerial roll keeps camera horizon",
    worst < 0.03 && roll < 1e-8,
    { worst, roll },
  );
  const scene = new Scene(),
    model = carModel(0x33eeff),
    fx = new VehicleEffects(model, scene, 0x33eeff),
    c = s.cars[0];
  c.body.setLinvel({ x: 0, y: 0, z: -23 }, true);
  c.updateSupersonic(P.dt);
  c.wheelContact = [true, true, true, true];
  fx.update(c, 0.1, 1, true);
  const visibleBefore = scene.children.some((o) => o.visible);
  c.wheelContact = [false, false, false, false];
  fx.update(c, 0.016, 2, true);
  check(
    "supersonic ground trails disappear airborne",
    visibleBefore && scene.children.every((o) => !o.visible),
    {
      visibleBefore,
      visibleAfter: scene.children.filter((o) => o.visible).length,
    },
  );
  check(
    "front steering follows curvature",
    Math.atan(0.86 * curvature(5)) > Math.atan(0.86 * curvature(23)) * 2,
    {
      low: Math.atan(0.86 * curvature(5)),
      high: Math.atan(0.86 * curvature(23)),
    },
  );
  s.dispose();
}
{
  const s = new Simulation(true),
    pads = new Pads(),
    p = pads.items[6],
    c = s.cars[0];
  c.reset(p.x, p.z, 0);
  c.boost = 0;
  const events = pads.tick(s.cars);
  check(
    "pickup value and short visual event are immediate",
    c.boost === 12 && events.length === 1 && p.pulse === 0.28,
    { boost: c.boost, pulse: p.pulse },
  );
  s.explode({ x: 0, y: 1, z: 0 });
  s.step([{ ...neutral(), boost: true, roll: 1 }, neutral()]);
  check(
    "explosion leaves boost and aerial input active",
    c.boosting && c.boost < 12,
    { boost: c.boost, omega: c.body.angvel() },
  );
  s.dispose();
}

for (const sign of [-1, 1]) {
  const s = new Simulation(),
    c = s.cars[0];
  c.reset(P.arena.goalHalf - 0.3, sign * 55, 0, 3.25);
  const f = new Vector3(0, 0, sign),
    up = new Vector3(-1, 0, 0),
    right = f.clone().cross(up);
  c.body.setRotation(
    new Quaternion().setFromRotationMatrix(
      new Matrix4().makeBasis(right, up, f.clone().negate()),
    ),
    true,
  );
  c.body.setLinvel(f.clone().multiplyScalar(8), true);
  let backContact = false,
    escaped = false;
  for (let i = 0; i < 240; i++) {
    s.step([{ ...neutral(), throttle: 0.25 }, neutral()]);
    if (c.contacts >= 2 && c.up.z * sign < -0.7) backContact = true;
    const p = c.body.translation();
    if (Math.abs(p.z) > 61 || Math.abs(p.x) > 11 || p.y < 0) escaped = true;
  }
  check(
    "goal " + sign + " side-to-rear curved wall contact",
    backContact && !escaped,
    { backContact, escaped, position: c.body.translation() },
  );
  s.dispose();
}
if (failures) process.exitCode = 1;
