import { z } from "zod";
import { inventory, palette, type Preset } from "./catalog.js";
import { cameraRanges, type Preferences } from "./settings.js";
import { defaultBindings } from "./controls.js";
export const avatars = [
  { id: "helmet", name: "Helmet" },
  { id: "robot", name: "Robot" },
  { id: "comet", name: "Comet" },
  { id: "fox", name: "Fox" },
  { id: "smile", name: "Smile" },
  { id: "prism", name: "Prism" },
] as const;
export const titles = [
  { id: "rookie", name: "Rookie", level: 1 },
  { id: "line-runner", name: "Line Runner", level: 1 },
  { id: "skybound", name: "Skybound", level: 10 },
] as const;
export const credentialsSchema = z
  .object({
    username: z
      .string()
      .min(5, "Username must have 5–20 characters.")
      .max(20, "Username must have 5–20 characters.")
      .regex(
        /^[A-Za-z0-9_]+$/,
        "Use letters, numbers and underscores for your username.",
      ),
    password: z
      .string()
      .min(8, "Password must have at least 8 characters.")
      .max(128, "Password must have at most 128 characters."),
  })
  .strict();
const choice = (slot: keyof typeof inventory) =>
  z
    .string()
    .refine(
      (v) => inventory[slot].some((i) => i.id === v),
      "Unknown cosmetic item.",
    );
export const presetSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/),
    name: z
      .string()
      .min(1)
      .max(32)
      .regex(/^[A-Za-z0-9 _-]+$/),
    body: z.enum(["ion", "vector"]),
    blue: z
      .string()
      .refine((v) => palette.includes(v), "Choose a palette color."),
    orange: z
      .string()
      .refine((v) => palette.includes(v), "Choose a palette color."),
    wheels: choice("wheels"),
    boost: choice("boost"),
    topper: choice("topper"),
    decal: choice("decal"),
    explosion: choice("explosion"),
  })
  .strict();
export const preferencesSchema = z
  .object({
    infiniteBoost: z.boolean(),
    quickChat: z.enum(["off", "friends", "everyone"]),
    showHitboxes: z.boolean(),
    camera: z
      .object(
        Object.fromEntries(
          Object.entries(cameraRanges).map(([k, [lo, hi]]) => [
            k,
            z.number().finite().min(lo).max(hi),
          ]),
        ),
      )
      .strict(),
    bindings: z
      .object(
        Object.fromEntries(
          Object.keys(defaultBindings).map((k) => [
            k,
            z
              .string()
              .regex(
                /^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|[A-Za-z]{2,20}|F[1-9][0-2]?)$/,
              ),
          ]),
        ),
      )
      .strict(),
    quality: z.enum(["low", "medium", "high", "ultra"]),
    audio: z
      .object({
        master: z.number().min(0).max(1),
        music: z.number().min(0).max(1),
        sfx: z.number().min(0).max(1),
        engine: z.number().min(0).max(1),
        ui: z.number().min(0).max(1),
      })
      .strict(),
  })
  .strict() as unknown as z.ZodType<Preferences>;
export const saveSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    presets: z.array(presetSchema).min(1).max(24),
    selected: z.string().max(64),
    settings: preferencesSchema,
    avatarId: z.enum(["helmet", "robot", "comet", "fox", "smile", "prism"]),
    titleId: z.enum(["rookie", "line-runner", "skybound"]),
  })
  .strict()
  .refine(
    (v) => new Set(v.presets.map((p) => p.id)).size === v.presets.length,
    "Preset IDs must be unique.",
  )
  .refine(
    (v) => v.presets.some((p) => p.id === v.selected),
    "Select an existing preset.",
  );
export type AccountSave = z.infer<typeof saveSchema>;
export interface AccountData {
  id: string;
  username: string;
  createdAt: string;
  xp: number;
  level: number;
  avatarId: string;
  titleId: string;
  revision: number;
  owned: Record<string, string[]>;
  presets: Preset[];
  selected: string;
  settings: Preferences;
  ratings: { mode: string; rating: number | null; games: number }[];
}
export interface ApiErrorBody {
  error: { code: string; message: string };
}
