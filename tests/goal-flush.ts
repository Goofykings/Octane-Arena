import assert from "node:assert/strict";
import { Vector3, Quaternion, Matrix4 } from "three";
import { Simulation, initializeSimulation } from "../src/physics/simulation";
import { P } from "../src/config/physics";
import { neutralInput } from "../shared/player";
import { insideArena } from "../src/arena/physics";
await initializeSimulation();
const a = P.arena,
  n = neutralInput();
let routes = 0;
for (const body of ["ion", "vector"] as const)
  for (const sign of [-1, 1])
    for (const side of [-1, 0, 1])
      for (const speed of [8, 16]) {
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
          let last = up.clone();
          for (let i = 0; i < 210; i++) {
            s.step([{ ...n, throttle: 1, boost: speed === 16 }, n]);
            const p = c.body.translation();
            entered ||= side
              ? p.z * sign > a.halfLength + a.goalLip + 0.5
              : c.up.y < -0.2 &&
                p.y > a.goalHeight - 0.5 &&
                Math.abs(p.z * sign - a.halfLength) < 1.5;
            if (c.contacts >= 2)
              maxTurn = Math.max(maxTurn, last.angleTo(c.normal));
            last.copy(c.normal);
            single = c.contacts === 1 ? single + 1 : 0;
            longestSingle = Math.max(single, longestSingle);
            assert.equal(s.containmentRecoveries, 0);
            assert.ok(insideArena(s.arenaCollider!, p, 0.03));
            assert.ok(
              new Vector3().copy(c.body.linvel()).length() <=
                P.car.maxSpeed + 0.02,
            );
            if (entered) break; // Evaluate the entrance, not a later rear-wall/landing contact.
          }
          assert.ok(
            entered,
            `${body}/${sign}/${side}/${speed}: failed wall-to-goal route`,
          );
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
console.log(
  `PASS ${routes} real-input wall/post/crossbar-to-tunnel routes, both bodies/goals, normal/boost, stable normals, no lip/escape/backstop`,
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
