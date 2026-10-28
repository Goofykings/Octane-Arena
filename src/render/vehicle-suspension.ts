import { Group, Object3D, Quaternion, Vector3, MathUtils } from "three";
import type { Car } from "../car/car";
import { wheelMountY, wheelRadius, wheelClearance } from "../car/wheels";
import { VEHICLE_VISUALS as V } from "../config/vehicle-visuals";
import { vehicleGeometry } from "../car/suspension";
import { P } from "../config/physics";

class VisualSuspension {
  velocity = new Vector3();
  position = new Vector3();
  acceleration = new Vector3();
  inverse = new Quaternion();
  local = new Vector3();
  ready = false;
  longitudinal = 0;
  lateral = 0;
  pitch = 0;
  roll = 0;
  lengths = [-wheelMountY, -wheelMountY, -wheelMountY, -wheelMountY];
  offsets = [0, 0, 0, 0];
}

/** Render state only; no rigid-body setters or physics history are modified. */
export function animateSuspension(
  model: Group,
  car: Car,
  pose: Object3D,
  dt: number,
) {
  const mounts = model.userData.wheelMounts as Group[] | undefined;
  if (!mounts) return;
  const state: VisualSuspension = (model.userData.suspensionVisual ??=
    new VisualSuspension());
  const chassis = model.userData.visualChassis as Group | undefined;
  const velocity = car.body.linvel();
  const elapsed = Math.max(0, Math.min(V.maxFrameTime, dt));
  const reset =
    !state.ready ||
    dt > V.maxFrameTime ||
    state.position.distanceTo(pose.position) > V.teleportDistance;
  const supported =
    car.grounded && car.wheelContact.filter(Boolean).length >= 3;
  state.inverse.copy(pose.quaternion).invert();
  if (reset) {
    state.longitudinal = state.lateral = state.pitch = state.roll = 0;
    state.lengths.fill(-wheelMountY);
  }
  let longitudinal = 0,
    lateral = 0;
  if (!reset && elapsed > 0 && supported) {
    state.acceleration
      .copy(velocity)
      .sub(state.velocity)
      .divideScalar(elapsed)
      .applyQuaternion(state.inverse);
    longitudinal = MathUtils.clamp(
      -state.acceleration.z / V.longitudinalAcceleration,
      -1,
      1,
    );
    lateral = MathUtils.clamp(
      state.acceleration.x / V.lateralAcceleration,
      -1,
      1,
    );
  }
  const blend = 1 - Math.exp(-V.accelerationResponse * elapsed);
  state.longitudinal += (longitudinal - state.longitudinal) * blend;
  state.lateral += (lateral - state.lateral) * blend;
  state.pitch = state.longitudinal * V.maxPitch;
  state.roll = state.lateral * V.maxRoll;
  state.velocity.copy(velocity);
  state.position.copy(pose.position);
  state.ready = true;
  if (chassis) {
    chassis.rotation.set(state.pitch, 0, state.roll);
    // Lift only the extra pitch beyond the previous limit, preserving side lean.
    const excessPitch = Math.max(0, Math.abs(state.pitch) - V.pitchClearanceStart);
    const geometry = car.geometry ?? vehicleGeometry(car.bodyId);
    chassis.position.y = excessPitch * (geometry.wheelbase * 0.5 + wheelRadius * 0.5);
  }

  const min = -wheelMountY - wheelRadius * V.compressionRadius;
  const max = -wheelMountY + wheelRadius * V.extensionRadius;
  const droop =
    car.geometry?.restLength ?? vehicleGeometry(car.bodyId).restLength;
  for (let i = 0; i < mounts.length; i++) {
    let target = droop;
    if (car.wheelContact[i]) {
      state.local
        .copy(car.wheelHits[i])
        .sub(pose.position)
        .applyQuaternion(state.inverse);
      target = -state.local.y - wheelRadius;
      // Preserve the existing terrain query when a live world is available.
      // Replay proxies use their recorded wheel hits and never need a world.
      if (car.world) {
        const clearance = wheelClearance(
          car.world,
          pose.position,
          pose.quaternion,
          car.bodyId,
          i,
          car.collider,
          car.body,
          i < 2 ? car.steerAngle : 0,
        );
        if (Number.isFinite(clearance))
          target = Math.min(target, P.car.contactSkin - clearance);
      }
    }
    const transfer = supported
      ? ((i < 2 ? -1 : 1) * state.longitudinal * V.longitudinalTransferRadius -
          (i % 2 ? 1 : -1) * state.lateral * V.lateralTransferRadius) *
        wheelRadius
      : 0;
    // Clamp the TOTAL (including weight transfer), not the physics spring travel.
    target = MathUtils.clamp(target - transfer, min, max);
    const rate =
      target < state.lengths[i] ? V.compressionResponse : V.extensionResponse;
    state.lengths[i] +=
      (target - state.lengths[i]) * (1 - Math.exp(-rate * elapsed));
    state.lengths[i] = MathUtils.clamp(state.lengths[i], min, max);
    mounts[i].position.y = -state.lengths[i];
    state.offsets[i] = mounts[i].position.y - wheelMountY;
  }
  // Inspectable on a model when debugging; no overlay or per-frame logging.
  model.userData.suspension = state.lengths;
}
