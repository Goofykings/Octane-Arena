import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three";
import { initializeSimulation, Simulation } from "../src/physics/simulation";
import { neutralInput as n } from "../shared/player";
import { P } from "../src/config/physics";
import { chassisPoints } from "../src/car/chassis";
import { BotController } from "../src/ai/controller";
import { upcomingUpdates } from "../src/config/version";
await initializeSimulation();
const fixture = () => {
  const s = new Simulation(true);
  s.cars[1].body.setEnabled(false);
  s.cars[1].collider.setCollisionGroups(0);
  s.ball.setEnabled(false);
  s.ballCollider.setCollisionGroups(0);
  return s;
};
const tick = (s: Simulation, count: number, input = n()) => {
  for (let i = 0; i < count; i++) s.step([input, n()]);
};
for (const id of ["ion", "vector"] as const)
  for (const direction of [1, -1]) {
    const s = fixture(),
      c = s.cars[0];
    c.setBody(id);
    c.reset(0, 0, 0, 1);
    c.body.setRotation(
      new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI),
      true,
    );
    let peak = 0,
      angle = 0,
      previous = new Quaternion().copy(c.body.rotation()),
      triggers = 0,
      was = false,
      firstTrigger = -1;
    for (let i = 0; i < 600; i++) {
      s.step([{ ...n(), throttle: direction }, n()]);
      if (c.recovering && firstTrigger < 0) firstTrigger = i * P.dt;
      const q = new Quaternion().copy(c.body.rotation());
      angle += q.angleTo(previous);
      previous = q;
      peak = Math.max(peak, new Vector3().copy(c.body.angvel()).length());
      if (c.recovering && !was) triggers++;
      was = c.recovering;
    }
    assert.ok(
      firstTrigger >= 0 && firstTrigger < 0.7,
      "Held aerial throttle starts recovery at roof landing without repress",
    );
    assert.equal(triggers, 1);
    assert.ok(c.up.y > 0.99 && c.contacts >= 3, id + " recovered onto wheels");
    assert.ok(angle < Math.PI * 1.35, "No full-turn overshoot");
    assert.ok(
      peak < P.car.recoveryMaxSpeed + 0.6,
      "Recovery rate remains bounded below the ordinary 6 rad/s cap",
    );
    s.dispose();
  }
// Two supported wheels on a ceiling strip must release under gravity without upright torque.
{
  const s = fixture(),
    c = s.cars[0];
  s.world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.16, 0.2, 3).setTranslation(0.27, 6.2, 0),
  );
  c.reset(0, 0, 0, 5.69);
  c.body.setRotation(
    new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI),
    true,
  );
  let partial = 0;
  for (let i = 0; i < 90; i++) {
    s.step([{ ...n(), throttle: 1 }, n()]);
    if (c.contacts === 2) {
      partial++;
      assert.equal(c.stableContact, false);
      assert.equal(c.adhesionAcceleration.length(), 0);
    }
  }
  assert.ok(partial > 0, "Fixture has real partial ceiling contact");
  assert.ok(c.body.translation().y < 4.5, "Gravity detaches it");
  assert.equal(c.recovering, false);
  s.dispose();
}
for (const yaw of [10, 20, 30]) {
  const s = fixture(),
    c = s.cars[0];
  c.reset(0, 0, 0, 1.8);
  c.body.setRotation(
    new Quaternion().setFromAxisAngle(
      new Vector3(0, 1, 0),
      (yaw * Math.PI) / 180,
    ),
    true,
  );
  c.body.setLinvel({ x: 0, y: -2, z: -18 }, true);
  let touched = false,
    start = 0,
    min = Infinity;
  for (let i = 0; i < 240; i++) {
    const before = new Vector3().copy(c.body.linvel()),
      right = new Vector3(1, 0, 0).applyQuaternion(c.body.rotation()),
      slipBefore = Math.abs(before.dot(right));
    s.step([n(), n()]);
    if (c.contacts >= 2) {
      const slip = Math.abs(new Vector3().copy(c.body.linvel()).dot(right));
      if (!touched) {
        start = slip;
        touched = true;
        assert.ok(
          slip > 18 * Math.sin((yaw * Math.PI) / 180) * 0.65,
          "Landing retains lateral momentum",
        );
      }
      const loss = before.sub(c.body.linvel()).dot(right);
      // RL grip removes a fraction of the slip per tick: smooth, never a snap.
      assert.ok(
        Math.abs(loss) < 0.25 * slipBefore + 0.05,
        "Finite tire correction per step",
      );
      min = Math.min(min, slip);
    }
  }
  assert.ok(
    touched && min < 0.1 && start > 0.5,
    "Slip settles while grip stays strong",
  );
  s.dispose();
}
// Nose-only contacts: deliberate input destabilizes; gentle input adds no artificial upright assist.
// Inputs mirror the game's mapping: steering also drives yaw.
for (const sign of [-1, 1])
  for (const input of [
    { throttle: 1 },
    { throttle: -1 },
    { steer: 1, yaw: 1 },
    { steer: -1, yaw: -1 },
    { throttle: 0.05 },
  ]) {
    const s = fixture(),
      c = s.cars[0];
    const q = new Quaternion().setFromAxisAngle(
      new Vector3(1, 0, 0),
      (sign * Math.PI) / 2,
    );
    const lowest = Math.min(
      ...chassisPoints(c.bodyId).map((p) => p.applyQuaternion(q).y),
    );
    c.reset(0, 0, 0, -lowest + P.car.contactSkin);
    c.body.setRotation(q, true);
    let motion = 0;
    for (let i = 0; i < 240; i++) {
      const wasRecovering = c.recovering;
      s.step([{ ...n(), ...input }, n()]);
      motion = Math.max(
        motion,
        q.angleTo(new Quaternion().copy(c.body.rotation())),
      );
      if (c.recovering && !wasRecovering)
        assert.ok(
          c.up.y < -0.65,
          "Recovery starts only after nose contact falls onto roof",
        );
      if (Math.abs(c.up.y) < 0.5)
        assert.equal(c.adhesionAcceleration.length(), 0);
    }
    assert.ok(
      motion > 0.2,
      "Nose contact cannot be permanently stabilized by held input",
    );
    s.dispose();
  }
function hit(kind: string, disabled = false) {
  const s = fixture(),
    c = s.cars[0];
  s.ball.setEnabled(true);
  s.ballCollider.setCollisionGroups(0xffffffff);
  s.ball.setLinearDamping(0);
  s.ball.setAngularDamping(0);
  s.world.gravity = { x: 0, y: kind === "drive" ? -P.gravity : 0, z: 0 };
  c.reset(0, kind === "drive" ? 1.7 : 1.5, 0, kind === "drive" ? 0.36 : 5);
  if (kind !== "drive")
    c.body.setRotation(
      new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.55),
      true,
    );
  c.body.setLinvel({ x: 0, y: 0, z: kind === "soft" ? -0.6 : -23 }, true);
  s.ball.setTranslation({ x: 0, y: kind === "drive" ? 0.95 : 5.1, z: 0 }, true);
  s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
  if (["front", "diagonal", "late", "side"].includes(kind)) {
    c.jump.used = true;
    c.jump.age = 0.3;
    c.jump.second = true;
    c.jump.flipAge = kind === "late" ? 0.5 : 0.05;
    c.jump.flipLeft = kind === "late" ? 0.15 : 0.6;
    c.jump.direction.set(
      kind === "diagonal" ? 0.707 : 0,
      0,
      kind === "diagonal" ? -0.707 : -1,
    );
  }
  if (["front", "diagonal", "late", "rotating"].includes(kind))
    c.body.setAngvel({ x: -7, y: 0, z: 0 }, true);
  if (kind === "side") {
    c.reset(1.5, 0, 0, 5);
    c.body.setLinvel({ x: -23, y: 0, z: 0 }, true);
    c.body.setAngvel({ x: 0, y: 0, z: 6 }, true);
    c.jump.used = true;
    c.jump.age = 0.3;
    c.jump.second = true;
    c.jump.flipAge = 0.05;
    c.jump.flipLeft = 0.6;
    c.jump.direction.set(0, 0, -1);
  }
  if (kind === "pose") {
    c.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    c.jump.reset();
  }
  void disabled;
  try {
    for (let i = 0; i < 120; i++) {
      const momentum = new Vector3()
        .copy(c.body.linvel())
        .multiplyScalar(c.body.mass())
        .addScaledVector(new Vector3().copy(s.ball.linvel()), s.ball.mass());
      s.step([n(), n()]);
      const contact = s.ballContacts[0];
      if (contact.impactCount) {
        const result = {
          kind,
          speed: 0,
          rotation: contact.rotationalClosing,
          bonus: contact.dodgeImpulse.length(),
          closing: contact.closing,
        };
        if (kind !== "drive") {
          const after = new Vector3()
            .copy(c.body.linvel())
            .multiplyScalar(c.body.mass())
            .addScaledVector(
              new Vector3().copy(s.ball.linvel()),
              s.ball.mass(),
            );
          // Rigid contact conserves momentum; RL's extra impulse is ball-only.
          assert.ok(
            momentum.add(contact.impulse).distanceTo(after) < 0.3,
            "Coupled hit conserves linear momentum plus the RL extra impulse",
          );
        }
        for (let k = 0; k < 12; k++) s.step([n(), n()]);
        result.speed = new Vector3().copy(s.ball.linvel()).length();
        return result;
      }
    }
    throw Error("Missing hit " + kind);
  } finally {
    s.dispose();
  }
}
const drive = hit("drive"),
  front = hit("front"),
  diag = hit("diagonal"),
  pose = hit("pose"),
  late = hit("late"),
  soft = hit("soft"),
  angular = hit("rotating");
assert.ok(
  front.speed > pose.speed * 1.04 && diag.speed > pose.speed * 1.04,
  "Timed flips beat the same pose without rotation (v + ω × r)",
);
assert.ok(
  front.speed > drive.speed,
  "A rotating aerial strike beats a plain drive hit at equal speed",
);
assert.ok(front.rotation > 0.25 && front.bonus === 0);
assert.equal(late.bonus, 0);
assert.equal(
  hit("side").bonus,
  0,
  "Non-leading side contact cannot receive a dodge bonus",
);
assert.equal(angular.bonus, 0);
assert.ok(soft.speed < 1);
assert.ok(upcomingUpdates.every((u) => !/multiplayer/i.test(u.title)));

{
  const s = fixture(),
    c = s.cars[0],
    bot = new BotController("beginner");
  c.reset(0, 0, 0, 1);
  c.body.setRotation(
    new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI),
    true,
  );
  tick(s, 120);
  const target = {
    point: new Vector3(0, 1, -20),
    intent: "chase",
    role: "first",
    aerial: false,
  } as any;
  assert.equal(bot.sample(c, target, s.clock).throttle, 0);
  tick(s, 12);
  const press = bot.sample(c, target, s.clock);
  assert.equal(press.throttle, 1);
  s.step([press, n()]);
  // Fresh intents are held for a decision interval in actual BotTeam; use that same second sample.
  s.step([{ ...n(), throttle: 1 }, n()]);
  assert.ok(
    c.recovering,
    "Bots deliberately recover instead of remaining held on their roof",
  );
  s.dispose();
}


for (const roll of [-1, 1])
  for (const steer of [-1, 1]) {
    const s = fixture(),
      c = s.cars[0];
    c.reset(0, 0, 0, 0.44);
    const q = new Quaternion().setFromAxisAngle(
      new Vector3(0, 0, 1),
      (roll * Math.PI) / 2,
    );
    c.body.setRotation(q, true);
    let applied = false,
      motion = 0;
    for (let i = 0; i < 180; i++) {
      s.step([{ ...n(), steer, yaw: steer }, n()]);
      applied ||= c.chassisContacts > 0 || c.contacts > 0;
      motion = Math.max(
        motion,
        q.angleTo(new Quaternion().copy(c.body.rotation())),
      );
      assert.equal(c.recovering, false);
    }
    assert.ok(
      applied && motion > 0.25,
      "Steering input moves a car resting on its side (no edge hold)",
    );
    s.dispose();
  }
console.log(
  "PASS immediate held-throttle roof recovery, partial ceiling release, finite off-angle tire slip, nose input, coupled leading flip strikes and version text",
  { drive, front, diag, pose, late, soft, angular },
);
