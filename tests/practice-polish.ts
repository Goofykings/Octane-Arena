import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import { Scene, Vector3, Quaternion, Matrix4 } from "three";
import { Simulation } from "../src/physics/simulation";
import { Match } from "../src/game/match";
import { trainingAction } from "../src/game/training";
import { freeplayKickoffs, kickoffSpawn } from "../shared/kickoff";
import { neutralInput } from "../shared/player";
import { P } from "../src/config/physics";
import { JumpBurst } from "../src/effects/jump-burst";
import { FlipTrails } from "../src/effects/motion-trails";
import { carModel, animateWheels, disposeModel } from "../src/render/models";
import { goalShell } from "../src/arena/geometry";

await RAPIER.init();
const n = neutralInput(),
  camera = new Vector3(0, 4, 6),
  s = new Simulation(),
  c = s.cars[0],
  m = new Match();
m.start(s, "freeplay");
for (let i = 0; i < 16; i++) {
  const formation = freeplayKickoffs[i % freeplayKickoffs.length],
    p = kickoffSpawn(formation.slots[0], 0, P.arena);
  assert.equal(m.kickoffFormationId, formation.id);
  assert.ok(
    Math.abs(c.body.translation().x - p.x) < 1e-5 &&
      Math.abs(c.body.translation().z - p.z) < 1e-5,
  );
  assert.equal(m.phase, "playing");
  assert.equal(m.countdown, 0);
  assert.deepEqual({ ...c.body.linvel() }, { x: 0, y: 0, z: 0 });
  assert.deepEqual({ ...s.ball.angvel() }, { x: 0, y: 0, z: 0 });
  assert.equal(c.boost, 100);
  assert.equal(s.cars[1].body.isEnabled(), false);
  s.ball.setTranslation({ x: 0, y: 1, z: -53 }, true);
  m.tick(s);
  assert.equal(m.phase, "goal");
  assert.ok(m.goalFocus);
  for (let t = 0; t < (i % 3) * 60; t++) m.tick(s);
  assert.ok(trainingAction("trainingReset", m, s));
  assert.equal(m.freeze, 0);
  assert.equal(m.goalFocus, null);
  assert.equal(m.lastGoal, null);
  assert.equal(m.message, "");
  assert.equal(m.goTime, 0);
  assert.deepEqual({ ...s.ball.linvel() }, { x: 0, y: 0, z: 0 });
}
m.start(s, "bot");
assert.equal(trainingAction("trainingReset", m, s), false);
console.log(
  "PASS 16 Free Play goal-phase resets cycle shared positions, clear goal timers/camera focus, preserve boost/no countdown; bot reset rejected",
);
s.ball.setEnabled(false);
s.ballCollider.setCollisionGroups(0);
s.cars[1].body.setEnabled(false);
s.cars[1].collider.setCollisionGroups(0);
const burst = new JumpBurst(new Scene());
const tick = (input = n) => {
  s.step([input, n]);
  burst.update(c, P.dt, true, camera);
};
c.reset(0, 0, 0);
for (let i = 0; i < 60; i++) tick();
tick({ ...n, jump: true });
assert.equal(burst.triggers, 1);
assert.ok(burst.ring.visible);
assert.ok(burst.ring.position.y < c.body.translation().y);
for (let i = 0; i < 30; i++) tick({ ...n, jump: true });
assert.equal(burst.triggers, 1);
assert.equal(burst.ring.visible, false);
tick();
tick({ ...n, jump: true, dodgeY: 1 });
assert.equal(burst.triggers, 1);
c.reset(0, 0, 0, 8);
burst.reset();
for (let i = 0; i < 20; i++) tick({ ...n, roll: 1, pitch: 1 });
assert.equal(burst.triggers, 1);
const up = new Vector3(-1, 0, 0),
  forward = new Vector3(0, 1, 0);
c.reset(P.arena.halfWidth - P.car.contactHeight, 0, 0, 7);
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
c.body.setLinvel({ x: 0, y: 5, z: 0 }, true);
burst.reset();
for (let i = 0; i < 8; i++) tick({ ...n, throttle: 1 });
assert.ok(c.grounded);
tick({ ...n, jump: true, throttle: 1 });
assert.equal(burst.triggers, 2);
const effectNormal = new Vector3(0, 0, 1).applyQuaternion(
  burst.ring.quaternion,
);
assert.ok(effectNormal.dot(up) > 0.99 && c.normalJumpNormal.dot(up) > 0.99);
c.reset(P.arena.halfWidth - P.car.contactHeight, 0, 0, 7);
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
c.body.setLinvel({ x: 0, y: 5, z: 0 }, true);
burst.reset();
for (let i = 0; i < 8; i++) tick({ ...n, throttle: 1 });
assert.ok(c.grounded);
c.body.setLinvel({ x: -8, y: 0, z: 0 }, true);
for (let i = 0; i < 60; i++) tick();
assert.equal(c.normalJumpSequence, 0);
assert.equal(
  burst.triggers,
  2,
  "leaving/falling off a wall triggers jump visual",
);
console.log(
  "PASS one burst per actual normal jump; no fall/air rotation/flip false trigger; wall burst points away from wall",
);
for (const id of ["ion", "vector"] as const)
  for (const [x, y] of [
    [0, 1],
    [0, -1],
    [1, 0],
    [1, 1],
  ]) {
    c.setBody(id);
    c.reset(0, 0, 0, 8);
    s.step([{ ...n, jump: true, dodgeX: x, dodgeY: y }, n]);
    const model = carModel(0xffffff, id),
      trails = new FlipTrails(new Scene());
    model.position.copy(c.body.translation());
    model.quaternion.copy(c.body.rotation());
    animateWheels(model, c.forwardSpeed, c.steerAngle, P.dt, c, model);
    const velocity = { ...c.body.linvel() },
      angular = { ...c.body.angvel() };
    trails.updateCar(c, model, P.dt, true, camera);
    const mounts = model.userData.wheelMounts;
    for (let i = 0; i < 4; i++)
      assert.ok(
        trails.tracks[i][0].point.distanceTo(
          mounts[i].position
            .clone()
            .applyQuaternion(model.quaternion)
            .add(model.position),
        ) < 1e-8,
      );
    assert.deepEqual({ ...c.body.linvel() }, velocity);
    assert.deepEqual({ ...c.body.angvel() }, angular);
    disposeModel(model);
  }
console.log(
  "PASS all four flip directions attach to actual wheel centers for both bodies without changing physics",
);
for (const sign of [-1, 1]) {
  const mesh = goalShell(sign),
    v = mesh.vertices;
  // At the post edge the floor fillet collapses to floor, rather than leaving
  // a constant-height vertical pocket between the post and surrounding ramp.
  for (const side of [-1, 1]) {
    let bottom = 0;
    for (let i = 0; i < v.length; i += 3)
      if (
        Math.abs(v[i] - side * P.arena.goalHalf) < 1e-5 &&
        Math.abs(v[i + 2] - sign * P.arena.halfLength) < 1e-5 &&
        v[i + 1] < P.arena.ramp - 0.001
      ) {
        assert.ok(v[i + 1] < 1e-5, "old post-base pocket remains");
        bottom++;
      }
    assert.ok(bottom > 0);
  }
}
console.log(
  "PASS front post shoulders taper to a clean floor mouth, shared render/collision geometry",
);
s.dispose();
