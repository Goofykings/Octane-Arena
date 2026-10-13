import { Vector3, Quaternion } from "three";
import { neutralInput } from "../../shared/player";
import type { Car } from "../car/car";
import type { BotDifficulty } from "../../shared/bots";
import type { BotTarget } from "./decision";
import { BOT_TUNING } from "./perception";
import { P } from "../config/physics";
/** The existing chase bot's steering, slide and jump/release/dodge sequence,
 * driven by a decision target rather than an orange-only ball offset. */
export class BotController {
  private nextJump = 0;
  private flipStarted = -Infinity;
  private last = -Infinity;
  private side = 0;
  private aerialJump = false;
  private roofReleased = false;
  private nextRecovery = 0;
  constructor(readonly difficulty: BotDifficulty) {}
  sample(car: Car, target: BotTarget, time: number) {
    if (time < this.last) {
      this.nextJump = 0;
      this.flipStarted = -Infinity;
      this.roofReleased = false;
      this.nextRecovery = 0;
    }
    this.last = time;
    if (car.recovering) return neutralInput();
    if (!car.grounded && car.up.y < -0.8 && car.chassisContacts > 0) {
      if (time < this.nextRecovery) return neutralInput();
      // Bots request the same deliberate release/repress as every other input source.
      if (!this.roofReleased) {
        this.roofReleased = true;
        return neutralInput();
      }
      this.roofReleased = false;
      this.nextRecovery =
        time + P.car.recoveryDuration + P.car.recoveryCooldown;
      return { ...neutralInput(), throttle: 1 };
    }
    this.roofReleased = false;
    const input = neutralInput(),
      local = target.point
        .clone()
        .sub(car.body.translation())
        .applyQuaternion(new Quaternion().copy(car.body.rotation()).invert());
    const angle = Math.atan2(local.x, -local.z),
      distance = Math.hypot(local.x, local.z);
    input.steer = Math.max(-1, Math.min(1, angle * 2));
    input.throttle = target.intent === "carry" ? 0.35 : 1;
    input.slide = Math.abs(angle) > 1 && Math.abs(car.forwardSpeed) > 4;
    input.boost =
      Math.abs(angle) < 0.32 &&
      distance > 6 &&
      car.boost > BOT_TUNING[this.difficulty].boostReserve &&
      car.forwardSpeed < 22 &&
      target.intent !== "carry";
    if (Math.abs(angle) > 2.4 && distance < 9) {
      input.throttle = -1;
      input.steer = -input.steer;
    }
    if (target.role !== "first" && distance < 1.8) {
      input.throttle =
        Math.abs(car.forwardSpeed) > 1 ? -Math.sign(car.forwardSpeed) : 0;
      input.boost = false;
    }
    if (car.grounded && car.normal.y > 0.9 && time > this.nextJump) {
      if (target.aerial && distance < 14) {
        this.aerialJump = true;
        this.flipStarted = time;
        this.nextJump = time + 2;
      } else if (
        car.forwardSpeed > 5 &&
        Math.abs(angle) < 0.25 &&
        target.role === "first" &&
        distance > 3 &&
        distance < 8
      ) {
        this.aerialJump = false;
        this.flipStarted = time;
        this.side = Math.max(-0.35, Math.min(0.35, Math.sin(angle)));
        this.nextJump = time + (this.difficulty === "beginner" ? 3 : 2.4);
      } else if (
        this.difficulty !== "beginner" &&
        car.forwardSpeed > 6 &&
        distance > 16 &&
        Math.abs(angle) < 0.18
      ) {
        this.aerialJump = false;
        this.flipStarted = time;
        this.side = 0;
        this.nextJump = time + 3;
      }
    }
    const age = time - this.flipStarted;
    if (age < 0.95) {
      if (this.aerialJump) {
        input.jump = age < P.jump.holdTime;
        input.dodgeX = input.dodgeY = 0;
        input.pitch = Math.max(
          -1,
          Math.min(1, -Math.atan2(local.y, Math.max(1, -local.z)) * 1.4),
        );
        input.yaw = Math.max(-1, Math.min(1, angle * 1.2));
        input.roll = car.right.y * 0.8;
        input.boost = car.boost > 0 && Math.abs(angle) < 0.6;
        return input;
      }
      input.jump = age < 0.05 || (!target.aerial && age >= 0.12 && age < 0.17);
      input.dodgeX = this.side;
      input.dodgeY = target.aerial ? 0 : 1;
      if (target.aerial) {
        input.pitch = -0.75;
        input.boost = car.boost > 0;
      }
      return input;
    }
    if (!car.grounded) {
      input.pitch = target.aerial
        ? Math.max(
            -1,
            Math.min(1, -Math.atan2(local.y, Math.max(1, -local.z)) * 1.4),
          )
        : car.forward.y > 0
          ? 0.4
          : -0.3;
      input.yaw = target.aerial ? Math.max(-1, Math.min(1, angle * 1.2)) : 0;
      input.roll = car.right.y * 0.8;
      input.boost = target.aerial && Math.abs(angle) < 0.5 && car.boost > 0;
    } else if (
      local.y > 1.4 &&
      local.y < 3.2 &&
      distance < 3.5 &&
      time > this.nextJump
    ) {
      input.jump = true;
      this.nextJump = time + 1.5;
    }
    return input;
  }
}
