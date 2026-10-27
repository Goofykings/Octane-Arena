import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import { Group, PerspectiveCamera, Vector3, Euler } from "three";
import { initializeSimulation, Simulation } from "../src/physics/simulation";
import { GameCamera } from "../src/camera/camera";
import { MouseLook } from "../src/camera/mouse-look";
import {
  cameraCollisionPolicy,
  cameraCollisionCategory,
} from "../src/camera/space";
import { insideArena } from "../src/arena/physics";
import { P } from "../src/config/physics";
import { CAR_FRAME_RADIUS } from "../src/camera/framing";
await initializeSimulation();
const s = new Simulation(),
  policy = cameraCollisionPolicy(s);
// RL camera: fixed FOV and boom. The car centre stays readable in frame; the
// ball stays fully visible whenever a fixed-FOV view can hold both (a ball
// almost straight overhead may leave the top edge, smoothly).
const centre = (cam: PerspectiveCamera, point: Vector3) => extent(cam, point, 0);
const extent = (cam: PerspectiveCamera, point: Vector3, radius: number) => {
  const p = point.clone().applyMatrix4(cam.matrixWorldInverse),
    t = Math.tan((cam.fov * Math.PI) / 360);
  return Math.max(
    (Math.abs(p.x) + radius) / (-p.z * t * cam.aspect),
    (Math.abs(p.y) + radius) / (-p.z * t),
  );
};
try {
  assert.equal(cameraCollisionCategory(s, s.arenaCollider!), "ARENA_BOUNDARY");
  assert.equal(cameraCollisionCategory(s, s.cars[0].collider), "IGNORE");
  const snapshot = s.world.takeSnapshot();
  for (const fps of [30, 60, 144])
    for (const aspect of [16 / 9, 9 / 16])
      for (const [name, carPoint, ballPoint, outside, both] of [
        ["side wall", [P.arena.halfWidth - 0.35, 8, 0], [0, 1, 0], true, true],
        ["corner", [37, 4, 47], [0, 1, 0], true, true],
        ["backboard", [0, 11, P.arena.halfLength - 0.35], [0, 4, 0], true, true],
        ["ceiling", [35, P.arena.height - 0.35, 0], [30, 16, 0], true, true],
        [
          "wall overhead",
          [P.arena.halfWidth - 0.35, 8, 0],
          [P.arena.halfWidth - 1, 17, 0],
          false,
          false,
        ],
        // The 2.88 m RL boom stays inside the 8.8 m deep goal.
        ["goal interior", [0, 3, P.arena.halfLength + 4], [0, 2, 0], false, true],
        ["midfield", [0, 0.34, 0], [3, 1, -14], false, true],
      ] as const) {
        const car = new Group(),
          ball = new Group(),
          camera = new PerspectiveCamera(73, aspect, 0.05, 340),
          rig = new GameCamera(camera);
        car.position.fromArray(carPoint);
        ball.position.fromArray(ballPoint);
        assert.ok(
          insideArena(s.arenaCollider!, car.position),
          `${name}: subject remains in the playable arena`,
        );
        let maxTurn = 0,
          minBoom = Infinity;
        for (let i = 0; i < fps * 2; i++) {
          car.rotation.set((i / fps) * 2, 0, (i / fps) * 3); // Body roll never owns the view up.
          const q = camera.quaternion.clone();
          rig.update(car, ball, s, 1 / fps, false, i / fps);
          if (i)
            maxTurn = Math.max(maxTurn, q.angleTo(camera.quaternion) * fps);
          minBoom = Math.min(minBoom, camera.position.distanceTo(car.position));
          assert.ok(
            centre(camera, car.position) < 0.86,
            `${name}: car framing ${centre(camera, car.position)}`,
          );
          if (both && i > fps / 2)
            assert.ok(
              extent(camera, ball.position, P.ball.radius) < 1,
              `${name}: ball framing`,
            );
          assert.ok(
            Math.abs(
              new Euler().setFromQuaternion(camera.quaternion, "YXZ").z,
            ) < 1e-8,
            `${name}: stable horizon`,
          );
        }
        assert.ok(
          minBoom >= rig.settings.distance * 0.01 * 0.95,
          `${name}: intended boom retained`,
        );
        assert.ok(
          maxTurn < 5.01 * Math.max(1, 1 / aspect),
          `${name}: no yaw snap`,
        );
        if (outside)
          assert.equal(
            insideArena(s.arenaCollider!, camera.position),
            false,
            `${name}: outside view is permitted`,
          );
      }
  // Compare unaffected midfield with the legacy closed-space predicate.
  const car = new Group(),
    ball = new Group();
  car.position.set(0, 0.34, 0);
  ball.position.set(3, 1, -14);
  const a = new GameCamera(new PerspectiveCamera(73, 16 / 9)),
    b = new GameCamera(new PerspectiveCamera(73, 16 / 9));
  const legacy = {
    world: s.world,
    ball: s.ball,
    cameraObstacles: (c: RAPIER.Collider) => c.parent() === null,
  };
  for (let i = 0; i < 120; i++) {
    a.update(car, ball, s, 1 / 60, false, i / 60);
    b.update(car, ball, legacy, 1 / 60, false, i / 60);
  }
  assert.ok(
    a.camera.position.distanceTo(b.camera.position) < 1e-8,
    "Midfield placement unchanged",
  );
  assert.ok(
    a.camera.quaternion.angleTo(b.camera.quaternion) < 1e-7,
    "Midfield orientation unchanged",
  );
  // Manual orbit can travel beyond a wall without reducing radius, then returns.
  car.position.set(P.arena.halfWidth - 0.35, 8, 0);
  ball.position.set(0, 1, 0);
  const mouse = new MouseLook(),
    rig = new GameCamera(new PerspectiveCamera(73, 16 / 9));
  rig.mouseLook = mouse;
  mouse.begin();
  mouse.move(220, 60);
  let outside = false,
    movement = 0;
  const last = new Vector3();
  for (let i = 0; i < 360; i++) {
    if (i === 120) mouse.end();
    mouse.update(1 / 60, rig.settings);
    rig.update(car, ball, s, 1 / 60, false, i / 60);
    assert.ok(
      rig.camera.position.distanceTo(car.position) >
        rig.settings.distance * 0.01 * 0.95,
      "Orbit does not collapse at wall",
    );
    outside ||= !insideArena(s.arenaCollider!, rig.camera.position);
    if (i > 0 && i < 120) movement += last.distanceTo(rig.camera.position);
    last.copy(rig.camera.position);
  }
  assert.ok(
    outside && movement > 0.5,
    `Mouse drag changes orbital position outside the shell ${outside} ${movement}`,
  );
  assert.equal(mouse.active, false);
  assert.deepEqual(
    s.world.takeSnapshot(),
    snapshot,
    "Camera queries never modify physics",
  );
  // A genuine solid blocker still shortens the boom; this is not collision-off.
  car.position.set(0, 0.34, 0);
  ball.position.set(0, 1, -14);
  a.reset();
  a.update(car, ball, s, 1 / 60, false, 0);
  const midpoint = a.camera.position.clone().lerp(car.position, 0.5);
  const box = s.world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.6, 2, 0.6).setTranslation(
      midpoint.x,
      midpoint.y,
      midpoint.z,
    ),
  );
  s.world.step();
  assert.equal(cameraCollisionCategory(s, box), "BLOCKING");
  assert.equal(policy.blockers(box), true);
  a.reset();
  a.update(car, ball, s, 1 / 60, false, 0);
  assert.equal(
    a.clearance.blocked,
    true,
    "Solid obstacle remains a camera blocker",
  );
  assert.ok(
    a.camera.position.distanceTo(car.position) <
      a.settings.distance * 0.01 * 0.75,
    "Real obstruction is resolved",
  );
  console.log(
    "PASS 42 boundary/framing/horizon cases at 30/60/144 FPS, outside wall/corner/backboard/ceiling/goal views, exact midfield preservation, wall mouse orbit/return, hard blocker protection and unchanged physics snapshot",
  );
} finally {
  s.dispose();
}
