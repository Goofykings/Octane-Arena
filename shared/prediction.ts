import { z } from "zod";
const value = z.union([
  z.number().finite(),
  z.boolean(),
  z.string().max(24),
  z.null(),
]);
export const predictionStateSchema = z
  .object({
    values: z.array(value).max(100),
    vectors: z
      .array(
        z.object({
          x: z.number().finite(),
          y: z.number().finite(),
          z: z.number().finite(),
        }),
      )
      .max(24),
    jump: z.array(value).max(32),
    direction: z.object({
      x: z.number().finite(),
      y: z.number().finite(),
      z: z.number().finite(),
    }),
    landing: z.array(value).max(8),
  })
  .strict();
export type CarPredictionState = z.infer<typeof predictionStateSchema>;
/** Explicit allowlists only: incoming packets never select object properties. */
export function captureValues(target: object, keys: readonly string[]) {
  const t = target as Record<string, number | boolean | string>;
  return keys.map((k) =>
    typeof t[k] === "number" && !Number.isFinite(t[k] as number) ? null : t[k],
  );
}
export function restoreValues(
  target: object,
  keys: readonly string[],
  values: CarPredictionState["values"],
) {
  if (values.length !== keys.length) return;
  const t = target as Record<string, number | boolean | string>;
  keys.forEach((key, i) => {
    const value = values[i];
    if (value === null && typeof t[key] === "number") t[key] = Infinity;
    else if (typeof value === typeof t[key])
      t[key] = value as number | boolean | string;
  });
}
