import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import { Matrix4, Quaternion, Vector3 } from "three";
import { initializeSimulation, Simulation } from "../src/physics/simulation";
import { neutralInput } from "../shared/player";
import { bodies } from "../shared/catalog";
import { P } from "../src/config/physics";
import { LandingContact } from "../src/car/landing";
import { vehicleGeometry } from "../src/car/suspension";
await initializeSimulation();
const n = neutralInput();
function fixture() {
  const s = new Simulation(true);
  s.ball.setEnabled(false);
  s.ballCollider.setCollisionGroups(0);
  s.cars[1].body.setEnabled(false);
  s.cars[1].collider.setCollisionGroups(0);
  return s;
}
function frame(up: Vector3, forward = new Vector3(0, 0, -1)) {
  return new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(
      forward.clone().cross(up),
      up,
      forward.clone().negate(),
    ),
  );
}
// Every body gets its own RL-style low/rear COM and box inertia, also after repeated garage swaps.
{
  const s = fixture(),
    c = s.cars[0];
  for (const id of [
    ...Object.keys(bodies),
    "ion",
    "vector",
  ] as (keyof typeof bodies)[]) {
    c.setBody(id);
    const g = vehicleGeometry(id);
    assert.ok(Math.abs(c.body.mass() - P.car.mass) < 1e-3);
    assert.ok(Math.abs(c.body.localCom().y - g.com.y) < 1e-6);
    assert.ok(Math.abs(c.body.localCom().z - g.com.z) < 1e-6);
    assert.ok(
      g.com.y <= bodies[id].hitboxY - bodies[id].halfHeight + 1e-9,
      "COM sits at the chassis floor",
    );
    assert.ok(Math.abs(c.body.principalInertia().x - g.inertia.x) < 1e-3);
    assert.ok(Math.abs(c.body.principalInertia().y - g.inertia.y) < 1e-3);
    assert.ok(Math.abs(c.body.principalInertia().z - g.inertia.z) < 1e-3);
    assert.equal(
      c.collider.translationWrtParent()!.y,
      Math.fround(bodies[id].hitboxY),
    );
    assert.equal(c.body.angularDamping(), 0);
    assert.ok(
      Math.abs(c.collider.restitution() - P.car.chassisRestitution) < 1e-6,
    );
  }
  c.reset(0, 0, 0);
  for (let i = 0; i < 12; i++) s.step([n, n]);
  assert.ok(c.grounded);
  c.reset(0, 0, 0, 0.31);
  assert.equal(
    c.grounded || c.contacts > 0 || c.supportState !== "AIRBORNE",
    false,
    "New kickoff/reset must clear support history",
  );
  s.dispose();
}
// Four touching wheels ground immediately (RL). A shrinking ceiling footprint
// loses full support immediately and gravity peels the car away.
for (const drive of [false, true]) {
  const s = fixture(),
    c = s.cars[0];
  let platform = s.world.createCollider(
    RAPIER.ColliderDesc.cuboid(3, 0.2, 3).setTranslation(0, 6.2, 0),
  );
  c.reset(0, 0, 0, 5.69);
  c.body.setRotation(frame(new Vector3(0, -1, 0)), true);
  s.world.step();
  for (let i = 0; i < 3; i++) {
    s.step([n, n]);
    assert.equal(c.contacts, 4);
    assert.equal(c.grounded, true, "Four touching ceiling wheels ground");
  }
  assert.equal(c.surfaceType, "CEILING");
  assert.equal(c.supportState, "GROUNDED");
  assert.ok(
    c.adhesionAcceleration.length() < s.physics.gravity * 0.75,
    "Full ceiling support is not a permanent magnet",
  );
  const checkpoint = c.capturePrediction();
  c.clearSurfaceHistory();
  c.restorePrediction(checkpoint);
  assert.deepEqual(
    c.capturePrediction(),
    checkpoint,
    "Contact timers round-trip through prediction",
  );
  s.world.removeCollider(platform, true);
  s.world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.16, 0.2, 3).setTranslation(0.27, 6.2, 0),
  );
  // Unloaded opposite wheels see a higher ceiling but cannot claim support.
  s.world.createCollider(
    RAPIER.ColliderDesc.cuboid(3, 0.2, 3).setTranslation(0, 6.45, 0),
  );
  s.world.step();
  s.step([n, n]);
  assert.equal(c.contacts, 2);
  assert.equal(
    c.wheelNormals.filter((v) => v.lengthSq() > 0).length,
    2,
    "Only touching wheels report a contact normal",
  );
  assert.equal(c.supportState, "PARTIAL_CONTACT");
  assert.equal(c.grounded, false);
  assert.equal(c.aerialControl, 1);
  let partial = 0;
  for (let i = 0; i < 120; i++) {
    s.step([{ ...n, throttle: drive ? 1 : 0, boost: drive }, n]);
    if (c.contacts === 2) {
      partial++;
      assert.equal(c.stableContact, false);
      assert.ok(
        c.adhesionAcceleration.length() < s.physics.gravity * 0.5,
        "Two wheels cannot hold the car to the ceiling",
      );
      assert.ok(c.wheelSupport <= 0.5);
      assert.equal(c.landing.rate, 0);
    }
  }
  assert.ok(partial > 0);
  assert.ok(
    c.body.translation().y < 4,
    "Two-wheel ceiling contact peels under real gravity",
  );
  s.dispose();
}
// Four rays reaching the ceiling can still mean only two touching tires: a
// fully extended wheel is not support (the old two-wheel ceiling-stick loophole).
{
  const s = fixture(),
    c = s.cars[0];
  const full = s.world.createCollider(
    RAPIER.ColliderDesc.cuboid(3, 0.2, 3).setTranslation(0, 6.2, 0),
  );
  c.reset(0, 0, 0, 5.69);
  c.body.setRotation(frame(new Vector3(0, -1, 0)), true);
  s.world.step();
  for (let i = 0; i < 3; i++) s.step([n, n]);
  assert.ok(c.grounded);
  s.world.removeCollider(full, true);
  s.world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.16, 0.2, 3).setTranslation(0.27, 6.2, 0),
  );
  s.world.createCollider(
    RAPIER.ColliderDesc.cuboid(3, 0.2, 3).setTranslation(0, 6.29, 0),
  );
  s.world.step();
  s.step([n, n]);
  assert.equal(
    c.wheels.filter((w) => w.contact).length,
    4,
    "All four suspension rays still reach the ceiling",
  );
  assert.equal(c.contacts, 2, "Only one real tread pair touches");
  assert.equal(
    c.supportContacts,
    2,
    "Only one real tread pair carries support",
  );
  assert.equal(c.supportState, "PARTIAL_CONTACT");
  assert.ok(c.adhesionAcceleration.length() < s.physics.gravity * 0.5);
  assert.equal(c.landing.rate, 0);
  for (let i = 0; i < 120; i++) s.step([n, n]);
  assert.ok(
    c.body.translation().y < 4,
    "Nearby unloaded rays cannot suspend the car",
  );
  s.dispose();
}
// Moderate drops settle physically; bad or commanded aerial landings get no assist.
let assisted = 0;
for (const body of ["ion", "vector"] as const)
  for (const roll of [0, 8, 20, 35, 75, 180])
    for (const commanded of [false, true]) {
      const s = fixture(),
        c = s.cars[0];
      c.setBody(body);
      c.reset(0, 0, 0, 2);
      c.body.setRotation(
        new Quaternion().setFromAxisAngle(
          new Vector3(0, 0, 1),
          (roll * Math.PI) / 180,
        ),
        true,
      );
      c.body.setLinvel({ x: 2, y: -3, z: -5 }, true);
      let previous = new Quaternion().copy(c.body.rotation()),
        settled = false,
        peakBounce = 0;
      for (let i = 0; i < 300; i++) {
        s.step([{ ...n, roll: commanded ? 0.8 : 0 }, n]);
        const q = new Quaternion().copy(c.body.rotation());
        assert.ok(q.angleTo(previous) < 0.12, "No quaternion snapping");
        previous = q;
        if (commanded || roll >= 75)
          assert.equal(
            c.landing.rate,
            0,
            "No rescue of aerial/roof/side landings",
          );
        if (c.landing.rate > 0) {
          assisted++;
          assert.ok(c.up.dot(c.normal) > 0.98);
          assert.equal(c.jump.flipLeft, 0);
        }
        if (c.supportContacts >= 3)
          peakBounce = Math.max(peakBounce, c.body.linvel().y);
        settled ||= c.contacts === 4 && c.up.y > 0.995;
        assert.equal(s.containmentRecoveries, 0);
      }
      if (!commanded && roll <= 35) {
        assert.ok(settled, `${body} ${roll} settles wheels-down`);
        assert.ok(
          peakBounce < 0.8,
          `No energetic wheel rebound: ${peakBounce}`,
        );
      }
      s.dispose();
    }
assert.ok(
  assisted > 0,
  "Real drops exercise the assist, not only mocked contact flags",
);
// Coherent wall touchdown uses the same surface-relative gate, not world-up.
{
  const s = fixture(),
    c = s.cars[0];
  s.world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.2, 5, 5).setTranslation(6.2, 5, 0),
  );
  c.reset(4.8, 0, 0, 4);
  c.body.setRotation(frame(new Vector3(-1, 0, 0), new Vector3(0, 1, 0)), true);
  c.body.setLinvel({ x: 4, y: 5, z: 0 }, true);
  let active = false;
  for (let i = 0; i < 90; i++) {
    s.step([{ ...n, throttle: 1 }, n]);
    if (c.landing.rate > 0) {
      active = true;
      assert.equal(c.surfaceType, "WALL");
      assert.ok(c.up.dot(c.normal) > 0.985);
    }
  }
  assert.ok(active, "Surface-relative wall landing assistance exercised");
  s.dispose();
}
// Four coherent ceiling wheels may absorb a real incoming landing briefly;
// gravity must still peel the car away after its upward momentum is spent.
{
  const s = fixture(),
    c = s.cars[0];
  s.world.createCollider(
    RAPIER.ColliderDesc.cuboid(3, 0.2, 3).setTranslation(0, 6.2, 0),
  );
  c.reset(0, 0, 0, 4.8);
  c.body.setRotation(frame(new Vector3(0, -1, 0)), true);
  c.body.setLinvel({ x: 0, y: 4, z: 0 }, true);
  let active = false,
    full = false;
  // ~0.2 s of ceiling contact, then free fall from the 6 m ceiling.
  for (let i = 0; i < 190; i++) {
    s.step([n, n]);
    full ||= c.grounded && c.contacts === 4;
    if (c.landing.rate > 0) {
      active = true;
      assert.equal(c.surfaceType, "CEILING");
      assert.ok(c.up.dot(c.normal) > 0.985);
    }
    assert.ok(
      c.adhesionAcceleration.length() < s.physics.gravity * 0.75,
      "Ceiling stickiness never outweighs gravity",
    );
  }
  assert.ok(
    active && full,
    "Valid four-wheel ceiling touchdown remains controllable",
  );
  assert.ok(
    c.body.translation().y < 3,
    "Ceiling assist does not oppose gravitational detachment",
  );
  s.dispose();
}
// Air acceleration is commanded directly, so the contact-inertia increase must
// not weaken pitch/yaw/roll/flip/stall angular response.
for (const maneuver of ["pitch", "yaw", "roll", "flip", "stall"] as const) {
  const run = (oldMass: boolean) => {
    const s = fixture(),
      c = s.cars[0];
    c.reset(0, 0, 0, 18);
    if (oldMass) {
      c.collider.setMassProperties(
        150,
        { x: 0, y: -0.04, z: 0 },
        { x: 25, y: 35, z: 20 },
        { x: 0, y: 0, z: 0, w: 1 },
      );
      c.body.recomputeMassPropertiesFromColliders();
    }
    c.jump.acquireReset();
    for (let i = 0; i < 60; i++) {
      const input = {
        ...n,
        pitch: maneuver === "pitch" ? 0.8 : 0,
        yaw: maneuver === "yaw" || maneuver === "stall" ? 1 : 0,
        roll: maneuver === "roll" ? 0.8 : maneuver === "stall" ? -1 : 0,
        directionalRoll: maneuver === "stall" ? -1 : 0,
        steer: maneuver === "stall" ? 1 : 0,
        jump: (maneuver === "flip" || maneuver === "stall") && i === 0,
        dodgeY: maneuver === "flip" ? 1 : 0,
      };
      s.step([input, n]);
      assert.equal(c.landing.rate, 0);
    }
    const result = [
      ...Object.values(c.body.rotation()),
      ...Object.values(c.body.angvel()),
    ];
    s.dispose();
    return result;
  };
  const before = run(true),
    after = run(false);
  assert.ok(
    before.every((v, i) => Math.abs(v - after[i]) < 1e-5),
    `${maneuver} aerial angular response preserved`,
  );
}
// Merely passing close to a surface without a descending impact must not arm.
{
  const landing = new LandingContact();
  for (let i = 0; i < 12; i++) landing.step(true, false, P.dt, 18, 0.24, false);
  assert.equal(landing.step(false, true, P.dt, 18, 0.24, false), 0);
  assert.equal(landing.step(false, true, P.dt, 18, 0.24, true), 18);
  const state = landing.predictionValues();
  landing.reset();
  landing.restorePrediction(state);
  assert.deepEqual(landing.predictionValues(), state);
}
console.log(
  "PASS per-body mass/COM/inertia, support hysteresis, four-to-two ceiling release, crooked/bad/commanded landings, wall touchdown, unchanged aerial/flip/stall response and prediction state",
);
