import { z } from "zod";
export const avatarIds = [
  "helmet",
  "robot",
  "comet",
  "fox",
  "smile",
  "prism",
] as const;
export const defaultAvatarColor = "#83E4FF";
export const avatarColors = [
  defaultAvatarColor,
  "#FFFFFF",
  "#FFB654",
  "#FF727C",
  "#BDA1FF",
  "#75DBA6",
  "#FFE38A",
  "#ED9ED8",
] as const;
export const avatarIdSchema = z.enum(avatarIds);
export const avatarColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .transform((color) => color.toUpperCase());
export const profileIdentitySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a name.")
    .max(20, "Use at most 20 characters.")
    .refine(
      (v) => !/[\u0000-\u001f\u007f-\u009f]/u.test(v),
      "Remove control characters.",
    ),
  avatarId: avatarIdSchema.default("helmet"),
  avatarColor: avatarColorSchema.default(defaultAvatarColor),
});
export const localIdentitySchema = profileIdentitySchema.extend({
  localPlayerId: z.string().uuid(),
});
export const displayIdentity = (identity: { name: string }) => identity.name;
export function newLocalPlayerId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((v) => v.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
