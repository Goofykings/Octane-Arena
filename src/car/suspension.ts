import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three";
import {
  HOOPS_NET_GROUP,
  DROPSHOT_TILE_GROUP,
} from "../physics/collision-groups";
import { bodies, type BodyId } from "../../shared/catalog";
import { P } from "../config/physics";
import { wheelMount, wheelRadius } from "./wheels";

export const WHEEL_NAMES = ["FL", "FR", "RL", "RR"] as const;

/** Wheel rays drive on static arena geometry only (never nets, tiles, cars or the ball). */
export const suspensionSurface = (col: RAPIER.Collider) =>
  col.parent() === null &&
  col.collisionGroups() !== HOOPS_NET_GROUP &&
  col.collisionGroups() !== DROPSHOT_TILE_GROUP;

/** Body-derived vehicle geometry. All bodies share the wheel hardpoint height
 * and radius, so they share the RL rest/ray lengths; COM, inertia and sprung
 * mass shares follow each chassis and axle. */
export function vehicleGeometry(id: BodyId) {
  const d = bodies[id],
    s = P.suspension,
    c = P.car;
  // RL rest length is the static ride length plus the static compression under
  // gravity and the resting sticky force (1.5 g / stiffness ≈ 2 cm).
  const staticCompression = (s.staticLoad * P.gravity) / s.stiffness;
  const restLength = c.contactHeight - wheelRadius + staticCompression;
  const comZ = d.axle * c.comRearAxleFraction;
  const wheelbase = 2 * d.axle;
  // Static moment balance about the COM: equal compression keeps the car level.
  const front = (d.axle - comZ) / (2 * wheelbase),
    rear = (d.axle + comZ) / (2 * wheelbase);
  const width = 2 * d.halfWidth,
    height = 2 * d.halfHeight,
    length = 2 * d.halfLength,
    k = c.mass / 12;
  return {
    restLength,
    rayLength: restLength + s.travel + wheelRadius - s.subtraction,
    bumpStop: restLength + wheelRadius - s.subtraction,
    minLength: restLength - s.travel,
    maxLength: restLength + s.travel,
    shares: [front, front, rear, rear] as const,
    wheelbase,
    com: new Vector3(0, d.hitboxY - d.halfHeight + c.comBottomOffset, comZ),
    // Bullet box inertia of the chassis about its own centre (RL does not add a
    // parallel-axis term for the COM offset). x = pitch, y = yaw, z = roll.
    inertia: {
      x: k * (height * height + length * length),
      y: k * (width * width + length * length),
      z: k * (width * width + height * height),
    },
  };
}
export type VehicleGeometry = ReturnType<typeof vehicleGeometry>;

/** One raycast wheel. Everything here is recomputed from the pose each tick;
 * the suspension itself is stateless, exactly like RL's raycast vehicle. */
export class WheelState {
  /** The ray reaches a static surface: spring, damper and tire forces run. */
  contact = false;
  /** Actually touching (near rest length): counts for contact state. */
  loaded = false;
  readonly hardpoint = new Vector3();
  readonly point = new Vector3();
  readonly normal = new Vector3();
  /** Ray hit distance from the hardpoint along -up. */
  distance = 0;
  /** Clamped suspension length (hardpoint to wheel centre). */
  length = 0;
  /** Rest length minus length: positive when compressed. */
  compression = 0;
  /** Suspension velocity along the contact normal; negative while compressing. */
  velocity = 0;
  springForce = 0;
  damperForce = 0;
  /** Final non-negative suspension force (N). */
  force = 0;
  /** Bump-stop impulse (N·s) once compression passes the RL subtraction depth. */
  pushback = 0;
  steer = 0;
  slip = 0;
  lateralFriction = 1;
  longitudinalFriction = 1;
  readonly impulse = new Vector3();
  clear() {
    this.contact = this.loaded = false;
    this.distance = this.length = this.compression = this.velocity = 0;
    this.springForce = this.damperForce = this.force = this.pushback = 0;
    this.slip = 0;
    this.lateralFriction = this.longitudinalFriction = 1;
    this.impulse.set(0, 0, 0);
  }
}

const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
/** Cast one wheel ray from its hardpoint along the chassis down axis. */
export function castWheel(
  world: RAPIER.World,
  wheel: WheelState,
  id: BodyId,
  index: number,
  position: Vector3,
  rotation: Quaternion,
  up: Vector3,
  geometry: VehicleGeometry,
  collider: RAPIER.Collider,
  body: RAPIER.RigidBody,
) {
  wheelMount(id, index, wheel.hardpoint)
    .applyQuaternion(rotation)
    .add(position);
  Object.assign(ray.origin, wheel.hardpoint);
  ray.dir.x = -up.x;
  ray.dir.y = -up.y;
  ray.dir.z = -up.z;
  const hit = world.castRayAndGetNormal(
    ray,
    geometry.rayLength,
    true,
    undefined,
    undefined,
    collider,
    body,
    suspensionSurface,
  );
  // A grazing hit (post side, wall seam, a car lying on its side) is not a
  // tire contact patch: tires only carry load within ~53° of their axis.
  if (
    !hit ||
    hit.normal.x * up.x + hit.normal.y * up.y + hit.normal.z * up.z <
      P.suspension.minContactDot
  ) {
    wheel.clear();
    wheel.point.copy(wheel.hardpoint).addScaledVector(up, -geometry.rayLength);
    wheel.normal.copy(up);
    wheel.length = geometry.maxLength;
    return false;
  }
  wheel.contact = true;
  wheel.distance = hit.timeOfImpact;
  wheel.point.copy(wheel.hardpoint).addScaledVector(up, -hit.timeOfImpact);
  wheel.normal.copy(hit.normal);
  wheel.length = Math.min(
    geometry.maxLength,
    Math.max(geometry.minLength, hit.timeOfImpact - wheelRadius),
  );
  wheel.compression = geometry.restLength - wheel.length;
  return true;
}
