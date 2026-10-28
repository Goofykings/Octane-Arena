import assert from "node:assert/strict";
import R from "@dimforge/rapier3d-compat";
import { Matrix4, Quaternion, Vector3 } from "three";
import { Simulation, initializeSimulation } from "../src/physics/simulation";
import { neutralInput } from "../shared/player";
import { P } from "../src/config/physics";
await initializeSimulation();
const neutral = neutralInput();
type Kind = "up" | "side" | "recover" | "turn" | "release";
function wall(body: "ion" | "vector", kind: Kind) {
  const s = new Simulation(true);
  s.ball.setEnabled(false);
  s.cars[1].body.setEnabled(false);
  const c = s.cars[0];
  c.setBody(body);
  s.world.createCollider(
    R.ColliderDesc.cuboid(0.2, 15, 30).setTranslation(6.2, 18, 0),
  );
  const up = new Vector3(-1, 0, 0);
  const forward =
    kind === "side" || kind === "turn"
      ? new Vector3(0, 0, -1)
      : new Vector3(0, 1, 0);
  c.reset(5.69, 0, 0, 18);
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
  c.body.setLinvel(
    {
      x: 0,
      y: kind === "recover" || kind === "turn" ? -3 : 0,
      z: kind === "turn" ? -5 : 0,
    },
    true,
  );
  return { s, c };
}
for (const body of ["ion", "vector"] as const)
  for (const kind of ["up", "side", "recover", "turn", "release"] as const) {
    const { s, c } = wall(body, kind);
    let previous = new Vector3().copy(c.body.linvel()),
      maxDelta = 0;
    let firstGrip = 0,
      firstDrive = 0,
      releaseDrive = 0,
      afterReleaseDrive = 0;
    const samples = new Map<
      number,
      {
        y: number;
        vy: number;
        z: number;
        vz: number;
        grip: number;
        drive: number;
        contacts: number;
      }
    >();
    for (let i = 0; i < 240; i++) {
      const throttle = kind === "release" && i >= 180 ? 0 : 1;
      s.step([
        { ...neutral, throttle, steer: kind === "turn" && i >= 60 ? 0.6 : 0 },
        neutral,
      ]);
      const v = new Vector3().copy(c.body.linvel()),
        p = c.body.translation();
      if (i > 12 && c.contacts >= 3)
        maxDelta = Math.max(maxDelta, v.distanceTo(previous));
      previous.copy(v);
      if (i === 12) {
        firstGrip = c.wallGrip;
        firstDrive = c.wallDrive;
      }
      if (i === 179) releaseDrive = c.wallDrive;
      if (i === 180) afterReleaseDrive = c.wallDrive;
      if ([30, 60, 120, 179, 239].includes(i))
        samples.set(i, {
          y: p.y,
          vy: v.y,
          z: p.z,
          vz: v.z,
          grip: c.wallGrip,
          drive: c.wallDrive,
          contacts: c.contacts,
        });
    }
    const a = samples.get(30)!,
      one = samples.get(120)!,
      end = samples.get(239)!;
    assert.ok(
      firstDrive > 0 && firstDrive < 0.3,
      body + " " + kind + " drive must build gradually",
    );
    assert.ok(
      firstGrip < 0.3 && a.grip < 0.85,
      body + " lateral traction must remain below floor grip",
    );
    assert.ok(
      maxDelta < 0.16,
      body + " " + kind + " abrupt velocity step " + maxDelta,
    );
    if (kind === "up") {
      assert.ok(one.vy > 1 && end.y > 19, body + " climbs vertically");
    }
    if (kind === "side") {
      assert.ok(one.vz < -4 && one.contacts >= 3, body + " drives sideways");
      assert.ok(a.vy < -0.3, body + " retains initial wall slip");
    }
    if (kind === "recover") {
      assert.ok(a.vy < -1, body + " sliding should initially continue");
      assert.ok(one.vy > -0.7 && end.vy > 2, body + " recovers and climbs");
    }
    if (kind === "turn") {
      assert.ok(
        a.vy < -0.3 && one.y > a.y && Math.abs(end.z - one.z) > 1,
        body + " steers progressively while slipping",
      );
    }
    if (kind === "release") {
      assert.ok(
        afterReleaseDrive < releaseDrive &&
          afterReleaseDrive > releaseDrive * 0.9,
        body + " release decays smoothly",
      );
      assert.ok(
        end.vy < 1 && end.drive < 0.2,
        body + " release reduces drive and gravity acts",
      );
    }
    const saved = c.capturePrediction(),
      expected = c.wallDrive;
    c.wallDrive = 0;
    c.restorePrediction(saved);
    assert.equal(
      c.wallDrive,
      expected,
      "drive recovery must survive prediction replay",
    );
    console.log(
      "PASS",
      body,
      kind,
      JSON.stringify({ firstGrip, firstDrive, maxDelta, one, end }),
    );
    s.dispose();
  }
// Real arena floor-to-wall transition: remain in contact and climb without boost.
for (const body of ["ion", "vector"] as const) {
  const s = new Simulation();
  s.ball.setEnabled(false);
  s.cars[1].body.setEnabled(false);
  const c = s.cars[0];
  c.setBody(body);
  c.reset(35, 0, -Math.PI / 2);
  c.body.setLinvel({ x: 12, y: 0, z: 0 }, true);
  let wallTicks = 0,
    maxStep = 0,
    maxSpeedStep = 0,
    previous = new Vector3().copy(c.body.linvel());
  for (let i = 0; i < 240; i++) {
    s.step([{ ...neutral, throttle: 1 }, neutral]);
    const v = new Vector3().copy(c.body.linvel());
    if (i > 10 && c.contacts >= 3)
      maxStep = Math.max(maxStep, v.distanceTo(previous));
    maxSpeedStep = Math.max(
      maxSpeedStep,
      Math.abs(v.length() - previous.length()),
    );
    previous.copy(v);
    if (c.contacts >= 3 && c.normal.y < 0.4) wallTicks++;
  }
  assert.ok(
    wallTicks > 30 && c.body.translation().y > 3,
    body +
      " transitions floor to wall and climbs " +
      JSON.stringify({
        wallTicks,
        pos: c.body.translation(),
        normal: c.normal,
        maxStep,
      }),
  );
  assert.ok(
    maxSpeedStep < 0.4,
    body + " abrupt transition speed change " + maxSpeedStep,
  );
  console.log(
    "PASS",
    body,
    "floor-wall",
    JSON.stringify({
      wallTicks,
      maxStep,
      maxSpeedStep,
      y: c.body.translation().y,
    }),
  );
  s.dispose();
}
// Reverse along a wall is also powered and keeps the tire forces gradual.
for (const body of ["ion", "vector"] as const) {
  const { s, c } = wall(body, "side");
  let previous = new Vector3().copy(c.body.linvel()),
    maxDelta = 0;
  for (let i = 0; i < 120; i++) {
    s.step([{ ...neutral, throttle: -1 }, neutral]);
    const v = new Vector3().copy(c.body.linvel());
    if (i > 12 && c.contacts >= 3)
      maxDelta = Math.max(maxDelta, v.distanceTo(previous));
    previous.copy(v);
  }
  assert.ok(
    c.body.linvel().z > 4 && c.contacts >= 3 && maxDelta < 0.16,
    body + " reverses smoothly along the wall",
  );
  console.log(
    "PASS",
    body,
    "reverse wall driving",
    JSON.stringify({ velocity: c.body.linvel(), maxDelta }),
  );
  s.dispose();
}
// Identical elapsed throttle at different forward speeds must produce smoothly higher drive grip.
const speedSamples: number[] = [];
for (const speed of [0, 5, 15]) {
  const { s, c } = wall("vector", "side");
  c.body.setLinvel({ x: 0, y: -3, z: -speed }, true);
  let previous = 0,
    maxRise = 0;
  for (let i = 0; i < 48; i++) {
    s.step([{ ...neutral, throttle: 1 }, neutral]);
    maxRise = Math.max(maxRise, c.wallDrive - previous);
    previous = c.wallDrive;
  }
  assert.ok(
    maxRise < 0.03,
    "powered traction changes gradually each physics step",
  );
  speedSamples.push(c.wallDrive);
  s.dispose();
}
assert.ok(
  speedSamples[2] > speedSamples[1] && speedSamples[1] > speedSamples[0],
  "drive grip rises with forward speed",
);
console.log(
  "PASS gradual speed-dependent wall drive and separate lateral grip; adhesion and gravity retained",
  speedSamples,
);
