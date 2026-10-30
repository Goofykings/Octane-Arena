import RAPIER from "@dimforge/rapier3d-compat";
import type { Car } from "../car/car";
import type { CarSnapshot } from "../../shared/network";

/** Swept non-authoritative bodies. Caller advances Rapier at the existing 120 Hz;
 * ordinary targets use kinematic motion, only explicit discontinuities teleport. */
export class RemoteCollisionProxies {
  private lifetimes = new Map<string, string>();
  constructor(cars: readonly Car[]) {
    for (const car of cars)
      car.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
  }
  clear() {
    this.lifetimes.clear();
  }
  move(car: Car, state: CarSnapshot, reset: number) {
    const key = `${reset}:${state.teleportSequence ?? 0}:${state.enabled}`;
    car.body.setEnabled(state.enabled);
    if (this.lifetimes.get(car.id) !== key) {
      car.body.setTranslation(state.position, true);
      car.body.setRotation(state.rotation, true);
      car.pose.snap();
      this.lifetimes.set(car.id, key);
    }
    car.body.setNextKinematicTranslation(state.position);
    car.body.setNextKinematicRotation(state.rotation);
    car.forward.set(0, 0, -1).applyQuaternion(state.rotation);
    car.up.set(0, 1, 0).applyQuaternion(state.rotation);
    car.right.set(1, 0, 0).applyQuaternion(state.rotation);
    car.grounded = state.grounded;
    car.normal.copy(state.normal);
  }
}
