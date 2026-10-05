import assert from "node:assert/strict";
import { Vector3, Quaternion, Group, Scene } from "three";
import { initializeSimulation, Simulation } from "../src/physics/simulation";
import { P } from "../src/config/physics";
import { bodies, type BodyId } from "../shared/catalog";
import { neutralInput } from "../shared/player";
import { carModel, animateWheels, disposeModel } from "../src/render/models";
import {
  BallHeightIndicator,
  innerHeightRatio,
} from "../src/effects/ball-height";
import { writeFileSync } from "node:fs";
await initializeSimulation();
const n = neutralInput();
function fixture(id: BodyId = "ion") {
  const s = new Simulation(true),
    c = s.cars[0];
  s.cars[1].body.setEnabled(false);
  c.setBody(id);
  c.reset(0, 0, 0);
  for (let i = 0; i < 40; i++) s.step([n, n]);
  return s;
}
const records: unknown[] = [];
function legacyResponse(s: Simulation) {
  const response = s.ballContacts[0],
    sample = response.sample.bind(response);
  const ballVelocity = new Vector3();
  let touching = false,
    cooldown = 0;
  response.sample = (car, ball) => {
    ballVelocity.copy(ball.linvel());
    sample(car, ball);
    cooldown = Math.max(0, cooldown - P.dt);
  };
  response.separate = () => {
    touching = false;
  };
  response.resolve = (car, ball) => {
    if (touching) return;
    touching = true;
    if (cooldown > 0) return;
    cooldown = 0.1;
    const normal = new Vector3()
      .subVectors(ball.translation(), car.body.translation())
      .normalize();
    const closing = Math.max(
      0,
      response.linear.clone().sub(ballVelocity).dot(normal),
    );
    if (closing < 0.5) return;
    const local = normal
      .clone()
      .applyQuaternion(new Quaternion().copy(car.body.rotation()).invert());
    const front = Math.max(0, -local.z),
      roof = Math.max(0, local.y),
      under = Math.max(0, -local.y);
    const gain =
      0.12 + 0.18 * front * front + 0.08 * roof * roof - 0.04 * under * under;
    const forward = new Vector3(0, 0, -1).applyQuaternion(car.body.rotation());
    const impulse = normal
      .clone()
      .lerp(forward, 0.22 * front)
      .normalize()
      .multiplyScalar(Math.min(6, closing * gain) * P.ball.mass);
    ball.applyImpulseAtPoint(
      impulse,
      new Vector3()
        .copy(ball.translation())
        .addScaledVector(normal, -P.ball.radius),
      true,
    );
  };
}
for (const id of ["ion", "vector"] as const)
  for (const x of [0, 0.2, 0.38]) {
    const s = fixture(id),
      c = s.cars[0],
      d = bodies[id];
    s.ball.setTranslation(
      {
        x,
        y:
          c.body.translation().y +
          d.hitboxY +
          d.halfHeight +
          P.ball.radius +
          0.002,
        z: 0,
      },
      true,
    );
    let impulses = 0;
    for (let i = 0; i < 480; i++) {
      s.step([n, n]);
      if (s.ballContacts[0].impulse.lengthSq()) impulses++;
    }
    const p = s.ball.translation();
    records.push({ kind: "dribble", id, x, final: p, impulses });
    assert.equal(
      impulses,
      0,
      "resting dribble receives artificial hit stacking",
    );
    if (x === 0)
      assert.ok(Math.abs(p.x) < 0.01 && p.y > 1.4, "centred roof support lost");
    else assert.ok(p.x > x + 0.5, "off-centre ball does not roll outward");
    if (x > 0.3) assert.ok(p.y < 1, "edge ball does not fall naturally");
    s.dispose();
  }
const flickSpeeds = new Map<string, number>();
for (const legacy of [true, false])
  for (const id of ["ion", "vector"] as const)
    for (const [name, x, y] of [
      ["front", 0, 1],
      ["back", 0, -1],
      ["side", 1, 0],
      ["diagonal", 1, 1],
    ] as const) {
      const s = fixture(id),
        c = s.cars[0],
        d = bodies[id];
      if (legacy) legacyResponse(s);
      const offset = new Vector3(x * 0.27, 0, -y * 0.32);
      s.ball.setTranslation(
        {
          x: offset.x,
          y:
            c.body.translation().y +
            d.hitboxY +
            d.halfHeight +
            P.ball.radius +
            0.002,
          z: offset.z,
        },
        true,
      );
      c.body.setLinvel({ x: 0, y: 0, z: -8 }, true);
      s.ball.setLinvel({ x: 0, y: 0, z: -8 }, true);
      let maxSpeed = 0,
        maxAngular = 0,
        extra = 0,
        angularContact = 0;
      for (let i = 0; i < 90; i++) {
        s.step([
          {
            ...n,
            jump: i < 10 || i === 12,
            dodgeX: i === 12 ? x : 0,
            dodgeY: i === 12 ? y : 0,
          },
          n,
        ]);
        maxSpeed = Math.max(
          maxSpeed,
          new Vector3().copy(s.ball.linvel()).length(),
        );
        maxAngular = Math.max(
          maxAngular,
          new Vector3().copy(c.body.angvel()).length(),
        );
        if (s.ballContacts[0].impulse.lengthSq() > 0) {
          extra += s.ballContacts[0].impulse.length() / P.ball.mass;
          angularContact = Math.max(
            angularContact,
            s.ballContacts[0].pointVelocity
              .clone()
              .sub(s.ballContacts[0].linear)
              .length(),
          );
        }
      }
      const key = id + name;
      if (legacy) flickSpeeds.set(key, maxSpeed);
      else {
        assert.ok(
          extra > 1 && angularContact > 1,
          "flick misses angular contact velocity",
        );
        assert.ok(
          maxAngular > 5.5 && maxAngular < P.jump.flipMaxAngular + 0.001,
          "flip speed changed",
        );
        assert.ok(
          maxSpeed > flickSpeeds.get(key)! * 1.08,
          "flick power did not improve",
        );
        assert.ok(maxSpeed <= P.ball.maxSpeed + 0.001);
      }
      records.push({
        kind: legacy ? "legacy flick" : "flick",
        id,
        name,
        maxSpeed,
        maxAngular,
        extra,
        angularContact,
      });
      s.dispose();
    }
for (const id of ["ion", "vector"] as const)
  for (const action of [
    "accelerate",
    "brake",
    "steer",
    "powerslide",
  ] as const) {
    const s = fixture(id),
      c = s.cars[0],
      d = bodies[id];
    c.body.setLinvel({ x: 0, y: 0, z: -8 }, true);
    s.ball.setTranslation(
      {
        x: 0,
        y:
          c.body.translation().y +
          d.hitboxY +
          d.halfHeight +
          P.ball.radius +
          0.002,
        z: 0,
      },
      true,
    );
    s.ball.setLinvel({ x: 0, y: 0, z: -8 }, true);
    for (let i = 0; i < 45; i++)
      s.step([
        {
          ...n,
          throttle: action === "brake" ? -1 : 1,
          steer: action === "steer" || action === "powerslide" ? 1 : 0,
          slide: action === "powerslide",
        },
        n,
      ]);
    const local = new Vector3()
      .subVectors(s.ball.translation(), c.body.translation())
      .applyQuaternion(new Quaternion().copy(c.body.rotation()).invert());
    if (action === "accelerate")
      assert.ok(local.z > 0.1, "ball glued during acceleration");
    if (action === "brake")
      assert.ok(local.z < -0.1, "ball glued during braking");
    if (action === "steer" || action === "powerslide")
      assert.ok(
        Math.abs(local.x) > 0.05,
        `ball glued during turn/drift ${id}/${action}: ${local.toArray()}`,
      );
    records.push({
      kind: "moving dribble",
      id,
      action,
      local: local.toArray(),
    });
    s.dispose();
  }
for (const [name, speed, x, carHeight] of [
  ["slow", 1, 0, 0.31],
  ["front", 23, 0, 0.31],
  ["diagonal", 18, 0.8, 0.31],
  ["aerial", 18, 0, 5],
] as const) {
  const s = fixture(),
    c = s.cars[0];
  c.reset(0, 0, 0, carHeight);
  s.ball.setTranslation({ x, y: carHeight + 0.65, z: -2 }, true);
  s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
  c.body.setLinvel({ x: 0, y: 0, z: -speed }, true);
  let maxSpeed = 0;
  for (let i = 0; i < 300; i++) {
    s.step([n, n], true);
    maxSpeed = Math.max(maxSpeed, new Vector3().copy(s.ball.linvel()).length());
    assert.ok(maxSpeed <= P.ball.maxSpeed + 0.001);
  }
  if (name === "slow") assert.ok(maxSpeed < 3, "minor contact launches ball");
  else assert.ok(maxSpeed > speed * 0.7, "shot unexpectedly weak");
  records.push({ kind: "shot", name, speed, maxSpeed });
  s.dispose();
}
for (const id of ["ion", "vector"] as const) {
  const s = fixture(id),
    c = s.cars[0],
    model = carModel(0xffffff, id),
    mounts = model.userData.wheelMounts as Group[];
  const fixed = mounts.map((m) => m.position.clone());
  for (let i = 0; i < 180; i++) {
    s.step([
      { ...n, throttle: 1, steer: 0.7, slide: i > 90, jump: i === 100 },
      n,
    ]);
    c.pose.render(model, 1);
    animateWheels(model, c.forwardSpeed, c.steerAngle, P.dt, c, model);
    mounts.forEach((m, k) =>
      assert.ok(
        m.position.equals(fixed[k]),
        "wheel mount moved relative to chassis",
      ),
    );
  }
  assert.ok(Math.abs(mounts[0].rotation.y) > 0.01, "steering animation lost");
  assert.ok(
    Math.abs(model.userData.wheels[0].rotation.x) > 0.1,
    "wheel spin lost",
  );
  disposeModel(model);
  s.dispose();
}
for (const [offset, angular] of [
  [new Vector3(0, 0, 0.5), new Vector3(-6, 0, 0)],
  [new Vector3(0, 0, -0.5), new Vector3(6, 0, 0)],
  [new Vector3(0.35, 0, 0), new Vector3(0, 0, 6)],
  [new Vector3(-0.35, 0, 0), new Vector3(0, 0, -6)],
]) {
  const s = fixture(),
    c = s.cars[0],
    d = bodies.ion;
  s.ball.setTranslation(
    {
      x: offset.x,
      y: c.body.translation().y + d.hitboxY + d.halfHeight + P.ball.radius,
      z: offset.z,
    },
    true,
  );
  c.body.setAngvel(angular, true);
  let extra = 0;
  for (let i = 0; i < 12; i++) {
    s.step([n, n], true);
    extra += s.ballContacts[0].impulse.length();
  }
  assert.ok(extra > 5, "rotating edge with zero COM velocity misses impact");
  s.dispose();
}
{
  const s = fixture();
  s.ball.setLinvel({ x: 100, y: 80, z: 30 }, true);
  s.step([n, n], true);
  assert.ok(
    Math.abs(new Vector3().copy(s.ball.linvel()).length() - P.ball.maxSpeed) <
      0.001,
  );
  s.dispose();
}
{
  const s = fixture(),
    indicator = new BallHeightIndicator(new Scene()),
    ball = new Group();
  const radii = [];
  for (const y of [P.ball.radius, 5, 10, P.arena.height - P.ball.radius]) {
    ball.position.set(3, y, 8);
    indicator.update(ball, s);
    radii.push(indicator.inner.scale.x / indicator.outer.scale.x);
    assert.ok(
      indicator.group.position.distanceTo(new Vector3(3, 0.03, 8)) < 1e-5,
    );
  }
  assert.ok(
    radii[0] > 0.89 &&
      radii[1] < radii[0] &&
      radii[2] < radii[1] &&
      radii[3] < 0.12,
  );
  assert.equal(innerHeightRatio(-1, 20), 0.9);
  assert.ok(innerHeightRatio(100, 20) > 0);
  s.dispose();
  records.push({ kind: "height indicator", radii });
}
console.log(
  "PASS rigid wheels, steering/spin, dribble offsets/motion, four physical flick directions, rotating contact-point impacts, shots and height indicator",
);
{
  const s = new Simulation(),
    indicator = new BallHeightIndicator(new Scene()),
    ball = new Group();
  ball.position.set(P.arena.halfWidth - 0.8, 5, 0);
  indicator.update(ball, s);
  assert.ok(
    indicator.group.position.y > 0.6,
    "height projection ignores actual curved playing surface",
  );
  assert.ok(
    Math.abs(
      indicator.height -
        (5 - indicator.group.position.y + 0.03 - P.ball.radius),
    ) < 1e-6,
  );
  ball.position.set(0, 5, P.arena.halfLength + 4);
  indicator.update(ball, s);
  const ratio = indicator.inner.scale.x / indicator.outer.scale.x;
  assert.ok(
    Math.abs(
      ratio -
        innerHeightRatio(
          5 - P.ball.radius,
          P.arena.goalHeight - 2 * P.ball.radius,
        ),
    ) < 1e-5,
    "goal indicator uses stadium ceiling instead of goal ceiling",
  );
  s.dispose();
}
console.log(
  JSON.stringify(
    records.filter((r) => (r as { kind: string }).kind === "flick"),
    null,
    2,
  ),
);
writeFileSync("docs/ball-quality.json", JSON.stringify(records, null, 2));
