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
export const PUBLISH_LIMITS = {
  name: 40,
  description: 250,
  authorName: 20,
  shots: MAX_TRAINING_SHOTS,
  bytes: 150000,
} as const;
const cloudIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,80}$/, "Malformed pack or shot ID.");
const shotNameSchema = z.string().trim().max(40);
/** Exactly what a published shot carries: playable state only, no editor/runtime data. */
export const publishedShotSchema = z
  .object({
    id: cloudIdSchema,
    name: shotNameSchema,
    enabled: z.literal(true),
    carPosition: trainingShotSchema.shape.carPosition,
    carRotation: rotationSchema,
    carVelocity: trainingShotSchema.shape.carVelocity,
    ballPosition: trainingShotSchema.shape.ballPosition,
    ballLaunchDirection: trainingShotSchema.shape.ballLaunchDirection,
    ballLaunchSpeed: trainingShotSchema.shape.ballLaunchSpeed,
    ballAngularVelocity: trainingShotSchema.shape.ballAngularVelocity,
    timeLimit: trainingShotSchema.shape.timeLimit,
  })
  .strip();
export type PublishedShot = z.infer<typeof publishedShotSchema>;
const authorNameSchema = z
  .string()
  .trim()
  .min(1, "Set a profile name before publishing.")
  .max(PUBLISH_LIMITS.authorName, "Profile name is too long to publish.");
const descriptionSchema = z
  .string()
  .trim()
  .max(
    PUBLISH_LIMITS.description,
    `Use ${PUBLISH_LIMITS.description} characters or fewer for the description.`,
  );
/** Client-controlled fields of a published document; the cloud layer adds ownerUid, version and timestamps. */
export interface PublishedPackPayload {
  packId: string;
  authorName: string;
  name: string;
  description: string;
  shotCount: number;
  shots: PublishedShot[];
}
const byteSize = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length;
/** Validates a local pack and reduces it to the public payload (enabled shots only). */
export function serializePublishedPack(
  value: unknown,
  authorName: string,
): PublishedPackPayload {
  const pack = validatePlayablePack(value);
  const payload: PublishedPackPayload = {
    packId: cloudIdSchema.parse(pack.id),
    authorName: authorNameSchema.parse(authorName),
    name: packNameSchema.parse(pack.name),
    description: descriptionSchema.parse(pack.description ?? ""),
    shotCount: pack.shots.length,
    shots: pack.shots.map((shot) =>
      publishedShotSchema.parse({ ...shot, enabled: true }),
    ),
  };
  if (byteSize(payload) > PUBLISH_LIMITS.bytes)
    throw new Error("Pack exceeds the 150 KB size limit.");
  return payload;
}
const millis = (t: unknown) => {
  if (typeof t === "number" && Number.isFinite(t)) return t;
  if (t && typeof (t as { toMillis?: unknown }).toMillis === "function") {
    const ms = (t as { toMillis(): number }).toMillis();
    if (Number.isFinite(ms)) return ms;
  }
  throw new Error("Invalid publication timestamp.");
};
const remotePackSchema = z
  .object({
    packId: cloudIdSchema,
    ownerUid: z.string().min(1).max(128),
    authorName: authorNameSchema,
    name: packNameSchema,
    description: descriptionSchema.default(""),
    version: z.number().int().min(1).max(1000000),
    shotCount: z.number().int().min(1).max(PUBLISH_LIMITS.shots),
    shots: z.array(z.unknown()).min(1).max(PUBLISH_LIMITS.shots),
    published: z.literal(true),
  })
  .strip();
/** Validates downloaded (untrusted) data and converts it to the local playback format.
 * Anything malformed throws; nothing from the network reaches physics unvalidated. */
export function parsePublishedPack(
  value: unknown,
  documentId: string,
): CustomTrainingPack {
  if (!/^[A-Za-z0-9_-]{1,220}$/.test(documentId))
    throw new Error("Malformed publication ID.");
  if (!value || typeof value !== "object")
    throw new Error("Invalid published pack.");
  const d = value as Record<string, unknown>;
  const doc = remotePackSchema.parse(d);
  if (doc.shots.length !== doc.shotCount)
    throw new Error("Invalid shot count.");
  const createdAt = millis(d.createdAt),
    updatedAt = millis(d.updatedAt),
    publishedAt = millis(d.publishedAt);
  const shots = doc.shots.map((s) => ({
    ...publishedShotSchema.parse(s),
    createdAt: updatedAt,
    updatedAt,
  }));
  return validatePlayablePack({
    id: doc.packId,
    name: doc.name,
    description: doc.description,
    authorName: doc.authorName,
    version: doc.version,
    createdAt,
    updatedAt,
    published: true,
    shots,
    ownerUid: doc.ownerUid,
    publishedDocumentId: documentId,
    publishedAt,
    publishedVersion: doc.version,
  });
}
export type PublicationStatus =
  | "DRAFT"
  | "PUBLISHED"
  | "PUBLISHED • LOCAL CHANGES";
export function publicationStatus(pack: CustomTrainingPack): PublicationStatus {
  if (!pack.publishedDocumentId) return "DRAFT";
  return pack.publishedRevision === pack.updatedAt
    ? "PUBLISHED"
    : "PUBLISHED • LOCAL CHANGES";
}
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
