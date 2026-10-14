import { P } from "./physics";
import {
  MUTATOR_TUNING as M,
  DEFAULT_MUTATORS,
  sameMutators,
  type MatchMutators,
} from "../../shared/mutators";
type Numeric<T> = { [K in keyof T]: T[K] extends number ? number : T[K] };
export interface MatchPhysics {
  gravity: number;
  car: Numeric<typeof P.car>;
  ball: Numeric<typeof P.ball>;
}
/** Derived once at setup. Shared immutable baseline P is never written. */
export function resolveMutators(config: MatchMutators): MatchPhysics {
  if (sameMutators(config, DEFAULT_MUTATORS)) return P;
  const strength = M.boostStrength[config.boostStrength];
  return Object.freeze({
    gravity: P.gravity * M.gravity[config.gravity],
    car: Object.freeze({
      ...P.car,
      boostGround: P.car.boostGround * strength,
      boostAir: P.car.boostAir * strength,
      maxSpeed: P.car.maxSpeed * Math.sqrt(strength),
    }),
    ball: Object.freeze({
      ...P.ball,
      radius: P.ball.radius * M.ballSize[config.ballSize],
      mass: P.ball.mass * M.ballPhysics[config.ballPhysics],
      maxSpeed: P.ball.maxSpeed * M.ballMaxSpeed[config.ballMaxSpeed],
      restitution: Math.min(
        M.restitutionCap,
        P.ball.restitution * M.ballBounciness[config.ballBounciness],
      ),
    }),
  });
}
