import assert from "node:assert/strict";
import * as T from "three";
import { ballModel, animateBall, disposeModel } from "../src/render/models";
import {
  heatseekerBall,
  heatColor,
  HEAT_VISUAL,
} from "../src/effects/heatseeker-ball";
import { Heatseeker, heatseekerServeSpawn } from "../src/game/heatseeker";
import { HEATSEEKER as H } from "../src/config/heatseeker";
import { P } from "../src/config/physics";
const ball = ballModel(),
  soccar = ballModel(),
  h = new Heatseeker();
const panel = ball.userData.panelMaterial as T.MeshStandardMaterial,
  core = ball.userData.coreMaterial as T.MeshStandardMaterial;
const attribute = (
  ball.userData.panelGeometry as T.BufferGeometry
).getAttribute("color");
const original = new Float32Array(attribute.array);
try {
  animateBall(ball, 1);
  heatseekerBall(ball, h.state);
  assert.equal(panel.color.getHex(), HEAT_VISUAL.neutral);
  assert.ok(panel.metalness <= 0.3);
  assert.ok(panel.roughness <= 0.5 && panel.emissiveIntensity < 0.1);
  assert.ok(core.color.r > 0.6 && core.color.g > 0.6 && core.color.b > 0.6);
  const gray = new Float32Array(attribute.array);
  for (let i = 0; i < gray.length; i += 3)
    assert.ok(gray[i] === gray[i + 1] && gray[i + 1] === gray[i + 2]);
  assert.ok(new Set(gray).size > 1, "Gray panels retain dimensional variation");
  for (const team of [0, 1] as const) {
    h.touch("player-" + team, team, team + 1);
    animateBall(ball, 2);
    const before = panel.color.clone();
    heatseekerBall(ball, h.state, 1 / 60);
    assert.ok(
      panel.color.getHex() !== heatColor(h.state),
      "Color transitions rather than flashing immediately",
    );
    assert.notEqual(panel.color.getHex(), before.getHex());
    for (let frame = 0; frame < 20; frame++)
      heatseekerBall(ball, h.state, 1 / 60);
    const color = team === 0 ? 0x399cff : 0xff8b32;
    assert.equal(panel.color.getHex(), color);
    assert.equal(panel.emissive.getHex(), color);
    assert.equal(core.emissive.getHex(), color);
    for (const lamp of ball.userData.lamps) {
      const c = lamp.material.color;
      assert.ok(team === 0 ? c.b > c.r * 2 : c.r > c.b * 2);
    }
  }
  assert.ok(h.backboard(0));
  heatseekerBall(ball, h.state, 0.2);
  assert.equal(
    panel.color.getHex(),
    0x399cff,
    "Backboard ownership also changes the full ball",
  );
  while (h.state.speed < H.maxSpeed) {
    h.touch("max-player", h.state.ownerTeam === 0 ? 1 : 0, h.state.tier + 10);
  }
  const owner = h.state.ownerTeam,
    target = h.state.targetTeam;
  heatseekerBall(ball, h.state, 0.2);
  assert.equal(panel.color.getHex(), HEAT_VISUAL.maximum);
  assert.equal(core.emissive.getHex(), HEAT_VISUAL.maximum);
  h.touch("other-at-max", owner === 0 ? 1 : 0, 999);
  heatseekerBall(ball, h.state, 0.2);
  assert.equal(panel.color.getHex(), HEAT_VISUAL.maximum);
  assert.notEqual(h.state.ownerTeam, owner);
  assert.notEqual(h.state.targetTeam, target);
  const immutable = JSON.stringify(h.state);
  heatseekerBall(ball, h.state);
  assert.equal(JSON.stringify(h.state), immutable);
  h.reset(1);
  animateBall(ball, 3);
  heatseekerBall(ball, h.state);
  assert.equal(panel.color.getHex(), HEAT_VISUAL.neutral);
  assert.deepEqual(new Float32Array(attribute.array), gray);
  animateBall(ball, 4);
  heatseekerBall(ball, null);
  const originalPanel = soccar.userData.panelMaterial as T.MeshStandardMaterial;
  assert.equal(panel.color.getHex(), originalPanel.color.getHex());
  assert.equal(panel.metalness, originalPanel.metalness);
  assert.equal(panel.roughness, originalPanel.roughness);
  assert.deepEqual(new Float32Array(attribute.array), original);
  const soccarColors = new Float32Array(
    soccar.userData.panelGeometry.getAttribute("color").array,
  );
  heatseekerBall(soccar, null);
  assert.deepEqual(
    soccar.userData.panelGeometry.getAttribute("color").array,
    soccarColors,
  );
  for (const team of [0, 1] as const) {
    const position = heatseekerServeSpawn(team),
      sign = team === 0 ? 1 : -1;
    assert.equal(position.x * sign, 10);
    assert.equal(38 - position.z * sign, 18);
    assert.equal(position.y, P.ball.radius + 0.02);
    assert.ok(
      Math.abs(position.x) < P.arena.halfWidth - P.arena.ramp - P.ball.radius,
    );
  }
  assert.equal(H.initialSpeed * 3.6, 70);
  assert.equal(H.acceleration, 45);
  assert.equal(H.speedIncrement, 2.5);
  assert.equal(H.maxTurnRate, 2.2);
  assert.equal(H.maxSpeed, P.ball.maxSpeed);
} finally {
  disposeModel(ball);
  disposeModel(soccar);
}
console.log(
  "PASS detailed white neutral, smooth team and max-speed pink transitions, full panel/core/lamp coloring, backboard color, neutral kickoff reset, exact Soccar restoration, mirrored local serve and unchanged speed/curvature",
);
