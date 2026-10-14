import { z } from "zod";
export const mutatorOptions = {
  matchLength: ["5 MINUTES", "10 MINUTES", "20 MINUTES", "UNLIMITED"],
  boostAmount: [
    "DEFAULT",
    "NO BOOST",
    "UNLIMITED",
    "RECHARGE SLOW",
    "RECHARGE FAST",
  ],
  boostStrength: ["1X", "1.5X", "2X", "10X"],
  gravity: ["DEFAULT", "LOW", "HIGH", "SUPER HIGH"],
  airJumps: ["DEFAULT", "2", "3", "INFINITE"],
  ballMaxSpeed: ["DEFAULT", "SLOW", "FAST", "SUPER FAST"],
  ballPhysics: ["VERY HEAVY", "HEAVY", "DEFAULT", "LIGHT", "VERY LIGHT"],
  ballSize: ["SMALL", "DEFAULT", "LARGE", "GIGANTIC"],
  ballBounciness: ["LOW", "DEFAULT", "HIGH", "SUPER HIGH"],
} as const;
export type MutatorKey = keyof typeof mutatorOptions;
export type MatchMutators = {
  readonly [K in MutatorKey]: (typeof mutatorOptions)[K][number];
};
export const mutatorKeys = Object.keys(mutatorOptions) as MutatorKey[];
export const mutatorLabels: Record<MutatorKey, string> = {
  matchLength: "MATCH LENGTH",
  boostAmount: "BOOST AMOUNT",
  boostStrength: "BOOST STRENGTH",
  gravity: "GRAVITY",
  airJumps: "AIR JUMPS",
  ballMaxSpeed: "BALL MAX SPEED",
  ballPhysics: "BALL PHYSICS",
  ballSize: "BALL SIZE",
  ballBounciness: "BALL BOUNCINESS",
};
export const DEFAULT_MUTATORS: MatchMutators = Object.freeze({
  matchLength: "5 MINUTES",
  boostAmount: "DEFAULT",
  boostStrength: "1X",
  gravity: "DEFAULT",
  airJumps: "DEFAULT",
  ballMaxSpeed: "DEFAULT",
  ballPhysics: "DEFAULT",
  ballSize: "DEFAULT",
  ballBounciness: "DEFAULT",
});
export const mutatorsSchema = z
  .object({
    matchLength: z.enum(mutatorOptions.matchLength),
    boostAmount: z.enum(mutatorOptions.boostAmount),
    boostStrength: z.enum(mutatorOptions.boostStrength),
    gravity: z.enum(mutatorOptions.gravity),
    airJumps: z.enum(mutatorOptions.airJumps),
    ballMaxSpeed: z.enum(mutatorOptions.ballMaxSpeed),
    ballPhysics: z.enum(mutatorOptions.ballPhysics),
    ballSize: z.enum(mutatorOptions.ballSize),
    ballBounciness: z.enum(mutatorOptions.ballBounciness),
  })
  .strict();
export const matchMutators = (raw: unknown = DEFAULT_MUTATORS): MatchMutators =>
  Object.freeze(mutatorsSchema.parse(raw));
/** Original tuning ratios, not a claim of Rocket League's internal physics values. */
export const MUTATOR_TUNING = {
  duration: {
    "5 MINUTES": 300,
    "10 MINUTES": 600,
    "20 MINUTES": 1200,
    UNLIMITED: null,
  },
  boostStrength: { "1X": 1, "1.5X": 1.5, "2X": 2, "10X": 10 },
  gravity: { DEFAULT: 1, LOW: 0.5, HIGH: 1.5, "SUPER HIGH": 2.5 },
  airJumps: { DEFAULT: 1, "2": 2, "3": 3, INFINITE: Infinity },
  ballMaxSpeed: { DEFAULT: 1, SLOW: 0.6, FAST: 1.3, "SUPER FAST": 1.75 },
  ballPhysics: {
    "VERY HEAVY": 3,
    HEAVY: 1.75,
    DEFAULT: 1,
    LIGHT: 0.65,
    "VERY LIGHT": 0.35,
  },
  ballSize: { SMALL: 0.7, DEFAULT: 1, LARGE: 1.3, GIGANTIC: 1.65 },
  ballBounciness: { LOW: 0.5, DEFAULT: 1, HIGH: 1.25, "SUPER HIGH": 1.5 },
  recharge: { "RECHARGE SLOW": 5, "RECHARGE FAST": 15 },
  restitutionCap: 0.92,
} as const;
export const sameMutators = (a: MatchMutators, b: MatchMutators) =>
  mutatorKeys.every((k) => a[k] === b[k]);
