import assert from "node:assert/strict";
import { initializeSimulation, Simulation } from "../src/physics/simulation";
import { Match } from "../src/game/match";
import { neutralInput } from "../shared/player";
import { P } from "../src/config/physics";
import { HEATSEEKER as H } from "../src/config/heatseeker";
import { Vector3, Quaternion } from "three";
await initializeSimulation();
for (const boost of [false, true]) {
  const s = new Simulation(),
    m = new Match();
  m.gameMode = "heatseeker";
  const random = Math.random;
  Math.random = () => 0.1;
  try {
    m.start(s, "network");
    Math.random = random;
    s.cars[1].collider.setCollisionGroups(0);
    const n = neutralInput();
    for (let i = 0; i < 120; i++) s.step([n, n]);
    let before = 0,
      contact = 0,
      after = 0,
      age = 0,
      hit = false,
      reached: number | null = null;
    for (let i = 0; i < 2400; i++) {
      const c = s.cars[0],
        q = new Quaternion().copy(c.body.rotation());
      const f = new Vector3(0, 0, -1).applyQuaternion(q),
        r = new Vector3(1, 0, 0).applyQuaternion(q);
      const delta = new Vector3()
        .copy(s.ball.translation())
        .sub(c.body.translation());
      const steer = Math.max(
        -1,
        Math.min(1, Math.atan2(delta.dot(r), delta.dot(f)) * 2),
      );
      const prev = Math.hypot(...Object.values(s.ball.linvel()));
      s.step([hit ? n : { ...n, throttle: boost ? 1 : 0.25, boost, steer }, n]);
      const speed = new Vector3().copy(s.ball.linvel()).length();
      if (!hit && s.heatseeker!.state.active) {
        hit = true;
        before = prev;
        contact = speed;
        if (speed >= H.initialSpeed * 0.98) reached = 0;
        continue;
      }
      if (hit) {
        age += P.dt;
        if (age <= P.dt + 1e-7) after = speed;
        if (reached === null && speed >= H.initialSpeed * 0.98) reached = age;
        if (age > 0.65) break;
      }
    }
    assert.ok(hit, "Real approach must produce a first touch");
    assert.ok(
      reached !== null && reached < 0.35,
      "Existing homing must promptly reach initial target",
    );
    assert.equal(H.initialSpeed * 3.6, 70);
    assert.equal(H.acceleration, 45);
    console.log(
      JSON.stringify({
        boost,
        beforeKmh: before * 3.6,
        contactKmh: contact * 3.6,
        firstHomingKmh: after * 3.6,
        timeTo98Percent: reached,
        targetKmh: H.initialSpeed * 3.6,
        acceleration: H.acceleration,
      }),
    );
  } finally {
    Math.random = random;
    s.dispose();
  }
}
