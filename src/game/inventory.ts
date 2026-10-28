import {
  inventory,
  palette,
  starter,
  type Preset,
  type CosmeticSlot,
} from "../../shared/catalog";
import {
  starterOwnership,
  ROCKET_PASS_SEASON_1,
  rewardSlot,
  type OwnedInventory,
} from "../../shared/rocket-pass";
import type { Progression } from "../../shared/progression";
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
  owned: OwnedInventory = starterOwnership();
  claimedRocketPass: Record<string, number[]> = { "season-1": [] };
  persistent = true;
  constructor() {
    try {
      const data = JSON.parse(
        localStorage.getItem("octane-arena-garage") ?? "{}",
      );
      this.mergeOwnership(data);
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
    this.save(); // Persist the one-time ownership migration immediately.
  }
  private mergeOwnership(data: any) {
    const slots = ["body", "topper", "explosion", "boost"] as const;
    const version = Number(data.inventoryVersion) || 0;
    const newToppers = new Set([
      "emerald-hat",
      "solar-halo",
      "frost-crown",
      "violet-ufo",
    ]);
    const legacyItems = (slot: (typeof slots)[number]) =>
      inventory[slot].filter(
        (item) =>
          item.id !== "none" && !(slot === "topper" && newToppers.has(item.id)),
      );
    // Version 1's migration automatically granted the complete old catalog.
    // Remove that blanket starting grant, preserving claims below and anything
    // actually customized in a saved preset. Partial explicit ownership stays valid.
    const blanketGrant =
      version === 1 &&
      (["body", "topper", "explosion"] as const).every((slot) =>
        legacyItems(slot).every(
          (item) =>
            Array.isArray(data.owned?.[slot]) &&
            data.owned[slot].includes(item.id),
        ),
      );
    for (const slot of slots) {
      const saved = Array.isArray(data.owned?.[slot]) ? data.owned[slot] : [];
      const kept =
        blanketGrant && slot !== "boost"
          ? saved.filter(
              (id: unknown) =>
                !legacyItems(slot).some((item) => item.id === id),
            )
          : saved;
      const customized =
        version < (slot === "boost" ? 3 : 2) && Array.isArray(data.presets)
          ? data.presets.map((preset: any) => preset?.[slot])
          : [];
      const valid = [...kept, ...customized].filter(
        (id: unknown) =>
          inventory[slot].some((item) => item.id === id) && id !== "none",
      );
      this.owned[slot] = [...new Set([...this.owned[slot], ...valid])];
    }
    const claims = data.claimedRocketPass?.["season-1"];
    if (Array.isArray(claims)) {
      this.claimedRocketPass["season-1"] = [
        ...new Set([
          ...this.claimedRocketPass["season-1"],
          ...claims.filter(
            (n: unknown) =>
              Number.isInteger(n) && Number(n) >= 1 && Number(n) <= 25,
          ),
        ]),
      ];
      for (const reward of ROCKET_PASS_SEASON_1.rewards)
        if (this.claimedRocketPass["season-1"].includes(reward.level)) {
          for (const item of [reward, ...(reward.bonus ?? [])]) {
            const slot = rewardSlot(item.type);
            if (!this.owned[slot].includes(item.itemId))
              this.owned[slot].push(item.itemId);
          }
        }
    }
  }
  owns(slot: CosmeticSlot, id: string) {
    if (slot === "topper" && id === "none") return true;
    return slot in this.owned
      ? this.owned[slot as keyof OwnedInventory].includes(id)
      : inventory[slot].some((item) => item.id === id);
  }
  equip(slot: CosmeticSlot, id: string) {
    if (!inventory[slot].some((item) => item.id === id) || !this.owns(slot, id))
      return false;
    (this.current[slot] as string) = id;
    this.save();
    return true;
  }
  async claimRocketPass(level: number, progression: Progression) {
    const claim = () => {
      try {
        this.mergeOwnership(
          JSON.parse(localStorage.getItem("octane-arena-garage") ?? "{}"),
        );
      } catch {}
      const reward = ROCKET_PASS_SEASON_1.rewards.find(
        (r) => r.level === level,
      );
      if (
        !reward ||
        progression.level < level ||
        this.claimedRocketPass["season-1"].includes(level)
      )
        return false;
      for (const item of [reward, ...(reward.bonus ?? [])]) {
        const slot = rewardSlot(item.type);
        if (!this.owned[slot].includes(item.itemId))
          this.owned[slot].push(item.itemId);
      }
      this.claimedRocketPass["season-1"].push(level);
      this.save(); // Ownership and the receipt are one durable JSON transaction.
      return true;
    };
    if (typeof navigator !== "undefined" && navigator.locks) {
      let entered = false;
      try {
        return await navigator.locks.request("octane-arena-rocket-pass", () => {
          entered = true;
          return claim();
        });
      } catch (error) {
        if (entered) throw error;
      }
    }
    return claim();
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
      try {
        this.mergeOwnership(
          JSON.parse(localStorage.getItem("octane-arena-garage") ?? "{}"),
        );
      } catch {}
      localStorage.setItem(
        "octane-arena-garage",
        JSON.stringify({
          version: 1,
          inventoryVersion: 3,
          owned: this.owned,
          claimedRocketPass: this.claimedRocketPass,
          presets: this.presets,
          index: this.presets.indexOf(this.current),
          profile: this.profile,
        }),
      );
      this.persistent = true;
    } catch {
      this.persistent = false;
      /* Session-only fallback. */
    }
  }
}
