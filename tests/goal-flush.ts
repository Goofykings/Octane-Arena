import assert from "node:assert/strict";
import { Vector3, Quaternion, Matrix4 } from "three";
import { Simulation, initializeSimulation } from "../src/physics/simulation";
import { P } from "../src/config/physics";
import { neutralInput } from "../shared/player";
import { insideArena } from "../src/arena/physics";
await initializeSimulation();
const a = P.arena,
  n = neutralInput();
let routes = 0,
  wrapped = 0;
// The rounded post lip is a convex 1.2 m edge. RL stickiness (1.5 g) can only
// hold a car around it below ~sqrt(1.5 g R) ≈ 3.4 m/s; faster cars (and cars
// accelerated by gravity down to the crossbar) fly off it into the goal mouth,
// as in Rocket League. Every route must stay contained and stable.
for (const body of ["ion", "vector"] as const)
  for (const sign of [-1, 1])
    for (const side of [-1, 0, 1])
      for (const speed of [3, 8, 16]) {
        const s = new Simulation(),
          c = s.cars[0];
        try {
          s.cars[1].body.setEnabled(false);
          s.ball.setEnabled(false);
          c.setBody(body);
          const up = new Vector3(0, 0, -sign);
          const forward = side
            ? new Vector3(-side, 0, 0)
            : new Vector3(0, -1, 0);
          const p = new Vector3(
            side * (a.goalHalf + a.goalLip + 3),
            side ? 4 : a.goalHeight + a.goalLip + 2,
            sign * (a.halfLength - 0.34),
          );
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
          c.body.setLinvel(forward.clone().multiplyScalar(speed), true);
          let entered = false,
            maxTurn = 0,
            longestSingle = 0,
            single = 0;
          let last = up.clone(),
            lastContacts = 4;
          for (let i = 0; i < (speed === 3 ? 420 : 210); i++) {
            // Hold the low-speed route near its target instead of depending on
            // a particular acceleration tune. Boosted routes still use full input.
            const throttle =
              speed === 16
                ? 1
                : Math.max(0, Math.min(1, (speed - c.forwardSpeed) * 0.6));
            s.step([{ ...n, throttle, boost: speed === 16 }, n]);
            const p = c.body.translation();
            entered ||= side
              ? p.z * sign > a.halfLength + a.goalLip + 0.5
              : p.y < a.goalHeight && Math.abs(p.z * sign - a.halfLength) < 1.5;
            // Surface-normal continuity while the wheels stay on the surface.
            if (c.contacts >= 2 && lastContacts >= 2)
              maxTurn = Math.max(maxTurn, last.angleTo(c.normal));
            last.copy(c.normal);
            lastContacts = c.contacts;
            // A true edge balance is static on one wheel; a tumble merely scrapes.
            single =
              c.contacts === 1 &&
              new Vector3().copy(c.body.angvel()).length() < 0.5 &&
              new Vector3().copy(c.body.linvel()).length() < 1
                ? single + 1
                : 0;
            longestSingle = Math.max(single, longestSingle);
            assert.equal(s.containmentRecoveries, 0);
            assert.ok(insideArena(s.arenaCollider!, p, 0.03));
            assert.ok(
              new Vector3().copy(c.body.linvel()).length() <=
                P.car.maxSpeed + 0.02,
            );
            if (entered) break; // Evaluate the entrance, not a later rear-wall/landing contact.
          }
          if (side && speed === 3) {
            assert.ok(
              entered && c.grounded,
              `${body}/${sign}/${side}/${speed}: slow route wraps the post lip into the goal`,
            );
            wrapped++;
          }
          assert.ok(maxTurn < 0.4, `entrance normal jump ${maxTurn}`);
          assert.ok(
            longestSingle < 20,
            `${body}/${sign}/${side}/${speed}: persistent edge balance ${longestSingle}`,
          );
          routes++;
        } finally {
          s.dispose();
        }
      }
assert.equal(wrapped, 8);
console.log(
  `PASS ${routes} real-input wall/post/crossbar-to-goal routes (${wrapped} slow wraps), both bodies/goals, normal/boost, stable normals, no lip/escape/backstop`,
);
for (const body of ["ion", "vector"] as const)
  for (const sign of [-1, 1])
    for (const side of [-1, 1]) {
      const s = new Simulation(),
        c = s.cars[0];
      try {
        s.cars[1].body.setEnabled(false);
        s.ball.setEnabled(false);
        c.setBody(body);
        const up = new Vector3(0, 0, -sign),
          forward = new Vector3(0, 1, 0);
        c.reset(
          side * (a.goalHalf + a.goalLip + 0.1),
          sign * (a.halfLength - 0.34),
          0,
          3,
        );
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
        c.body.setLinvel(forward.clone().multiplyScalar(8), true);
        let passed = false;
        for (let i = 0; i < 240; i++) {
          s.step([{ ...n, throttle: 1, boost: true }, n]);
          assert.equal(s.containmentRecoveries, 0);
          if (c.body.translation().y > a.goalHeight + a.goalLip + 0.5) {
            passed = true;
            break;
          }
        }
        assert.ok(
          passed,
          `${body}/${sign}/${side}: wall climb beside opening catches a lip`,
        );
      } finally {
        s.dispose();
      }
    }
console.log(
  "PASS 8 real boosted wall climbs beside the integrated goal boundary",
);
