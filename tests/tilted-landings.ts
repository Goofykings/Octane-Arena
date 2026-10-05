import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import { Matrix4, Quaternion, Vector3 } from "three";
import { Simulation } from "../src/physics/simulation";
import { neutralInput } from "../shared/player";
import { P } from "../src/config/physics";

await RAPIER.init();
const n = neutralInput();
let count = 0,
  worst = 0;
for (const body of ["ion", "vector"] as const) {
  const s = new Simulation(false),
    c = s.cars[0];
  s.ball.setEnabled(false);
  s.ballCollider.setCollisionGroups(0);
  s.cars[1].body.setEnabled(false);
  s.cars[1].collider.setCollisionGroups(0);
  c.setBody(body);
  for (let i = 0; i < 120; i++) s.step([n, n]);
  for (const roll of [0, 15, -20, 35, -35, 45, -45, 60])
    for (const pitch of Math.abs(roll) <= 35 ? [0, 35] : [0])
      for (const mode of ["neutral", "throttle", "slide"] as const) {
        // The combined 35-degree landing reproduces the former one-wheel stall.
        c.reset(0, 0, 0, 3);
        c.body.setRotation(
          new Quaternion()
            .setFromAxisAngle(new Vector3(0, 0, 1), (roll * Math.PI) / 180)
            .multiply(
              new Quaternion().setFromAxisAngle(
                new Vector3(1, 0, 0),
                (pitch * Math.PI) / 180,
              ),
            ),
          true,
        );
        c.body.setLinvel({ x: mode === "slide" ? 8 : 0, y: -3, z: 0 }, true);
        const label = `${body}, roll ${roll}, pitch ${pitch}, ${mode}`;
        let first = -1,
          settled = -1,
          run = 0,
          physicalRoll = false,
          detached = false;
        let previous = new Quaternion().copy(c.body.rotation());
        for (let i = 0; i < 360; i++) {
          s.step([
            {
              ...n,
              throttle: mode === "throttle" ? 1 : 0,
              slide: mode === "slide",
            },
            n,
          ]);
          const q = new Quaternion().copy(c.body.rotation());
          assert.ok(previous.angleTo(q) < 0.13, `orientation snap: ${label}`);
          previous = q;
          if (c.contacts && first < 0) first = i;
          if (first >= 0 && !c.stableContact && c.contacts) {
            assert.ok(
              c.adhesionAcceleration.length() === 0,
              `landing adhesion: ${label}`,
            );
            if (
              c.contacts < 3 &&
              Math.hypot(c.body.angvel().x, c.body.angvel().z) > 0.2
            )
              physicalRoll = true;
          }
          if (first >= 0 && c.contacts === 0 && c.up.y < 0.4) detached = true;
          run = c.contacts === 4 && c.up.y > 0.995 ? run + 1 : 0;
          if (run >= 12) {
            settled = i;
            break;
          }
          assert.equal(s.containmentRecoveries, 0, label);
        }
        assert.ok(first >= 0, `no wheel touchdown: ${label}`);
        if (Math.abs(roll) <= 45) {
          assert.ok(
            settled >= 0 && (settled - first) * P.dt < 1.1,
            `slow landing: ${label}`,
          );
          worst = Math.max(worst, (settled - first) * P.dt);
          if (Math.abs(roll) >= 35)
            assert.ok(physicalRoll, `suppressed roll: ${label}`);
          if (mode === "slide")
            assert.ok(c.body.linvel().x > 1, `lost lateral slip: ${label}`);
        } else {
          // Beyond the tipping point, falling onto the side is physical. Never
          // demand an automatic upright torque to rescue an unsupported car.
          assert.ok(
            settled >= 0 || detached,
            `magnetic severe-angle support: ${label}`,
          );
        }
        count++;
      }

  // Establish a real wall frame, then exercise immediate flat-floor contact
  // without reset(), so the previous frame and normal history remain live.
  const up = new Vector3(-1, 0, 0),
    forward = new Vector3(0, 1, 0);
  c.reset(P.arena.halfWidth - P.car.contactHeight, 0, 0, 7);
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
  c.body.setLinvel({ x: 0, y: 8, z: 0 }, true);
  for (let i = 0; i < 12; i++) s.step([{ ...n, throttle: 1 }, n]);
  assert.ok(c.normal.x < -0.9, "fixture must establish a wall frame");
  c.body.setTranslation({ x: 0, y: 0.53, z: 0 }, true);
  c.body.setRotation(
    new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 4),
    true,
  );
  c.body.setLinvel({ x: 0, y: -1, z: 0 }, true);
  c.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  let first = false;
  for (let i = 0; i < 180; i++) {
    s.step([n, n]);
    if (c.contacts && !first) {
      first = true;
      assert.ok(c.normal.y > 0.9999, "stale wall normal on flat landing");
      assert.ok(!c.stableContact, "tilted touchdown incorrectly stable");
    }
  }
  assert.ok(
    first && c.contacts === 4 && c.up.y > 0.995,
    "wall-history landing must settle",
  );
  for (const sign of [-1, 1]) {
    const normal = new Vector3(0, Math.SQRT1_2, -sign * Math.SQRT1_2);
    const position = new Vector3(
      0,
      P.arena.goalCurve * (1 - Math.SQRT1_2),
      sign *
        (P.arena.halfLength +
          P.arena.goalDepth -
          P.arena.goalCurve * (1 - Math.SQRT1_2)),
    ).addScaledVector(normal, 0.3);
    const roofUp = normal.clone().negate(),
      roofForward = new Vector3(1, 0, 0);
    c.reset(position.x, position.z, 0, position.y);
    c.body.setRotation(
      new Quaternion().setFromRotationMatrix(
        new Matrix4().makeBasis(
          roofForward.clone().cross(roofUp),
          roofUp,
          roofForward.clone().negate(),
        ),
      ),
      true,
    );
    for (let i = 0; i < 60; i++) s.step([n, n]);
    let recovered = false;
    for (let i = 0; i < 480; i++) {
      s.step([
        { ...n, throttle: 1, jump: i % 100 < 30, boost: i > 80 && i < 130 },
        n,
      ]);
      recovered ||= c.up.y > 0.8;
      assert.equal(
        s.containmentRecoveries,
        0,
        "roof recovery must remain inside goal",
      );
    }
    assert.ok(recovered, `${body} roof recovery in goal ${sign}`);
  }
  s.dispose();
}
console.log(
  `PASS ${count} tilted landing cases, physical roll/no snap, throttle/powerslide, severe-angle release; worst supported settling ${worst.toFixed(3)}s`,
);
console.log(
  "PASS immediate floor touchdown after real wall contact clears obsolete normal history",
);
console.log(
  "PASS player-requested roof recovery in both goals with both car bodies",
);
