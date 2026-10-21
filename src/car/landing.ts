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
] as const;

/** Brief energy absorption after a real coherent wheel-side touchdown, never a pose target. */
export class LandingContact {
  private air = 0;
  private sinceAir = 1;
  private armed = false;
  private remaining = 0;
  rate = 0;
  private approachAge = 1;
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
  }
  step(
    airborne: boolean,
    validSurfaceSupport: boolean,
    dt: number,
    rate: number,
    duration: number,
    approaching = true,
  ) {
    this.approachAge = approaching ? 0 : this.approachAge + dt;
    if (airborne) {
      this.air += dt;
      this.sinceAir = 0;
      this.remaining = 0;
      if (this.air >= 0.025) this.armed = true;
    } else {
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
