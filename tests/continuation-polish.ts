import { AIR_SPEED_VISUAL } from "../src/effects/air-speed";
import assert from "node:assert/strict";
import { Vector3, Quaternion } from "three";
import { initializeSimulation, Simulation } from "../src/physics/simulation";
import { P } from "../src/config/physics";
import { RUMBLE_CONFIG as R } from "../src/config/rumble";
import { HEATSEEKER as H } from "../src/config/heatseeker";
import { neutralInput as n } from "../shared/player";
import {
  ringGeometry,
  ringScale,
  ringVertex,
  ringTubeRadius,
  createRingsCourse,
} from "../src/extra/course";
import { arenaShell } from "../src/arena/geometry";
import { hexSurfaceUv, ARENA_MARKINGS } from "../src/render/arena-markings";
await initializeSimulation();
function grapple(finalSpeed: number) {
  const cfg = R.grapple as any,
    old = cfg.contactApproachSpeed,
    oldGain = cfg.pullGain,
    oldTarget = cfg.targetApproachSpeed;
  cfg.contactApproachSpeed = finalSpeed;
  if (finalSpeed === 3) {
    cfg.pullGain = 2.5;
    cfg.targetApproachSpeed = 16;
  }
  const s = new Simulation(true, [
    { id: "a", name: "A", team: 0, controller: "local" },
  ]);
  s.setGameMode("rumble");
  s.rumble!.setPhase(true, false);
  s.world.gravity = { x: 0, y: 0, z: 0 };
  s.cars[0].reset(0, 0, 0, 8);
  s.ball.setTranslation({ x: 12, y: 8, z: 0 }, true);
  s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
  s.rumble!.grant("a", "GRAPPLING_HOOK");
  s.rumble!.use("a");
  let near = 0;
  const cruising: number[] = [];
  try {
    for (let i = 0; i < 600; i++) {
      const gap = new Vector3()
        .copy(s.ball.translation())
        .distanceTo(s.cars[0].body.translation());
      if (gap > 4 && gap < 8) cruising.push(s.cars[0].body.linvel().x);
      if (gap < 3) near = Math.max(near, s.cars[0].body.linvel().x);
      s.step([n()]);
      if (s.touchSequence)
        return {
          time: i * P.dt,
          impact: new Vector3().copy(s.ball.linvel()).length(),
          near,
          cruising,
        };
    }
    throw Error("Grapple missed");
  } finally {
    cfg.contactApproachSpeed = old;
    cfg.pullGain = oldGain;
    cfg.targetApproachSpeed = oldTarget;
    s.dispose();
  }
}
const old = grapple(3),
  strong = grapple(R.grapple.contactApproachSpeed);
assert.ok(
  strong.impact > old.impact * 1.4 && strong.near > old.near * 1.15,
  "Final contact is stronger, not a slow crawl: " +
    JSON.stringify({
      oldImpact: old.impact,
      newImpact: strong.impact,
      oldNear: old.near,
      newNear: strong.near,
    }),
);
assert.ok(
  strong.cruising.every((v) => v > 9 && v < 16.5),
  "Cruise approach stays close to its target",
);
assert.ok(
  P.car.lateralMaxAcceleration > 28 && P.car.lateralMaxAcceleration < 40,
);
const s = new Simulation(true);
s.ballCollider.setCollisionGroups(0);
s.cars[1].collider.setCollisionGroups(0);
const c = s.cars[0];
c.reset(0, 0, 0, 1);
c.body.setRotation(
  new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI),
  true,
);
for (let i = 0; i < 120; i++) s.step([n(), n()]);
s.step([{ ...n(), throttle: 1 }, n()]);
let settled = -1,
  rotation = 0,
  last = new Quaternion().copy(c.body.rotation());
for (let i = 0; i < 300; i++) {
  s.step([{ ...n(), throttle: 1 }, n()]);
  const q = new Quaternion().copy(c.body.rotation());
  rotation += last.angleTo(q);
  last = q;
  if (settled < 0 && c.up.y > 0.98 && c.contacts >= 3) settled = i * P.dt;
}
assert.ok(
  settled > 0 && settled < 1.3 && rotation < Math.PI * 1.35,
  "Faster recovery retains braking/no overshoot",
);
s.dispose();
const g = ringGeometry(),
  p = g.getAttribute("position");
for (const ring of createRingsCourse().rings) {
  let min = Infinity,
    max = -Infinity,
    depth = 0;
  for (let i = 0; i < p.count; i++) {
    const v = ringVertex(p.getX(i), p.getY(i), p.getZ(i), ringScale(ring));
    const r = Math.hypot(v[0], v[1]);
    min = Math.min(min, r);
    max = Math.max(max, r);
    depth = Math.max(depth, Math.abs(v[2]));
  }
  assert.ok(Math.abs(min - ring.opening) < 1e-5);
  assert.ok(Math.abs(max - min - ringTubeRadius * 2) < 1e-5);
  assert.ok(depth <= ringTubeRadius + 0.0001);
}
g.dispose();
const shell = arenaShell(),
  vertices = new Float32Array(shell.vertices),
  uv = hexSurfaceUv(shell);
assert.deepEqual(
  shell.vertices,
  vertices,
  "Hex mapping changes no collision vertices",
);
for (
  let col = 0;
  col < shell.vertices.length / 3 / shell.profileLength;
  col++
) {
  const i = (col + 1) * shell.profileLength - 1;
  assert.ok(
    Math.abs(
      uv[i * 2] - shell.vertices[i * 3] / (3 * ARENA_MARKINGS.hexRadius),
    ) < 1e-5,
  );
  assert.ok(
    Math.abs(
      uv[i * 2 + 1] -
        shell.vertices[i * 3 + 2] / (Math.sqrt(3) * ARENA_MARKINGS.hexRadius),
    ) < 1e-5,
    "Wall fillet meets ceiling UV exactly",
  );
}
// Real homing/world steps isolate trajectory tuning; speed tiers stay unchanged.
function flight(comp: number) {
  const cfg = H as any,
    prev = cfg.gravityCompensation;
  cfg.gravityCompensation = comp;
  const sim = new Simulation();
  sim.setGameMode("heatseeker");
  sim.cars.forEach((c) => c.collider.setCollisionGroups(0));
  sim.ball.setTranslation({ x: 4, y: 4, z: 20 }, true);
  sim.ball.setLinvel({ x: 0, y: 0, z: -H.initialSpeed }, true);
  sim.heatseeker!.touch("a", 0, 0);
  let min = 4;
  try {
    for (let i = 0; i < 200; i++) {
      sim.step([n(), n()]);
      min = Math.min(min, sim.ball.translation().y);
    }
    return {
      min,
      p: { ...sim.ball.translation() },
      speed: sim.heatseeker!.state.speed,
    };
  } finally {
    cfg.gravityCompensation = prev;
    sim.dispose();
  }
}
const sag = flight(0),
  direct = flight(H.gravityCompensation);
assert.ok(
  direct.min > sag.min + 0.15,
  "Homing dips less without changing world gravity",
);
assert.equal(direct.speed, sag.speed);
assert.ok(direct.p.y < 6.5, "No large lift or speed-tier change");
assert.ok(
  AIR_SPEED_VISUAL.travelRate > 1 &&
    AIR_SPEED_VISUAL.width > 1.2 &&
    AIR_SPEED_VISUAL.length > 0.08 &&
    AIR_SPEED_VISUAL.lengthGain > 0.11,
  "Speed-edge effect moves faster and uses larger streaks",
);
console.log(
  "PASS stronger controlled grapple, firmer finite grip, snappier recovery, constant ring band, continuous nonphysical hex UV and subtle Heatseeker trajectory",
  { old, strong, settled, sag, direct },
);
