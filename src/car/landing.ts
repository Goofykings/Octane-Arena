import {
  captureValues,
  restoreValues,
  type CarPredictionState,
} from "../../shared/prediction";
const predictionKeys = [
  "air",
  "sinceAir",
  "armed",
  "remaining",
  "rate",
  "approachAge",
  "rearmAir",
] as const;

/** Brief surface-tangent spin damping after a real coherent 3-4 wheel touchdown;
 * never a pose target, never active in the air or for partial/roof/nose contact. */
export class LandingContact {
  private air = 0;
  private sinceAir = 1;
  private armed = false;
  private remaining = 0;
  rate = 0;
  private approachAge = 1;
  /** Flight time needed to re-arm; longer after a dirty (chassis/tilted) touchdown. */
  private rearmAir = 0;
  predictionValues() {
    return captureValues(this, predictionKeys);
  }
  restorePrediction(values: CarPredictionState["landing"]) {
    restoreValues(this, predictionKeys, values);
  }
  reset() {
    this.air = 0;
    this.approachAge = 1;
    this.sinceAir = 1;
    this.armed = false;
    this.remaining = this.rate = 0;
    this.rearmAir = 0;
  }
  step(
    airborne: boolean,
    validSurfaceSupport: boolean,
    dt: number,
    rate: number,
    duration: number,
    approaching = true,
    minAir = 0.025,
    clean = true,
  ) {
    this.approachAge = approaching ? 0 : this.approachAge + dt;
    if (airborne) {
      this.air += dt;
      this.sinceAir = 0;
      this.remaining = 0;
      if (this.air >= Math.max(minAir, this.rearmAir)) {
        this.armed = true;
        this.rearmAir = 0;
      }
    } else {
      // A touchdown whose first contact is the chassis or a badly tilted
      // wheel pair is a bad landing; it stays unassisted until the next flight.
      // A short bounce off that bad contact cannot launder it into a clean one.
      if (this.sinceAir === 0 && !clean) {
        this.armed = false;
        this.rearmAir = 0.3;
      }
      this.air = 0;
      this.sinceAir += dt;
      this.remaining = Math.max(0, this.remaining - dt);
      if (
        validSurfaceSupport &&
        this.armed &&
        this.sinceAir < 0.5 &&
        this.approachAge < 0.3
      ) {
        this.remaining = duration;
        this.armed = false;
      }
      if (this.sinceAir >= 0.5) this.armed = false;
    }
    return (this.rate = validSurfaceSupport && this.remaining > 0 ? rate : 0);
  }
}
