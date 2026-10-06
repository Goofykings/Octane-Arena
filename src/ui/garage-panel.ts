import {
  Garage,
  inventory,
  palette,
  bodies,
  type Team,
  type CosmeticSlot,
} from "../game/inventory";
import { icon } from "./icons";
export class GaragePanel {
  team: Team = "blue";
  category: CosmeticSlot | "paint" = "body";
  customizing = false;
  host = document.querySelector<HTMLElement>("#garage-screen")!;
  constructor(
    public data: Garage,
    private change: () => void,
    private back: () => void,
  ) {
    this.render();
  }
  render() {
    this.host.dispatchEvent(new Event("preview-reset"));
    const p = this.data.current;
    this.host.innerHTML = `<h2>${this.customizing ? "CUSTOMIZE CAR" : "GARAGE"}</h2><div id="preview-drag" aria-label="Drag to orbit car preview"></div><div class="garage-left">${this.customizing ? `<nav class="category-tabs" role="tablist" aria-label="Car customization">${(["body", "paint", "wheels", "boost", "topper", "decal", "explosion"] as const).map((k) => `<button role="tab" data-category="${k}" aria-selected="${k === this.category}" aria-label="${k === "explosion" ? "Goal explosion" : k}" title="${k === "explosion" ? "Goal explosion" : k}">${icon(k)}</button>`).join("")}</nav><h3>${this.category === "explosion" ? "GOAL EXPLOSION" : this.category.toUpperCase()}</h3><div class="inventory-grid ${this.category === "paint" ? "palette" : ""}">${this.category === "paint" ? palette.map((color) => `<button class="swatch" data-color="${color}" aria-label="Paint ${color}" aria-pressed="${p[this.team] === color}" style="--swatch:${color}"></button>`).join("") : inventory[this.category].map((item) => `<button class="item-card" data-item="${item.id}" aria-pressed="${p[this.category as CosmeticSlot] === item.id}">${icon(this.category)}<span>${item.name}</span></button>`).join("")}</div>` : `<label class="preset-select" for="preset">PRESET<select id="preset">${this.data.presets.map((preset, i) => `<option value="${i}" ${preset.id === p.id ? "selected" : ""}>${preset.name}</option>`).join("")}</select></label><button id="customize-car" class="nav-button">CUSTOMIZE CAR</button><button id="new-preset" class="nav-button" ${this.data.presets.length >= 24 ? "disabled" : ""}>CREATE NEW PRESET</button>`}</div><div class="car-name">${bodies[p.body].name.toUpperCase()}</div><footer class="screen-footer"><button id="garage-back" class="back-button">← BACK</button><button id="team-preview" class="team-toggle ${this.team}" aria-label="Preview ${this.team === "blue" ? "orange" : "blue"} team" title="Switch team color">${icon("body").repeat(3)}<span>${this.team.toUpperCase()} TEAM</span></button></footer>`;
    this.host.querySelector("#garage-back")!.addEventListener("click", () => {
      if (this.customizing) {
        this.customizing = false;
        this.render();
      } else this.back();
    });
    this.host.querySelector("#team-preview")!.addEventListener("click", () => {
      this.team = this.team === "blue" ? "orange" : "blue";
      this.render();
      this.change();
    });
    if (this.customizing) {
      this.host.querySelectorAll<HTMLButtonElement>("[data-category]").forEach(
        (b) =>
          (b.onclick = () => {
            this.category = b.dataset.category as typeof this.category;
            this.render();
          }),
      );
      this.host.querySelectorAll<HTMLButtonElement>("[data-item]").forEach(
        (b) =>
          (b.onclick = () => {
            (p[this.category as CosmeticSlot] as string) = b.dataset.item!;
            this.data.save();
            this.render();
            this.change();
            if (this.category === "explosion")
              this.host.dispatchEvent(new Event("preview-explosion"));
          }),
      );
      this.host.querySelectorAll<HTMLButtonElement>("[data-color]").forEach(
        (b) =>
          (b.onclick = () => {
            p[this.team] = b.dataset.color!;
            this.data.save();
            this.render();
            this.change();
          }),
      );
    } else {
      this.host
        .querySelector("#customize-car")!
        .addEventListener("click", () => {
          this.customizing = true;
          this.render();
        });
      this.host.querySelector("#new-preset")!.addEventListener("click", () => {
        this.data.duplicate();
        this.render();
        this.change();
      });
      this.host.querySelector<HTMLSelectElement>("#preset")!.onchange = (e) => {
        this.data.selected =
          this.data.presets[Number((e.target as HTMLSelectElement).value)].id;
        this.data.save();
        this.render();
        this.change();
      };
    }
  }
}
