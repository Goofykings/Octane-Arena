import assert from "node:assert/strict";
import { Vector3, Quaternion, Scene } from "three";
import { initializeSimulation, Simulation } from "../src/physics/simulation";
import { JumpState } from "../src/car/dodge";
import { P } from "../src/config/physics";
import { bodies } from "../shared/catalog";
import { neutralInput } from "../shared/player";
import { Input } from "../src/input/input";
import { defaultBindings } from "../shared/controls";
import { FlipResetBurst } from "../src/effects/flip-reset";
await initializeSimulation();
const n = neutralInput();
for (const id of ["ion", "vector"] as const) {
  const s = new Simulation(true),
    c = s.cars[0],
    d = bodies[id];
  s.cars[1].body.setEnabled(false);
  s.world.gravity = { x: 0, y: 0, z: 0 };
  c.setBody(id);
  const contact = (side: "bottom" | "roof" | "side" | "nose") => {
    c.reset(0, 0, 0, 6);
    c.jump.used = true;
    c.jump.second = true;
    c.jump.age = 10;
    const offset =
      side === "bottom"
        ? new Vector3(0, d.hitboxY - d.halfHeight - P.ball.radius + 0.025, 0)
        : side === "roof"
          ? new Vector3(0, d.hitboxY + d.halfHeight + P.ball.radius - 0.025, 0)
          : side === "side"
            ? new Vector3(d.halfWidth + P.ball.radius - 0.025, d.hitboxY, 0)
            : new Vector3(
                0,
                -0.065 + d.hitboxY,
                -d.halfLength - P.ball.radius + 0.025,
              );
    s.ball.setTranslation(offset.add(c.body.translation()), true);
    s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    s.ballContacts[0].reset();
    s.step([n, n]);
  };
  try {
    for (const face of ["roof", "side", "nose"] as const) {
      contact(face);
      assert.equal(c.flipResetSequence, 0, `${id} ${face}: no reset`);
    }
    contact("bottom");
    assert.equal(c.flipResetSequence, 1);
    assert.equal(c.jump.available, true);
    assert.equal(c.jump.resetAvailable, true);
    assert.equal(
      c.jump.flipLeft,
      0,
      "Reset restores eligibility without auto-flipping",
    );
    assert.equal(c.jump.age > 9, true);
    for (let i = 0; i < 25; i++) {
      const q = new Quaternion().copy(c.body.rotation()),
        offset = new Vector3(
          0,
          d.hitboxY - d.halfHeight - P.ball.radius + 0.01,
          0,
        )
          .applyQuaternion(q)
          .add(c.body.translation());
      s.ball.setTranslation(offset, true);
      s.ball.setLinvel(c.body.linvel(), true);
      s.step([n, n]);
    }
    assert.equal(c.flipResetSequence, 1, "Continuous contact awards once");
    s.ball.setTranslation({ x: 20, y: 12, z: 0 }, true);
    s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    for (let i = 0; i < 360; i++) s.step([n, n]);
    assert.equal(
      c.jump.available,
      true,
      "Reset survives long beyond original jump window",
    );
    s.ball.setTranslation(
      new Vector3(0, d.hitboxY - d.halfHeight - P.ball.radius + 0.025, 0)
        .applyQuaternion(new Quaternion().copy(c.body.rotation()))
        .add(c.body.translation()),
      true,
    );
    s.ball.setLinvel(c.body.linvel(), true);
    s.step([n, n]);
    assert.equal(
      c.flipResetSequence,
      2,
      "Real separation/recontact allows another reset",
    );
    const scene = new Scene(),
      fx = new FlipResetBurst(scene);
    fx.update(c, true);
    assert.equal(fx.ring.visible, true);
    c.flipResetAge = 0.2;
    fx.update(c, true);
    assert.ok(fx.ring.scale.x > 3 && fx.ring.material.opacity < 0.4);
    c.flipResetAge = 0.4;
    fx.update(c, true);
    assert.equal(fx.ring.visible, false);
    fx.dispose();
    c.reset(0, 0, 0, 6);
    c.jump.used = true;
    c.jump.age = 10;
    c.jump.acquireReset();
    c.body.setLinvel({ x: 12, y: -3, z: 4 }, true);
    c.body.setAngvel({ x: 0.7, y: 0.4, z: 0.2 }, true);
    s.ball.setTranslation({ x: 20, y: 12, z: 0 }, true);
    const pos = new Vector3().copy(c.body.translation());
    s.step([
      { ...n, yaw: -1, steer: -1, roll: 1, directionalRoll: 1, jump: true },
      n,
    ]);
    assert.equal(c.jump.stall, true);
    assert.equal(c.jump.available, false);
    assert.equal(c.jump.direction.length(), 0);
    for (let i = 0; i < 24; i++) s.step([n, n]);
    assert.ok(
      Math.abs(c.body.linvel().x - 12) < 0.001 &&
        Math.abs(c.body.linvel().z - 4) < 0.001,
      "Stall retains lateral/forward momentum",
    );
    assert.ok(
      c.body.linvel().y > -2 &&
        new Vector3().copy(c.body.angvel()).length() > 0.1,
      "Normal dodge vertical damping; angular momentum isn't zeroed",
    );
    assert.ok(
      pos.distanceTo(c.body.translation()) > 2,
      "No world-space freeze",
    );
    c.reset(0, 0, 0);
    for (let i = 0; i < 100; i++) s.step([n, n]);
    assert.equal(c.jump.resetAvailable, false);
    assert.equal(c.jump.available, true);
  } finally {
    s.dispose();
  }
}
for (const sign of [-1, 1]) {
  const jump = new JumpState();
  jump.used = true;
  jump.age = 10;
  jump.acquireReset();
  assert.equal(
    jump.step(
      { ...n, yaw: sign, roll: -sign, directionalRoll: -sign, jump: true },
      false,
      P.dt,
    ),
    "dodge",
  );
  assert.equal(jump.stall, true);
  assert.equal(
    jump.flipLeft,
    0,
    "Stall never enters sustained rotational flip state",
  );
  assert.equal(
    jump.verticalDampingActive,
    true,
    "Linear dodge damping stays independent",
  );
  assert.equal(jump.available, false);
  const normal = new JumpState();
  assert.equal(
    normal.step(
      {
        ...n,
        yaw: sign,
        steer: sign,
        roll: sign,
        directionalRoll: sign,
        dodgeX: sign,
        jump: true,
      },
      false,
      P.dt,
    ),
    "dodge",
  );
  assert.equal(normal.stall, false);
  assert.equal(normal.direction.x, sign);
  const generic = new JumpState();
  generic.step(
    { ...n, yaw: sign, roll: -sign, dodgeX: sign, jump: true },
    false,
    P.dt,
  );
  assert.equal(generic.stall, false, "Generic roll cannot trigger stall");
  const delayed = new JumpState();
  for (let i = 0; i < 40; i++) delayed.step({ ...n, yaw: sign }, false, P.dt);
  delayed.step(
    { ...n, yaw: sign, directionalRoll: -sign, jump: true },
    false,
    P.dt,
  );
  assert.equal(
    delayed.stall,
    false,
    "Opposing inputs must begin near simultaneously",
  );
}
// Clean held chord, immediate control, physical delayed reset and a second stall.
for (const body of ["ion", "vector"] as const)
  for (const gravity of [0, P.gravity])
    for (const sign of [-1, 1]) {
      const s = new Simulation(true),
        c = s.cars[0];
      try {
        s.cars[1].body.setEnabled(false);
        s.world.gravity = { x: 0, y: -gravity, z: 0 };
        c.setBody(body);
        c.reset(0, 0, 0, 20);
        c.jump.used = true;
        c.jump.second = true;
        c.jump.age = 10;
        const resetContact = () => {
          const d = bodies[body];
          s.ball.setTranslation(
            new Vector3(0, d.hitboxY - d.halfHeight - P.ball.radius + 0.025, 0)
              .applyQuaternion(new Quaternion().copy(c.body.rotation()))
              .add(c.body.translation()),
            true,
          );
          s.ball.setLinvel(c.body.linvel(), true);
          for (let i = 0; i < 8 && !c.jump.available; i++) s.step([n, n]);
        };
        resetContact();
        assert.equal(c.flipResetSequence, 1);
        s.ball.setTranslation({ x: 100, y: 30, z: 0 }, true);
        for (let i = 0; i < 120; i++) s.step([n, n]);
        assert.equal(c.jump.available, true);
        c.body.setLinvel({ x: 10, y: -3, z: 4 }, true);
        const rotation = new Quaternion().copy(c.body.rotation());
        const chord = {
          ...n,
          yaw: sign,
          steer: sign,
          roll: -sign,
          directionalRoll: -sign,
          jump: true,
        };
        s.step([chord, n]);
        assert.equal(c.jump.available, false);
        assert.equal(c.jump.flipLeft, 0);
        assert.equal(c.pitchLocked, false);
        let angle = 0;
        for (let i = 0; i < 90; i++) {
          s.step([chord, n]);
          angle = Math.max(
            angle,
            rotation.angleTo(new Quaternion().copy(c.body.rotation())),
          );
          assert.equal(c.flipPitchAcceleration, 0);
        }
        assert.ok(angle < 0.03, `clean held stall rotates ${angle} radians`);
        assert.ok(
          Math.abs(c.body.linvel().x - 10) < 0.001 &&
            Math.abs(c.body.linvel().z - 4) < 0.001,
        );
        assert.ok(
          c.body.linvel().y > -1,
          "Retains strong vertical dodge damping",
        );
        // Reacquire at the actually preserved underside orientation, no pose reset.
        resetContact();
        assert.equal(c.flipResetSequence, 2);
        s.ball.setTranslation({ x: 100, y: 30, z: 0 }, true);
        s.step([n, n]); // Release jump/chord, then consume a new real contact reset.
        s.step([chord, n]);
        assert.equal(c.jump.available, false);
        assert.equal(c.jump.stall, true);
        assert.equal(c.flipResetSequence, 2);
        // Counter existing momentum during the first post-stall tick, without an
        // instant angular zero. Pitch, yaw and roll must all respond immediately.
        for (const axis of ["pitch", "yaw", "roll"] as const) {
          c.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
          s.step([{ ...n, [axis]: 1 }, n]);
          assert.ok(
            new Vector3().copy(c.body.angvel()).length() > 0.05,
            `${axis} has immediate air control`,
          );
          assert.equal(c.pitchLocked, false);
        }
        c.body.setAngvel(c.forward.clone().multiplyScalar(2), true);
        const before = new Vector3().copy(c.body.angvel()).dot(c.forward);
        s.step([{ ...n, roll: -1, directionalRoll: -1 }, n]);
        const after = new Vector3().copy(c.body.angvel()).dot(c.forward);
        assert.ok(
          after > 0 && after < before - 0.2,
          "Residual roll is countered on the next tick, not snapped to zero",
        );
      } finally {
        s.dispose();
      }
    }
// Input layer respects remapped actions and actual controller bumper states.
(globalThis as any).window = { addEventListener() {} };
(globalThis as any).document = {
  querySelector() {
    return null;
  },
  hidden: false,
};
let pad: any = null;
Object.defineProperty(globalThis, "navigator", {
  value: { getGamepads: () => (pad ? [pad] : []) },
  configurable: true,
});
const input = new Input({ ...defaultBindings, rollRight: "KeyG" });
input.keys = new Set([defaultBindings.left, "KeyG", defaultBindings.jump]);
assert.equal(input.sample().directionalRoll, 1);
assert.equal(new JumpState().step(input.sample(), false, P.dt), "dodge");
input.keys.clear();
pad = {
  connected: true,
  axes: [-1, 0],
  buttons: Array.from({ length: 16 }, (_, i) => ({
    pressed: i === 0 || i === 5,
    value: i === 0 || i === 5 ? 1 : 0,
  })),
};
const control = input.sample(),
  state = new JumpState();
state.step(control, false, P.dt);
assert.equal(state.stall, true);
console.log(
  "PASS both-body physical bottom/roof/side/nose contacts, continuous/reset separation, indefinite eligibility, ground reset, white ring/fade, momentum-preserving reset stalls, both directions, delay/generic-roll rejection and keyboard/controller action states",
);
