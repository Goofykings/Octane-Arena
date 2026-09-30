import { Vector3 } from "three";
import { P } from "../config/physics";
import type { Controls } from "../input/types";
/** Tick-level jump ownership, independent of input devices and mesh animation. */
export class JumpState {
  age = 0;
  held = 0;
  used = false;
  second = false;
  wasDown = false;
  flipLeft = 0;
  flipAge = Infinity;
  direction = new Vector3();
  /** Only a real surface jump starts the timed window. Falling preserves the aerial action. */
  get available() {
    return (
      !this.second && (!this.used || this.age <= P.jump.window + this.held)
    );
  }
  reset() {
    this.age = 0;
    this.held = 0;
    this.used = false;
    this.second = false;
    this.flipLeft = 0;
    this.flipAge = Infinity;
  }
  step(
    input: Controls,
    grounded: boolean,
    dt: number,
  ): "first" | "double" | "dodge" | null {
    const edge = input.jump && !this.wasDown;
    this.wasDown = input.jump;
    if (grounded && (!this.used || this.age > 0.22)) this.reset();
    if (this.used) this.age += dt;
    this.flipLeft = Math.max(0, this.flipLeft - dt);
    this.flipAge += dt;
    if (!edge) return null;
    if (grounded && !this.used) {
      this.used = true;
      this.age = 0;
      return "first";
    }
    if (!grounded && this.available) {
      this.second = true;
      this.direction.set(
        input.dodgeX ?? input.steer,
        0,
        -(input.dodgeY ?? input.throttle),
      );
      if (this.direction.length() > 0.2) {
        this.direction.normalize();
        this.flipLeft = P.jump.flipTime;
        this.flipAge = 0;
        return "dodge";
      }
      return "double";
    }
    return null;
  }
}
