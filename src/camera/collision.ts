import * as T from "three";
import RAPIER from "@dimforge/rapier3d-compat";

const arenaOnly = (collider: RAPIER.Collider) => collider.parent() === null;
const axes = [
  new T.Vector3(1, 0, 0),
  new T.Vector3(-1, 0, 0),
  new T.Vector3(0, 1, 0),
  new T.Vector3(0, -1, 0),
  new T.Vector3(0, 0, 1),
  new T.Vector3(0, 0, -1),
];
const worldUp = new T.Vector3(0, 1, 0);

/** Static arena queries only. Never writes a physics pose or velocity. */
export class CameraClearance {
  readonly surfaceUp = new T.Vector3(0, 1, 0);
  blocked = false;
  nearestSurface = Infinity;
  inwardDistance = 1.5;
  private ray = new RAPIER.Ray(new T.Vector3(), new T.Vector3());
  private sphere = new RAPIER.Ball(0.2);
  private identity = new T.Quaternion();
  private referenceRotation = new T.Quaternion();
  private direction = new T.Vector3();
  private tangent = new T.Vector3();
  private previousTangent = new T.Vector3();
  private sum = new T.Vector3();
  private world!: RAPIER.World;
  private pivot = new T.Vector3();
  private length = 0;

  reset() {
    this.length = 0;
    this.previousTangent.set(0, 0, 0);
  }

  survey(
    world: RAPIER.World,
    pivot: T.Vector3,
    reach: number,
    dt: number,
    first: boolean,
  ) {
    this.world = world;
    this.pivot.copy(pivot);
    Object.assign(this.ray.origin, pivot);
    this.sum.set(0, 0, 0);
    this.nearestSurface = Infinity;
    for (let i = 0; i < axes.length; i++) {
      Object.assign(this.ray.dir, axes[i]);
      const hit = world.castRayAndGetNormal(
        this.ray,
        reach,
        true,
        undefined,
        undefined,
        undefined,
        undefined,
        arenaOnly,
      );
      const weight = hit
        ? 1 - T.MathUtils.smoothstep(hit.timeOfImpact, 0.3, reach)
        : 0;
      if (!hit) continue;
      this.direction.copy(hit.normal);
      this.nearestSurface = Math.min(
        this.nearestSurface,
        Math.max(0, -axes[i].dot(this.direction) * hit.timeOfImpact),
      );
      this.sum.addScaledVector(this.direction, weight * weight * weight);
    }
    if (this.sum.lengthSq() > 1e-5) this.sum.normalize();
    else this.sum.copy(worldUp);
    if (first) this.surfaceUp.copy(this.sum);
    else {
      // Vector lerp crosses zero for opposing normals after ceiling departure.
      this.referenceRotation
        .setFromUnitVectors(this.surfaceUp, this.sum)
        .slerp(this.identity, Math.exp(-18 * dt));
      this.surfaceUp.applyQuaternion(this.referenceRotation).normalize();
    }
  }

  /** Plan a readable boom in nearby surface half-spaces, before smoothing.
   * This reference-frame step is separate from the final obstruction cast.
   * A wall-facing bearing is degenerate: retain a consistent tangent sign. */
  plan(offset: T.Vector3, distance: number, previous: T.Vector3) {
    const normal = this.surfaceUp;
    const wallWeight = T.MathUtils.smoothstep(
      1 - Math.abs(normal.y),
      0.02,
      0.7,
    );
    const component = offset.dot(normal);
    const inward = this.inwardDistance * wallWeight;
    if (component < inward) offset.addScaledVector(normal, inward - component);
    if (wallWeight > 0.001) {
      this.tangent.crossVectors(normal, worldUp).normalize();
      const side =
        this.previousTangent.lengthSq() > 0.5 ? this.previousTangent : previous;
      if (this.tangent.dot(side) < -0.001) this.tangent.negate();
      this.previousTangent.copy(this.tangent);
      const minimum = distance * 0.85 * wallWeight;
      const along = offset.dot(this.tangent);
      if (along < minimum)
        offset.addScaledVector(this.tangent, minimum - along);
    }
    // Local tangent planes cannot describe a concave curve beyond its end.
    // Query the whole planned boom too, so a floor-curve plane cannot place
    // the ideal camera beyond the vertical wall higher up (or past a bar).
    // These half-space constraints choose the ideal rig, not the final pose.
    for (let pass = 0; pass < 3; pass++) {
      const length = offset.length();
      this.direction.copy(offset).divideScalar(Math.max(length, 1e-6));
      Object.assign(this.ray.origin, this.pivot);
      Object.assign(this.ray.dir, this.direction);
      const hit = this.world.castRayAndGetNormal(
        this.ray,
        length + 20,
        true,
        undefined,
        undefined,
        undefined,
        undefined,
        arenaOnly,
      );
      if (!hit) break;
      this.sum.copy(hit.normal);
      const gap = (length - hit.timeOfImpact) * this.direction.dot(this.sum);
      if (gap >= 0.8) break;
      offset.addScaledVector(this.sum, 0.8 - gap);
    }
  }

  /** Final collision stage: only shorten the smoothed boom. Reopen gradually. */
  resolve(
    world: RAPIER.World,
    pivot: T.Vector3,
    offset: T.Vector3,
    actual: T.Vector3,
    dt: number,
    first: boolean,
  ) {
    const desired = offset.length();
    this.direction.copy(offset).divideScalar(Math.max(desired, 1e-6));
    const hit = world.castShape(
      pivot,
      this.identity,
      this.direction,
      this.sphere,
      0.015,
      desired,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      arenaOnly,
    );
    const available = hit
      ? Math.max(0.05, hit.time_of_impact - 0.035)
      : desired;
    this.blocked = available < desired - 0.001;
    if (first || this.length > available) this.length = available;
    else this.length += (available - this.length) * (1 - Math.exp(-10 * dt));
    actual.copy(pivot).addScaledVector(this.direction, this.length);
  }
}
