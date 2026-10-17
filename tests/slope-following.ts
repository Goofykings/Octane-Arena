import assert from "node:assert/strict";
import { refineContactNormal } from "../src/car/contact-frame";
import { initializeSimulation, Simulation } from "../src/physics/simulation";
import { Vector3, Quaternion, Matrix4 } from "three";
import { neutralInput } from "../shared/player";
import { wheelClearance, wheelMountY } from "../src/car/wheels";
import { P } from "../src/config/physics";
import { writeFileSync, mkdirSync } from "node:fs";
await initializeSimulation();
const n = neutralInput(),
  results: any[] = [];
for (const mode of ["soccar", "dropshot"] as const) {
  const s = new Simulation();
  s.setGameMode(mode);
  s.cars[1].body.setEnabled(false);
  s.ball.setEnabled(false);
  s.world.step();
  const c = s.cars[0];
  for (const body of ["ion", "vector"] as const)
    for (const speed of [4, 14, 23])
      for (const direction of ["up", "down"]) {
        c.setBody(body);
        const side = mode === "soccar" ? P.arena.halfWidth : 45.55;
        const up =
          direction === "down"
            ? mode === "soccar"
              ? new Vector3(-1, 0, 0)
              : new Vector3(0, 0, -1)
            : new Vector3(0, 1, 0);
        const forward =
          direction === "down"
            ? new Vector3(0, -1, 0)
            : mode === "soccar"
              ? new Vector3(1, 0, 0)
              : new Vector3(0, 0, 1);
        c.reset(
          mode === "soccar" ? (direction === "up" ? 35 : side - 0.312) : 0,
          mode === "dropshot" ? (direction === "up" ? 39 : side - 0.312) : 0,
          0,
          direction === "up" ? 0.36 : 5,
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
        c.body.setLinvel(forward.clone().multiplyScalar(speed), true);
        s.world.step();
        let samples = 0,
          missing = 0,
          worst = 0,
          gaps = 0,
          large = 0,
          normalStep = 0;
        let previous = c.normal.clone();
        for (let i = 0; i < 300; i++) {
          c.boost = 100;
          s.step([{ ...n, throttle: 1, boost: speed === 23 }, n]);
          const p = c.body.translation();
          const horizontal = mode === "soccar" ? p.x : p.z;
          if (horizontal > side - 2.8 && p.y > 0.1 && p.y < 2.9) {
            samples++;
            missing += 4 - c.contacts;
            let gap = 0;
            for (let k = 0; k < 4; k++) {
              const v = wheelClearance(
                s.world,
                new Vector3().copy(p),
                new Quaternion().copy(c.body.rotation()),
                c.bodyId,
                k,
                c.collider,
                c.body,
                k < 2 ? c.steerAngle : 0,
              );
              if (Number.isFinite(v)) gap = Math.max(gap, wheelMountY - v);
            }
            gaps += gap;
            worst = Math.max(worst, gap);
            if (gap > 0.08) large++;
            normalStep = Math.max(normalStep, c.normal.angleTo(previous));
          }
          previous.copy(c.normal);
          if (direction === "up" && p.y > 3) break;
          if (direction === "down" && horizontal < side - 3) break;
        }
        results.push({
          mode,
          body,
          speed,
          direction,
          samples,
          missing,
          worst,
          meanGap: samples ? gaps / samples : 0,
          large,
          normalStep,
          recoveries: s.containmentRecoveries,
        });
      }
  s.dispose();
}
mkdirSync(".tools", { recursive: true });
writeFileSync(
  ".tools/slope-following-current.json",
  JSON.stringify(results, null, 2),
);
for (const r of results) {
  assert.ok(r.samples > 10, "Curve traversal " + JSON.stringify(r));
  assert.equal(r.missing, 0, "Engaged wheel contacts " + JSON.stringify(r));
  assert.ok(
    r.meanGap <
      (r.speed === 23 ? (r.mode === "dropshot" ? 0.09 : 0.06) : 0.045),
    "Bounded mean wheel gap " + JSON.stringify(r),
  );
  assert.ok(
    r.worst < (r.mode === "dropshot" ? 0.18 : 0.12),
    "Bounded peak wheel gap " + JSON.stringify(r),
  );
  assert.equal(r.recoveries, 0, "No containment recovery");
}
for (const angle of [Math.PI / 6, Math.PI / 2]) {
  const floor = new Vector3(0, 1, 0),
    wall = floor.clone().applyAxisAngle(new Vector3(0, 0, 1), angle),
    normal = floor.clone().add(wall).normalize();
  assert.equal(
    refineContactNormal(
      normal,
      [floor, floor, wall, wall],
      [1, 1, 1, 1],
      floor,
    ),
    false,
  );
  assert.ok(normal.dot(floor) > 0.999, "Sharp edge keeps actual face normal");
}
// The front axle can enter a tight tangent goal curve while the midpoint is
// barely beyond the straight approach. Its genuine intermediate normal must
// not be mistaken for a sharp edge merely because it differs from the average.
{
  const start = new Vector3(0, 0, 1),
    axis = new Vector3(0, 1, 0),
    front = start.clone().applyAxisAngle(axis, (29.25 * Math.PI) / 180),
    middle = start.clone().applyAxisAngle(axis, (2.25 * Math.PI) / 180),
    normal = start.clone().add(front).normalize();
  assert.equal(
    refineContactNormal(
      normal,
      [start, start, front, front],
      [1, 1, 1, 1],
      middle,
    ),
    true,
    "Tangent goal curve keeps continuous support",
  );
  const sharp = start.clone().applyAxisAngle(axis, Math.PI / 6),
    biased = start.clone().multiplyScalar(3).add(sharp).normalize();
  assert.equal(
    refineContactNormal(
      biased,
      [start, start, start, sharp],
      [1, 1, 1, 1],
      start,
    ),
    false,
    "Uneven sharp-edge footprint keeps one face",
  );
}
const floor = new Vector3(0, 1, 0),
  a = floor.clone().applyAxisAngle(new Vector3(0, 0, 1), -0.25),
  b = floor.clone().applyAxisAngle(new Vector3(0, 0, 1), 0.25),
  normal = a.clone().multiplyScalar(2).add(b).normalize();
assert.equal(
  refineContactNormal(normal, [a, a, b, b], [1, 1, 0.5, 0.5], floor),
  true,
  "Smooth curvature stays blended despite axle load bias",
);
console.log(
  "PASS 24 real up/down slope runs at 4/14/23 m/s, both bodies and arenas: bounded physical wheel gaps, no missing contacts/containment recovery; smooth normals and sharp-edge separation",
);
