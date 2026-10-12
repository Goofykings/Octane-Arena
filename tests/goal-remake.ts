import assert from "node:assert/strict";
import { Vector3 } from "three";
import { Simulation, initializeSimulation } from "../src/physics/simulation";
import { goalShell } from "../src/arena/geometry";
import { goalRoofHeight } from "../src/arena/goal";
import { goalFrame } from "../src/arena/posts";
import { insideArena } from "../src/arena/physics";
import { P } from "../src/config/physics";
import { neutralInput } from "../shared/player";
import { scoringTeam } from "../src/game/goals";
await initializeSimulation();
const a = P.arena,
  n = neutralInput();
assert.equal(a.goalHalf, 8.93);
assert.equal(a.goalHeight, 6.43);
assert.equal(a.goalDepth, 8.8);
assert.ok(a.goalCurve < 2.4 && a.goalCurve > 1);
assert.equal(goalRoofHeight(0), a.goalHeight);
assert.equal(goalRoofHeight(a.goalDepth), a.goalHeight - a.goalRoofDrop);
for (const sign of [-1, 1]) {
  const mesh = goalShell(sign),
    frame = goalFrame(sign);
  assert.equal(frame.length, 3);
  const faces = new Set(
    Array.from({ length: mesh.indices.length / 3 }, (_, i) =>
      Array.from(mesh.indices.slice(i * 3, i * 3 + 3))
        .sort((a, b) => a - b)
        .join(","),
    ),
  );
  for (const part of frame) {
    assert.ok(part.indices.length > 0);
    assert.deepEqual(part.vertices, mesh.vertices);
    for (let i = 0; i < part.indices.length; i += 3)
      assert.ok(
        faces.has(
          Array.from(part.indices.slice(i, i + 3))
            .sort((a, b) => a - b)
            .join(","),
        ),
        "Colored frame uses exactly the wall collision faces",
      );
  }
  const roofVertices = [];
  for (let i = 0; i < mesh.vertices.length; i += 3) {
    const [x, y, z] = mesh.vertices.slice(i, i + 3);
    if (
      Math.abs(x) < a.goalHalf - a.goalCurve + 0.01 &&
      y > 5 &&
      z * sign > a.halfLength + a.goalLip &&
      z * sign <= a.halfLength + a.goalDepth - a.goalCurve + 1e-5
    )
      roofVertices.push([y, z * sign - a.halfLength]);
  }
  assert.ok(roofVertices.length >= 4);
  for (const [y, depth] of roofVertices)
    assert.ok(Math.abs(y - goalRoofHeight(depth)) < 1e-5);
  assert.equal(
    scoringTeam({ x: 0, y: 2, z: sign * (a.halfLength + P.ball.radius + 0.1) }),
    sign > 0 ? 1 : 0,
  );
  assert.equal(
    scoringTeam({ x: 0, y: 2, z: sign * (a.halfLength + P.ball.radius - 0.1) }),
    null,
  );
  for (const body of ["ion", "vector"] as const)
    for (const speed of [3, 12, 23]) {
      const s = new Simulation(),
        c = s.cars[0];
      try {
        s.cars[1].body.setEnabled(false);
        s.ball.setEnabled(false);
        c.setBody(body);
        c.reset(0, sign * (a.halfLength - 4), sign > 0 ? Math.PI : 0, 0.4);
        c.body.setLinvel({ x: 0, y: 0, z: sign * speed }, true);
        let entered = false,
          climbed = false,
          exited = false,
          maxY = 0;
        for (let tick = 0; tick < 360; tick++) {
          // Actual driving inputs only after the initial launch speed: no pose,
          // force, velocity, grip, gravity or boost-inventory injection.
          s.step([{ ...n, throttle: 1, boost: true }, n]);
          const p = c.body.translation();
          entered ||= p.z * sign > a.halfLength + 2;
          climbed ||= entered && c.up.z * sign < -0.7 && p.y > 1.5;
          maxY = Math.max(maxY, p.y);
          exited ||= climbed && p.z * sign < a.halfLength - 1 && p.y > 2;
          assert.ok(
            insideArena(s.arenaCollider!, p, 0.03),
            `${body}/${sign}/${speed} escaped`,
          );
          assert.equal(
            s.containmentRecoveries,
            0,
            "containment safeguard must never hide a goal flaw",
          );
          assert.ok(
            new Vector3().copy(c.body.linvel()).length() <=
              P.car.maxSpeed + 0.02,
          );
        }
        assert.ok(
          entered && climbed && exited,
          `${body}/${sign}/${speed}: drive/climb/upper fly-out failed (${maxY})`,
        );
        assert.ok(maxY > 4.5, "route must reach the upper opening");
      } finally {
        s.dispose();
      }
    }
}
console.log(
  "PASS mirrored compact tunnel, flush shared-face colored entrance, unchanged scoring, 12 real-input drive-in/climb/upper fly-out routes without containment recovery",
);
