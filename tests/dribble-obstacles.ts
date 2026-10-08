import assert from "node:assert/strict";
import { Vector3, Quaternion } from "three";
import { initializeSimulation } from "../src/physics/simulation";
import { DribblePhysics } from "../src/extra/dribble/physics";
import { buildDribbleCourse, dribbleLevels } from "../src/extra/dribble/levels";
import { DribbleView } from "../src/extra/dribble/view";
import { bodies } from "../shared/catalog";
import { neutralInput } from "../shared/player";
import { P } from "../src/config/physics";
await initializeSimulation();
const n = neutralInput();
const turns = (id: number) =>
  dribbleLevels[id - 1].pieces
    .filter((p) => p.kind === "turn")
    .map((p) => p.degrees);
assert.deepEqual(turns(1), []);
assert.deepEqual(turns(2), []);
assert.ok(dribbleLevels[0].width > dribbleLevels[1].width);
assert.ok(
  buildDribbleCourse(dribbleLevels[1]).nodes.at(-1)!.distance >
    buildDribbleCourse(dribbleLevels[0]).nodes.at(-1)!.distance,
);
assert.deepEqual(turns(3), [90]);
assert.deepEqual(turns(4), [90, -90]);
assert.deepEqual(turns(5), [-180]);
assert.deepEqual(turns(8), [90, -90]);
assert.equal(buildDribbleCourse(dribbleLevels[5]).obstacles.length, 1);
assert.equal(buildDribbleCourse(dribbleLevels[6]).obstacles.length, 2);
assert.equal(buildDribbleCourse(dribbleLevels[7]).obstacles.length, 2);
const largeGap = dribbleLevels[9].pieces.find((p) => p.kind === "gap")!;
assert.equal(largeGap.kind, "gap");
if (largeGap.kind === "gap")
  assert.ok(
    largeGap.length >= 3 * 2 * bodies.ion.halfLength &&
      largeGap.length <= 4 * 2 * bodies.ion.halfLength,
  );
assert.ok(
  dribbleLevels[10].pieces.some((p) => p.kind === "gap") &&
    turns(11).length === 2,
);
let walls = 0;
for (const level of dribbleLevels.slice(0, 11))
  for (const obstacle of buildDribbleCourse(level).obstacles) {
    if (obstacle.piece.kind !== "wall") continue;
    for (const bodyId of ["ion", "vector"] as const) {
      const p = new DribblePhysics(buildDribbleCourse(level), bodyId);
      try {
        const dir = new Vector3(
          Math.sin(obstacle.heading),
          0,
          -Math.cos(obstacle.heading),
        );
        const pos = obstacle.center.clone().addScaledVector(dir, -3);
        const d = bodies[bodyId];
        p.car.reset(pos.x, pos.z, -obstacle.heading, pos.y + 0.34);
        p.ball.setTranslation(
          {
            x: pos.x,
            y: pos.y + 0.34 + d.hitboxY + d.halfHeight + P.ball.radius + 0.03,
            z: pos.z,
          },
          true,
        );
        for (let i = 0; i < 120; i++) p.step(n);
        p.car.body.setLinvel(dir.clone().multiplyScalar(6), true);
        p.ball.setLinvel(dir.clone().multiplyScalar(6), true);
        for (let i = 0; i < 240; i++) {
          p.step({ ...n, jump: i < 24, throttle: 0.05 });
          assert.equal(
            p.failed(),
            null,
            `Level ${level.id} ${bodyId}: single long jump must carry ball over wall`,
          );
        }
        assert.ok(
          new Vector3()
            .copy(p.car.body.translation())
            .sub(obstacle.center)
            .dot(dir) > 3,
          "Car cleared wall and landed beyond it",
        );
        assert.ok(
          Math.hypot(
            p.ball.translation().x - p.car.body.translation().x,
            p.ball.translation().z - p.car.body.translation().z,
          ) < 1.6,
          "Ball still carried after wall landing",
        );
        assert.ok(
          p.car.grounded,
          "Long jump lands without boost or second jump",
        );
        walls++;
      } finally {
        p.dispose();
      }
    }
  }
const course = buildDribbleCourse(dribbleLevels[8]),
  obstacle = course.obstacles[0];
assert.equal(obstacle.piece.kind, "spinner");
if (obstacle.piece.kind === "spinner") {
  const p = new DribblePhysics(course),
    view = new DribbleView(course);
  try {
    p.ball.setEnabled(false);
    for (let i = 0; i < 120; i++) p.step(n);
    const expected = new Quaternion().setFromAxisAngle(
      new Vector3(0, 0, 1),
      obstacle.piece.angularSpeed,
    );
    assert.ok(
      new Quaternion().copy(p.spinners[0].body.rotation()).angleTo(expected) <
        0.00001,
      "Kinematic rotation follows configurable fixed-step clock",
    );
    assert.equal(view.spinners[0].mesh.children.length, 2);
    assert.equal(p.spinners[0].body.numColliders(), 2);
    for (let i = 0; i < 2; i++) {
      const mesh = view.spinners[0].mesh.children[i] as import("three").Mesh;
      const extent = (
        p.spinners[0].body.collider(i)
          .shape as import("@dimforge/rapier3d-compat").Cuboid
      ).halfExtents;
      const bounds = new Vector3();
      mesh.geometry.computeBoundingBox();
      mesh.geometry.boundingBox!.getSize(bounds);
      assert.ok(
        bounds.distanceTo(
          new Vector3(extent.x * 2, extent.y * 2, extent.z * 2),
        ) < 0.00001,
        "Art/collider dimensions match",
      );
    }
    for (const [name, rotation, height] of [
      ["nose", new Quaternion(), 2.6],
      [
        "roof",
        new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2),
        2.6,
      ],
      [
        "wheels",
        new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2),
        2.6,
      ],
    ] as const) {
      p.reset();
      p.ball.setEnabled(false);
      p.car.reset(0, obstacle.center.z + 3, 0, obstacle.center.y + height);
      p.car.body.setRotation(rotation, true);
      p.car.body.setLinvel({ x: 0, y: 0, z: -23 }, true);
      let contact = false;
      for (let i = 0; i < 45; i++) {
        p.step(n);
        for (let j = 0; j < 2; j++)
          p.world.contactPair(
            p.car.collider,
            p.spinners[0].body.collider(j),
            (m) => {
              if (m.numSolverContacts()) contact = true;
            },
          );
        if (p.car.body.translation().z < obstacle.center.z - 1)
          assert.ok(contact, `${name}: no tunneling through rotating arm`);
      }
      assert.ok(contact, `${name}: actual rotating arm contact generated`);
      assert.ok(
        new Vector3().copy(p.car.body.linvel()).length() <=
          P.car.maxSpeed + 0.01,
      );
    }
    p.reset();
    p.car.body.setEnabled(false);
    p.ball.setEnabled(true);
    p.ball.setTranslation(
      { x: 0, y: obstacle.center.y + 2.6, z: obstacle.center.z + 3 },
      true,
    );
    p.ball.setLinvel({ x: 0, y: 0, z: -60 }, true);
    let touched = false;
    for (let i = 0; i < 25; i++) {
      p.step(n);
      for (let j = 0; j < 2; j++)
        p.world.contactPair(
          p.ballCollider,
          p.spinners[0].body.collider(j),
          (m) => {
            if (m.numSolverContacts()) touched = true;
          },
        );
      assert.ok(
        p.ball.translation().z > obstacle.center.z,
        "60m/s ball does not tunnel through plus",
      );
    }
    assert.ok(touched);
    // A visible side opening can be driven through while carrying a ball.
    for (const bodyId of ["ion", "vector"] as const) {
      p.car.body.setEnabled(true);
      p.car.setBody(bodyId);
      p.reset();
      const x = 1.75,
        z = obstacle.center.z + 2.8,
        d = bodies[bodyId];
      p.car.reset(x, z, 0, obstacle.center.y + 0.34);
      p.ball.setTranslation(
        {
          x,
          y:
            obstacle.center.y +
            0.34 +
            d.hitboxY +
            d.halfHeight +
            P.ball.radius +
            0.03,
          z,
        },
        true,
      );
      // Settle with the spinner parked at its opening, then run it normally.
      for (let i = 0; i < 120; i++) {
        p.obstacleTime = 0.4 / obstacle.piece.angularSpeed - P.dt;
        p.step(n);
      }
      p.obstacleTime = 0.4 / obstacle.piece.angularSpeed;
      p.car.body.setLinvel({ x: 0, y: 0, z: -7 }, true);
      p.ball.setLinvel({ x: 0, y: 0, z: -7 }, true);
      for (let i = 0; i < 150; i++) {
        p.step({ ...n, throttle: 0.05 });
        assert.equal(
          p.failed(),
          null,
          "Car and ball can pass through timed opening",
        );
      }
      assert.ok(p.car.body.translation().z < obstacle.center.z - 2);
      assert.ok(p.ball.translation().z < obstacle.center.z - 2);
    }
  } finally {
    view.dispose();
    p.dispose();
  }
}
console.log(
  `PASS exact early layouts, ${walls} both-body single-jump wall carries, 3–4-length gap, kinematic/art sync, real nose/roof/wheel/60m/s ball spinner collisions and timed ball-carry passage`,
);
