import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three";
import { Simulation } from "../src/physics/simulation";
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
  let result: Vector3 | undefined;
  for (let i = 0; i < 160; i++) {
    const before = new Vector3().copy(s.ball.linvel());
    s.world.step();
    const v = new Vector3().copy(s.ball.linvel());
    if (v.distanceTo(before) > velocity.length() * 0.02) {
      result = v;
      assert.ok(energy() <= initialEnergy * 1.01, `energy added: ${kind}`);
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
for (const sign of [-1, 1])
  for (const speed of [8, 25, 60]) {
    for (const offset of [-0.15, 0, 0.15, 0.35, 0.7]) {
      const v = impact(
        sign,
        "front",
        new Vector3(
          0,
          a.goalHeight + a.postRadius + offset,
          sign * (a.halfLength - 3),
        ),
        new Vector3(0, 0, sign * speed),
      );
      assert.ok(
        Math.abs(v.y) < speed * 0.1,
        `front launch: ${offset}/${speed}: ${v.y}`,
      );
      assert.ok(
        Math.abs(v.z) > speed * 0.3 && Math.abs(v.z) < speed * 0.6,
        "front restitution changed",
      );
    }
    for (const offset of [-0.3, -0.5, -0.7]) {
      const v = impact(
        sign,
        "lower edge",
        new Vector3(
          0,
          a.goalHeight + a.postRadius + offset,
          sign * (a.halfLength - 3),
        ),
        new Vector3(0, 0, sign * speed),
      );
      assert.ok(v.y < -speed * 0.02, `lower edge must deflect down: ${v.y}`);
    }
    for (const slope of [-0.15, 0.15])
      for (const sideSpeed of [-0.1, 0.1]) {
        const v = impact(
          sign,
          "angled front",
          new Vector3(
            -sideSpeed * 2,
            a.goalHeight + a.postRadius + 0.35 - slope * 2,
            sign * (a.halfLength - 3),
          ),
          new Vector3(sideSpeed * speed, slope * speed, sign * speed),
        );
        assert.ok(
          v.z * sign < -speed * 0.25,
          "angled front must rebound toward field",
        );
        assert.ok(
          Math.abs(v.y) < (Math.abs(slope) + 0.1) * speed,
          "angled front added an upward launch",
        );
      }
    const under = impact(
      sign,
      "under",
      new Vector3(
        0,
        a.goalHeight - P.ball.radius - 0.5,
        sign * (a.halfLength + a.postRadius),
      ),
      new Vector3(0, speed, 0),
    );
    assert.ok(under.y < -speed * 0.3, "underside rebound should be downward");
    // Fine adjacent sampling verifies a smooth, physical lower-edge transition.
    let previous: Vector3 | undefined;
    for (let y = a.goalHeight - 0.55; y <= a.goalHeight + 0.1; y += 0.025) {
      const v = impact(
        sign,
        "edge sweep",
        new Vector3(0, y, sign * (a.halfLength - 3)),
        new Vector3(0, 0, sign * speed),
      );
      if (previous)
        assert.ok(
          v.distanceTo(previous) < speed * 0.16,
          "discontinuous edge rebound",
        );
      previous = v;
    }
  }
// The top of the beam is embedded in the solid fascia. Test its actual rounded
// shape in isolation to approach it from above without starting in solid arena.
for (const sign of [-1, 1]) {
  s.world.forEachCollider((col) => {
    if (col.parent()) return;
    const p = col.translation();
    col.setEnabled(
      Math.abs(p.z - sign * (a.halfLength + a.postRadius + a.crossbarBevel)) <
        0.001 && Math.abs(p.y - a.goalHeight - a.postRadius) < 0.001,
    );
  });
  for (const speed of [8, 25, 60]) {
    const above = impact(
      sign,
      "above",
      new Vector3(
        0,
        a.goalHeight + 2 * a.postRadius + P.ball.radius + 0.5,
        sign * (a.halfLength + a.postRadius),
      ),
      new Vector3(0, -speed, 0),
    );
    assert.ok(above.y > speed * 0.3, "physical top rebound should be upward");
  }
}
s.dispose();
console.log(
  `PASS ${impacts} crossbar impacts: front, underside, lower edge, top, smooth angle sweep; restitution/spin/energy`,
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
