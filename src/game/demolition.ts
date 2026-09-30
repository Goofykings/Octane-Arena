import { Vector3, Quaternion } from "three";
import type { Car } from "../car/car";
import { P } from "../config/physics";

/** Called only for a real collider contact, using pre-solver velocities. */
export function canDemolish(
  attacker: Car,
  victim: Car,
  velocity: Vector3,
  victimVelocity: Vector3,
) {
  if (
    attacker.demolitionState !== "active" ||
    victim.demolitionState !== "active" ||
    !attacker.body.isEnabled() ||
    !victim.body.isEnabled() ||
    attacker.team === victim.team ||
    !attacker.supersonic
  )
    return false;
  const toward = new Vector3()
    .subVectors(victim.body.translation(), attacker.body.translation())
    .normalize();
  const nose = new Vector3(0, 0, -1).applyQuaternion(
    new Quaternion().copy(attacker.body.rotation()),
  );
  return (
    nose.dot(toward) >= P.demolition.frontDot &&
    velocity.clone().normalize().dot(nose) >= P.demolition.frontDot &&
    velocity.dot(toward) > 0 &&
    velocity.clone().sub(victimVelocity).dot(toward) > P.demolition.minClosing
  );
}

export const respawnLocations = (team: number) =>
  [-30, -22, 22, 30].map(
    (x) => new Vector3(x, 0.36, (team === 0 ? 1 : -1) * 43),
  );
