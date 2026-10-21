import { z } from "zod";
import { P } from "../src/config/physics";
export const MAX_TRAINING_SHOTS = 50;
export const vectorSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    z: z.number().finite(),
  })
  .strip();
const position = vectorSchema.refine(
  (v) =>
    Math.abs(v.x) <= P.arena.halfWidth &&
    v.y >= 0 &&
    v.y <= P.arena.height &&
    Math.abs(v.z) <= P.arena.halfLength + P.arena.goalDepth,
  "Position is outside arena limits.",
);
const velocity = vectorSchema.refine(
  (v) => Math.hypot(v.x, v.y, v.z) <= P.car.maxSpeed + 0.001,
  "Car speed exceeds its limit.",
);
const direction = vectorSchema.refine(
  (v) => Math.abs(Math.hypot(v.x, v.y, v.z) - 1) < 0.001,
  "Launch direction must be normalized.",
);
export const rotationSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    z: z.number().finite(),
    w: z.number().finite(),
  })
  .strip()
  .refine(
    (q) => Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) < 0.001,
    "Rotation must be normalized.",
  );
export const trainingShotSchema = z
  .object({
    id: z.string().min(1).max(80),
    enabled: z.boolean().default(true),
    name: z.string().max(40),
    carPosition: position,
    carRotation: rotationSchema,
    carVelocity: velocity,
    ballPosition: position,
    ballLaunchDirection: direction,
    ballLaunchSpeed: z.number().finite().min(0).max(P.ball.maxSpeed),
    ballAngularVelocity: vectorSchema.refine(
      (v) => Math.hypot(v.x, v.y, v.z) <= 100,
    ),
    timeLimit: z.number().finite().min(1).max(120),
    createdAt: z.number().finite(),
    updatedAt: z.number().finite(),
  })
  .strip();
export type TrainingShot = z.infer<typeof trainingShotSchema>;
export const packNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a pack name.")
  .max(40, "Use 40 characters or fewer.");
export const customTrainingPackSchema = z
  .object({
    id: z.string().min(1).max(80),
    name: packNameSchema,
    createdAt: z.number().finite(),
    updatedAt: z.number().finite(),
    published: z.boolean(),
    shots: z.array(trainingShotSchema).max(MAX_TRAINING_SHOTS),
    version: z.number().int().min(1).max(1000000),
    authorName: z.string().trim().min(1).max(20).default("Guest"),
    publishedDocumentId: z.string().max(160).optional(),
    ownerUid: z.string().max(128).optional(),
    publishedAt: z.number().finite().optional(),
    publishedVersion: z.number().int().positive().optional(),
    publishedRevision: z.number().finite().optional(),
    description: z.string().max(500).optional(),
    author: z.string().max(20).optional(),
    difficulty: z.string().max(40).optional(),
    tags: z.array(z.string().max(30)).max(10).optional(),
    thumbnail: z.string().max(1024).optional(),
    publishCode: z.string().max(160).optional(),
  })
  .strip()
  .refine(
    (p) => new Set(p.shots.map((s) => s.id)).size === p.shots.length,
    "Shot IDs must be unique.",
  );
export type CustomTrainingPack = z.infer<typeof customTrainingPackSchema>;
export const trainingLibrarySchema = z.object({
  schemaVersion: z.literal(1),
  packs: z.array(customTrainingPackSchema),
});
export function validatePlayablePack(value: unknown) {
  const pack = customTrainingPackSchema.parse(value);
  if (!pack.shots.length)
    throw new Error("Add at least one shot before playing or publishing.");
  pack.shots = pack.shots.filter((shot) => shot.enabled);
  if (!pack.shots.length)
    throw new Error("Enable at least one shot before playing or publishing.");
  if (new TextEncoder().encode(JSON.stringify(pack)).length > 150000)
    throw new Error("Pack exceeds the 150 KB size limit.");
  return pack;
}
