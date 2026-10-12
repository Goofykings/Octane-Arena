import assert from "node:assert/strict";
import { Vector3, Quaternion } from "three";
import { initializeSimulation } from "../src/physics/simulation";
import { DribblePhysics } from "../src/extra/dribble/physics";
import { buildDribbleCourse, dribbleLevels } from "../src/extra/dribble/levels";
import { DribbleFinishGoalView } from "../src/extra/dribble/finish-goal";
import { neutralInput } from "../shared/player";
import { P } from "../src/config/physics";
import { disposeDribbleResources } from "../src/extra/dribble/view";
await initializeSimulation();
const n = neutralInput();
for (const level of dribbleLevels) {
  const p = new DribblePhysics(buildDribbleCourse(level)),
    g = p.finishGoal,
    v = new DribbleFinishGoalView(g);
  const world = (x: number, y: number, z: number) =>
    new Vector3(x, y, z).applyQuaternion(g.rotation).add(g.finish.center);
  try {
    assert.equal(p.goalColliders.length, 3);
    v.group.updateMatrixWorld(true);
    g.parts.forEach((part, i) => {
      const mesh = v.group.getObjectByName(`dribble-goal-${part.name}`)!;
      assert.ok(
        mesh
          .getWorldPosition(new Vector3())
          .distanceTo(p.goalColliders[i].translation()) < 1e-4,
      );
      assert.ok(
        mesh
          .getWorldQuaternion(new Quaternion())
          .angleTo(new Quaternion().copy(p.goalColliders[i].rotation())) <
          0.001,
      );
      assert.equal(
        p.goalColliders[i].shapeType(),
        p.goalColliders[0].shapeType(),
      );
    });
    g.reset();
    assert.equal(
      g.crossed(world(0, 3, 1), world(0, 3, -0.2), P.ball.radius),
      true,
      "First partial-sphere overlap immediately succeeds",
    );
    assert.equal(
      g.crossed(world(0, 3, -0.2), world(0, 3, -1.1), P.ball.radius),
      false,
      "Completion is emitted once per attempt",
    );
    for (const [x, y] of [
      [g.finish.width / 2 + 0.5, 3],
      [0, g.finish.height + 1],
    ]) {
      g.reset();
      assert.equal(
        g.crossed(world(x, y, 2), world(x, y, -2), P.ball.radius),
        false,
      );
    }
    g.reset();
    assert.equal(
      g.crossed(
        world(g.finish.width / 2 + 2, 3, 2),
        world(g.finish.width / 2 + 2, 3, -2),
        P.ball.radius,
      ),
      false,
    );
    assert.equal(
      g.crossed(
        world(g.finish.width / 2 + 2, 3, -2),
        world(0, 3, -3),
        P.ball.radius,
      ),
      false,
      "Going around a post behind goal never completes",
    );
    g.reset();
    assert.equal(
      g.crossed(world(0, 3, -2), world(0, 3, 2), P.ball.radius),
      true,
      "Valid volume overlap does not depend on velocity direction",
    );
    for (const y of [0.2, -0.5, -P.ball.radius - 0.2]) {
      g.reset();
      assert.equal(
        g.crossed(world(0, y, 2), world(0, y, -0.2), P.ball.radius),
        true,
        "Low/partly below-floor sphere overlaps count",
      );
    }
    g.reset();
    assert.equal(
      g.crossed(world(0, -0.1, 2), world(0, -0.8, -0.2), P.ball.radius),
      true,
      "Falling-through-floor swept overlap counts",
    );
    g.reset();
    const grazing = P.ball.radius + g.radius - 0.01;
    assert.equal(
      g.crossed(world(0, 2, grazing), world(0, 2, grazing), P.ball.radius),
      true,
      "Stationary partial cap in the trigger counts without centre-plane crossing",
    );
    g.reset();
    assert.equal(
      g.crossed(
        world(0, -2 * P.ball.radius - 0.1, 2),
        world(0, -2 * P.ball.radius - 0.1, -2),
        P.ball.radius,
      ),
      false,
    );
    // Real falling ball on the ball-permeable finish road, for every orientation.
    p.reset();
    p.ball.setTranslation(world(0, -0.5, 1.5), true);
    p.ball.setLinvel(new Vector3(0, -4, -10).applyQuaternion(g.rotation), true);
    for (let i = 0; i < 20 && !p.finished(); i++) p.step(n);
    assert.equal(
      p.finished(),
      true,
      `Level ${level.id}: low falling ball scores physically`,
    );
    assert.ok(g.local(new Vector3().copy(p.ball.translation())).y < 0);
    for (let i = 0; i < 20; i++) p.step(n);
    assert.equal(p.finished(), true, "Later falling cannot revoke completion");
    p.world.gravity = { x: 0, y: 0, z: 0 };
    p.car.body.setEnabled(false);
    p.ball.setLinearDamping(0);
    for (const part of g.parts) {
      p.reset();
      p.car.body.setEnabled(false);
      p.ball.setTranslation(
        world(part.center.x, part.name === "crossbar" ? part.center.y : 3, 2),
        true,
      );
      p.ball.setLinvel(
        new Vector3(0, 0, -12).applyQuaternion(g.rotation),
        true,
      );
      p.ball.setAngvel({ x: 0, y: 4, z: 0 }, true);
      let bounce = false;
      for (let i = 0; i < 40; i++) {
        p.step(n);
        assert.equal(p.finished(), false, "Frame impact alone must not finish");
        if (
          new Vector3()
            .copy(p.ball.linvel())
            .applyQuaternion(g.rotation.clone().invert()).z > 1
        ) {
          bounce = true;
          break;
        }
      }
      assert.ok(bounce, `Level ${level.id} ${part.name}: actual sphere bounce`);
    }
    // A real chassis collision, separate from any ball/contact assistance.
    p.reset();
    p.ball.setEnabled(false);
    p.car.body.setEnabled(true);
    const part = g.parts[0],
      start = world(part.center.x, 3, 3);
    p.car.reset(start.x, start.z, -g.finish.heading, start.y);
    p.car.body.setLinvel(
      new Vector3(0, 0, -10).applyQuaternion(g.rotation),
      true,
    );
    let touched = false;
    for (let i = 0; i < 80; i++) {
      p.step(n);
      p.world.contactPair(p.car.collider, p.goalColliders[0], (m) => {
        if (m.numContacts()) touched = true;
      });
    }
    assert.ok(touched, `Level ${level.id}: chassis collides with post`);
    assert.ok(
      g.local(new Vector3().copy(p.car.body.translation())).z > -0.4,
      "Chassis cannot tunnel through post",
    );
    v.update(false, 0.1);
    assert.equal(
      v.material.color.getHex(),
      0xc4e5e7,
      "Post hit doesn't turn goal green",
    );
    v.update(true, P.dt);
    assert.equal(
      v.material.color.getHex(),
      0x56ff91,
      "Green feedback starts immediately",
    );
    for (let i = 0; i < 30; i++) v.update(true, 1 / 60);
    assert.ok(
      v.material.color.g > 0.95 &&
        v.material.color.g > v.material.color.r * 2 &&
        v.material.emissiveIntensity > 0.7,
    );
    assert.ok(v.gridMaterial.color.g > v.gridMaterial.color.r * 2);
    v.reset();
    assert.equal(v.material.color.getHex(), 0xc4e5e7);
    assert.equal(v.gridMaterial.color.getHex(), 0xffffff);
  } finally {
    disposeDribbleResources(v.group);
    p.dispose();
  }
}
console.log(
  "PASS all 20 oriented goals: matching physical frames, low/falling/partial swept sphere overlaps, stationary/reverse contacts, outside/over rejects, persistent one-shot success and immediate green/reset",
);
