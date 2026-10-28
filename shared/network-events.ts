import { z } from "zod";
const number = z.number().finite().min(-1e8).max(1e8);
const vec = z.object({ x: number, y: number, z: number });
const rotation = vec.extend({ w: number });
const motion = z.object({
  position: vec,
  rotation,
  velocity: vec,
  angularVelocity: vec.optional(),
  enabled: z.boolean(),
});
export const contactEventSchema = z.object({
  sequence: z.number().int().nonnegative(),
  tick: z.number().int().nonnegative(),
  time: z.number().finite().nonnegative(),
  ball: motion,
  cars: z
    .array(
      motion.extend({
        id: z.string().min(1).max(80),
        teleportSequence: z.number().int().nonnegative().optional(),
      }),
    )
    .max(6),
});
export type ContactEvent = z.infer<typeof contactEventSchema>;
export type InputTick = {
  sequence: number;
  tick: number;
  input: import("./player").PlayerInput;
};
/** Small numeric tuples; redundant unacknowledged ticks survive unordered loss. */
export function packInputTick(c: InputTick): number[] {
  const i = c.input;
  return [
    c.sequence,
    c.tick,
    i.throttle,
    i.steer,
    i.pitch,
    i.yaw,
    i.roll,
    i.dodgeX ?? 0,
    i.dodgeY ?? 0,
    +i.jump | (+i.boost << 1) | (+i.slide << 2) | (+!!i.usePowerup << 3),
    i.directionalRoll ?? 0,
  ];
}
export function readInputTick(a: unknown): InputTick | null {
  if (
    !Array.isArray(a) ||
    a.length !== 11 ||
    !a.every(Number.isFinite) ||
    !Number.isSafeInteger(a[0]) ||
    a[0] < 0 ||
    !Number.isSafeInteger(a[1]) ||
    a[1] < 0 ||
    [2, 3, 4, 5, 6, 7, 8, 10].some((k) => Math.abs(a[k]) > 1) ||
    !Number.isInteger(a[9]) ||
    a[9] < 0 ||
    a[9] > 15
  )
    return null;
  return {
    sequence: a[0],
    tick: a[1],
    input: {
      throttle: a[2],
      steer: a[3],
      pitch: a[4],
      yaw: a[5],
      roll: a[6],
      dodgeX: a[7],
      dodgeY: a[8],
      jump: !!(a[9] & 1),
      boost: !!(a[9] & 2),
      slide: !!(a[9] & 4),
      usePowerup: !!(a[9] & 8),
      directionalRoll: a[10],
    },
  };
}
