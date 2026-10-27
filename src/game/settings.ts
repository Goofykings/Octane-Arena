import { defaultBindings, type Bindings } from "../input/bindings";
import {
  controllerActions,
  validControllerBinding,
} from "../../shared/controller";
import {
  defaults,
  qualities,
  cameraRanges,
  migrateCamera,
  SETTINGS_VERSION,
  type CameraRangeKey,
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
      const camera =
        saved.version >= SETTINGS_VERSION
          ? (migrateCamera(saved.camera) as Record<string, unknown> | undefined)
          : undefined;
      for (const key of Object.keys(cameraRanges) as CameraRangeKey[]) {
        const [lo, hi] = cameraRanges[key];
        this.value.camera[key] = clamp(
          camera?.[key],
          lo,
          hi,
          this.value.camera[key],
        );
      }
      if (typeof camera?.shake === "boolean")
        this.value.camera.shake = camera.shake;
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
          /^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|[A-Za-z]{2,20}|F[1-9][0-2]?)?$/.test(
            code,
          )
        )
          this.value.bindings[key] = code;
      }
      this.value.controller.deadzone = clamp(
        saved.controller?.deadzone,
        0.05,
        0.3,
        0.12,
      );
      for (const action of controllerActions) {
        const binding = saved.controller?.bindings?.[action];
        if (validControllerBinding(binding))
          this.value.controller.bindings[action] = binding;
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
        JSON.stringify({ version: SETTINGS_VERSION, ...this.value }),
      );
    } catch {
      /* Session-only fallback. */
    }
  }
}
