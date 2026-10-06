import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { initializeSimulation, Simulation } from "../src/physics/simulation";
import { neutralInput } from "../shared/player";
import { type BodyId } from "../shared/catalog";
import { chassisPoints } from "../src/car/chassis";
import { wheelMount, wheelSupportPoint } from "../src/car/wheels";
import { P } from "../src/config/physics";
import { writeFileSync } from "node:fs";

await initializeSimulation();
const n = neutralInput(),
  results: object[] = [];
function setup(id: BodyId) {
  const s = new Simulation(),
    c = s.cars[0];
  s.ball.setEnabled(false);
  s.ballCollider.setCollisionGroups(0);
  s.cars[1].body.setEnabled(false);
  s.cars[1].collider.setCollisionGroups(0);
  c.setBody(id);
  return { s, c };
}
function place(s: Simulation, id: BodyId, q: Quaternion, wheels: boolean) {
  const c = s.cars[0],
    points = chassisPoints(id).map((p) => p.applyQuaternion(q));
  if (wheels)
    for (let i = 0; i < 4; i++)
      points.push(
        wheelSupportPoint(
          wheelMount(id, i).applyQuaternion(q),
          q,
          new Vector3(0, 1, 0),
        ),
      );
  c.reset(0, 0, 0, -Math.min(...points.map((p) => p.y)) + P.car.contactSkin);
  c.body.setRotation(q, true);
}
for (const id of ["ion", "vector"] as const) {
  for (const sign of [-1, 1])
    for (const angle of [85, 87, 88, 89, 90, 91, 95]) {
      const { s, c } = setup(id),
        q = new Quaternion().setFromAxisAngle(
          new Vector3(1, 0, 0),
          (sign * angle * Math.PI) / 180,
        );
      place(s, id, q, false);
      let leftEdge = -1,
        pitchMotion = false;
      let previous = new Quaternion().copy(c.body.rotation());
      for (let i = 0; i < 360; i++) {
        s.step([n, n]);
        const current = new Quaternion().copy(c.body.rotation());
        assert.ok(previous.angleTo(current) < 0.12, "nose orientation snapped");
        previous = current;
        if (Math.abs(c.up.y) < 0.35) {
          assert.equal(c.stableContact, false);
          assert.equal(c.grounded, false);
          assert.equal(c.adhesionAcceleration.length(), 0);
        }
        pitchMotion ||=
          Math.abs(new Vector3().copy(c.body.angvel()).dot(c.right)) > 0.15;
        if (leftEdge < 0 && Math.abs(c.up.y) > 0.5) leftEdge = i * P.dt;
        assert.equal(
          c.recovering,
          false,
          "neutral nose contact triggered recovery",
        );
        assert.equal(s.containmentRecoveries, 0);
      }
      assert.ok(
        pitchMotion && leftEdge >= 0 && leftEdge < 2.5,
        `${id} nose ${sign * angle} remained balanced`,
      );
      results.push({
        kind: "nose",
        id,
        angle: sign * angle,
        time: leftEdge,
        up: c.up.y,
      });
      s.dispose();
    }
  for (const sign of [-1, 1])
    for (const angle of [75, 85, 89, 90, 95, 105])
      for (const throttle of [0, 1, -1]) {
        const { s, c } = setup(id),
          q = new Quaternion().setFromAxisAngle(
            new Vector3(0, 0, 1),
            (sign * angle * Math.PI) / 180,
          );
        place(s, id, q, true);
        let settled = -1,
          force = 0,
          naturalRoll = 0,
          run = 0,
          chassisSupport = false,
          initialChassis = false;
        let previous = new Quaternion().copy(c.body.rotation());
        for (let i = 0; i < 300; i++) {
          s.step([{ ...n, throttle }, n]);
          const current = new Quaternion().copy(c.body.rotation());
          assert.ok(previous.angleTo(current) < 0.12, "side recovery snapped");
          previous = current;
          naturalRoll = Math.max(naturalRoll, q.angleTo(current));
          chassisSupport ||= c.chassisContacts > 0;
          if (i < 12) initialChassis ||= c.chassisContacts > 0;
          force = Math.max(force, c.edgeDriveForce.length());
          assert.ok(
            c.edgeDriveForce.length() <=
              c.body.mass() * P.gravity * P.car.edgeDriveGrip + 0.001,
            "unbounded tire-edge force",
          );
          if (c.supportKind === "edge") {
            assert.equal(c.grounded, false);
            assert.equal(c.stableContact, false);
            assert.equal(c.adhesionAcceleration.length(), 0);
            assert.equal(c.aerialControl, 0);
          }
          assert.equal(
            c.recovering,
            false,
            "side input invoked old timed flip",
          );
          run = c.contacts === 4 && c.up.y > 0.995 ? run + 1 : 0;
          if (run >= 12 && settled < 0) settled = i * P.dt;
          assert.equal(s.containmentRecoveries, 0);
        }
        if (throttle)
          assert.ok(
            force > 0 && settled >= 0 && settled < 1.6,
            `${id} side ${sign * angle} throttle ${throttle} slow recovery ${settled}`,
          );
        else {
          assert.equal(force, 0);
          assert.ok(
            (naturalRoll > (angle <= 90 ? 0.08 : 0.025) || initialChassis) &&
              (chassisSupport || settled >= 0),
            `${id} side ${sign * angle}: neutral wheel edge remained an isolated equilibrium (roll ${naturalRoll}, chassis ${chassisSupport}, settled ${settled}, up ${c.up.y})`,
          );
        }
        results.push({
          kind: "side",
          id,
          angle: sign * angle,
          throttle,
          time: settled,
          force,
          roll: naturalRoll,
        });
        s.dispose();
      }
  // Transient two-wheel cornering and handbrake landings must stay physical.
  for (const slide of [false, true]) {
    const { s, c } = setup(id);
    c.reset(0, 0, 0, 1.1);
    c.body.setRotation(
      new Quaternion().setFromAxisAngle(
        new Vector3(0, 0, 1),
        (35 * Math.PI) / 180,
      ),
      true,
    );
    c.body.setLinvel({ x: 8, y: -2, z: -9 }, true);
    let partial = 0;
    for (let i = 0; i < 180; i++) {
      s.step([{ ...n, throttle: 1, steer: 0.4, slide }, n]);
      if (c.contacts === 2) partial++;
      assert.equal(c.edgeDriveForce.length(), 0);
      assert.equal(
        c.recovering,
        false,
        `${id} cornering slide ${slide}, step ${i}, up ${c.up.y}, contacts ${c.contacts}, position ${JSON.stringify(c.body.translation())}`,
      );
    }
    assert.ok(partial > 0);
    assert.ok(c.up.y > 0.98);
    s.dispose();
  }
  // Legitimate wall support has a floor-like normal in the car's local frame.
  const { s, c } = setup(id);
  c.reset(30, 0, -Math.PI / 2);
  c.body.setLinvel({ x: 23, y: 0, z: 0 }, true);
  let wall = 0;
  for (let i = 0; i < 210; i++) {
    c.boost = 100;
    s.step([{ ...n, throttle: 1, boost: true }, n]);
    assert.equal(c.edgeDriveForce.length(), 0, "wall mistaken for wheel edge");
    if (c.body.translation().y > 5 && c.up.x < -0.9 && c.contacts >= 3) {
      wall++;
      assert.equal(c.supportKind, "wheel");
    }
    assert.equal(s.containmentRecoveries, 0);
  }
  assert.ok(wall > 10);
  s.dispose();
  // In midair, sideways throttle never produces a recovery/contact impulse.
  const air = setup(id);
  air.c.reset(0, 0, 0, 10);
  air.c.body.setRotation(
    new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2),
    true,
  );
  for (let i = 0; i < 60; i++) {
    air.s.step([{ ...n, throttle: 1 }, n]);
    assert.equal(air.c.edgeDriveForce.length(), 0);
    assert.equal(air.c.recovering, false);
  }
  air.s.dispose();
}
// Different field headings and held steering exercise both front tire shoulders,
// rather than only testing an unsteered car aligned with the arena axes.
for (const id of ["ion", "vector"] as const)
  for (const heading of [Math.PI / 4, Math.PI / 2, -Math.PI / 3])
    for (const steer of [-1, 1])
      for (const angle of [-95, 90, 105])
        for (const throttle of [-1, 1]) {
          const { s, c } = setup(id);
          const q = new Quaternion()
            .setFromAxisAngle(new Vector3(0, 1, 0), heading)
            .multiply(
              new Quaternion().setFromAxisAngle(
                new Vector3(0, 0, 1),
                (angle * Math.PI) / 180,
              ),
            );
          place(s, id, q, true);
          let settled = -1,
            run = 0;
          for (let i = 0; i < 300; i++) {
            s.step([{ ...n, throttle, steer }, n]);
            assert.equal(
              c.recovering,
              false,
              "steered edge invoked timed flip",
            );
            assert.equal(s.containmentRecoveries, 0);
            run = c.contacts === 4 && c.up.y > 0.995 ? run + 1 : 0;
            if (run >= 12 && settled < 0) settled = i * P.dt;
          }
          assert.ok(
            settled >= 0 && settled < 2,
            `${id} heading ${heading} roll ${angle} steer ${steer} throttle ${throttle}: recovery ${settled}`,
          );
          results.push({
            kind: "steered-side",
            id,
            heading,
            angle,
            steer,
            throttle,
            time: settled,
          });
          s.dispose();
        }
writeFileSync(".tools/edge-support.json", JSON.stringify(results, null, 2));
console.log(
  `PASS ${results.length} nose/side support cases, neutral physical tipping, forward/reverse tire recovery, bounded force/no snap/no timed side flip; transient cornering/powerslide, wall support and airborne exclusions`,
);
