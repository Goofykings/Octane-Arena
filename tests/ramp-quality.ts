import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import RAPIER from "@dimforge/rapier3d-compat";
import { Group, PerspectiveCamera, Quaternion, Vector3 } from "three";
import { Simulation } from "../src/physics/simulation";
import { GameCamera } from "../src/camera/camera";
import { FixedLoop } from "../src/physics/loop";
import { neutralInput } from "../shared/player";
import { P } from "../src/config/physics";
await RAPIER.init();
const s = new Simulation(false),
  c = s.cars[0],
  n = neutralInput();
s.cars[1].body.setEnabled(false);
const profiles = [
  { name: "slow", speed: 5, angle: 0, throttle: 0.6, boost: false },
  { name: "throttle max", speed: 14.1, angle: 0, throttle: 1, boost: false },
  { name: "full boost", speed: 23, angle: 0, throttle: 1, boost: true },
  { name: "boost 30", speed: 23, angle: 30, throttle: 1, boost: true },
  { name: "boost 45", speed: 23, angle: 45, throttle: 1, boost: true },
  { name: "boost glancing 75", speed: 23, angle: 75, throttle: 1, boost: true },
];
const results: object[] = [];
try {
  for (const body of ["ion", "vector"] as const)
    for (const side of [-1, 1])
      for (const travel of [-1, 1])
        for (const fps of [30, 60, 144])
          for (const profile of profiles) {
            c.setBody(body);
            const angle = (profile.angle * Math.PI) / 180;
            const direction = new Vector3(
              side * Math.cos(angle),
              0,
              travel * Math.sin(angle),
            );
            c.reset(
              side * 35,
              -travel * 20,
              Math.atan2(-direction.x, -direction.z),
            );
            s.ball.setTranslation({ x: 0, y: P.ball.radius, z: 0 }, true);
            s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
            for (let i = 0; i < 60; i++) s.step([n, n]);
            const camera = new PerspectiveCamera(76, 16 / 9, 0.05, 340);
            const control = new GameCamera(camera),
              model = new Group(),
              ball = new Group();
            ball.position.set(0, P.ball.radius, 0);
            c.pose.render(model, 1);
            for (let i = 0; i < fps; i++)
              control.update(model, ball, s, 1 / fps, false, 0);
            c.body.setLinvel(direction.multiplyScalar(profile.speed), true);
            const loop = new FixedLoop();
            let run = 0,
              longest = 0,
              rearRun = 0,
              longestRear = 0,
              zero = 0;
            let normalStep = 0,
              cameraRate = 0,
              maxHeight = 0,
              wall = 0;
            let force = 0,
              angular = 0,
              correction = 0;
            const trace: object[] = [];
            let previousNormal = c.normal.clone();
            for (let frame = 0; frame < fps * 8; frame++) {
              const result = loop.advance(1 / fps, () => {
                c.boost = 100;
                s.step([
                  { ...n, throttle: profile.throttle, boost: profile.boost },
                  n,
                ]);
                const p = c.body.translation();
                maxHeight = Math.max(maxHeight, p.y);
                if (Math.abs(p.x) > 37.5 && p.y < 8) {
                  run = c.contacts <= 1 ? run + 1 : 0;
                  longest = Math.max(longest, run);
                  rearRun =
                    !c.wheelContact[2] && !c.wheelContact[3] ? rearRun + 1 : 0;
                  longestRear = Math.max(longestRear, rearRun);
                  zero += Number(c.contacts === 0);
                  normalStep = Math.max(
                    normalStep,
                    c.normal.angleTo(previousNormal),
                  );
                  angular = Math.max(
                    angular,
                    new Vector3().copy(c.body.angvel()).length(),
                  );
                  force = Math.max(force, c.adhesionAcceleration.length());
                  correction = Math.max(
                    correction,
                    c.contactCorrection.length(),
                  );
                  if (c.normal.y < 0.1 && c.contacts >= 2) wall++;
                  if (c.contacts < 3 && trace.length < 8)
                    trace.push({
                      p: { ...p },
                      speed: new Vector3().copy(c.body.linvel()).length(),
                      wheels: [...c.wheelContact],
                      normals: c.wheelNormals.map((v) => v.toArray()),
                      normal: c.normal.toArray(),
                      angular: { ...c.body.angvel() },
                      correction: c.normalCorrectionAcceleration.toArray(),
                      adhesion: c.adhesionAcceleration.toArray(),
                    });
                }
                previousNormal.copy(c.normal);
              });
              c.pose.render(model, result.alpha);
              const q = camera.quaternion.clone();
              control.update(model, ball, s, 1 / fps, false, frame / fps);
              camera.updateMatrixWorld(true);
              cameraRate = Math.max(
                cameraRate,
                q.angleTo(camera.quaternion) * fps,
              );
              const screen = ball.position.clone().project(camera);
              const carScreen = model.position.clone().project(camera);
              assert.ok(
                Math.abs(carScreen.x) < 1 &&
                  Math.abs(carScreen.y) < 1 &&
                  carScreen.z < 1,
                `car framing lost ${body}/${side}/${travel}/${profile.name}/${fps}`,
              );
              assert.ok(
                Math.abs(screen.x) < 1 &&
                  Math.abs(screen.y) < 1 &&
                  screen.z < 1,
                `lost ball ${body}/${side}/${travel}/${profile.name}/${fps}: ${screen.toArray()}`,
              );
              assert.ok(Math.abs(camera.rotation.z) < 1e-9);
              assert.ok(
                camera.position.distanceTo(model.position) > 2.1,
                `boom collapsed ${body}/${side}/${travel}/${profile.name}/${fps} frame=${frame} car=${model.position.toArray()} camera=${camera.position.toArray()} desired=${control.desiredPosition.toArray()}`,
              );
              if (wall >= 24 || maxHeight >= 8) break;
            }
            const context = `${body}/${side}/${travel}/${profile.name}/${fps}`;
            assert.ok(
              maxHeight > 2 && wall >= 2,
              `no wall transition ${context}`,
            );
            assert.equal(zero, 0, `contact ejection ${context}`);
            assert.ok(longest <= 8, `one-wheel ${longest} ticks ${context}`);
            assert.ok(
              longestRear <= 25,
              `rear lift ${longestRear} ticks ${context}`,
            );
            assert.ok(
              normalStep < 0.2,
              `normal discontinuity ${normalStep} ${context}`,
            );
            assert.ok(cameraRate < 4, `camera snap ${cameraRate} ${context}`);
            assert.ok(force <= P.car.adhesion + P.gravity + 0.001);
            assert.equal(s.containmentRecoveries, 0);
            results.push({
              body,
              side,
              travel,
              fps,
              profile: profile.name,
              longest,
              longestRear,
              zero,
              normalStep,
              cameraRate,
              maxHeight,
              wall,
              angular,
              force,
              correction,
              referenceUp: control.referenceUp.toArray(),
              trace,
            });
          }
  console.log(
    "PASS 144 repeated real-physics ramp/Ball Cam runs: both bodies/sides/directions, A–E, 30/60/144 FPS",
  );
  // Stress vertical/parallel bearings and wall departure independently of car roll.
  for (const fps of [30, 60, 144])
    for (const side of [-1, 1]) {
      const camera = new PerspectiveCamera(76, 16 / 9, 0.05, 340);
      const control = new GameCamera(camera),
        model = new Group(),
        ball = new Group();
      model.position.set(side * 40.6, 8, 0);
      model.quaternion.setFromAxisAngle(
        new Vector3(0, 0, 1),
        (side * Math.PI) / 2,
      );
      c.normal.set(-side, 0, 0);
      c.grounded = true;
      c.wheelContact.fill(true);
      c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      for (const target of [
        [0, 1, 0],
        [0, 19, 0],
        [side * 39, 19, 0],
        [side * 39, 1, 0],
        [side * 40.6, 18, 0],
        [side * 40.6, 1, 0],
        [side * 39, 8, 15],
      ]) {
        control.reset();
        ball.position.fromArray(target);
        for (let i = 0; i < fps * 2; i++)
          control.update(model, ball, s, 1 / fps, false, i / fps);
        camera.updateMatrixWorld(true);
        const screen = ball.position.clone().project(camera);
        assert.ok(
          Math.abs(screen.x) < 1 && Math.abs(screen.y) < 1 && screen.z < 1,
          `wall target lost ${side}/${fps}/${target}: ${screen.toArray()}`,
        );
        assert.ok(Math.abs(camera.rotation.z) < 1e-9);
      }
    }
  console.log(
    "PASS wall Ball Cam: midfield, high, below, behind and parallel up/down bearings at 30/60/144 FPS",
  );
  for (const fps of [30, 60, 144])
    for (const side of [-1, 1])
      for (const jump of [false, true]) {
        c.reset(side * (P.arena.halfWidth - 0.36), 0, 0, 8);
        c.body.setRotation(
          new Quaternion()
            .setFromAxisAngle(new Vector3(0, 0, 1), (side * Math.PI) / 2)
            .multiply(
              new Quaternion().setFromAxisAngle(
                new Vector3(0, 1, 0),
                (side * Math.PI) / 2,
              ),
            ),
          true,
        );
        c.body.setLinvel({ x: 0, y: -14, z: 0 }, true);
        c.pose.snap();
        c.normal.set(-side, 0, 0);
        c.grounded = true;
        c.wheelContact.fill(true);
        const camera = new PerspectiveCamera(76, 16 / 9, 0.05, 340),
          control = new GameCamera(camera);
        const model = new Group(),
          ball = new Group();
        ball.position.set(0, 1, 0);
        c.pose.render(model, 1);
        for (let i = 0; i < fps; i++)
          control.update(model, ball, s, 1 / fps, false, 0);
        const loop = new FixedLoop();
        let ticks = 0,
          peakTurn = 0,
          detached = false,
          floor = false;
        for (let frame = 0; frame < fps * 3; frame++) {
          const sample = loop.advance(1 / fps, () => {
            c.boost = 100;
            s.step([
              { ...n, throttle: 1, boost: true, jump: jump && ticks < 12 },
              n,
            ]);
            ticks++;
            detached ||=
              jump &&
              !c.grounded &&
              Math.abs(c.body.translation().x) < P.arena.halfWidth - 0.7;
            floor ||=
              !jump &&
              c.grounded &&
              c.normal.y > 0.98 &&
              c.body.translation().y < 0.5;
          });
          c.pose.render(model, sample.alpha);
          const q = camera.quaternion.clone();
          control.update(model, ball, s, 1 / fps, false, frame / fps);
          peakTurn = Math.max(peakTurn, q.angleTo(camera.quaternion) * fps);
          camera.updateMatrixWorld(true);
          const screen = ball.position.clone().project(camera);
          assert.ok(
            Math.abs(screen.x) < 1 && Math.abs(screen.y) < 1 && screen.z < 1,
            `wall departure ball lost ${side}/${fps}/${jump}: ${screen.toArray()}`,
          );
          assert.ok(Math.abs(camera.rotation.z) < 1e-9);
          if ((detached && frame > fps * 0.8) || (floor && frame > fps)) break;
        }
        assert.ok(
          jump ? detached : floor,
          `wall departure failed ${side}/${fps}/${jump}`,
        );
        assert.ok(peakTurn < 4, `wall departure camera snap ${peakTurn}`);
      }
  console.log(
    "PASS real wall-to-floor and wall-jump aerial transitions in both directions at 30/60/144 FPS",
  );
} finally {
  writeFileSync(".tools/ramp-quality.json", JSON.stringify(results, null, 2));
  s.dispose();
}
