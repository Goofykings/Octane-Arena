import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  Vector3,
  Quaternion,
  Matrix4,
  Object3D,
  PerspectiveCamera,
} from "three";
import { GameCamera } from "../src/camera/camera";
import { RingsPhysics, RingsRun } from "../src/extra/rings";
import { ExtraRecords } from "../src/extra/storage";
import { neutralInput } from "../shared/player";
import { P } from "../src/config/physics";

// A QA-only guidance controller, never shipped as game controls or bot logic.
// It uses ordinary PlayerInput, jump, boost and angular controls, with no pose
// edits after spawning: the entire course must be reachable in real physics.
await RAPIER.init();
const clamp = (value: number) => Math.max(-1, Math.min(1, value));
for (const id of ["ion", "vector"] as const) {
  const physics = new RingsPhysics(),
    car = physics.car;
  car.setBody(id);
  physics.reset();
  const run = new RingsRun(physics, new ExtraRecords(physics.course.id));
  const visual = new Object3D(),
    camera = new PerspectiveCamera(73, 16 / 9, 0.1, 1200),
    rig = new GameCamera(camera),
    previousOffset = new Vector3();
  rig.ballMode = false;
  let maxDistance = 0,
    maxOffsetStep = 0;
  let jumped = false,
    jumpHeld = 0,
    completedAt = -1,
    easyAt = -1;
  for (let i = 0; i < 120 * 120; i++) {
    const checkpoint = run.passed;
    const position = new Vector3().copy(car.body.translation());
    const velocity = new Vector3().copy(car.body.linvel());
    const rotation = new Quaternion().copy(car.body.rotation()).normalize();
    const last = physics.course.rings[39];
    const target =
      run.passed < 40
        ? physics.course.rings[run.passed]
        : {
            center: physics.course.finish.center
              .clone()
              .add(new Vector3(0, 0.36, 0)),
            normal: last.normal.clone().setY(0).normalize(),
          };
    const desiredVelocity = target.center
      .clone()
      .addScaledVector(target.normal, 1)
      .sub(position)
      .setY(0)
      .normalize()
      // The revised opening S requires steering rather than a straight boost
      // run. Approach at a controlled speed using the same real flight inputs.
      .multiplyScalar(run.passed < 9 ? 12 : run.passed < 29 ? 7 : 5);
    desiredVelocity.y = Math.max(
      -6,
      Math.min(6, (target.center.y - position.y) * 2),
    );
    const acceleration = desiredVelocity
      .sub(velocity)
      .multiplyScalar(2)
      .add(new Vector3(0, P.gravity, 0));
    // Ask for acceleration the normal boost engine can supply. Reserve thrust
    // for gravity, and pulse boost rather than requiring a fractional throttle.
    const courseForward = target.center
      .clone()
      .addScaledVector(target.normal, 1)
      .sub(position)
      .setY(0)
      .normalize();
    const horizontal = acceleration.clone().setY(0).clampLength(0, 4);
    acceleration.set(
      horizontal.x,
      Math.max(0.5, Math.min(9, acceleration.y)),
      horizontal.z,
    );
    const boostFrames = Math.min(
      12,
      Math.round((acceleration.length() / P.car.boostAir) * 12),
    );
    const forward = acceleration.normalize();
    // Preserve the course-facing right axis while pitching past vertical to
    // brake. Deriving it from thrust would flip it whenever braking starts.
    const right = courseForward
      .clone()
      .cross(new Vector3(0, 1, 0))
      .addScaledVector(
        forward,
        -courseForward
          .clone()
          .cross(new Vector3(0, 1, 0))
          .dot(forward),
      )
      .normalize();
    const up = right.clone().cross(forward).normalize();
    const targetRotation = new Quaternion().setFromRotationMatrix(
      new Matrix4().makeBasis(right, up, forward.clone().negate()),
    );
    const error = targetRotation.multiply(rotation.clone().invert());
    if (error.w < 0) error.set(-error.x, -error.y, -error.z, -error.w);
    const angle = 2 * Math.acos(Math.min(1, error.w));
    const torque = new Vector3(error.x, error.y, error.z)
      .normalize()
      .multiplyScalar(angle * 24)
      .addScaledVector(new Vector3().copy(car.body.angvel()), -5);
    const carRight = new Vector3(1, 0, 0).applyQuaternion(rotation);
    const carUp = new Vector3(0, 1, 0).applyQuaternion(rotation);
    const carForward = new Vector3(0, 0, -1).applyQuaternion(rotation);
    if (!jumped && position.z < -physics.course.start.length / 2 + 12) {
      jumped = true;
      jumpHeld = 10;
    }
    run.step(
      {
        ...neutralInput(),
        throttle: jumped ? 0 : 1,
        boost: jumped && i % 12 < boostFrames,
        jump: jumpHeld-- > 0,
        pitch: jumped ? clamp(-torque.dot(carRight) / P.car.airPitch) : 0,
        yaw: jumped ? clamp(-torque.dot(carUp) / P.car.airYaw) : 0,
        roll: jumped ? clamp(torque.dot(carForward) / P.car.airRoll) : 0,
      },
      (i * 1000) / 120,
    );
    assert.equal(
      run.resetSequence,
      0,
      `${id} at Ring ${checkpoint + 1} reset: ${run.reason}`,
    );
    assert.equal(car.boost, 100);
    if (i % 2 === 0) {
      visual.position.copy(car.body.translation());
      visual.quaternion.copy(car.body.rotation());
      rig.update(visual, null, physics, 1 / 60, false, i / 120);
      const offset = camera.position.clone().sub(visual.position);
      // Preserve the original ring-flight jitter check's scope. The added
      // finish landing encounters the solid deck, which intentionally retracts
      // the camera boom; unlike ring tubes, decks remain camera obstacles.
      if (checkpoint < 40) {
        maxDistance = Math.max(maxDistance, offset.length());
        if (i > 0)
          maxOffsetStep = Math.max(
            maxOffsetStep,
            offset.distanceTo(previousOffset),
          );
      }
      previousOffset.copy(offset);
      assert.ok(Number.isFinite(camera.position.lengthSq()));
    }
    if (run.passed >= 10 && easyAt < 0) easyAt = i / 120;
    if (run.phase === "complete") {
      completedAt = i / 120;
      break;
    }
  }
  assert.ok(
    completedAt > 0 && completedAt < 120 && easyAt > 0 && easyAt < 30,
    `${id} did not fly through the course (Ring 10 ${easyAt}, Ring 40 ${completedAt})`,
  );
  assert.equal(run.passed, 40);
  assert.ok(
    physics.landedOnFinish(),
    "Flight must end with real finish-deck contact",
  );
  console.log(
    `PASS ${id}: platform acceleration, jump, all 40 rings and physical finish landing using only normal inputs (${completedAt.toFixed(2)} s; Ring 10 ${easyAt.toFixed(2)} s), no resets`,
  );
  console.log(
    `Camera ${id}: max boom ${maxDistance.toFixed(2)}m, relative frame step ${maxOffsetStep.toFixed(2)}m`,
  );
  assert.ok(
    maxDistance < 9 && maxOffsetStep < 0.65,
    "Ring geometry destabilized the camera boom",
  );
  physics.dispose();
}
