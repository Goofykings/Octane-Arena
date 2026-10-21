import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import { Matrix4, Quaternion, Vector3 } from "three";
import { initializeSimulation, Simulation } from "../src/physics/simulation";
import { neutralInput as n, type PlayerInput } from "../shared/player";
import { chassisPoints } from "../src/car/chassis";
import { P } from "../src/config/physics";
await initializeSimulation();
const fixture = () => {
  const s = new Simulation(true);
  s.ball.setEnabled(false);
  s.cars[1].body.setEnabled(false);
  return s;
};
const frame = (up: Vector3, forward = new Vector3(0, 0, -1)) =>
  new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(
      forward.clone().cross(up),
      up,
      forward.clone().negate(),
    ),
  );
const setup = (kind: string) => {
  const s = fixture(),
    c = s.cars[0];
  if (kind === "nose" || kind === "edge" || kind === "roof") {
    const q = new Quaternion().setFromAxisAngle(
      kind === "nose" ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1),
      kind === "roof" ? Math.PI : Math.PI / 2,
    );
    c.reset(
      0,
      0,
      0,
      -Math.min(...chassisPoints(c.bodyId).map((p) => p.applyQuaternion(q).y)) +
        P.car.contactSkin,
    );
    c.body.setRotation(q, true);
    for (let i = 0; i < 12; i++) s.step([n(), n()]);
  } else {
    // Raised narrow strips isolate one side's actual two-wheel contacts; the
    // ordinary floor is too distant to masquerade as the other support pair.
    if (kind === "wall") {
      s.world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.2, 0.16, 3).setTranslation(6.2, 6.27, 0),
      );
      c.reset(5.69, 0, 0, 6);
      c.body.setRotation(frame(new Vector3(-1, 0, 0)), true);
    } else {
      s.world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.16, 0.2, 3).setTranslation(0.27, 6.2, 0),
      );
      c.reset(0, 0, 0, kind === "ceiling" ? 5.69 : 6.71);
      c.body.setRotation(
        frame(new Vector3(0, kind === "ceiling" ? -1 : 1, 0)),
        true,
      );
    }
    s.step([n(), n()]);
    s.step([n(), n()]);
    assert.equal(
      c.contacts,
      2,
      kind + " fixture must have exactly two wheel contacts",
    );
  }
  assert.equal(c.stableContact, false, kind);
  assert.equal(c.grounded, false, kind + " is not full driving contact");
  assert.equal(c.aerialControl, 1, kind + " must keep controls available");
  assert.equal(c.adhesionAcceleration.length(), 0, kind);
  return { s, c };
};
for (const kind of ["nose", "edge", "roof", "floor strip", "wall", "ceiling"])
  for (const action of ["roll", "yaw"] as const) {
    const neutral = setup(kind),
      commanded = setup(kind);
    try {
      for (let i = 0; i < 12; i++) {
        neutral.s.step([n(), n()]);
        commanded.s.step([
          { ...n(), [action]: 1, steer: action === "yaw" ? 1 : 0 },
          n(),
        ]);
      }
      assert.ok(
        new Vector3()
          .copy(neutral.c.body.angvel())
          .distanceTo(commanded.c.body.angvel()) > 0.01,
        kind + " " + action + " must affect physical angular motion",
      );
      assert.equal(
        commanded.c.recovering,
        false,
        "No generic unstick/recovery impulse",
      );
    } finally {
      neutral.s.dispose();
      commanded.s.dispose();
    }
  }
for (const kind of ["wall", "ceiling"]) {
  const { s, c } = setup(kind);
  try {
    let partial = 0;
    for (let i = 0; i < 90; i++) {
      s.step([{ ...n(), throttle: 1 }, n()]);
      if (c.contacts === 2) {
        partial++;
        assert.equal(c.grounded, false);
        assert.equal(c.adhesionAcceleration.length(), 0);
        assert.ok(
          c.wheelSupport <= 0.061,
          "No full tire patch on partial overhead support",
        );
      }
    }
    assert.ok(partial > 0);
    assert.ok(
      c.body.translation().y < 5,
      "Unsupported " + kind + " must fall under gravity",
    );
  } finally {
    s.dispose();
  }
}
// Nearby unloaded rays must not perpetuate full support after two wheels leave.
{
  const s = fixture(),
    c = s.cars[0];
  const platform = s.world.createCollider(
    RAPIER.ColliderDesc.cuboid(3, 0.2, 3).setTranslation(0, 6.2, 0),
  );
  c.reset(0, 0, 0, 6.71);
  for (let i = 0; i < 12; i++) s.step([n(), n()]);
  assert.ok(c.stableContact && c.contacts === 4);
  s.world.removeCollider(platform, true);
  s.world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.16, 0.2, 3).setTranslation(0.27, 6.2, 0),
  );
  s.world.createCollider(
    RAPIER.ColliderDesc.cuboid(3, 0.2, 3).setTranslation(0, 5.95, 0),
  );
  s.world.step(); // Refresh scene queries after replacing static geometry.
  s.step([n(), n()]);
  assert.equal(c.contacts, 2);
  assert.ok(
    c.wheelNormals.every((normal) => normal.lengthSq() > 0),
    "Other rays see nearby, unloaded floor",
  );
  assert.equal(
    c.stableContact,
    false,
    "Stable history cannot turn a narrow edge into driving support",
  );
  assert.equal(c.grounded, false);
  assert.equal(c.aerialControl, 1);
  assert.equal(c.adhesionAcceleration.length(), 0);
  const initialHeight = c.body.translation().y;
  let tipped = false;
  for (let i = 0; i < 90; i++) {
    s.step([n(), n()]);
    tipped ||= c.up.y < 0.995;
  }
  assert.ok(
    tipped,
    "Normal correction must act at the supported wheel, not hold the COM up",
  );
  assert.ok(
    c.body.translation().y < initialHeight - 0.03,
    "COM descends as the other side settles toward the lower floor",
  );
  s.dispose();
}
// A loaded, aligned tread pair still allows a normal surface jump without
// being promoted to driving contact or suppressing aerial controls.
{
  const { s, c } = setup("floor strip");
  assert.equal(c.jumpSupported, true);
  s.step([{ ...n(), jump: true }, n()]);
  assert.ok(c.jump.used && !c.jump.second && c.lastJump);
  assert.ok(c.body.linvel().y > 2);
  assert.equal(c.grounded, false);
  s.dispose();
}
// Leaving a partial contact must not re-enter the settled-driving debounce.
{
  const { s, c } = setup("floor strip");
  c.body.setTranslation({ x: 2, y: 8, z: 0 }, true);
  s.step([{ ...n(), roll: 1 }, n()]);
  assert.equal(c.contacts, 0);
  assert.equal(c.aerialControl, 1);
  s.dispose();
}
// A genuinely supported car owns steering and does not mix in aerial roll.
{
  const s = fixture(),
    c = s.cars[0];
  c.reset(0, 0, 0);
  for (let i = 0; i < 60; i++) s.step([n(), n()]);
  for (let i = 0; i < 30; i++) {
    s.step([{ ...n(), throttle: 1, roll: 1, yaw: 1 }, n()]);
    assert.ok(c.grounded && c.stableContact && c.contacts === 4);
    assert.equal(c.aerialControl, 0);
    assert.equal(c.wheelSupport, 1);
    assert.ok(c.up.y > 0.999);
  }
  s.dispose();
}
const recoveryResults: object[] = [];
for (const body of ["ion", "vector"] as const)
  for (const direction of [-1, 1]) {
    const s = fixture(),
      c = s.cars[0];
    c.setBody(body);
    c.reset(0, 0, 0, 0.65);
    c.body.setRotation(
      new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI),
      true,
    );
    for (let i = 0; i < 120; i++) s.step([n(), n()]);
    let settled = -1,
      total = 0,
      peak = 0,
      triggers = 0,
      previousActive = false;
    let previous = new Quaternion().copy(c.body.rotation());
    for (let i = 0; i < 360; i++) {
      s.step([{ ...n(), throttle: 1, roll: i === 0 ? direction : 0 }, n()]);
      const q = new Quaternion().copy(c.body.rotation());
      assert.ok(q.angleTo(previous) < 0.08, "No orientation snap");
      total += q.angleTo(previous);
      previous = q;
      peak = Math.max(peak, new Vector3().copy(c.body.angvel()).length());
      if (c.recovering && !previousActive) triggers++;
      previousActive = c.recovering;
      if (settled < 0 && c.grounded && c.up.y > 0.98 && !c.recovering)
        settled = (i + 1) * P.dt;
    }
    assert.ok(
      settled > 0 && settled < 1.05,
      "Responsive clean recovery " + body,
    );
    assert.equal(triggers, 1, "Held request cannot retrigger recovery");
    assert.ok(total < Math.PI * 1.35, "No full-turn overshoot");
    assert.ok(peak < P.car.recoveryMaxSpeed + 0.6);
    assert.ok(c.grounded && c.up.y > 0.99);
    recoveryResults.push({ body, direction, seconds: settled, total, peak });
    s.dispose();
  }
function hit(
  speed: number,
  air: boolean,
  flip = false,
  spin = 0,
  diagonal = false,
) {
  const s = fixture(),
    c = s.cars[0];
  s.ball.setEnabled(true);
  s.ball.setLinearDamping(0);
  s.ball.setAngularDamping(0);
  if (air) s.world.gravity = { x: 0, y: 0, z: 0 };
  c.reset(0, 1.7, 0, air ? 5 : 0.36);
  if (spin)
    c.body.setRotation(
      new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.55),
      true,
    );
  c.body.setLinvel({ x: 0, y: 0, z: -speed }, true);
  s.ball.setTranslation({ x: 0, y: air ? 5.15 : P.ball.radius, z: 0 }, true);
  s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
  if (flip) {
    c.jump.used = c.jump.second = true;
    c.jump.age = 0.3;
    c.jump.flipAge = 0.05;
    c.jump.flipLeft = 0.6;
    c.jump.direction.set(
      diagonal ? Math.SQRT1_2 : 0,
      0,
      diagonal ? -Math.SQRT1_2 : -1,
    );
  }
  if (spin) c.body.setAngvel({ x: -spin, y: 0, z: 0 }, true);
  try {
    for (let i = 0; i < 120; i++) {
      const momentum = new Vector3()
        .copy(c.body.linvel())
        .multiplyScalar(c.body.mass())
        .addScaledVector(new Vector3().copy(s.ball.linvel()), s.ball.mass());
      s.step([n(), n()]);
      const contact = s.ballContacts[0];
      if (contact.impactCount) {
        if (air) {
          const after = new Vector3()
            .copy(c.body.linvel())
            .multiplyScalar(c.body.mass())
            .addScaledVector(
              new Vector3().copy(s.ball.linvel()),
              s.ball.mass(),
            );
          // Normal gravity contributes to pair momentum during this tick.
          momentum.y +=
            (c.body.mass() + s.ball.mass()) * s.world.gravity.y * P.dt;
          assert.ok(
            momentum.distanceTo(after) < 0.05,
            "Equal and opposite aerial reaction",
          );
        }
        return {
          speed: new Vector3().copy(s.ball.linvel()).length(),
          closing: contact.closing,
          rotation: contact.rotationalClosing,
          bonus: contact.dodgeImpulse.length(),
          point: contact.pointVelocity.clone(),
          linear: contact.linear.clone(),
          angular: contact.angular.clone(),
          local: contact.local.clone(),
        };
      }
    }
    throw Error("Fixture missed ball");
  } finally {
    s.dispose();
  }
}
const drive = hit(23, false),
  aerial = hit(23, true);
assert.ok(
  // The lower COM and +8% pitch inertia change rigid-body recoil slightly.
  // Preserve the strike curve within 0.5%, rather than a 0.01 m/s mass-specific snapshot.
  Math.abs(drive.speed / 34.54174175322715 - 1) < 0.005,
  "Full-speed ground strike curve is preserved after mass-distribution tuning",
);
for (const speed of [8, 12, 23]) {
  const ground = hit(speed, false),
    airborne = hit(speed, true);
  assert.ok(
    airborne.speed > ground.speed * 0.85 && airborne.speed < ground.speed * 1.2,
    "Same-speed jump/aerial hit cannot lose the driving strike curve",
  );
}
const front = hit(23, true, true, 7),
  diagonal = hit(23, true, true, 7, true);
assert.ok(
  front.speed > drive.speed * 1.08 && diagonal.speed > drive.speed * 1.08,
);
assert.ok(
  front.rotation > 0.25 &&
    front.bonus > 0 &&
    front.bonus <= P.hit.dodgeHitMaxImpulse + 0.01,
);
const rotating = hit(23, true, false, 7);
assert.ok(
  rotating.point.distanceTo(rotating.linear) > 0.25,
  "Angular contact velocity participates without a flip label",
);
assert.equal(rotating.bonus, 0);
assert.ok(hit(0.6, true).speed < 1, "Soft touch stays controllable");
console.log(
  "PASS partial nose/roof/shoulder/two-wheel controls, gravity release, full-driving ownership, bounded fast recovery and coupled approach/flip hits",
  JSON.stringify({
    recoveryResults,
    drive: drive.speed,
    aerial: aerial.speed,
    front: front.speed,
    diagonal: diagonal.speed,
  }),
);
