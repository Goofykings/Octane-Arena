import { Vector3, Quaternion } from "three";
import type { Car } from "../car/car";
import { neutral, type Controls } from "../input/types";
export class Opponent {
  name = "";
  constructor() {
    this.rename();
  }
  rename() {
    const names = [
      "Kestrel",
      "Vanta",
      "Rivet",
      "Flux",
      "Mistral",
      "Brisk",
      "Cinder",
      "Fable",
      "Quasar",
      "Tinker",
      "Relay",
      "Aster",
    ];
    this.name = names[Math.floor(Math.random() * names.length)];
  }
  private target = new Vector3();
  private local = new Vector3();
  private inverse = new Quaternion();
  private nextJump = 0;
  sample(
    car: Car,
    ball: { x: number; y: number; z: number },
    time: number,
  ): Controls {
    const c = neutral(),
      p = car.body.translation();
    // Orange attacks +Z. Approach from behind the ball; retreat if it is behind us.
    this.target.set(ball.x, 0, ball.z - 4);
    if (p.z > ball.z + 2)
      this.target.set(ball.x + (p.x > ball.x ? 6 : -6), 0, ball.z - 8);
    const distance = this.target.distanceTo(p);
    if (distance < 5) this.target.set(ball.x, 0, ball.z + 1);
    this.local
      .copy(this.target)
      .sub(p)
      .applyQuaternion(this.inverse.copy(car.body.rotation()).invert());
    const angle = Math.atan2(this.local.x, -this.local.z);
    c.steer = Math.max(-1, Math.min(1, angle * 2));
    c.throttle = 1;
    c.slide = Math.abs(angle) > 1 && Math.abs(car.forwardSpeed) > 4;
    c.boost = Math.abs(angle) < 0.18 && distance > 9 && car.boost > 15;
    if (Math.abs(angle) > 2.4 && distance < 9) {
      c.throttle = -1;
      c.steer = -c.steer;
    }
    if (
      ball.y > 1.4 &&
      ball.y < 4 &&
      new Vector3().copy(ball).distanceTo(p) < 4 &&
      car.grounded &&
      time > this.nextJump
    ) {
      c.jump = true;
      this.nextJump = time + 1.5;
    }
    if (!car.grounded) {
      c.pitch = car.forward.y > 0 ? 0.4 : -0.3;
      c.roll = car.right.y * 0.8;
    }
    return c;
  }
}
