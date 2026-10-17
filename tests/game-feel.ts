import assert from "node:assert/strict";
import { Quaternion, Vector3, Scene, Group } from "three";
import { initializeSimulation, Simulation } from "../src/physics/simulation";
import { neutralInput } from "../shared/player";
import { P } from "../src/config/physics";
import { LandingContact } from "../src/car/landing";
import { LandingPulse } from "../src/effects/landing-pulse";
import { ScreenTransitions } from "../src/ui/motion";
import { UiAudio, uiSoundSamples, type UiCue } from "../src/audio/ui-audio";
await initializeSimulation();
const n = neutralInput();
function trial(angle: number, rate: number, body: "ion" | "vector", steer = 0) {
  const s = new Simulation(true),
    c = s.cars[0];
  s.ball.setEnabled(false);
  s.cars[1].body.setEnabled(false);
  c.setBody(body);
  c.physics = { ...s.physics, car: { ...s.physics.car, landingDamping: rate } };
  c.reset(0, 0, 0, 0.58);
  c.body.setRotation(
    new Quaternion().setFromAxisAngle(
      new Vector3(0, 0, 1),
      (angle * Math.PI) / 180,
    ),
    true,
  );
  c.body.setLinvel({ x: 2, y: -5, z: -8 }, true);
  c.body.setAngvel({ x: 0.6, y: 0, z: 0.8 }, true);
  let first = -1,
    settled = -1,
    tail = 0,
    peakRate = 0;
  for (let i = 0; i < 360; i++) {
    s.step([{ ...n, steer }, n]);
    peakRate = Math.max(peakRate, c.landing.rate);
    if (c.supportContacts >= 3 && first < 0) first = i;
    if (first >= 0 && i < first + 40)
      tail += Math.hypot(c.body.angvel().x, c.body.angvel().z);
    if (c.landing.rate > 0)
      assert.ok(
        new Vector3(0, 1, 0).applyQuaternion(
          new Quaternion().copy(c.body.rotation()),
        ).y > 0.985,
        "Damping only on near-aligned floor support",
      );
    if (
      first >= 0 &&
      settled < 0 &&
      c.up.y > 0.998 &&
      c.contacts === 4 &&
      Math.hypot(c.body.angvel().x, c.body.angvel().z) < 0.1
    )
      settled = i;
    if (c.supportKind === "edge" || c.up.y < 0.5)
      assert.equal(c.landing.rate, 0, "Partial/roof/nose poses remain free");
    assert.equal(s.containmentRecoveries, 0);
  }
  const result = {
    tail,
    settle: (settled - first) * P.dt,
    settled,
    peakRate,
    up: c.up.y,
  };
  s.dispose();
  return result;
}
let improvements = 0;
for (const body of ["ion", "vector"] as const)
  for (const angle of [0, 8, 15]) {
    const without = trial(angle, 0, body),
      withDamping = trial(angle, P.car.landingDamping, body);
    assert.ok(
      withDamping.settled >= 0 && withDamping.settle < 0.65,
      "Supported landing settles promptly",
    );
    assert.ok(
      withDamping.tail <= without.tail * 1.01,
      "Landing damping does not increase rotational energy",
    );
    if (withDamping.tail < without.tail * 0.94) improvements++;
  }
assert.ok(
  improvements >= 4,
  "Real contact fixtures show substantial rotational-energy reduction",
);
for (const angle of [70, 180]) {
  const result = trial(angle, P.car.landingDamping, "ion");
  assert.equal(result.peakRate, 0);
  assert.ok(result.up < -0.9, "Bad/roof landing is not rescued upright");
}
const state = new LandingContact();
for (let i = 0; i < 12; i++) state.step(true, false, P.dt, 18, 0.24);
assert.equal(
  state.step(false, false, P.dt, 18, 0.24),
  0,
  "Partial touchdown has no damping",
);
assert.equal(state.step(false, true, P.dt, 18, 0.24), 18);
assert.equal(
  state.step(false, false, P.dt, 18, 0.24),
  0,
  "Losing full support immediately removes damping",
);
for (let i = 0; i < 60; i++) state.step(false, true, P.dt, 18, 0.24);
assert.equal(state.rate, 0, "Temporary absorption expires");
// Identical free-flight trajectories with landing absorption enabled/disabled.
for (const input of [
  { ...n, pitch: 1, roll: 0.7 },
  { ...n, jump: true, dodgeX: 0.7, dodgeY: 1 },
  { ...n, jump: true, yaw: 1, roll: -1, directionalRoll: -1 },
]) {
  const run = (rate: number) => {
    const s = new Simulation(true),
      c = s.cars[0];
    s.ball.setEnabled(false);
    s.cars[1].body.setEnabled(false);
    c.physics = {
      ...s.physics,
      car: { ...s.physics.car, landingDamping: rate },
    };
    c.reset(0, 0, 0, 12);
    for (let i = 0; i < 60; i++) {
      s.step([i === 0 ? input : { ...input, jump: false }, n]);
      assert.equal(c.landing.rate, 0);
    }
    const result = [
      ...Object.values(c.body.rotation()),
      ...Object.values(c.body.linvel()),
      ...Object.values(c.body.angvel()),
    ];
    s.dispose();
    return result;
  };
  assert.deepEqual(
    run(18),
    run(0),
    "Aerial roll/flip/stall dynamics unchanged",
  );
}
// Reused visual geometry, floor-only trigger, finite fade, quality-off reset.
{
  const s = new Simulation(true),
    c = s.cars[0],
    scene = new Scene(),
    model = new Group(),
    pulse = new LandingPulse(scene);
  c.grounded = false;
  c.body.setLinvel({ x: 0, y: -6, z: 0 }, true);
  model.position.set(0, 1, 0);
  for (let i = 0; i < 12; i++) pulse.update(c, model, 1 / 60, true);
  c.grounded = true;
  c.normal.set(0, 1, 0);
  pulse.update(c, model, 1 / 60, true);
  assert.ok(pulse.mesh.visible);
  const geometry = pulse.mesh.geometry;
  for (let i = 0; i < 60; i++) pulse.update(c, model, 1 / 60, true);
  assert.equal(pulse.mesh.visible, false);
  assert.equal(pulse.mesh.geometry, geometry);
  assert.equal(scene.children.length, 1);
  LandingPulse.enabled = false;
  pulse.update(c, model, 1 / 60, true);
  assert.equal(pulse.mesh.visible, false);
  LandingPulse.enabled = true;
  pulse.dispose();
  assert.equal(scene.children.length, 0);
  s.dispose();
}
// Shared screen transitions survive rapid reversal and never retain stale inert/hidden state.
let reduced = false;
Object.defineProperty(globalThis, "matchMedia", {
  configurable: true,
  value: () => ({ matches: reduced }),
});
const animations: { finish: () => void }[] = [];
const panel = {
  hidden: true,
  inert: false,
  dataset: {},
  animate: () => {
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => (finish = resolve));
    animations.push({ finish });
    return { finished, cancel: finish };
  },
} as unknown as HTMLElement;
const transitions = new ScreenTransitions();
transitions.setVisible(panel, true);
assert.ok(!panel.hidden && !panel.inert);
transitions.setVisible(panel, false);
assert.equal(panel.inert, true);
transitions.setVisible(panel, true);
animations.forEach((a) => a.finish());
await new Promise((resolve) => setTimeout(resolve, 0));
assert.ok(
  !panel.hidden && !panel.inert,
  "Old exit completion cannot hide a newly opened panel",
);
const count = animations.length;
for (let i = 0; i < 1000; i++) transitions.setVisible(panel, true);
assert.equal(animations.length, count);
transitions.setVisible(panel, false);
animations.at(-1)!.finish();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(panel.hidden, true);
reduced = true;
transitions.setVisible(panel, true);
transitions.setVisible(panel, false);
assert.equal(panel.hidden, true);
// Original short waveforms and fixed buffer/gain budgets under rapid navigation.
const cues: UiCue[] = [
  "hover",
  "click",
  "back",
  "confirm",
  "error",
  "navigate",
];
const signatures = new Set<string>();
for (const cue of cues) {
  const samples = uiSoundSamples(cue, 48000);
  assert.ok(samples.length <= 6481);
  assert.equal(samples[0], 0);
  assert.ok(Math.abs(samples.at(-1)!) < 1e-6);
  assert.ok(Math.max(...samples) < 0.1);
  signatures.add(samples.slice(100, 110).join(","));
}
assert.equal(signatures.size, 6);
let buffers = 0,
  gains = 0,
  sources = 0;
const context = {
  sampleRate: 48000,
  currentTime: 0,
  createBuffer: (_: number, n: number, rate: number) => {
    buffers++;
    return { duration: n / rate, getChannelData: () => new Float32Array(n) };
  },
  createGain: () => {
    gains++;
    return { connect() {} };
  },
  createBufferSource: () => {
    sources++;
    return {
      buffer: null,
      connect() {},
      disconnect() {},
      start() {},
      onended: null,
    };
  },
};
const uiAudio = new UiAudio(
  context as unknown as AudioContext,
  {} as AudioNode,
);
for (let i = 0; i < 100; i++) {
  context.currentTime = i * 0.2;
  for (const cue of cues) uiAudio.play(cue);
}
assert.equal(buffers, 6);
assert.equal(gains, 8);
assert.ok(sources > 100);
const before = sources;
for (let i = 0; i < 100; i++) uiAudio.play("click");
assert.equal(
  sources,
  before,
  "Same-instant duplicate sound requests are coalesced",
);
console.log(
  "PASS real supported landing energy reduction; free roof/edge/aerial states; unchanged flight/flip/stall trajectories; pooled quality-aware landing pulse; reversible/reduced-motion screen transitions; six original cached UI cues and bounded voices",
);
