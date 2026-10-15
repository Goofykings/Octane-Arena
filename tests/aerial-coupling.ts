import assert from "node:assert/strict";
import { Vector3 } from "three";
import { initializeSimulation, Simulation } from "../src/physics/simulation";
import { neutralInput } from "../shared/player";
import { P } from "../src/config/physics";
await initializeSimulation();
const n = neutralInput(),
  records: any[] = [];
for (const [label, speed, offset, roof] of [
  ["soft", 0.6, 0, false],
  ["hard nose", 12, 0, false],
  ["glancing", 12, 0.9, false],
  ["corner", 15, 0.65, false],
  ["side", 12, 0.2, false],
  ["roof", 10, 0.2, true],
] as const) {
  const s = new Simulation(true),
    c = s.cars[0];
  try {
    s.world.gravity = { x: 0, y: 0, z: 0 };
    s.cars[1].body.setEnabled(false);
    s.ball.setLinearDamping(0);
    s.ball.setAngularDamping(0);
    const side = label === "side";
    c.reset(
      side ? 1.8 : offset,
      side ? offset : roof ? 0 : 1.8,
      0,
      roof ? 3.4 : 5,
    );
    s.ball.setTranslation({ x: 0, y: 5.04, z: 0 }, true);
    s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    const launch = new Vector3(
      side ? -speed : 0,
      roof ? speed : 0,
      side || roof ? 0 : -speed,
    );
    c.body.setLinvel(launch, true);
    const before = new Vector3(),
      after = new Vector3();
    let touched = false;
    for (let i = 0; i < 1600; i++) {
      before
        .copy(c.body.linvel())
        .multiplyScalar(c.body.mass())
        .addScaledVector(new Vector3().copy(s.ball.linvel()), s.ball.mass());
      s.step([n, n]);
      if (s.ballContacts[0].impactCount) {
        touched = true;
        const contact = s.ballContacts[0];
        assert.equal(contact.aerial, true);
        after
          .copy(c.body.linvel())
          .multiplyScalar(c.body.mass())
          .addScaledVector(new Vector3().copy(s.ball.linvel()), s.ball.mass());
        assert.ok(
          after.distanceTo(before) < 0.05,
          "Aerial correction conserves pair linear momentum instead of adding ball-only momentum",
        );
        const recoil = new Vector3().copy(c.body.linvel()).sub(launch).length();
        const ballSpeed = new Vector3().copy(s.ball.linvel()).length();
        assert.ok(
          recoil > speed * 0.05,
          "Physical chassis reaction is measurable",
        );
        if (label === "soft")
          assert.ok(ballSpeed < 1, "Light aerial touch does not ping away");
        if (label === "hard nose")
          assert.ok(
            ballSpeed > speed * 1.3 && ballSpeed < speed * 1.9,
            "Solid aerial hit uses the driving strike curve with bounded coupled recoil",
          );
        if (label === "corner" || label === "roof" || side)
          assert.ok(
            new Vector3().copy(c.body.angvel()).length() > 0.05,
            "Off-centre contacts create real angular reaction",
          );
        records.push({
          label,
          closing: contact.closing,
          ballSpeed,
          recoil,
          angular: new Vector3().copy(c.body.angvel()).length(),
          correction: contact.impulse.dot(contact.normal),
        });
        break;
      }
    }
    assert.ok(touched, `${label}: actual physical contact`);
    assert.equal(c.body.mass(), 150);
    assert.equal(s.ball.mass(), 50);
  } finally {
    s.dispose();
  }
}
assert.ok(
  records.find((r) => r.label === "glancing").ballSpeed <
    records.find((r) => r.label === "hard nose").ballSpeed,
  "Glancing hit stays less explosive than centered hit",
);
console.log(
  "PASS aerial soft/nose/glancing/corner/side/roof coupling, real recoil/rotation, conserved impulse, unchanged 150:50 masses",
  JSON.stringify(records),
);
