import assert from "node:assert/strict";
import * as T from "three";
import { BallTrails } from "../src/effects/motion-trails";
import { SoccarTrail } from "../src/effects/soccar-trail";
import { P } from "../src/config/physics";

const camera = new T.Vector3(0, 30, 80);
for (const fps of [30, 60, 144]) {
  for (const speed of [5, 18, 80]) {
    const scene = new T.Scene(),
      ball = new T.Group(),
      trail = new BallTrails(scene);
    const history = trail.history,
      vertices = trail.mesh.geometry.attributes.position.array;
    for (let i = 0; i < fps * 4; i++) {
      const t = (i + 1) / fps;
      ball.position.set(
        20 * Math.sin((t * speed) / 20),
        3,
        20 * Math.cos((t * speed) / 20),
      );
      ball.rotation.x += 0.4;
      trail.updateBall(ball, speed, 0, 1 / fps, true, camera);
    }
    assert.equal(trail.count, SoccarTrail.capacity);
    assert.equal(trail.history, history);
    assert.equal(trail.mesh.geometry.attributes.position.array, vertices);
    assert.equal(
      scene.children.length,
      2,
      "Only one reusable mesh per trail type",
    );
    assert.ok(
      Math.abs(trail.renderedLength - 10 * P.ball.radius) < 0.001,
      "Five diameters of recent arc length",
    );
    assert.equal(
      trail.mesh.material.uniforms.color.value.getHex(),
      SoccarTrail.colors[0],
    );
    for (let i = 0; i < trail.count; i++) {
      assert.ok(
        Math.abs(Math.hypot(history[i * 3], history[i * 3 + 2]) - 20) < 0.05,
        "Curved history stays on actual flight path despite spin",
      );
    }
    const geometry = trail.mesh.geometry,
      count = geometry.drawRange.count;
    assert.ok(count > 12 && count <= SoccarTrail.capacity * 6);
    const a = new T.Vector3().fromBufferAttribute(
      geometry.attributes.position,
      0,
    );
    const b = new T.Vector3().fromBufferAttribute(
      geometry.attributes.position,
      1,
    );
    assert.ok(
      a.distanceTo(b) <= P.ball.radius * 0.181,
      "Thin near-ball ribbon",
    );
    const tailA = new T.Vector3().fromBufferAttribute(
      geometry.attributes.position,
      count - 4,
    );
    const tailB = new T.Vector3().fromBufferAttribute(
      geometry.attributes.position,
      count - 1,
    );
    assert.ok(tailA.distanceTo(tailB) < 0.001, "Taper closes at tail");
    const alpha = geometry.attributes.trailAlpha.array;
    assert.ok(
      alpha[0] > 0.1 && alpha[count - 1] < 0.001,
      "Bright head, fading tail",
    );
    for (let i = 0; i < count * 3; i++) assert.ok(Number.isFinite(vertices[i]));
    trail.updateBall(ball, speed, 1, 1 / fps, true, camera);
    const transition = trail.mesh.material.uniforms.color.value.getHex();
    assert.notEqual(transition, SoccarTrail.colors[0]);
    assert.notEqual(
      transition,
      SoccarTrail.colors[1],
      "Ownership blends instead of snapping",
    );
    for (let i = 0; i < fps * 2; i++)
      trail.updateBall(ball, speed, 1, 1 / fps, true, camera);
    assert.equal(
      trail.mesh.material.uniforms.color.value.getHex(),
      SoccarTrail.colors[1],
    );
    const oldCount = trail.count;
    trail.updateBall(ball, speed, 0, 0, true, camera);
    assert.equal(trail.count, oldCount, "Pause freezes history");
    trail.reset();
    assert.equal(trail.count, 0);
    assert.equal(geometry.drawRange.count, 0);
    assert.equal(trail.mesh.visible, false);
    assert.equal(trail.mesh.material.uniforms.color.value.getHex(), 0xc4c4c4);
    ball.position.set(100, 3, 0);
    trail.updateBall(ball, 18, null, 1 / fps, true, camera);
    ball.position.x += 0.3;
    trail.updateBall(ball, 18, null, 1 / fps, true, camera);
    assert.ok(trail.renderedLength < 0.31, "No old kickoff connector");
    assert.ok(
      geometry.attributes.trailAlpha.array[0] <= 0.12,
      "Neutral is subtle",
    );
    ball.position.x += 100;
    trail.updateBall(ball, 18, 0, 1 / fps, true, camera);
    assert.ok(
      trail.count <= 3 && trail.renderedLength === 0,
      "Teleport clears history",
    );
    trail.updateBall(ball, 0, null, 1 / fps, true, camera);
    assert.equal(trail.mesh.visible, false);
    trail.updateBall(ball, 18, 0, 1 / fps, false, camera);
    assert.equal(trail.count, 0);
  }
}
console.log(
  "PASS Soccar trail: 30/60/144 FPS, ownership blending, five-diameter curved path, thin tapered fade, fixed storage, pause/kickoff/teleport cleanup and neutral suppression",
);
