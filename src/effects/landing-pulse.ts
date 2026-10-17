import * as T from "three";
import type { Car } from "../car/car";
/** Four faint wheel-contact scuffs; deliberately distinct from the ball reset ring. */
export class LandingPulse {
  static enabled = true;
  readonly mesh = new T.Mesh(
    new T.BufferGeometry().setAttribute(
      "position",
      new T.Float32BufferAttribute(
        [
          -0.5, -0.6, 0, -0.45, -0.6, 0, -0.5, -0.35, 0, -0.45, -0.6, 0, -0.45,
          -0.35, 0, -0.5, -0.35, 0, 0.45, -0.6, 0, 0.5, -0.6, 0, 0.45, -0.35, 0,
          0.5, -0.6, 0, 0.5, -0.35, 0, 0.45, -0.35, 0, -0.5, 0.35, 0, -0.45,
          0.35, 0, -0.5, 0.6, 0, -0.45, 0.35, 0, -0.45, 0.6, 0, -0.5, 0.6, 0,
          0.45, 0.35, 0, 0.5, 0.35, 0, 0.45, 0.6, 0, 0.5, 0.35, 0, 0.5, 0.6, 0,
          0.45, 0.6, 0,
        ],
        3,
      ),
    ),
    new T.MeshBasicMaterial({
      color: 0xc1d5dd,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: T.DoubleSide,
    }),
  );
  private age = 1;
  private air = 0;
  private downward = 0;
  private grounded = true;
  private previous = new T.Vector3();
  private zAxis = new T.Vector3(0, 0, 1);
  constructor(scene: T.Scene) {
    this.mesh.name = "landing-contact-pulse";
    this.mesh.visible = false;
    scene.add(this.mesh);
  }
  reset() {
    this.mesh.visible = false;
    this.age = 1;
    this.air = this.downward = 0;
    this.grounded = true;
  }
  update(car: Car, model: T.Object3D, dt: number, active: boolean) {
    if (!active || !LandingPulse.enabled || !car.body) {
      this.reset();
      return;
    }
    if (this.previous.distanceToSquared(model.position) > 64) {
      this.reset();
    }
    this.previous.copy(model.position);
    if (!car.grounded) {
      this.air += dt;
      this.downward = Math.max(this.downward, -car.body.linvel().y);
    }
    if (car.grounded && !this.grounded) {
      if (this.air > 0.08 && this.downward > 3 && car.normal.y > 0.8) {
        this.age = 0;
        this.mesh.position
          .copy(model.position)
          .addScaledVector(car.normal, -car.physics.car.contactHeight + 0.018);
        this.mesh.quaternion.setFromUnitVectors(this.zAxis, car.normal);
      }
      this.air = this.downward = 0;
    }
    this.grounded = car.grounded;
    this.age += dt;
    this.mesh.visible = this.age < 0.24;
    if (this.mesh.visible) {
      const t = this.age / 0.24;
      this.mesh.scale.setScalar(1 + t * 0.2);
      this.mesh.material.opacity = (1 - t) * 0.18;
    }
  }
  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
