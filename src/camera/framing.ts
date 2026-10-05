import * as T from "three";

export const SAFE_FRAME = 0.85;
export const MAX_FRAMING_FOV = 120;
export const CAR_FRAME_RADIUS = 0.85;

/** Two angular subjects, including their extents, evaluated in the final pose. */
export class CameraFraming {
  readonly carScreen = new T.Vector3();
  readonly ballScreen = new T.Vector3();
  requiredFov = 0;
  feasible = true;
  private carRay = new T.Vector3();
  private ballRay = new T.Vector3();
  private local = new T.Vector3();
  private inverse = new T.Quaternion();

  aim(position: T.Vector3, car: T.Vector3, ball: T.Vector3, result: T.Vector3) {
    this.carRay.copy(car).sub(position).normalize();
    this.ballRay.copy(ball).sub(position).normalize();
    // Angular weighting avoids the far-away ball overwhelming the near car.
    // Give the ball a modest priority; reduce it as angular separation grows.
    const dot = this.carRay.dot(this.ballRay);
    const priority = T.MathUtils.lerp(
      0.5,
      0.56,
      T.MathUtils.smoothstep(dot, 0, 0.95),
    );
    result
      .copy(this.carRay)
      .multiplyScalar(1 - priority)
      .addScaledVector(this.ballRay, priority);
    if (result.lengthSq() < 1e-6) result.copy(this.carRay);
    result.normalize();
  }

  evaluate(
    position: T.Vector3,
    rotation: T.Quaternion,
    car: T.Vector3,
    ball: T.Vector3,
    ballRadius: number,
    aspect: number,
    fov: number,
    margin = SAFE_FRAME,
  ) {
    this.inverse.copy(rotation).invert();
    this.requiredFov = 0;
    this.feasible = true;
    this.subject(
      position,
      car,
      CAR_FRAME_RADIUS,
      aspect,
      fov,
      this.carScreen,
      margin,
    );
    this.subject(
      position,
      ball,
      ballRadius,
      aspect,
      fov,
      this.ballScreen,
      margin,
    );
    this.feasible &&= this.requiredFov <= MAX_FRAMING_FOV;
    return this.requiredFov;
  }

  private subject(
    position: T.Vector3,
    subject: T.Vector3,
    radius: number,
    aspect: number,
    fov: number,
    screen: T.Vector3,
    margin: number,
  ) {
    this.local.copy(subject).sub(position).applyQuaternion(this.inverse);
    const depth = -this.local.z;
    const tan = Math.tan(T.MathUtils.degToRad(fov / 2));
    screen.set(
      this.local.x / (depth * tan * aspect),
      this.local.y / (depth * tan),
      depth,
    );
    const extent = Math.max(
      Math.abs(this.local.y) + radius,
      (Math.abs(this.local.x) + radius) / aspect,
    );
    this.requiredFov = Math.max(
      this.requiredFov,
      T.MathUtils.radToDeg(2 * Math.atan2(extent, depth * margin)),
    );
    this.feasible &&= depth > radius;
  }
}
