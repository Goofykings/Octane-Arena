import assert from "node:assert/strict";
import { Vector3, Quaternion } from "three";
import { initializeSimulation } from "../src/physics/simulation";
import { DribblePhysics } from "../src/extra/dribble/physics";
import { buildDribbleCourse, dribbleLevels } from "../src/extra/dribble/levels";
import { neutralInput } from "../shared/player";
import { P, curvature } from "../src/config/physics";
import { bodies } from "../shared/catalog";
await initializeSimulation();
const n = neutralInput();
// Geometry traversal deliberately isolates the car. It proves there are no
// impossible road joints/gaps; it does not claim a full dribbling playthrough.
for (const level of dribbleLevels) {
  const p = new DribblePhysics(buildDribbleCourse(level)),
    c = p.car,
    nodes = p.course.nodes;
  try {
    p.ball.setEnabled(false);
    p.ballCollider.setCollisionGroups(0);
    const jumped = new Set<number>();
    let arrived = false;
    for (let i = 0; i < 20000; i++) {
      const pos = c.body.translation();
      let nearest = 0,
        closest = Infinity;
      for (let j = 0; j < nodes.length; j++) {
        const distance =
          (nodes[j].center.x - pos.x) ** 2 + (nodes[j].center.z - pos.z) ** 2;
        if (distance < closest) {
          closest = distance;
          nearest = j;
        }
      }
      const target = nodes[Math.min(nodes.length - 1, nearest + 5)].center;
      const forward = new Vector3(0, 0, -1).applyQuaternion(
        new Quaternion().copy(c.body.rotation()),
      );
      const heading = Math.atan2(forward.x, -forward.z),
        desired = Math.atan2(target.x - pos.x, -(target.z - pos.z));
      const error = Math.atan2(
        Math.sin(desired - heading),
        Math.cos(desired - heading),
      );
      const speed = new Vector3().copy(c.body.linvel()).dot(forward);
      const gap = nodes.findIndex((node, j) => j >= nearest && !node.connected);
      const distance =
        gap > 0 ? nodes[gap - 1].distance - nodes[nearest].distance : Infinity;
      const jump =
        gap > 0 &&
        distance <= 0.8 &&
        distance >= 0 &&
        c.grounded &&
        !jumped.has(gap);
      if (jump) jumped.add(gap);
      p.step({
        ...n,
        throttle: speed < 4.5 ? 0.16 : 0,
        steer: Math.max(
          -1,
          Math.min(1, (error * 2) / Math.max(0.4, speed * curvature(speed))),
        ),
        jump,
      });
      assert.ok(
        c.body.translation().y > p.course.failHeight,
        `Level ${level.id}: car fell during road traversal`,
      );
      if (nearest >= nodes.length - 6) {
        arrived = true;
        break;
      }
    }
    assert.ok(
      arrived,
      `Level ${level.id}: road could not be driven at modest speed`,
    );
  } finally {
    p.dispose();
  }
}
let gaps = 0;
for (const level of dribbleLevels) {
  const course = buildDribbleCourse(level);
  for (let index = 1; index < course.nodes.length; index++) {
    if (course.nodes[index].connected || !course.nodes[index - 1].connected)
      continue;
    const p = new DribblePhysics(course);
    try {
      const node = course.nodes[index - 1],
        direction = new Vector3(
          Math.sin(node.heading),
          0,
          -Math.cos(node.heading),
        );
      const start = node.center.clone().addScaledVector(direction, -0.5),
        d = bodies[p.car.bodyId];
      p.car.reset(start.x, start.z, -node.heading, start.y + 0.34);
      p.ball.setTranslation(
        {
          x: start.x,
          y: start.y + 0.34 + d.hitboxY + d.halfHeight + P.ball.radius + 0.03,
          z: start.z,
        },
        true,
      );
      for (let i = 0; i < 120; i++) p.step(n);
      p.car.body.setLinvel(direction.clone().multiplyScalar(4.5), true);
      p.ball.setLinvel(direction.clone().multiplyScalar(4.5), true);
      for (let i = 0; i < 150; i++) {
        p.step({ ...n, jump: i === 0, throttle: 0.08 });
        assert.equal(
          p.failed(),
          null,
          `Level ${level.id}: carrying the ball over gap ${gaps + 1} failed`,
        );
      }
      assert.ok(
        new Vector3()
          .copy(p.car.body.translation())
          .sub(node.center)
          .dot(direction) > 2,
      );
      const ball = p.ball.translation(),
        car = p.car.body.translation();
      assert.ok(
        Math.hypot(ball.x - car.x, ball.z - car.z) < 1.5 &&
          ball.y > car.y + 0.7,
      );
      gaps++;
    } finally {
      p.dispose();
    }
  }
}
console.log(
  `PASS real-input car traversal of all 20 courses and ${gaps} isolated ball-carry jumps at 4.5m/s; no geometry teleport/boost/aerial assist`,
);
