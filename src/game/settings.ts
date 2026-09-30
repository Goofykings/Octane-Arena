import { defaultBindings, type Bindings } from "../input/bindings";
import {
  defaults,
  qualities,
  cameraRanges,
  type CameraSettings,
  type AudioSettings,
} from "../../shared/settings";
export * from "../../shared/settings";
export class Settings {
  onSave?: () => void;
  value = defaults();
  constructor() {
    try {
      const saved = JSON.parse(
        localStorage.getItem("octane-arena-settings") ?? "{}",
      );
      for (const key of ["infiniteBoost", "showHitboxes"] as const)
        if (typeof saved[key] === "boolean") this.value[key] = saved[key];
      if (["off", "friends", "everyone"].includes(saved.quickChat))
        this.value.quickChat = saved.quickChat;
      if (saved.quality in qualities) this.value.quality = saved.quality;
      const clamp = (v: unknown, lo: number, hi: number, fallback: number) =>
        typeof v === "number" && Number.isFinite(v)
          ? Math.max(lo, Math.min(hi, v))
          : fallback;
      for (const key of Object.keys(cameraRanges) as (keyof CameraSettings)[]) {
        const [lo, hi] = cameraRanges[key];
        this.value.camera[key] = clamp(
          saved.camera?.[key] ?? (key === "fov" ? saved.fov : undefined),
          lo,
          hi,
          this.value.camera[key],
        );
      }
      for (const key of Object.keys(
        this.value.audio,
      ) as (keyof AudioSettings)[])
        this.value.audio[key] = clamp(
          saved.audio?.[key] ?? (key === "master" ? saved.volume : undefined),
          0,
          1,
          this.value.audio[key],
        );
      for (const key of Object.keys(defaultBindings) as (keyof Bindings)[]) {
        const code = saved.bindings?.[key];
        if (
          typeof code === "string" &&
          /^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|[A-Za-z]{2,20}|F[1-9][0-2]?)$/.test(
            code,
          )
        )
          this.value.bindings[key] = code;
      }
    } catch {
      /* Optional local persistence. */
    }
  }
  save() {
    if (this.onSave) {
      this.onSave();
      return;
    }
    try {
      localStorage.setItem(
        "octane-arena-settings",
        JSON.stringify({ version: 2, ...this.value }),
      );
    } catch {
      /* Session-only fallback. */
    }
  }
}
