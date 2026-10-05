import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import RAPIER from "@dimforge/rapier3d-compat";
import { Group, PerspectiveCamera, Vector3 } from "three";
import { GameCamera } from "../src/camera/camera";
import { Simulation } from "../src/physics/simulation";
import { P } from "../src/config/physics";
import { CAR_FRAME_RADIUS } from "../src/camera/framing";
import { neutralInput } from "../shared/player";

await RAPIER.init();
const simulation = new Simulation();
const results: object[] = [];
const axis = new Vector3(0, 0, 1);
const scenarios: [
  string,
  (t: number, car: Group, ball: Group, rig: GameCamera) => void,
][] = [
  [
    "A normal drive",
    (t, c, b) => {
      c.position.set(0, 0.34, -3 * t);
      b.position.set(3, 1, -40);
    },
  ],
  [
    "B full-speed powerslide around ball",
    (t, c, b) => {
      const a = t * 2;
      c.position.set(11.5 * Math.sin(a), 0.34, 11.5 * Math.cos(a));
      c.rotation.y = a + Math.PI / 2;
      b.position.set(0, 1, 0);
    },
  ],
  ["C low-speed curve", (t, c, b) => curve(t / 8, c, b)],
  ["D full-speed curve", (t, c, b) => curve(Math.min(1, t * 3), c, b)],
  [
    "E vertical wall",
    (t, c, b) => {
      c.position.set(P.arena.halfWidth - 0.35, 8 + Math.sin(t) * 3, -t);
      c.rotation.z = Math.PI / 2;
      b.position.set(0, 1, 0);
    },
  ],
  [
    "F directly overhead",
    (t, c, b) => {
      c.position.set(0, 0.34, 0);
      b.position.set(
        0.02 * Math.sin(t * 10),
        9 + Math.sin(t),
        0.02 * Math.cos(t * 10),
      );
    },
  ],
  [
    "G ceiling overhead",
    (t, c, b) => {
      c.position.set(0, 0.34, 0);
      b.position.set(0.05 * Math.sin(t * 10), 19.4, 0.05 * Math.cos(t * 10));
    },
  ],
  [
    "H ball passes behind",
    (t, c, b) => {
      c.position.set(0, 0.34, 0);
      b.position.set(12 * Math.sin(t * 0.5), 1, -12 * Math.cos(t * 0.5));
    },
  ],
  [
    "I close noisy ball",
    (t, c, b) => {
      c.position.set(0, 0.34, 0);
      b.position.set(0.7 * Math.sin(t * 10), 1.2, 0.7 * Math.cos(t * 10));
    },
  ],
  [
    "H1 fast close ball crossing behind",
    (t, c, b) => {
      c.position.set(0, 0.34, 0);
      b.position.set(2, 1, 30 * Math.sin(t * 2));
    },
  ],
  [
    "J continuous aerial air-roll",
    (t, c, b) => {
      c.position.set(0, 5 + Math.sin(t) * 2, -t);
      c.rotation.set(t * 3, t * 4, t * 7);
      b.position.set(4, 8, -20);
    },
  ],
  [
    "K aerial overhead crossing",
    (t, c, b) => {
      c.position.set(0, 8, 0);
      c.rotation.set(t * 3, 0, t * 4);
      b.position.set(0, 15, -12 * Math.cos(t * 0.5));
    },
  ],
  [
    "L wall to aerial",
    (t, c, b) => {
      c.position.set(
        P.arena.halfWidth - 0.35 - t * 3,
        8 + Math.sin(t * 0.6) * 3,
        -t,
      );
      c.rotation.set(t, 0, Math.PI / 2 + t * 3);
      b.position.set(0, 4, -5);
    },
  ],
  ["M wall to floor", (t, c, b) => curve(1 - Math.min(1, t / 5), c, b)],
  [
    "N inverted car",
    (t, c, b) => {
      c.position.set(t, 0.35, 0);
      c.quaternion.setFromAxisAngle(axis, Math.PI);
      b.position.set(3, 1, -14);
    },
  ],
  [
    "O goal celebration",
    (t, c, b) => {
      c.position.set(Math.sin(t), 0.5 + Math.sin(t * 0.5) ** 2 * 2, 48);
      c.rotation.set(t, t, t);
      b.position.set(0, 1, 53);
    },
  ],
  [
    "P rapid toggles",
    (t, c, b, r) => {
      c.position.set(0, 0.34, 0);
      b.position.set(8, 3, -12);
      r.ballMode = Math.floor(t * 4) % 2 === 0;
    },
  ],
];
function curve(progress: number, c: Group, b: Group) {
  const a = (Math.max(0, Math.min(1, progress)) * Math.PI) / 2;
  c.position.set(
    P.arena.halfWidth - P.arena.ramp + (P.arena.ramp - 0.35) * Math.sin(a),
    P.arena.ramp - (P.arena.ramp - 0.35) * Math.cos(a),
    0,
  );
  c.rotation.set(0, -Math.PI / 2, a, "ZYX");
  b.position.set(0, 1, 0);
}
function extent(camera: PerspectiveCamera, point: Vector3, radius: number) {
  const local = point.clone().applyMatrix4(camera.matrixWorldInverse);
  const depth = -local.z,
    tan = Math.tan((camera.fov * Math.PI) / 360);
  return Math.max(
    (Math.abs(local.x) + radius) / (depth * tan * camera.aspect),
    (Math.abs(local.y) + radius) / (depth * tan),
  );
}
try {
  for (const fps of [30, 60, 144])
    for (const aspect of [16 / 9, 4 / 3, 9 / 16, 21 / 9])
      for (const [name, trajectory] of scenarios) {
        const car = new Group(),
          ball = new Group(),
          camera = new PerspectiveCamera(73, aspect, 0.05, 340),
          rig = new GameCamera(camera);
        const goal = name.startsWith("O") ? { x: 0, y: 1, z: 53 } : null;
        simulation.ball.setEnabled(!goal);
        trajectory(0, car, ball, rig);
        for (let i = 0; i < fps; i++)
          rig.update(car, ball, simulation, 1 / fps, false, 0, goal);
        let peakTurn = 0,
          peakExtent = 0,
          minimumBoom = Infinity,
          peakFovStep = 0;
        for (let i = 0; i < fps * 8; i++) {
          const t = i / fps;
          trajectory(t, car, ball, rig);
          const previous = camera.quaternion.clone(),
            fov = camera.fov;
          rig.update(car, ball, simulation, 1 / fps, false, t, goal);
          peakTurn = Math.max(
            peakTurn,
            previous.angleTo(camera.quaternion) * fps,
          );
          peakFovStep = Math.max(peakFovStep, Math.abs(camera.fov - fov));
          minimumBoom = Math.min(
            minimumBoom,
            camera.position.distanceTo(car.position),
          );
          assert.ok(camera.position.toArray().every(Number.isFinite));
          assert.ok(
            Math.abs(camera.rotation.z) < 1e-8,
            name + " inherited car roll",
          );
          const offset = camera.position.clone().sub(car.position),
            length = offset.length();
          assert.equal(
            simulation.world.castRay(
              new RAPIER.Ray(car.position, offset.normalize()),
              length - 0.02,
              true,
              undefined,
              undefined,
              undefined,
              undefined,
              (col) => col.parent() === null,
            ),
            null,
            name + " boom crossed arena",
          );
          assert.ok(
            extent(camera, car.position, CAR_FRAME_RADIUS) < 1,
            `${name}/${fps}/${aspect} t=${t}: car clipped during mode transition extent=${extent(camera, car.position, CAR_FRAME_RADIUS)} fov=${camera.fov} car=${rig.framing.carScreen.toArray()} ball=${rig.framing.ballScreen.toArray()} boom=${camera.position.toArray()}`,
          );
          if (rig.ballMode) {
            const currentExtent = Math.max(
              extent(camera, car.position, CAR_FRAME_RADIUS),
              extent(camera, ball.position, goal ? 0.2 : P.ball.radius),
            );
            peakExtent = Math.max(peakExtent, currentExtent);
            assert.ok(
              currentExtent <= 0.90001,
              `${name}/${fps}/${aspect} t=${t} frame extent=${currentExtent} fov=${camera.fov} feasible=${rig.framing.feasible} car=${rig.framing.carScreen.toArray()} ball=${rig.framing.ballScreen.toArray()}`,
            );
          }
        }
        assert.ok(
          peakTurn <= 5 * Math.max(1, 1 / aspect) + 0.001,
          `${name}/${fps} angular discontinuity ${peakTurn}`,
        );
        assert.ok(
          minimumBoom > 2.1,
          `${name} car obscures lens ${minimumBoom}`,
        );
        results.push({
          name,
          fps,
          aspect,
          peakTurn,
          peakExtent,
          minimumBoom,
          peakFovStep,
        });
      }
  console.log(
    "PASS 204 A–P and fast-pass camera torture trajectories: 30/60/144 FPS, 16:9/4:3/9:16/21:9",
  );
  // Camera must be independent of raw physics poses, wheel-normal noise and air roll.
  const car = new Group(),
    ball = new Group(),
    a = new GameCamera(new PerspectiveCamera(73, 16 / 9)),
    b = new GameCamera(new PerspectiveCamera(73, 16 / 9));
  simulation.ball.setEnabled(true);
  car.position.set(0, 8, 0);
  ball.position.set(3, 10, -12);
  for (let i = 0; i < 300; i++) {
    simulation.cars[0].body.setTranslation({ x: 0, y: 8, z: 0 }, true);
    simulation.cars[0].body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    simulation.cars[0].normal.set(0, 1, 0);
    car.rotation.set(0, 0, 0);
    a.update(car, ball, simulation, 1 / 60, false, i / 60);
    simulation.cars[0].body.setTranslation({ x: i * 0.1, y: 4, z: 20 }, true);
    simulation.cars[0].body.setLinvel(
      { x: i % 2 ? 60 : -60, y: 0, z: 0 },
      true,
    );
    simulation.cars[0].normal.set(i % 2 ? 1 : -1, 0, 0);
    car.rotation.set(i * 0.1, i * 0.2, i * 0.3);
    b.update(car, ball, simulation, 1 / 60, false, i / 60);
    assert.ok(a.camera.position.distanceTo(b.camera.position) < 1e-8);
    assert.ok(a.camera.quaternion.angleTo(b.camera.quaternion) < 1e-7);
  }
  console.log(
    "PASS render-pose independence from physics poses, wheel normals and aerial roll",
  );
  const previousRight = new Vector3(1, 0, 0),
    right = new Vector3();
  for (let i = 0; i < 100; i++) {
    const direction = new Vector3(
      Math.sin(i) * 1e-8,
      i < 50 ? 1 : -1,
      Math.cos(i) * 1e-8,
    ).normalize();
    (a as any).orientation(direction, a.camera.quaternion, 0);
    right.set(1, 0, 0).applyQuaternion(a.camera.quaternion);
    assert.ok(right.dot(previousRight) > 0.999999, "polar basis changed sign");
    assert.ok(a.camera.quaternion.toArray().every(Number.isFinite));
    previousRight.copy(right);
  }
  console.log(
    "PASS explicit up/down polar basis with alternating horizontal noise",
  );
  // Use the actual resting roof clearance, rather than a wheel-height fixture.
  simulation.cars[1].body.setEnabled(false);
  for (const body of ["ion", "vector"] as const) {
    const vehicle = simulation.cars[0];
    vehicle.setBody(body);
    vehicle.reset(0, 0, 0, 0.6);
    vehicle.body.setRotation(
      car.quaternion.setFromAxisAngle(axis, Math.PI),
      true,
    );
    simulation.ball.setTranslation({ x: 0, y: 1, z: -15 }, true);
    simulation.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    for (let i = 0; i < 120; i++)
      simulation.step([neutralInput(), neutralInput()]);
    const rig = new GameCamera(new PerspectiveCamera(73, 16 / 9, 0.05, 340));
    for (let i = 0; i < 60; i++) {
      vehicle.pose.render(car, 1);
      simulation.ballPose.render(ball, 1);
      rig.update(car, ball, simulation, 1 / 60, false, i / 60);
      assert.ok(
        rig.camera.position.distanceTo(car.position) > 3,
        `roof resting pivot blocked camera: ${body}`,
      );
      assert.ok(extent(rig.camera, car.position, CAR_FRAME_RADIUS) < 0.91);
      assert.ok(extent(rig.camera, ball.position, P.ball.radius) < 0.91);
    }
    console.log(
      "PASS actual inverted roof resting clearance",
      body,
      car.position.y,
    );
  }
} finally {
  simulation.dispose();
}
writeFileSync("docs/camera-rig.json", JSON.stringify(results, null, 2) + "\n");
