import assert from "node:assert/strict";
import * as T from "three";
import { HeatseekerTrail } from "../src/effects/heatseeker-trail";
import { BallTrails } from "../src/effects/motion-trails";
import { HEAT_VISUAL } from "../src/effects/heatseeker-ball";
import { Heatseeker } from "../src/game/heatseeker";
import { HEATSEEKER as H } from "../src/config/heatseeker";
import type { Quality } from "../shared/settings";
const camera = new T.Vector3(0, 35, 70),
  point = new T.Vector3();
const counts: number[] = [];
for (const fps of [30, 60, 144])
  for (const quality of ["low", "medium", "high", "ultra"] as Quality[]) {
    const scene = new T.Scene(),
      trail = new HeatseekerTrail(scene),
      h = new Heatseeker();
    h.touch("blue", 0, 1);
    const arrays = [
      trail.history,
      trail.timestamps,
      trail.mesh.geometry.attributes.position.array,
    ];
    const immutable = JSON.stringify(h.state);
    for (let frame = 0; frame < fps * 5; frame++) {
      const time = (frame + 1) / fps;
      point.set(25 * Math.sin(time * 0.8), 4, -25 * Math.cos(time * 0.8));
      trail.update(point, 1 / fps, true, h.state, camera, quality);
    }
    assert.equal(
      trail.count,
      192,
      "History is bounded after continuous motion",
    );
    assert.equal(trail.history, arrays[0], "History storage is reused");
    assert.equal(trail.timestamps, arrays[1], "Timestamp storage is reused");
    assert.equal(
      trail.mesh.geometry.attributes.position.array,
      arrays[2],
      "Vertex storage is reused",
    );
    assert.equal(
      JSON.stringify(h.state),
      immutable,
      "Rendering cannot change ownership/physics state",
    );
    const vertices = trail.mesh.geometry.drawRange.count;
    assert.ok(vertices > 24 && vertices <= 192 * 18);
    assert.ok(trail.mesh.visible);
    const geometry = trail.mesh.geometry.attributes.position;
    let maximumDistance = 0;
    for (let v = 0; v < vertices; v++) {
      const p = new T.Vector3().fromBufferAttribute(geometry, v);
      assert.ok(p.toArray().every(Number.isFinite));
      maximumDistance = Math.max(maximumDistance, p.distanceTo(point));
    }
    assert.ok(
      maximumDistance > 15,
      "Early rally has a genuinely long trail, not the normal .22s trail",
    );
    assert.ok(maximumDistance < 40);
    // Points remain on the recent circular path; rotation never feeds the trail.
    for (let i = 0; i < 192; i++)
      assert.ok(
        Math.abs(
          Math.hypot(trail.history[i * 3], trail.history[i * 3 + 2]) - 25,
        ) < 0.01,
      );
    const midpoint = new T.Vector3().fromArray(
      trail.history,
      ((191 + 192 - 30) % 192) * 3,
    );
    assert.ok(
      Math.abs(midpoint.x - point.x) > 2,
      "History preserves the curved route",
    );
    assert.equal(
      trail.mesh.material.uniforms.color.value.getHex(),
      HEAT_VISUAL.blue,
    );
    if (fps === 60) counts.push(vertices);
    const before = trail.mesh.geometry.drawRange.count;
    trail.update(point, 0, true, h.state, camera, quality);
    assert.equal(
      trail.mesh.geometry.drawRange.count,
      before,
      "Pause freezes history",
    );
    while (h.state.speed < H.maxSpeed)
      h.touch("rise", h.state.ownerTeam === 0 ? 1 : 0, h.state.tier + 10);
    let firstColor = -1;
    for (let frame = 0; frame < 30; frame++) {
      point.x += 0.5;
      trail.update(point, 1 / 60, true, h.state, camera, quality);
      if (frame === 0)
        firstColor = trail.mesh.material.uniforms.color.value.getHex();
    }
    assert.notEqual(
      firstColor,
      HEAT_VISUAL.maximum,
      "Pink transition is gradual",
    );
    assert.equal(
      trail.mesh.material.uniforms.color.value.getHex(),
      HEAT_VISUAL.maximum,
    );
    const next = h.state.ownerTeam === 0 ? 1 : 0;
    h.touch("switch-at-max", next, 999);
    trail.update(point, 0.2, true, h.state, camera, quality);
    assert.equal(h.state.ownerTeam, next);
    assert.equal(h.state.targetTeam, 1 - next);
    assert.equal(
      trail.mesh.material.uniforms.color.value.getHex(),
      HEAT_VISUAL.maximum,
      "Max appearance survives target changes",
    );
    h.reset(1);
    point.set(10, 1, 20);
    trail.update(point, 1 / 60, true, h.state, camera, quality);
    assert.ok(trail.count <= 2);
    assert.equal(
      trail.mesh.material.uniforms.color.value.getHex(),
      HEAT_VISUAL.neutral,
    );
    h.touch("orange", 1, 11);
    trail.update(point, 0.2, true, h.state, camera, quality);
    assert.equal(
      trail.mesh.material.uniforms.color.value.getHex(),
      HEAT_VISUAL.orange,
    );
    point.set(100, 30, 100);
    trail.update(point, 1 / 60, true, h.state, camera, quality);
    assert.ok(
      trail.count <= 2,
      "Teleport/reset cannot leave an arena-spanning connector",
    );
    trail.update(point, 1 / 60, false, h.state, camera, quality);
    assert.equal(trail.count, 0);
    assert.equal(trail.mesh.visible, false);
    trail.mesh.geometry.dispose();
    trail.mesh.material.dispose();
  }
assert.ok(
  counts[0] < counts[1] && counts[1] < counts[2] && counts[2] <= counts[3],
  "Quality scales sample/streak work",
);
const scene = new T.Scene(),
  ball = new T.Group(),
  normal = new BallTrails(scene),
  h = new Heatseeker();
for (let i = 0; i < 30; i++) {
  ball.position.z -= 0.3;
  normal.updateBall(ball, 18, 0, 1 / 60, true, camera);
}
assert.ok(normal.mesh.visible);
assert.equal(normal.heatseeker.mesh.visible, false);
assert.equal(normal.lifetime, 0.22);
h.touch("b", 0, 1);
normal.updateBall(ball, 18, 0, 1 / 60, true, camera, 0, h.state);
assert.equal(normal.mesh.visible, false);
normal.reset();
assert.equal(normal.heatseeker.count, 0);
normal.updateBall(ball, 18, 0, 1 / 60, true, camera);
normal.updateBall(ball, 18, 0, 1 / 60, true, camera);
assert.equal(normal.heatseeker.mesh.visible, false);
console.log(
  "PASS curved long trails at 30/60/144 FPS, fixed storage/history, quality budgets, smooth max/team color, state isolation, pause/reset/teleport cleanup and unchanged normal trail",
);
