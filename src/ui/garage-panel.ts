import { reveal, flashControl } from "./motion";
import {
  Garage,
  PRESET_NAME_MAX,
  inventory,
  palette,
  bodies,
  type Team,
  type CosmeticSlot,
} from "../game/inventory";
import { icon } from "./icons";
const escapeText = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export class GaragePanel {
  private presetDialog = document.createElement("dialog");
  team: Team = "blue";
  category: CosmeticSlot | "paint" = "body";
  customizing = false;
  host = document.querySelector<HTMLElement>("#garage-screen")!;
  constructor(
    public data: Garage,
    private change: () => void,
    private back: () => void,
  ) {
    this.presetDialog.className = "preset-dialog";
    document.getElementById("app")!.append(this.presetDialog);
    this.render();
  }
  render(enter = true) {
    this.host.dispatchEvent(new Event("preview-reset"));
    const p = this.data.current;
    this.host.innerHTML = `<h2>${this.customizing ? "CUSTOMIZE CAR" : "GARAGE"}</h2><div id="preview-drag" aria-label="Drag to orbit car preview"></div><div class="garage-left">${this.customizing ? `<nav class="category-tabs" role="tablist" aria-label="Car customization">${(["body", "paint", "wheels", "boost", "topper", "explosion"] as const).map((k) => `<button role="tab" data-category="${k}" aria-selected="${k === this.category}" aria-label="${k === "explosion" ? "Goal explosions" : k}" title="${k === "explosion" ? "Goal explosions" : k}">${icon(k)}</button>`).join("")}</nav><h3>${this.category === "explosion" ? "GOAL EXPLOSIONS" : this.category.toUpperCase()}</h3><div class="inventory-grid ${this.category === "paint" ? "palette" : ""}">${this.category === "paint" ? palette.map((color) => `<button class="swatch" data-color="${color}" aria-label="Paint ${color}" aria-pressed="${p[this.team] === color}" style="--swatch:${color}"></button>`).join("") : inventory[this.category].map((item) => `<button class="item-card" data-item="${item.id}" aria-pressed="${p[this.category as CosmeticSlot] === item.id}">${icon(this.category)}<span>${item.name}</span></button>`).join("")}</div>` : `<label class="preset-select" for="preset">PRESET<select id="preset">${this.data.presets.map((preset, i) => `<option value="${i}" ${preset.id === p.id ? "selected" : ""}>${escapeText(preset.name)}</option>`).join("")}</select></label><button id="customize-car" class="nav-button">CUSTOMIZE CAR</button><button id="new-preset" class="nav-button" ${this.data.presets.length >= 24 ? "disabled" : ""}>CREATE NEW PRESET</button>`}</div><div class="car-name">${bodies[p.body].name.toUpperCase()}</div><footer class="screen-footer"><button id="garage-back" data-nav-back class="back-button">← BACK</button><button id="team-preview" class="team-toggle ${this.team}" aria-label="Preview ${this.team === "blue" ? "orange" : "blue"} team" title="Switch team color">${icon("body").repeat(3)}<span>${this.team.toUpperCase()} TEAM</span></button></footer>`;
    if (enter) reveal(this.host.querySelector<HTMLElement>(".garage-left")!, 6);
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
            if (this.category === "explosion")
              this.host.dispatchEvent(new Event("preview-explosion"));
          }),
      );
      this.host.querySelectorAll<HTMLButtonElement>("[data-item]").forEach(
        (b) =>
          (b.onclick = () => {
            (p[this.category as CosmeticSlot] as string) = b.dataset.item!;
            this.data.save();
            this.render(false);
            const selected = this.host.querySelector<HTMLElement>(
              `[data-item="${b.dataset.item}"]`,
            );
            if (selected) flashControl(selected);
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
            this.render(false);
            const selected = this.host.querySelector<HTMLElement>(
              `[data-color="${b.dataset.color}"]`,
            );
            if (selected) flashControl(selected);
            this.change();
          }),
      );
    } else {
      this.presetList();
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
        this.render(false);
        flashControl(this.host.querySelector<HTMLElement>("#preset")!);
        this.change();
      };
    }
  }
  private presetList() {
    const list = document.createElement("div");
    list.className = "preset-list";
    this.data.presets.forEach((p, i) => {
      const row = document.createElement("div");
      row.className = "preset-row";
      const equip = document.createElement("button");
      equip.className = "preset-equip";
      equip.dataset.equip = String(i);
      equip.textContent = p.name;
      equip.setAttribute("aria-pressed", String(p.id === this.data.current.id));
      equip.onclick = () => {
        this.data.selected = p.id;
        this.data.save();
        this.render(false);
        flashControl(
          this.host.querySelector<HTMLElement>(`[data-equip="${i}"]`)!,
        );
        this.change();
      };
      row.append(equip);
      for (const action of ["rename", "delete"] as const) {
        const b = document.createElement("button");
        b.className = "preset-icon";
        b.dataset[action] = String(i);
        b.setAttribute(
          "aria-label",
          (action === "rename" ? "Rename " : "Delete ") + p.name,
        );
        b.title = action === "rename" ? "Rename preset" : "Delete preset";
        b.innerHTML = icon(action === "rename" ? "pencil" : "trash");
        b.disabled = action === "delete" && this.data.presets.length === 1;
        if (b.disabled) b.title = "Keep at least one preset";
        b.onclick = () => this.editPreset(p.id, action);
        row.append(b);
      }
      list.append(row);
    });
    this.host.querySelector(".preset-select")!.after(list);
  }
  private editPreset(id: string, action: "rename" | "delete") {
    const preset = this.data.presets.find((p) => p.id === id);
    if (!preset) return;
    const d = this.presetDialog;
    d.dataset.navScope = "preset-" + action;
    d.dataset.navDefault =
      action === "rename" ? "#preset-name" : "#preset-cancel";
    d.setAttribute(
      "aria-label",
      action === "rename" ? "Rename preset" : "Delete preset?",
    );
    d.innerHTML =
      "<form><h2>" +
      (action === "rename" ? "RENAME PRESET" : "DELETE PRESET?") +
      "</h2>" +
      (action === "rename"
        ? '<input id="preset-name" aria-label="Preset name" maxlength="' +
          PRESET_NAME_MAX +
          '" required autocomplete="off">'
        : '<p class="preset-to-delete"></p>') +
      '<p class="preset-error" role="alert"></p><footer><button id="preset-cancel" type="button" data-nav-back class="back-button">CANCEL</button><button id="preset-confirm" type="submit" class="party-button">' +
      (action === "rename" ? "SAVE" : "DELETE") +
      "</button></footer></form>";
    if (action === "delete")
      d.querySelector(".preset-to-delete")!.textContent = preset.name;
    const input = d.querySelector<HTMLInputElement>("#preset-name");
    if (input) input.value = preset.name;
    const close = () => {
      d.close();
      this.host
        .querySelector<HTMLElement>(
          action === "rename"
            ? '[data-rename="' +
                this.data.presets.findIndex((p) => p.id === id) +
                '"]'
            : "#preset",
        )
        ?.focus();
    };
    d.querySelector<HTMLButtonElement>("#preset-cancel")!.onclick = close;
    d.querySelector("form")!.onsubmit = (e) => {
      e.preventDefault();
      try {
        if (action === "rename") this.data.rename(id, input!.value);
        else if (!this.data.delete(id)) throw Error("KEEP AT LEAST ONE PRESET");
        this.render();
        this.change();
        close();
      } catch (e) {
        d.querySelector(".preset-error")!.textContent =
          e instanceof Error ? e.message : "PRESET COULD NOT BE SAVED";
      }
    };
    d.showModal();
    if (input) {
      input.focus();
      input.select();
    }
  }
}
