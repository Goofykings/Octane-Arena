import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three";
import { Simulation } from "../src/physics/simulation";
import { goalCeilingHeight } from "../src/arena/goal";
import { P } from "../src/config/physics";
import { neutralInput } from "../shared/player";

await RAPIER.init();
const n = neutralInput(),
  a = P.arena;
const records: unknown[] = [];
let impacts = 0;
const s = new Simulation();
s.cars.forEach((c) => {
  c.body.setEnabled(false);
  c.collider.setCollisionGroups(0);
});
s.ball.setGravityScale(0, true);
const energy = () => {
  const v = new Vector3().copy(s.ball.linvel()),
    w = new Vector3().copy(s.ball.angvel());
  return (
    0.5 * P.ball.mass * v.lengthSq() +
    0.2 * P.ball.mass * P.ball.radius ** 2 * w.lengthSq()
  );
};
function impact(sign: number, kind: string, p: Vector3, velocity: Vector3) {
  s.ball.setTranslation(p, true);
  s.ball.setLinvel(velocity, true);
  s.ball.setAngvel({ x: 0.7, y: -0.4, z: 0.3 }, true);
  const initialEnergy = energy();
  const hit = s.world.castShape(
    p,
    new Quaternion(),
    velocity,
    new RAPIER.Ball(P.ball.radius),
    0,
    2,
    false,
    undefined,
    undefined,
    undefined,
    undefined,
    (col) => col.parent() === null,
  );
  assert.ok(hit, `no sphere sweep contact for ${kind}`);
  const normal = new Vector3().copy(hit.normal1).normalize();
  let result: Vector3 | undefined;
  for (let i = 0; i < 160; i++) {
    const before = new Vector3().copy(s.ball.linvel());
    s.world.step();
    const v = new Vector3().copy(s.ball.linvel());
    if (v.distanceTo(before) > velocity.length() * 0.02) {
      result = v;
      assert.ok(energy() <= initialEnergy * 1.01, `energy added: ${kind}`);
      assert.ok(
        v.dot(normal) > 0,
        `rebound must leave actual contact surface: ${kind}`,
      );
      assert.ok(
        new Vector3().copy(s.ball.angvel()).length() > 0.01,
        "spin erased",
      );
      break;
    }
  }
  assert.ok(result, `missed ${kind} ${sign} ${velocity.toArray()}`);
  impacts++;
  return result;
}
// The post/bar are now convex rounded entrance regions of one shell. Test
// their actual contact normals, including field joins and glancing angles.
for (const sign of [-1, 1])
  for (const speed of [8, 25, 60])
    for (const side of [0, -1, 1])
      for (let step = 1; step <= 20; step++) {
        const t = ((step / 21) * Math.PI) / 2,
          l = a.goalLip;
        const depth = l * (1 - Math.cos(t));
        const point =
          side === 0
            ? new Vector3(
                0,
                goalCeilingHeight(depth),
                sign * (a.halfLength + depth),
              )
            : new Vector3(
                side * (a.goalHalf + l - l * Math.sin(t)),
                3,
                sign * (a.halfLength + depth),
              );
        const normal =
          side === 0
            ? new Vector3(
                0,
                -Math.sin(t),
                -sign *
                  (Math.cos(t) + (a.goalRoofDrop / a.goalDepth) * Math.sin(t)),
              ).normalize()
            : new Vector3(-side * Math.sin(t), 0, -sign * Math.cos(t));
        const tangent = new Vector3()
          .crossVectors(
            normal,
            side === 0 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0),
          )
          .normalize();
        for (const glance of [0, 0.2]) {
          const velocity = normal
            .clone()
            .negate()
            .addScaledVector(tangent, glance)
            .normalize()
            .multiplyScalar(speed);
          const v = impact(
            sign,
            side === 0 ? "integrated crossbar" : "integrated post",
            point.clone().addScaledVector(normal, P.ball.radius + 0.5),
            velocity,
          );
          assert.ok(
            v.length() <= speed * 1.01,
            "rounded entrance cannot add rebound energy",
          );
          if (glance === 0)
            assert.ok(
              v.dot(normal) > speed * 0.25 && v.dot(normal) < speed * 0.65,
              "normal-aligned entrance hit must retain normal restitution",
            );
        }
      }
s.dispose();
console.log(
  `PASS ${impacts} integrated post/crossbar impacts: normal/glancing angle sweeps; restitution/spin/energy`,
);

function flip(
  dodgeX: number,
  dodgeY: number,
  cancelAt = Infinity,
  cancelPitch = -Math.sign(dodgeY),
) {
  const sim = new Simulation(true),
    c = sim.cars[0];
  sim.ball.setEnabled(false);
  sim.ballCollider.setCollisionGroups(0);
  sim.cars[1].body.setEnabled(false);
  sim.cars[1].collider.setCollisionGroups(0);
  c.reset(0, 0, 0, 30);
  sim.step([{ ...n, jump: true, dodgeX, dodgeY }, n]);
  const impulse = new Vector3().copy(c.body.linvel());
  const directionLength = Math.hypot(dodgeX, dodgeY);
  const expectedImpulse =
    P.jump.dodgeImpulse *
    Math.hypot(
      dodgeX / directionLength,
      (dodgeY / directionLength) * (dodgeY < 0 ? 16 / 15 : 1),
    );
  assert.ok(
    Math.abs(Math.hypot(impulse.x, impulse.z) - expectedImpulse) < 0.02,
    "dodge impulse changed",
  );
  const samples: {
    t: number;
    pitch: number;
    roll: number;
    torque: number;
    locked: boolean;
  }[] = [];
  for (let i = 0; i < 180; i++) {
    const t = (i + 1) * P.dt,
      input = t >= cancelAt ? cancelPitch : 0;
    const axis = new Vector3(1, 0, 0).applyQuaternion(
      new Quaternion().copy(c.body.rotation()),
    );
    const before = new Vector3().copy(c.body.angvel()).dot(axis);
    sim.step([{ ...n, pitch: input }, n]);
    const w = new Vector3().copy(c.body.angvel());
    const pitch = w.dot(
      new Vector3(1, 0, 0).applyQuaternion(
        new Quaternion().copy(c.body.rotation()),
      ),
    );
    const roll = w.dot(
      new Vector3(0, 0, -1).applyQuaternion(
        new Quaternion().copy(c.body.rotation()),
      ),
    );
    if (input && c.jump.flipLeft > 0 && dodgeY) {
      assert.equal(
        Math.abs(c.flipPitchAcceleration),
        0,
        "opposite pitch should cancel flip torque, not reverse it",
      );
      if (!dodgeX) {
        assert.ok(
          pitch * before > 0,
          "cancel instantly deleted/reversed momentum",
        );
        assert.ok(
          Math.abs(pitch) >= Math.abs(before) * 0.94,
          "one-frame cancel discontinuity",
        );
      }
    }
    if (input && c.pitchLocked && dodgeY)
      assert.ok(pitch * dodgeY <= 0.001, "reverse pitch during lock");
    if (i % 6 === 0)
      samples.push({
        t: c.jump.flipAge,
        pitch,
        roll,
        torque: c.flipPitchAcceleration,
        locked: c.pitchLocked,
      });
  }
  assert.equal(c.jump.flipLeft, 0);
  if (dodgeY && cancelAt < Infinity)
    assert.ok(
      samples.at(-1)!.pitch * dodgeY > 1,
      "aerial reverse pitch never returned",
    );
  if (dodgeX)
    assert.ok(
      samples.some((v) => Math.abs(v.roll) > 3),
      "roll component destroyed",
    );
  records.push({ dodgeX, dodgeY, cancelAt: String(cancelAt), samples });
  sim.dispose();
  return samples;
}
const normal = flip(0, 1),
  immediate = flip(0, 1, P.dt),
  later = flip(0, 1, 0.1);
assert.ok(Math.abs(normal[3].pitch) > 6.9, "normal forward flip changed");
assert.ok(
  Math.abs(immediate[3].pitch) > 0.5 &&
    Math.abs(immediate[3].pitch) < Math.abs(normal[3].pitch),
  "cancel should decelerate while retaining rotation",
);
assert.ok(
  Math.abs(later[3].pitch) > Math.abs(immediate[3].pitch) + 1,
  "cancel timing has no effect",
);
flip(0, -1);
flip(0, -1, P.dt, 1);
flip(1, 0);
flip(1, 1);
flip(1, 1, 0.1);
console.log(
  "PASS front/back/side/diagonal flips, immediate/delayed cancel, continuous momentum, pitch lock, restored aerial pitch, dodge impulse",
);
console.log(
  "FLIP TIMING",
  JSON.stringify({
    activeTorque: P.jump.flipTime,
    lockExtra: P.jump.pitchLockExtra,
    controlReturn: P.jump.controlReturn,
    cancelDamping: P.jump.cancelDamping,
  }),
);
console.log("FLIP TRACE", JSON.stringify(records));
