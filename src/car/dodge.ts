import { Vector3 } from "three";
import { MUTATOR_TUNING as M, type MatchMutators } from "../../shared/mutators";
import { P } from "../config/physics";
import type { Controls } from "../input/types";
/** Tick-level jump ownership, independent of input devices and mesh animation. */
export class JumpState {
  private airJumps: MatchMutators["airJumps"] = "DEFAULT";
  availableAirJumps = 1;
  configureAirJumps(value: MatchMutators["airJumps"]) {
    this.airJumps = value;
    this.reset();
  }
  age = 0;
  held = 0;
  used = false;
  second = false;
  wasDown = false;
  flipLeft = 0;
  flipAge = Infinity;
  direction = new Vector3();
  resetAvailable = false;
  stall = false;
  stallChordHeld = false;
  private stallYawSign = 0;
  /** A directionless dodge retains its linear damping window, without flipping. */
  get verticalDampingActive() {
    return this.flipLeft > 0 || (this.stall && this.flipAge < P.jump.flipTime);
  }
  private yawAge = Infinity;
  private rollAge = Infinity;
  private yawSign = 0;
  private rollSign = 0;
  acquireReset() {
    this.second = false;
    this.resetAvailable = true;
    this.availableAirJumps = Math.max(1, this.availableAirJumps);
  }
  /** Only a real surface jump starts the timed window. Falling preserves the aerial action. */
  get available() {
    if (this.airJumps !== "DEFAULT") return this.availableAirJumps > 0;
    return (
      !this.second &&
      (this.resetAvailable ||
        !this.used ||
        this.age <= P.jump.window + this.held)
    );
  }
  reset() {
    this.availableAirJumps = M.airJumps[this.airJumps];
    this.age = 0;
    this.held = 0;
    this.used = false;
    this.second = false;
    this.flipLeft = 0;
    this.flipAge = Infinity;
    this.resetAvailable = false;
    this.stall = false;
    this.stallChordHeld = false;
  }
  step(
    input: Controls,
    grounded: boolean,
    dt: number,
  ): "first" | "double" | "dodge" | null {
    const edge = input.jump && !this.wasDown;
    this.wasDown = input.jump;
    const yaw =
      Math.abs(input.yaw) >= P.jump.stallThreshold ? Math.sign(input.yaw) : 0;
    const roll =
      Math.abs(input.directionalRoll ?? 0) >= P.jump.stallThreshold
        ? Math.sign(input.directionalRoll!)
        : 0;
    if (
      this.stallChordHeld &&
      (yaw !== this.stallYawSign || roll !== -this.stallYawSign)
    )
      this.stallChordHeld = false;
    this.yawAge =
      yaw && yaw === this.yawSign ? this.yawAge + dt : yaw ? 0 : Infinity;
    this.rollAge =
      roll && roll === this.rollSign ? this.rollAge + dt : roll ? 0 : Infinity;
    this.yawSign = yaw;
    this.rollSign = roll;
    if (grounded) this.resetAvailable = false;
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
      if (
        this.airJumps !== "DEFAULT" &&
        Number.isFinite(this.availableAirJumps)
      )
        this.availableAirJumps--;
      else if (this.airJumps === "DEFAULT") this.availableAirJumps = 0;
      this.second = true;
      this.resetAvailable = false;
      if (this.stall) this.flipAge = Infinity;
      this.stall =
        !!yaw &&
        yaw === -roll &&
        Math.abs(this.yawAge - this.rollAge) <=
          P.jump.stallSimultaneousWindow &&
        Math.abs(input.dodgeY ?? input.pitch) < 0.2;
      this.stallChordHeld = this.stall;
      if (this.stall) {
        this.stallYawSign = yaw;
        this.direction.set(0, 0, 0);
        this.flipLeft = 0;
        this.flipAge = 0;
        return "dodge";
      }
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
