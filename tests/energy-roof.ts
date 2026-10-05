import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { initializeSimulation, Simulation } from "../src/physics/simulation";
import { neutral } from "../src/input/types";
import { Opponent } from "../src/ai/opponent";
import { P } from "../src/config/physics";
import { bodies } from "../shared/catalog";
import { NetworkMatch } from "../server/src/network-match";
import { starter } from "../shared/catalog";

await initializeSimulation();
const n = neutral();
function setup(flat: boolean, body: "ion" | "vector" = "ion") {
  const s = new Simulation(flat),
    c = s.cars[0];
  s.ball.setEnabled(false);
  s.cars[1].body.setEnabled(false);
  c.setBody(body);
  return { s, c };
}
function invert(c: Simulation["cars"][number], yaw = 0) {
  c.body.setRotation(
    new Quaternion()
      .setFromAxisAngle(new Vector3(0, 1, 0), yaw)
      .multiply(
        new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI),
      ),
    true,
  );
}
for (const body of ["ion", "vector"] as const) {
  for (const action of ["coast", "steer", "steerLeft", "boost"] as const) {
    const { s, c } = setup(true, body);
    try {
      c.reset(0, 0, 0, 0.7);
      invert(c);
      for (let i = 0; i < 120; i++) s.step([n, n]);
      const height = c.body.translation().y;
      assert.ok(
        Math.abs(height - (bodies[body].hitboxY + bodies[body].halfHeight)) <
          0.025,
      );
      c.body.setLinvel({ x: 0, y: 0, z: -10 }, true);
      let yaw = 0,
        maxVertical = 0;
      const steer = action === "steer" ? 1 : action === "steerLeft" ? -1 : 0;
      for (let i = 0; i < 120; i++) {
        s.step([
          {
            ...n,
            steer,
            yaw: steer,
            boost: action === "boost",
          },
          n,
        ]);
        yaw += c.body.angvel().y * P.dt;
        maxVertical = Math.max(
          maxVertical,
          Math.abs(c.body.translation().y - height),
        );
        assert.ok(
          c.up.y < -0.98,
          "flat roof should remain supported without a keep-flat torque",
        );
        assert.equal(
          c.contacts,
          0,
          "roof contact must not run wheel alignment/adhesion",
        );
        assert.equal(c.recovering, false);
      }
      assert.ok(maxVertical < 0.025, `${body} ${action} jitter ${maxVertical}`);
      if (steer) {
        assert.ok(
          yaw * steer > 0.85 && yaw * steer < 2,
          `correct direction and freer roof yaw ${yaw}`,
        );
        assert.equal(
          c.collider.friction(),
          Math.fround(P.car.roofSteeringFriction),
        );
        s.step([n, n]);
        assert.equal(
          c.collider.friction(),
          P.car.roofFriction,
          "release restores normal roof sliding friction",
        );
      }
      if (action === "coast")
        assert.ok(
          Math.abs(c.body.linvel().z) < 9,
          "roof friction slows coasting",
        );
      if (action === "boost")
        assert.ok(
          c.forwardSpeed > 15 && c.body.translation().z < -12,
          "COM boost propels supported roof",
        );
      console.log("PASS rigid flat roof", body, action, { yaw, maxVertical });
    } finally {
      s.dispose();
    }
  }
  for (const side of [-1, 1])
    for (const speed of [5, 14, 23]) {
      const { s, c } = setup(false, body);
      try {
        c.reset(side * 34, 0, 0, 0.7);
        invert(c, (-side * Math.PI) / 2);
        for (let i = 0; i < 120; i++) s.step([n, n]);
        c.body.setLinvel({ x: side * speed, y: 0, z: 0 }, true);
        let wallFrames = 0,
          worstAlignment = 1,
          separation = 0;
        for (let i = 0; i < 200; i++) {
          c.boost = 100;
          s.step([{ ...n, boost: true }, n]);
          const p = c.body.translation();
          if (p.y > 3 && p.y < 12 && Math.abs(p.x) > 40) {
            wallFrames++;
            worstAlignment = Math.min(worstAlignment, side * c.up.x);
            const q = new Quaternion().copy(c.body.rotation()),
              d = bodies[body];
            for (const z of [-d.halfLength, d.halfLength]) {
              const roof = new Vector3(0, d.hitboxY + d.halfHeight, z)
                .applyQuaternion(q)
                .add(p);
              separation = Math.max(
                separation,
                P.arena.halfWidth - Math.abs(roof.x),
              );
            }
          }
          assert.equal(
            s.containmentRecoveries,
            0,
            "roof transition must work without containment reset",
          );
        }
        assert.ok(
          wallFrames > 20,
          `${body} ${side} ${speed}: should climb the curve`,
        );
        assert.ok(
          worstAlignment > 0.88,
          `${body} ${side} ${speed}: nose hinge alignment ${worstAlignment}`,
        );
        assert.ok(
          separation < 0.3,
          `${body} ${side} ${speed}: rear roof gap ${separation}`,
        );
        console.log("PASS roof-to-wall", body, side, speed, {
          wallFrames,
          worstAlignment,
          separation,
        });
      } finally {
        s.dispose();
      }
    }
}

// Actual bot inputs drive the physics/jump state, rather than manually faking a dodge.
for (const kind of ["travel", "challenge", "diagonal", "miss"] as const) {
  const { s, c } = setup(true),
    bot = new Opponent();
  try {
    c.reset(0, 0, Math.PI);
    for (let i = 0; i < 60; i++) s.step([n, n]);
    c.body.setLinvel({ x: 0, y: 0, z: 8 }, true);
    s.step([n, n]);
    const ball = {
      x: kind === "diagonal" ? 1 : kind === "miss" ? 6 : 0,
      y: 0.9125,
      z: kind === "travel" ? 80 : 6,
    };
    let boostTicks = 0,
      dodges = 0,
      wasSecond = false,
      recovered = false;
    for (let i = 0; i < 300; i++) {
      const input = bot.sample(c, ball, s.clock);
      boostTicks += Number(input.boost);
      s.step([input, n]);
      if (c.jump.second && !wasSecond) {
        dodges++;
        if (kind === "diagonal") assert.ok(Math.abs(c.jump.direction.x) > 0.05);
      }
      wasSecond = c.jump.second;
      if (kind === "miss" && i < 30)
        assert.equal(
          dodges,
          0,
          "do not flip before lining up with an off-line ball",
        );
      if (dodges && c.grounded && c.up.y > 0.98) recovered = true;
    }
    if (kind !== "miss") {
      assert.ok(dodges >= 1 && dodges <= 2, `${kind} bounded flips ${dodges}`);
      assert.ok(recovered, `${kind} bot should recover after flipping`);
    }
    if (kind === "travel")
      assert.ok(boostTicks > 15, "bot actively boosts on useful travel");
    console.log("PASS bot", kind, { boostTicks, dodges, recovered });
  } finally {
    s.dispose();
  }
}
// Previously the narrower boost policy refused these useful approaches.
{
  const { s, c } = setup(true);
  try {
    c.reset(0, 0, Math.PI);
    for (let i = 0; i < 60; i++) s.step([n, n]);
    c.boost = 10;
    const input = new Opponent().sample(c, { x: 2.3, y: 0.9125, z: 12 }, 1);
    assert.ok(
      input.boost,
      "moderately aligned travel uses available low boost reserve",
    );
    c.body.setRotation(new Quaternion(), true);
    assert.equal(
      new Opponent().sample(c, { x: 0, y: 0.9125, z: 12 }, 1).boost,
      false,
      "do not boost facing away",
    );
  } finally {
    s.dispose();
  }
}

// Drive the authoritative match through a real goal, pickup, and kickoff reset.
const game = new NetworkMatch([
  { id: "a", name: "A", team: 0, controller: "remote", preset: starter() },
  { id: "b", name: "B", team: 1, controller: "remote", preset: starter() },
]);
try {
  while (game.match.phase === "countdown") game.step(0);
  game.simulation.ball.setTranslation({ x: 0, y: 1, z: -53 }, true);
  game.step(0);
  assert.equal(game.match.phase, "goal");
  const car = game.simulation.cars[0];
  game.simulation.cars[1].body.setEnabled(false);
  for (const large of [false, true]) {
    const pad = game.pads.items.find((p) => p.large === large)!;
    pad.cooldown = 0;
    car.reset(pad.x, pad.z, 0);
    car.boost = 20;
    game.step(0);
    assert.equal(car.boost, large ? 100 : 32);
    assert.ok(pad.pulse! > 0);
    assert.ok(pad.cooldown > 0);
    const cooldown = pad.cooldown;
    game.step(0);
    assert.ok(pad.cooldown < cooldown);
    assert.equal(
      car.boost,
      large ? 100 : 32,
      "pad cannot be collected twice during cooldown",
    );
  }
  const reset = game.match.resetSequence;
  while (game.match.phase === "goal") game.step(0);
  assert.equal(game.match.phase, "countdown");
  assert.ok(game.match.resetSequence > reset);
  assert.equal(car.boost, 33);
  assert.ok(game.pads.items.every((p) => p.cooldown === 0));
  const pose = { ...car.body.translation() };
  game.step(0);
  assert.deepEqual({ ...car.body.translation() }, pose);
  console.log(
    "PASS post-goal small/large pickups, boost values, pulses, cooldowns, normal kickoff reset",
  );
} finally {
  game.dispose();
}
