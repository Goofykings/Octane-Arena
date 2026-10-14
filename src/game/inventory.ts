import {
  inventory,
  palette,
  starter,
  type Preset,
  type CosmeticSlot,
} from "../../shared/catalog";
import { newLocalPlayerId } from "../../shared/local-profile";
export const PRESET_NAME_MAX = 32;
export function presetName(raw: unknown) {
  if (typeof raw !== "string") throw Error("ENTER A PRESET NAME");
  const name = raw.trim();
  if (
    !name ||
    name.length > PRESET_NAME_MAX ||
    /[\u0000-\u001f\u007f]/.test(name)
  )
    throw Error("NAME MUST BE 1-32 CHARACTERS");
  return name;
}
export * from "../../shared/catalog";
export interface Profile {
  name: string;
  localPlayerId?: string;
  title: string;
  level: number;
  avatarId?: string;
  avatarColor?: string;
  xp?: number;
}
export class Garage {
  onSave?: () => void;
  profile: Profile = { name: "Guest", title: "Rookie", level: 1 };
  presets: Preset[] = [starter()];
  selected = "starter";
  constructor() {
    try {
      const data = JSON.parse(
        localStorage.getItem("octane-arena-garage") ?? "{}",
      );
      if (Array.isArray(data.presets) && data.presets.length) {
        const ids = new Set<string>();
        this.presets = data.presets
          .slice(0, 24)
          .map((raw: Record<string, unknown>, i: number) => {
            const p = starter();
            p.id =
              typeof raw.id === "string" &&
              raw.id.length > 0 &&
              raw.id.length <= 64 &&
              !ids.has(raw.id)
                ? raw.id
                : newLocalPlayerId();
            ids.add(p.id);
            try {
              p.name = presetName(raw.name);
            } catch {
              p.name = `Preset ${i + 1}`;
            }
            for (const slot of Object.keys(inventory) as CosmeticSlot[]) {
              if (inventory[slot].some((item) => item.id === raw[slot]))
                (p[slot] as string) = raw[slot] as string;
            }
            for (const team of ["blue", "orange"] as const)
              if (palette.includes(raw[team] as string))
                p[team] = raw[team] as string;
            return p;
          });
        this.selected =
          this.presets[
            Math.max(
              0,
              Math.min(this.presets.length - 1, Number(data.index) || 0),
            )
          ].id;
      }
    } catch {
      /* A corrupt or unavailable save never prevents playing. */
    }
  }
  get current() {
    return this.presets.find((p) => p.id === this.selected) ?? this.presets[0];
  }
  duplicate() {
    if (this.presets.length >= 24) return;
    const p = {
      ...this.current,
      id: newLocalPlayerId(),
      name: `Preset ${this.presets.length + 1}`,
    };
    this.presets.push(p);
    this.selected = p.id;
    this.save();
  }
  rename(id: string, raw: unknown) {
    const p = this.presets.find((p) => p.id === id);
    if (!p) throw Error("PRESET NOT FOUND");
    p.name = presetName(raw);
    this.save();
  }
  delete(id: string) {
    const index = this.presets.findIndex((p) => p.id === id);
    if (index < 0 || this.presets.length <= 1) return false;
    this.presets.splice(index, 1);
    if (this.selected === id)
      this.selected = this.presets[Math.min(index, this.presets.length - 1)].id;
    this.save();
    return true;
  }
  save() {
    if (this.onSave) {
      this.onSave();
      return;
    }
    try {
      localStorage.setItem(
        "octane-arena-garage",
        JSON.stringify({
          version: 1,
          presets: this.presets,
          index: this.presets.indexOf(this.current),
          profile: this.profile,
        }),
      );
    } catch {
      /* Session-only fallback. */
    }
  }
}
