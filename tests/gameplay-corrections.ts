import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3, Quaternion, Euler, Matrix4 } from "three";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { Simulation } from "../src/physics/simulation";
import { neutral, type Controls } from "../src/input/types";
import { P } from "../src/config/physics";
import { Match } from "../src/game/match";
import { trainingAction } from "../src/game/training";
import { trainingActions } from "../shared/controls";
import { bodies } from "../shared/catalog";
import { goalShell } from "../src/arena/geometry";

await RAPIER.init();
const results: {
  name: string;
  pass: boolean;
  data?: unknown;
  error?: string;
}[] = [];
function check(name: string, work: () => unknown) {
  try {
    const data = work();
    results.push({ name, pass: true, data });
    console.log("PASS " + name + ": " + JSON.stringify(data));
  } catch (e) {
    results.push({ name, pass: false, error: String(e) });
    console.log("FAIL " + name + ": " + String(e));
  }
}
function setup() {
  const s = new Simulation(true);
  s.cars[1].body.setEnabled(false);
  s.ball.setTranslation({ x: 200, y: 1, z: 200 }, true);
  s.ball.setEnabled(false);
  return s;
}
function tick(s: Simulation, input: Partial<Controls> = {}, count = 1) {
  for (let i = 0; i < count; i++)
    s.step([{ ...neutral(), ...input }, neutral()]);
}
function surface(kind: "floor" | "wall" | "ceiling", long = false) {
  const s = setup(),
    c = s.cars[0];
  let shape: RAPIER.ColliderDesc;
  if (kind === "floor") {
    shape = RAPIER.ColliderDesc.cuboid(5, 0.3, long ? 40 : 3).setTranslation(
      0,
      19.7,
      0,
    );
    c.reset(0, 0, 0, 20.34);
  } else if (kind === "wall") {
    shape = RAPIER.ColliderDesc.cuboid(0.3, 10, long ? 40 : 3).setTranslation(
      -0.3,
      20,
      0,
    );
    c.reset(0.34, 0, 0, 20);
    c.body.setRotation(
      new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 2),
      true,
    );
  } else {
    shape = RAPIER.ColliderDesc.cuboid(5, 0.3, long ? 40 : 3).setTranslation(
      0,
      25.3,
      0,
    );
    c.reset(0, 0, 0, 24.66);
    c.body.setRotation(
      new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI),
      true,
    );
  }
  const collider = s.world.createCollider(shape);
  s.world.step();
  tick(s);
  assert.ok(c.contacts >= 3, kind + " initial surface contact");
  return { s, c, collider };
}

for (const held of [false, true])
  check(
    `roof recovery with throttle ${held ? "held before" : "pressed after"} touchdown`,
    () => {
      const s = setup(),
        c = s.cars[0];
      c.reset(0, 0, 0, held ? 0.7 : 0.23);
      c.body.setRotation(
        new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI),
        true,
      );
      if (!held) tick(s, {}, 100);
      let triggers = 0,
        was = false,
        recovered = false;
      for (let i = 0; i < 360; i++) {
        tick(s, { throttle: 1, pitch: 1 });
        if (c.recovering && !was) triggers++;
        was = c.recovering;
        if (c.contacts >= 3 && c.up.y > 0.8) {
          recovered = true;
          break;
        }
      }
      assert.ok(recovered);
      assert.equal(triggers, 1);
      s.dispose();
      return { triggers, recovered };
    },
  );
check("recovery does not self-right unsupported aerial cars", () => {
  const s = setup(),
    c = s.cars[0];
  c.reset(0, 0, 0, 10);
  c.body.setRotation(
    new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI),
    true,
  );
  tick(s, { throttle: 1 }, 60);
  assert.ok(!c.recovering);
  assert.equal(c.jump.used, false);
  s.dispose();
});

for (const kind of ["floor", "wall", "ceiling"] as const)
  check(`${kind} first jump starts and expires aerial-action timer`, () => {
    const { s, c, collider } = surface(kind);
    tick(s, { jump: true });
    assert.ok(c.jump.used);
    assert.ok(c.lastJump);
    assert.equal(c.jump.second, false);
    s.world.removeCollider(collider, true);
    tick(s, {}, 190);
    assert.ok(c.contacts === 0);
    assert.ok(c.jump.age > 1.5);
    assert.ok(!c.jump.available);
    tick(s, { jump: true, throttle: 1 });
    assert.ok(!c.jump.second && !c.lastJump);
    const data = {
      age: c.jump.age,
      performedFirstJump: c.jump.used,
      available: c.jump.available,
    };
    s.dispose();
    return data;
  });
for (const kind of ["wall", "ceiling"] as const)
  for (const directional of [false, true])
    check(
      `${kind} drive-off retains ${directional ? "dodge" : "double jump"} indefinitely`,
      () => {
        const { s, c } = surface(kind);
        c.body.setLinvel({ x: 0, y: 0, z: -12 }, true);
        let absent = 0;
        for (let i = 0; i < 360 && absent < 195; i++) {
          tick(s, { throttle: 1 });
          absent = c.contacts === 0 ? absent + 1 : 0;
        }
        assert.ok(absent >= 195);
        assert.equal(c.jump.used, false);
        assert.equal(c.jump.age, 0);
        assert.ok(c.jump.available);
        tick(s, { jump: true, throttle: directional ? 1 : 0 });
        assert.ok(c.lastJump && c.jump.second);
        assert.equal(c.jump.used, false);
        assert.equal(c.jump.flipLeft > 0, directional);
        tick(s);
        tick(s, { jump: true });
        assert.ok(!c.lastJump);
        const data = {
          firstJump: c.jump.used,
          usedAerialAction: c.jump.second,
          age: c.jump.age,
          flipLeft: c.jump.flipLeft,
        };
        s.dispose();
        return data;
      },
    );
check("landing restores an aerial action consumed without a first jump", () => {
  const s = setup(),
    c = s.cars[0];
  c.reset(0, 0, 0, 3);
  tick(s, { jump: true });
  assert.ok(c.jump.second && !c.jump.used);
  tick(s, {}, 300);
  assert.ok(
    c.grounded,
    JSON.stringify({
      p: c.body.translation(),
      up: c.up.toArray(),
      v: c.body.linvel(),
      contacts: c.contacts,
      jump: { used: c.jump.used, second: c.jump.second },
    }),
  );
  assert.ok(c.jump.available && !c.jump.second);
  tick(s, { jump: true });
  assert.ok(c.jump.used && c.lastJump && !c.jump.second);
  s.dispose();
});

for (const kind of ["floor", "wall", "ceiling"] as const)
  check(`${kind} contact uses drive forces without aerial pitch`, () => {
    const { s, c } = surface(kind, true);
    let supported = 0,
      maxPitch = 0;
    for (let i = 0; i < 90; i++) {
      tick(s, { throttle: 1, pitch: 1 });
      if (c.contacts >= 3) {
        supported++;
        maxPitch = Math.max(
          maxPitch,
          Math.abs(new Vector3().copy(c.body.angvel()).dot(c.right)),
        );
        assert.equal(c.aerialControl, 0);
      }
    }
    assert.ok(supported >= 4);
    assert.ok(maxPitch < 0.15);
    assert.ok(Math.abs(c.forwardSpeed) > 0.5);
    const data = { supported, maxPitch, speed: c.forwardSpeed };
    s.dispose();
    return data;
  });
check(
  "single-wheel landing suppresses input pitch but preserves physical rotation",
  () => {
    const samples = [];
    for (const pitch of [0, 1]) {
      const s = setup(),
        c = s.cars[0];
      c.reset(0, 0, 0, 0.55);
      c.body.setRotation(
        new Quaternion().setFromEuler(new Euler(0.25, 0, 0.25)),
        true,
      );
      c.body.setAngvel({ x: 1, y: 0.3, z: 0.1 }, true);
      tick(s, { throttle: 1, pitch });
      samples.push({
        contacts: c.contacts,
        air: c.aerialControl,
        omega: new Vector3().copy(c.body.angvel()),
      });
      s.dispose();
    }
    assert.equal(samples[0].contacts, 1);
    assert.equal(samples[1].air, 0);
    assert.ok(samples[0].omega.distanceTo(samples[1].omega) < 1e-7);
    assert.ok(samples[1].omega.length() > 0.1);
    return samples;
  },
);
check(
  "contact debounce tolerates a lost tick, while jump restores air input promptly",
  () => {
    const { s, c, collider } = surface("floor");
    s.world.removeCollider(collider, true);
    tick(s, { pitch: 1 });
    assert.equal(c.contactState, "transition");
    assert.equal(c.aerialControl, 0);
    tick(s, { pitch: 1 }, 12);
    assert.equal(c.contactState, "air");
    assert.equal(c.aerialControl, 1);
    assert.ok(Math.abs(c.body.angvel().x) > 0.2);
    s.dispose();
    const next = surface("floor");
    tick(next.s, { jump: true });
    tick(next.s, { pitch: 1 });
    assert.equal(next.c.aerialControl, 1);
    assert.ok(Math.abs(next.c.body.angvel().x) > 0.05);
    next.s.dispose();
  },
);
check(
  "landing with forward held stabilizes instead of continuing aerial pitch",
  () => {
    const s = setup(),
      c = s.cars[0];
    c.reset(0, 0, 0, 0.8);
    c.body.setLinvel({ x: 0, y: -3, z: -7 }, true);
    let landed = false;
    for (let i = 0; i < 240; i++) {
      tick(s, { throttle: 1, pitch: 1 });
      if (c.contacts >= 3) landed = true;
    }
    assert.ok(landed && c.contacts >= 3 && c.up.y > 0.95);
    assert.equal(c.aerialControl, 0);
    assert.ok(c.forwardSpeed > 10);
    s.dispose();
  },
);

check("Free Play disabled opponent cannot collide with the player", () => {
  const s = new Simulation(),
    m = new Match();
  m.start(s, "freeplay");
  const c = s.cars[0],
    bot = s.cars[1];
  c.reset(0, -23, 0);
  c.body.setLinvel({ x: 0, y: 0, z: -12 }, true);
  const before = new Vector3().copy(bot.body.translation());
  tick(s, { throttle: 1 }, 60);
  const moved = before.distanceTo(bot.body.translation());
  assert.ok(moved < 0.001, `disabled bot moved ${moved}`);
  assert.ok(c.body.translation().z < -27);
  s.dispose();
  return { moved };
});
check(
  "Free Play celebrates goals without score then resets without countdown",
  () => {
    const s = new Simulation(),
      m = new Match();
    m.start(s, "freeplay");
    assert.equal(m.phase, "playing");
    assert.equal(m.countdown, 0);
    assert.equal(m.rules.scoreboard, false);
    assert.ok(!s.cars[1].body.isEnabled());
    tick(s, { throttle: 1 });
    assert.ok(s.cars[0].forwardSpeed >= 0);
    s.ball.setTranslation({ x: 0, y: 1, z: -53 }, true);
    m.tick(s);
    assert.equal(m.phase, "goal");
    assert.equal(m.message, "");
    assert.equal(m.lastGoal, null);
    assert.deepEqual(m.score, [0, 0]);
    for (let i = 0; i <= Math.ceil(P.match.celebration / P.dt); i++) m.tick(s);
    assert.equal(m.phase, "playing");
    assert.deepEqual(m.score, [0, 0]);
    assert.equal(s.ball.translation().z, 0);
    s.cars[0].body.setLinvel({ x: 1, y: 2, z: 3 }, true);
    s.ball.setAngvel({ x: 2, y: 1, z: 2 }, true);
    assert.ok(trainingAction("trainingReset", m, s));
    assert.equal(m.phase, "playing");
    assert.deepEqual({ ...s.cars[0].body.linvel() }, { x: 0, y: 0, z: 0 });
    assert.deepEqual({ ...s.ball.angvel() }, { x: 0, y: 0, z: 0 });
    assert.equal(m.goTime, 0);
    s.dispose();
  },
);
for (const id of ["ion", "vector"] as const)
  check(
    `${id} training placement follows orientation and clears the collider`,
    () => {
      const s = new Simulation(),
        m = new Match();
      m.start(s, "freeplay");
      const c = s.cars[0],
        d = bodies[id];
      c.setBody(id);
      c.reset(3, 6, Math.PI / 2, 4);
      c.body.setRotation(
        new Quaternion().setFromEuler(new Euler(0.2, 1, 0.3)),
        true,
      );
      c.body.setLinvel({ x: 2, y: 1, z: -3 }, true);
      const q = new Quaternion().copy(c.body.rotation());
      trainingAction("possession", m, s);
      let local = new Vector3()
        .copy(s.ball.translation())
        .sub(c.body.translation())
        .applyQuaternion(q.clone().invert());
      assert.ok(local.z < -(d.halfLength + P.ball.radius));
      assert.ok(Math.abs(local.x) < 1e-5);
      trainingAction("dribble", m, s);
      local = new Vector3()
        .copy(s.ball.translation())
        .sub(c.body.translation())
        .applyQuaternion(q.clone().invert());
      assert.ok(local.y - P.ball.radius > d.hitboxY + d.halfHeight);
      assert.ok(local.z < 0);
      assert.ok(
        new Vector3().copy(s.ball.linvel()).distanceTo(c.body.linvel()) < 1e-5,
      );
      s.dispose();
      return local.toArray();
    },
  );
check(
  "launch stacks immediately with a bounded speed and is match-isolated",
  () => {
    const s = new Simulation(),
      m = new Match();
    m.start(s, "freeplay");
    trainingAction("launch", m, s);
    const first = s.ball.linvel().y;
    trainingAction("launch", m, s);
    assert.ok(s.ball.linvel().y > first);
    for (let i = 0; i < 100; i++) trainingAction("launch", m, s);
    assert.equal(s.ball.linvel().y, P.training.maxLaunchSpeed);
    m.start(s, "bot");
    const before = JSON.stringify([
      s.ball.translation(),
      s.ball.linvel(),
      s.cars[0].body.translation(),
    ]);
    m.phase = "playing";
    for (const action of trainingActions)
      assert.equal(trainingAction(action, m, s), false);
    assert.equal(
      JSON.stringify([
        s.ball.translation(),
        s.ball.linvel(),
        s.cars[0].body.translation(),
      ]),
      before,
    );
    assert.equal(m.rules.scoreboard, true);
    s.dispose();
    return { first, maximum: P.training.maxLaunchSpeed };
  },
);
for (const sign of [-1, 1])
  check(
    `goal ${sign} upper mouth has no protrusions, degenerate faces or hard seams`,
    () => {
      const mesh = goalShell(sign),
        v = mesh.vertices,
        ix = mesh.indices,
        edges = new Map<string, { normal: Vector3; upper: boolean }>();
      let minArea = Infinity,
        maxAngle = 0,
        upperFaces = 0;
      const point = (i: number) =>
        new Vector3(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]);
      for (let i = 0; i < ix.length; i += 3) {
        const ids = [ix[i], ix[i + 1], ix[i + 2]],
          points = ids.map(point),
          cross = points[1]
            .clone()
            .sub(points[0])
            .cross(points[2].clone().sub(points[0]));
        const area = cross.length() / 2;
        minArea = Math.min(minArea, area);
        assert.ok(area > 1e-9);
        const upper = points.every(
          (p) => p.y > P.arena.goalHeight - P.arena.goalCurve + 0.01,
        );
        if (upper) {
          upperFaces++;
          for (const p of points) {
            assert.ok(sign * p.z >= P.arena.halfLength - 1e-5);
            assert.ok(p.y <= P.arena.goalHeight + P.arena.goalLip + 1e-5);
          }
        }
        for (let e = 0; e < 3; e++) {
          const key = [ids[e], ids[(e + 1) % 3]]
            .sort((a, b) => a - b)
            .join(",");
          const other = edges.get(key);
          if (other && upper && other.upper)
            maxAngle = Math.max(
              maxAngle,
              cross.clone().normalize().angleTo(other.normal),
            );
          else if (!other)
            edges.set(key, { normal: cross.clone().normalize(), upper });
        }
      }
      assert.ok(upperFaces > 500);
      assert.ok(maxAngle < 0.4, `upper seam angle ${maxAngle}`);
      return {
        vertices: v.length / 3,
        triangles: ix.length / 3,
        minArea,
        maxAngleDegrees: (maxAngle * 180) / Math.PI,
      };
    },
  );
for (const sign of [-1, 1])
  for (const side of [-1, 1])
    check(`goal ${sign} upper ${side} curved mouth remains driveable`, () => {
      const s = new Simulation(),
        c = s.cars[0];
      s.cars[1].collider.setCollisionGroups(0);
      s.ballCollider.setCollisionGroups(0);
      const a = P.arena,
        r = a.goalCurve,
        n = new Vector3(-side * Math.SQRT1_2, -Math.SQRT1_2, 0);
      const forward = new Vector3(0, 0, -sign),
        right = forward.clone().cross(n);
      const position = new Vector3(
        side * (a.goalHalf - r + r * Math.SQRT1_2),
        a.goalHeight - r + r * Math.SQRT1_2,
        sign * (a.halfLength + 3.5),
      ).addScaledVector(n, 0.34);
      c.reset(position.x, position.z, 0, position.y);
      c.body.setRotation(
        new Quaternion().setFromRotationMatrix(
          new Matrix4().makeBasis(right, n, forward.clone().negate()),
        ),
        true,
      );
      c.body.setLinvel(forward.clone().multiplyScalar(8), true);
      s.world.step();
      let supported = 0,
        maxAngular = 0;
      for (let i = 0; i < 100; i++) {
        tick(s, { throttle: 1 });
        if (c.contacts > 0) supported++;
        maxAngular = Math.max(
          maxAngular,
          new Vector3().copy(c.body.angvel()).length(),
        );
      }
      const final = c.body.translation();
      assert.ok(supported > 10, `supported ${supported}`);
      assert.ok(
        sign * final.z < a.halfLength - 0.5,
        `did not exit: ${JSON.stringify(final)}`,
      );
      assert.ok(maxAngular < 10 && Number.isFinite(final.y));
      s.dispose();
      return { supported, maxAngular, final };
    });
writeFileSync(
  "docs/gameplay-corrections.json",
  JSON.stringify(results, null, 2) + "\n",
);
if (results.some((r) => !r.pass)) process.exitCode = 1;
