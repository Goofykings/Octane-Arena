import { disposeModel } from "../src/render/models";
import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  Scene,
  Group,
  Matrix4,
  Quaternion,
  Vector3,
  MeshStandardMaterial,
} from "three";
import { initializeSimulation, Simulation } from "../src/physics/simulation";
import { refreshStaticQueries } from "../src/physics/queries";
import {
  DROPSHOT_BALL_GROUP,
  DROPSHOT_CAR_GROUP,
} from "../src/physics/collision-groups";
import {
  dropshotTiles as tiles,
  DROPSHOT_CONFIG as D,
} from "../shared/dropshot";
import { neutralInput } from "../shared/player";
import { drawDropshotArena, dropshotBall } from "../src/render/dropshot";
import { bodies } from "../shared/catalog";
import { P } from "../src/config/physics";
const n = neutralInput();
await initializeSimulation();
const center = tiles.find(
  (t) => t.team === 1 && t.row === 3 && Math.abs(t.x) < 4,
)!;
function setup() {
  const s = new Simulation();
  s.setGameMode("dropshot");
  s.reset();
  s.cars.forEach((c) => c.body.setEnabled(false));
  s.ball.setEnabled(false);
  return s;
}
function open(s: Simulation, id: number) {
  const d = s.dropshot!;
  d.touch("player", (1 - tiles[id].team) as 0 | 1, 0);
  d.damage(id, 10, s.clock);
  d.damage(id, 10, s.clock + 0.21);
  s.clock += 0.5;
  refreshStaticQueries(s);
}
// The same open point supports car queries, physics and wheels; ball sweeps see a hole.
{
  const s = setup(),
    c = s.cars[0],
    t = center;
  open(s, t.id);
  const ray = new RAPIER.Ray({ x: t.x, y: 2, z: t.z }, { x: 0, y: -1, z: 0 });
  assert.equal(
    s.world.castRay(ray, 3, true, undefined, DROPSHOT_BALL_GROUP),
    null,
  );
  assert.ok(s.world.castRay(ray, 3, true, undefined, DROPSHOT_CAR_GROUP));
  c.reset(t.x, t.z, 0);
  c.body.setEnabled(true);
  for (let i = 0; i < 480; i++) {
    s.step([n, n]);
    assert.ok(
      c.body.translation().y > 0.2,
      "Car remains supported above an open tile",
    );
  }
  assert.ok(
    c.stableContact && c.contacts >= 3,
    "Stationary car has real rigid wheel support",
  );
  c.reset(t.x, t.z + 6, 0);
  let crossed = false;
  for (let i = 0; i < 180; i++) {
    s.step([{ ...n, throttle: 1 }, n]);
    if (Math.abs(c.body.translation().z - t.z) < 1) crossed = true;
    assert.ok(c.body.translation().y > 0.2);
  }
  assert.ok(crossed, "Drives across the opening");
  c.body.setEnabled(false);
  s.ball.setEnabled(true);
  s.ball.setTranslation({ x: t.x, y: 3, z: t.z }, true);
  s.ball.setLinvel({ x: 0, y: -5, z: 0 }, true);
  for (let i = 0; i < 100 && s.dropshot!.goal === null; i++) s.step([n, n]);
  assert.equal(
    s.dropshot!.goal,
    0,
    "Ball falls through unchanged scoring volume",
  );
  s.dispose();
}
// Real top-face impacts must still drive authoritative damage, not only direct damage() fixtures.
for (const team of [0, 1] as const)
  for (const speed of [1, 8]) {
    const s = setup(),
      t = tiles.find(
        (t) => t.team === team && t.row === 3 && Math.abs(t.x) < 4,
      )!;
    s.dropshot!.touch("player", (1 - team) as 0 | 1, 0);
    s.world.gravity = { x: 0, y: 0, z: 0 };
    s.ball.setEnabled(true);
    s.ball.setTranslation(
      { x: t.x, y: s.physics.ball.radius + 0.15, z: t.z },
      true,
    );
    s.ball.setLinvel({ x: 0, y: -speed, z: 0 }, true);
    s.ballPose.snap();
    for (let i = 0; i < 100; i++) s.step([n, n]);
    assert.equal(
      s.dropshot!.states[t.id],
      speed > 2.5 ? 1 : 0,
      "Physical top hit damage, team " + team + " speed " + speed,
    );
    s.dispose();
  }
// Real horizontal exposed-face impacts, both teams and all six neighbor directions.
for (const team of [0, 1] as const)
  for (const height of [-D.tileThickness / 2, 0.65])
    for (const speed of [1, 10]) {
      const tile = tiles.find(
        (t) => t.team === team && t.row === 3 && Math.abs(t.x) < 4,
      )!;
      for (const neighborId of tile.neighbors) {
        const s = setup(),
          b = s.ball,
          other = tiles[neighborId];
        open(s, other.id);
        s.dropshot!.touch("player", (1 - team) as 0 | 1, 0);
        s.world.gravity = { x: 0, y: 0, z: 0 };
        b.setEnabled(true);
        const direction = new Vector3(
          tile.x - other.x,
          0,
          tile.z - other.z,
        ).normalize();
        b.setTranslation({ x: other.x, y: height, z: other.z }, true);
        b.setLinvel(direction.multiplyScalar(speed), true);
        s.ballPose.snap();
        let contacted = false;
        for (let i = 0; i < Math.ceil(4 / speed / P.dt) + 30; i++) {
          s.step([n, n]);
          s.world.contactPair(
            s.ballCollider,
            s.dropshot!.arena.tiles[tile.id],
            (m) => {
              if (m.numContacts()) contacted = true;
            },
          );
          if (s.dropshot!.states[tile.id] === 1) break;
        }
        assert.ok(
          contacted,
          "Physical side/edge contact " +
            team +
            "/" +
            neighborId +
            "/" +
            speed +
            "/" +
            height,
        );
        assert.equal(
          s.dropshot!.states[tile.id],
          speed > 2.5 ? 1 : 0,
          "Incoming normal speed controls side damage",
        );
        assert.equal(
          s.dropshot!.grounded,
          false,
          "Vertical side is not zero-second ground contact",
        );
        s.dispose();
      }
    }
// Floor/wall/ceiling/car contacts never create reset events. Valid airborne BALL contact does.
for (const mode of ["soccar", "dropshot"] as const) {
  const s = new Simulation();
  s.setGameMode(mode);
  s.reset();
  const c = s.cars[0];
  s.cars[1].body.setEnabled(false);
  s.ball.setTranslation({ x: 20, y: 10, z: 20 }, true);
  s.world.gravity = { x: 0, y: -P.gravity, z: 0 };
  c.reset(0, mode === "dropshot" ? 15 : 0, 0, 3);
  for (let i = 0; i < 240; i++) {
    s.step([n, n]);
    assert.equal(c.flipResetSequence, 0, "Ground/tile landing is not a reset");
  }
  // Place the fixed wheel envelope against actual wall and ceiling geometry.
  for (const surface of ["wall", "ceiling"] as const) {
    const wallZ = mode === "dropshot" ? 45.55 : P.arena.halfLength;
    const ceiling = mode === "dropshot" ? D.arenaHeight : P.arena.height;
    c.reset(
      0,
      surface === "wall" ? wallZ - 0.31 : 0,
      0,
      surface === "wall" ? 8 : ceiling - 0.31,
    );
    c.body.setRotation(
      new Quaternion().setFromAxisAngle(
        new Vector3(1, 0, 0),
        surface === "wall" ? -Math.PI / 2 : Math.PI,
      ),
      true,
    );
    c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    c.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    let supported = false;
    for (let i = 0; i < 30; i++) {
      s.step([n, n]);
      supported ||= c.wheelContact.some(Boolean);
      assert.equal(c.flipResetSequence, 0, surface + " contact is not a reset");
    }
    assert.ok(supported, "Fixture touches actual " + surface);
  }
  // Clear contact history before creating a genuine underside collision.
  c.reset(0, 0, 0, 6);
  s.world.gravity = { x: 0, y: 0, z: 0 };
  s.ball.setTranslation({ x: 20, y: 12, z: 0 }, true);
  s.step([n, n]);
  const d = bodies[c.bodyId];
  c.jump.used = c.jump.second = true;
  c.jump.age = 10;
  s.ball.setTranslation(
    { x: 0, y: 6 + d.hitboxY - d.halfHeight - P.ball.radius + 0.025, z: 0 },
    true,
  );
  s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
  for (let i = 0; i < 8 && c.flipResetSequence === 0; i++) s.step([n, n]);
  assert.equal(
    c.flipResetSequence,
    1,
    "Actual airborne underside ball contact grants exactly one reset",
  );
  s.dispose();
}
// Shared visual buffers and state transitions, including replay rewind and cleanup.
{
  const scene = new Scene(),
    arena = drawDropshotArena(scene),
    s = setup(),
    ds = s.dropshot!;
  arena.update(ds.snapshot(0, true), 0);
  const mesh = arena.group.getObjectByName("dropshot-tiles") as any,
    base = new Vector3(),
    scale = new Vector3(),
    q = new Quaternion(),
    mat = new Matrix4();
  const blue = new (await import("three")).Color(),
    orange = blue.clone();
  mesh.getColorAt(0, blue);
  mesh.getColorAt(70, orange);
  assert.ok(
    blue.getHSL({ h: 0, s: 0, l: 0 }).l < 0.03 &&
      orange.getHSL({ h: 0, s: 0, l: 0 }).l < 0.03,
    "Dark intact tiles on both sides",
  );
  ds.touch("player", 0, 0);
  ds.damage(center.id, 10, 0);
  arena.update(ds.snapshot(0.1, true), 0.4);
  mesh.getColorAt(center.id, blue);
  assert.ok(
    blue.getHSL({ h: 0, s: 0, l: 0 }).l > 0.2,
    "Damaged tile is dramatically brighter",
  );
  ds.damage(center.id, 10, 0.21);
  arena.update(ds.snapshot(0.3, true), 0.1);
  mesh.getMatrixAt(center.id, mat);
  mat.decompose(base, q, scale);
  assert.equal(scale.length(), 0, "Open top surface disappears");
  assert.ok(
    (
      arena.group.getObjectByName("dropshot-exposed-rims") as any
    ).geometry.getAttribute("position").count > 0,
  );
  assert.equal(
    (arena.group.getObjectByName("dropshot-open-depth") as any).count,
    1,
    "Depth renders only under the one open tile",
  );
  assert.equal(
    arena.group.getObjectByName("dropshot-faded-mirrors"),
    undefined,
    "No whole-board reflected geometry",
  );
  const falling = arena.group.getObjectByName("dropshot-falling-tiles") as any;
  assert.ok(
    falling.visible && falling.count > 0,
    "Newly opened tile falls visually",
  );
  arena.update(ds.snapshot(0.8, true), 0.5);
  assert.equal(
    falling.visible,
    false,
    "Falling tile cleans up within 0.45 seconds",
  );
  assert.equal(
    arena.group.children.filter((o) => o.name === "dropshot-light-pole").length,
    18,
  );
  const ball = new Group();
  scene.add(ball);
  ball.visible = true;
  ball.position.set(0, 5, 0);
  const state = ds.snapshot(0, true);
  state.chargeLevel = 0;
  dropshotBall(ball, state, 0);
  state.chargeLevel = 1;
  for (let i = 1; i <= 30; i++) dropshotBall(ball, state, i / 60);
  const fx = ball.userData.dropshotFX,
    sizes = fx.points.geometry.getAttribute("size"),
    active = () =>
      Array.from(sizes.array as Float32Array).filter((v) => v > 0).length,
    charged = active();
  state.chargeLevel = 2;
  dropshotBall(ball, state, 0.51);
  assert.ok(active() > charged * 2, "Super transition emits a dense burst");
  assert.ok(fx.wave.visible);
  const core = ball.getObjectByName("dropshot-ball")!.children[0] as any;
  assert.ok((core.material as MeshStandardMaterial).emissiveIntensity > 2);
  for (let i = 32; i <= 100; i++) {
    ball.position.x = i / 10;
    dropshotBall(ball, state, i / 60);
  }
  assert.ok(
    active() > charged * 3,
    "Sustained Super state is substantially denser",
  );
  const beforeObjects = fx.group.children.length;
  for (let i = 101; i < 250; i++) dropshotBall(ball, state, i / 60);
  assert.equal(fx.group.children.length, beforeObjects);
  dropshotBall(ball, state, 0.2);
  assert.ok(active() <= 128, "Rewind stays bounded");
  ball.rotation.set(0.4, 1.7, 0.8);
  ball.scale.setScalar(1.4);
  dropshotBall(ball, state, 5);
  scene.updateMatrixWorld(true);
  assert.ok(
    fx.group.matrixWorld.elements.every(
      (v: number, i: number) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-8,
    ),
    "Particle history does not rotate with ball spin",
  );
  dropshotBall(ball, null, 0);
  assert.equal(fx.group.visible, false);
  let disposedGeometry = false,
    disposedMaterial = false;
  fx.points.geometry.addEventListener(
    "dispose",
    () => (disposedGeometry = true),
  );
  fx.points.material.addEventListener(
    "dispose",
    () => (disposedMaterial = true),
  );
  disposeModel(ball);
  assert.ok(
    disposedGeometry && disposedMaterial,
    "Particle GPU buffers are disposed with their owner",
  );
  s.dispose();
}
console.log(
  "PASS Dropshot refinement: car-only hole support, ball passage, 48 real side/upper-edge impacts/weak rejection, surface/reset exclusion and valid reset, dark/bright/open tiles, pooled Super burst/steady particles, replay rewind, instanced depth and perimeter lights",
);
