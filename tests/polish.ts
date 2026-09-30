import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3, Quaternion, Matrix4, Group, Scene } from "three";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { Simulation } from "../src/physics/simulation";
import { neutral } from "../src/input/types";
import { P } from "../src/config/physics";
import { Match } from "../src/game/match";
import { Pads } from "../src/game/pads";
import { canDemolish } from "../src/game/demolition";
import { goalPlane, goalIntersection, scoringTeam } from "../src/game/goals";
import { SkidMarks } from "../src/effects/skid-marks";

await RAPIER.init();
const results: {
  name: string;
  pass: boolean;
  data?: unknown;
  error?: string;
}[] = [];
function check(name: string, run: () => unknown) {
  try {
    const data = run();
    results.push({ name, pass: true, data });
    console.log("PASS", name, JSON.stringify(data));
  } catch (e) {
    results.push({ name, pass: false, error: String(e) });
    console.log("FAIL", name, String(e));
  }
}
const tick = (s: Simulation, controls = neutral(), n = 1) => {
  for (let i = 0; i < n; i++) s.step([controls, neutral()]);
};
function isolated(flat = true) {
  const s = new Simulation(flat);
  s.ballCollider.setCollisionGroups(0);
  s.cars[1].collider.setCollisionGroups(0);
  return s;
}

for (const initial of [0, 14, 23])
  for (const boost of [false, true])
    check(`wall entry speed ${initial} boost ${boost}`, () => {
      const s = isolated(false),
        c = s.cars[0];
      c.reset(29, 0, -Math.PI / 2);
      c.body.setLinvel({ x: initial, y: 0, z: 0 }, true);
      let supported = 0,
        lost = 0,
        maxHeight = 0;
      // Measure ascent only. The smaller ramp starts farther from the spawn;
      // allow the standing start to reach it without including ceiling falls.
      for (let i = 0; i < 480; i++) {
        tick(s, { ...neutral(), throttle: 1, boost });
        const p = c.body.translation();
        maxHeight = Math.max(maxHeight, p.y);
        if (p.y > 4 && p.y < 15) {
          if (c.contacts >= 2) supported++;
          else lost++;
        }
        assert.equal(c.recovering, false);
        if (maxHeight > 15) break;
      }
      assert.ok(supported > 25 && lost === 0);
      assert.ok(maxHeight > 15);
      s.dispose();
      return { supported, lost, maxHeight };
    });
check("wall stop slides and jump separates", () => {
  const s = isolated(false),
    c = s.cars[0],
    up = new Vector3(-1, 0, 0),
    fwd = new Vector3(0, 1, 0);
  const setup = () => {
    c.reset(40.62, 0, 0, 10);
    c.body.setRotation(
      new Quaternion().setFromRotationMatrix(
        new Matrix4().makeBasis(
          fwd.clone().cross(up),
          up,
          fwd.clone().negate(),
        ),
      ),
      true,
    );
    s.world.step();
  };
  setup();
  tick(s, neutral(), 360);
  const stoppedHeight = c.body.translation().y;
  assert.ok(stoppedHeight < 8, `wall height ${stoppedHeight}`);
  setup();
  tick(s);
  tick(s, { ...neutral(), jump: true });
  tick(s, neutral(), 20);
  assert.ok(c.body.translation().x < 40.2);
  assert.equal(c.grounded, false);
  s.dispose();
});
for (const side of [-1, 1])
  check(`side recovery ${side}`, () => {
    const s = isolated(),
      c = s.cars[0];
    c.reset(0, 0, 0, 0.44);
    c.body.setRotation(
      new Quaternion().setFromAxisAngle(
        new Vector3(0, 0, 1),
        (side * Math.PI) / 2,
      ),
      true,
    );
    let recovered = false,
      triggered = false;
    for (let i = 0; i < 360; i++) {
      tick(s, { ...neutral(), throttle: 1 });
      triggered ||= c.recovering;
      recovered ||= c.grounded && c.up.y > 0.8;
    }
    assert.ok(triggered && recovered);
    s.dispose();
    return { triggered, recovered };
  });
check("flip rigid-body angular calibration", () => {
  const s = isolated(),
    c = s.cars[0];
  c.reset(0, 0, 0);
  tick(s, neutral(), 30);
  tick(s, { ...neutral(), jump: true }, 24);
  tick(s);
  tick(s, { ...neutral(), jump: true, throttle: 1 });
  let angle = 0,
    peak = 0;
  const samples = [];
  for (let i = 0; i < 78; i++) {
    const q = new Quaternion().copy(c.body.rotation());
    tick(s);
    angle += q.angleTo(new Quaternion().copy(c.body.rotation()));
    peak = Math.max(peak, new Vector3().copy(c.body.angvel()).length());
    if ([11, 23, 47, 77].includes(i))
      samples.push({ time: (i + 1) / 120, angle });
    const model = new Group();
    c.pose.render(model, 1);
    assert.ok(
      model.quaternion
        .normalize()
        .angleTo(new Quaternion().copy(c.body.rotation()).normalize()) < 0.001,
    );
  }
  assert.ok(Math.abs(peak - P.jump.flipMaxAngular) < 0.001);
  // Integrate a full torque window: allow for the short acceleration ramp and
  // the final tick returning to the ordinary aerial cap.
  const targetAngle = P.jump.flipMaxAngular * P.jump.flipTime;
  assert.ok(angle > targetAngle * 0.94 && angle < targetAngle * 1.02);
  assert.ok(
    new Vector3().copy(c.body.angvel()).length() <= P.car.maxAngular + 0.001,
  );
  assert.equal(c.jump.flipLeft, 0);
  s.dispose();
  return { peak, samples };
});
check("supersonic hysteresis", () => {
  const s = isolated(),
    c = s.cars[0];
  c.body.setLinvel({ x: 0, y: 0, z: -22 }, true);
  c.updateSupersonic(P.dt);
  assert.ok(c.supersonic);
  c.body.setLinvel({ x: 0, y: 0, z: -21.5 }, true);
  for (let i = 0; i < 60; i++) c.updateSupersonic(P.dt);
  assert.ok(c.supersonic);
  for (let i = 0; i < 61; i++) c.updateSupersonic(P.dt);
  assert.equal(c.supersonic, false);
  c.body.setLinvel({ x: 0, y: 0, z: -22 }, true);
  c.updateSupersonic(P.dt);
  c.body.setLinvel({ x: 0, y: 0, z: -20 }, true);
  c.updateSupersonic(P.dt);
  assert.equal(c.supersonic, false);
  s.dispose();
});
for (const attackerIndex of [0, 1])
  check(
    `valid demolition attacker ${attackerIndex} and 3 second respawn`,
    () => {
      const s = new Simulation(true);
      s.ballCollider.setCollisionGroups(0);
      const a = s.cars[attackerIndex],
        v = s.cars[1 - attackerIndex];
      a.reset(0, 3, 0);
      v.reset(0, 0, Math.PI);
      a.body.setLinvel({ x: 0, y: 0, z: -23 }, true);
      for (let i = 0; i < 30 && v.demolitionState === "active"; i++)
        s.step([neutral(), neutral()]);
      assert.equal(v.demolitionState, "demolished");
      assert.equal(v.body.isEnabled(), false);
      assert.equal(v.collider.collisionGroups(), 0);
      assert.equal(s.demolitions.length, 1);
      const id = v.id;
      for (let i = 0; i < 359; i++) s.step([neutral(), neutral()]);
      assert.equal(v.demolitionState, "demolished");
      s.step([neutral(), neutral()]);
      assert.equal(v.demolitionState, "active");
      assert.equal(v.id, id);
      assert.equal(v.boost, 33);
      assert.ok(Math.abs(v.body.translation().x) >= 21);
      assert.ok(Math.sign(v.body.translation().z) === (v.team === 0 ? 1 : -1));
      assert.ok(v.body.isEnabled());
      s.dispose();
    },
  );
check("demo rejects slow, teammate, rear and lateral contacts", () => {
  const s = new Simulation(true),
    [a, b] = s.cars;
  a.reset(0, 2, 0);
  b.reset(0, 0, 0);
  a.supersonic = false;
  assert.equal(canDemolish(a, b, new Vector3(0, 0, -10), new Vector3()), false);
  a.supersonic = true;
  b.team = a.team;
  assert.equal(canDemolish(a, b, new Vector3(0, 0, -23), new Vector3()), false);
  b.team = 1;
  assert.equal(canDemolish(a, b, new Vector3(23, 0, 0), new Vector3()), false);
  assert.equal(canDemolish(a, b, new Vector3(0, 0, 23), new Vector3()), false);
  assert.equal(
    canDemolish(a, b, new Vector3(0, 0, -23), new Vector3(0, 0, -23)),
    false,
  );
  s.dispose();
});
check(
  "goal during demolition preserves identity and kickoff restores cars",
  () => {
    const s = new Simulation(true),
      m = new Match();
    m.start(s, "bot");
    m.phase = "playing";
    const [a, b] = s.cars;
    a.reset(0, 3, 0);
    b.reset(0, 0, Math.PI);
    b.displayName = "NOVA";
    s.ball.setTranslation({ x: 15, y: 1, z: 0 }, true);
    a.body.setLinvel({ x: 0, y: 0, z: -23 }, true);
    for (let i = 0; i < 30 && b.demolitionState === "active"; i++) tick(s);
    assert.equal(b.demolitionState, "demolished");
    s.lastTouchId = b.id;
    s.ball.setTranslation({ x: 0, y: 1, z: 53 }, true);
    m.tick(s);
    assert.equal(m.score[1], 1);
    assert.equal(m.lastGoal?.scorerId, b.id);
    assert.equal(m.message, "NOVA SCORED");
    m.kickoff(s);
    assert.ok(
      s.cars.every(
        (c) =>
          c.body.isEnabled() &&
          c.demolitionState === "active" &&
          c.boost === 33,
      ),
    );
    assert.equal(b.displayName, "NOVA");
    s.dispose();
  },
);
check("kickoff boosts and bot names survive goal flow", () => {
  const s = new Simulation(),
    m = new Match();
  for (const name of ["NOVA", "TURBO", "Quasar"]) {
    m.start(s, "bot");
    assert.ok(s.cars.every((c) => c.boost === 33));
    s.cars[1].displayName = name;
    m.phase = "playing";
    s.lastTouchId = s.cars[1].id;
    s.ball.setTranslation({ x: 0, y: 1, z: 53 }, true);
    m.tick(s);
    assert.equal(m.message, `${name.toUpperCase()} SCORED`);
    assert.equal(m.lastGoal?.scorerId, s.cars[1].id);
  }
  m.start(s, "freeplay");
  assert.equal(s.cars[0].boost, 100);
  s.dispose();
});
for (const sign of [-1, 1])
  check(`goal plane ${sign} full sphere crossing`, () => {
    const plane = goalPlane(sign),
      r = P.ball.radius;
    assert.equal(
      goalIntersection({ x: 0, y: 1, z: plane - sign * (r + 0.01) }, sign),
      null,
    );
    assert.equal(goalIntersection({ x: 0, y: 1, z: plane }, sign)?.radius, r);
    assert.equal(scoringTeam({ x: 0, y: 1, z: plane + sign * 0.01 }), null);
    assert.equal(
      scoringTeam({ x: 0, y: 1, z: plane + sign * (r - 0.001) }),
      null,
    );
    assert.equal(
      scoringTeam({ x: 0, y: 1, z: plane + sign * (r + 0.001) }),
      sign === 1 ? 1 : 0,
    );
  });
check("small and large pad exact amounts and respawns", () => {
  const s = isolated(),
    c = s.cars[0],
    pads = new Pads();
  for (const large of [false, true]) {
    const p = pads.items.find((p) => p.large === large)!;
    c.reset(p.x, p.z, 0);
    c.boost = 10.25;
    pads.tick([c]);
    assert.equal(c.boost, large ? 100 : 22.25);
    assert.equal(p.cooldown, large ? 10 : 4);
    for (let i = 0; i < (large ? 1200 : 480); i++) pads.tick([]);
    assert.ok(p.cooldown < 1e-8);
  }
  s.dispose();
});
check("skid marks use rear contacts and expire in pooled storage", () => {
  const s = isolated(),
    c = s.cars[0],
    marks = new SkidMarks(new Scene());
  c.right.set(1, 0, 0);
  c.normal.set(0, 1, 0);
  c.skidIntensity = 1;
  c.wheelContact = [true, true, false, false];
  marks.update(c, P.dt, true);
  assert.equal((marks as any).cursor, 0);
  c.wheelContact = [false, false, true, true];
  for (let i = 0; i < 10; i++) {
    c.wheelHits[2].set(-0.3, 0, -i * 0.1);
    c.wheelHits[3].set(0.3, 0, -i * 0.1);
    marks.update(c, P.dt, true);
  }
  assert.ok((marks as any).cursor > 0);
  const count = (marks as any).cursor;
  c.wheelContact.fill(false);
  for (let i = 0; i < 100; i++) marks.update(c, P.dt, true);
  assert.equal((marks as any).cursor, count);
  assert.ok(
    (marks as any).time - Math.max(...(marks as any).births) > P.skid.lifetime,
  );
  s.dispose();
  return { segments: count, lifetime: P.skid.lifetime };
});
writeFileSync(
  "docs/polish-calibration.json",
  JSON.stringify(results, null, 2) + "\n",
);
if (results.some((r) => !r.pass)) process.exitCode = 1;
