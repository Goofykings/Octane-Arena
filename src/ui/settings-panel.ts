import {
  Settings,
  cameraRanges,
  type CameraSettings,
  type AudioSettings,
} from "../game/settings";
import {
  defaultBindings,
  actionLabels,
  keyName,
  conflicts,
  type Action,
} from "../input/bindings";
import type { Input } from "../input/input";
export class SettingsPanel {
  dialog = document.querySelector<HTMLDialogElement>("#settings")!;
  private tab = "gameplay";
  private capture: Action | null = null;
  constructor(
    private settings: Settings,
    private input: Input,
    private apply: () => void,
  ) {
    this.dialog.innerHTML = `<div class="dialog-heading"><h2>SETTINGS</h2><button id="close-settings" class="icon-button" aria-label="Close settings">×</button></div><nav class="settings-tabs" role="tablist" aria-label="Settings">${["gameplay", "camera", "controls", "graphics", "audio"].map((t) => `<button role="tab" id="tab-${t}" data-tab="${t}" aria-controls="settings-content">${t.toUpperCase()}</button>`).join("")}</nav><div id="settings-content" role="tabpanel"></div>`;
    this.dialog.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach(
      (btn) =>
        (btn.onclick = () => {
          this.stopCapture();
          this.tab = btn.dataset.tab!;
          this.render();
        }),
    );
    this.dialog
      .querySelector("#close-settings")!
      .addEventListener("click", () => this.dialog.close());
    this.dialog.addEventListener("close", () => {
      this.stopCapture();
      input.clear();
    });
    this.dialog.addEventListener("cancel", () => input.clear());
    window.addEventListener(
      "keydown",
      (e) => {
        if (!this.capture) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.code !== "Escape")
          this.settings.value.bindings[this.capture] = e.code;
        this.stopCapture();
        this.save();
        this.render();
      },
      true,
    );
    this.render();
    this.apply();
  }
  open(tab?: string) {
    if (tab) this.tab = tab;
    this.render();
    this.input.clear();
    this.dialog.showModal();
  }
  private stopCapture() {
    this.capture = null;
    this.input.capturing = false;
    this.input.clear();
  }
  private save() {
    this.settings.save();
    this.apply();
  }
  private render() {
    const p = this.settings.value;
    this.dialog
      .querySelectorAll<HTMLButtonElement>("[data-tab]")
      .forEach((b) => {
        b.setAttribute("aria-selected", String(b.dataset.tab === this.tab));
        b.tabIndex = b.dataset.tab === this.tab ? 0 : -1;
      });
    this.dialog.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach(
      (b, i, all) =>
        (b.onkeydown = (e) => {
          if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
            e.preventDefault();
            const next =
              all[
                (i + (e.key === "ArrowRight" ? 1 : all.length - 1)) % all.length
              ];
            next.click();
            next.focus();
          }
        }),
    );
    const host = this.dialog.querySelector<HTMLElement>("#settings-content")!;
    host.setAttribute("aria-labelledby", `tab-${this.tab}`);
    const select = (
      key: string,
      label: string,
      items: string[],
      value: string,
    ) =>
      `<label class="setting-row" for="${key}"><span>${label}</span><select id="${key}">${items.map((i) => `<option value="${i}" ${i === value ? "selected" : ""}>${i.toUpperCase()}</option>`).join("")}</select></label>`;
    const toggle = (key: string, label: string, value: boolean) =>
      `<label class="setting-row" for="${key}"><span>${label}</span><input class="switch" id="${key}" type="checkbox" ${value ? "checked" : ""}></label>`;
    const range = (
      key: string,
      label: string,
      value: number,
      min: number,
      max: number,
      step: number,
      unit = "",
    ) =>
      `<div class="setting-row"><label for="${key}">${label}</label><div class="range-control"><input id="${key}" type="range" value="${value}" min="${min}" max="${max}" step="${step}"><button type="button" class="number-value" data-range="${key}" data-unit="${unit}" aria-label="Type ${label}">${Number(value.toFixed(2))}${unit}</button></div></div>`;
    if (this.tab === "gameplay") {
      host.innerHTML =
        toggle(
          "infiniteBoost",
          "Infinite boost in free play",
          p.infiniteBoost,
        ) +
        select(
          "quickChat",
          "Quick chat",
          ["off", "friends", "everyone"],
          p.quickChat,
        ) +
        '<p class="field-note">Quick chat is saved for future multiplayer.</p>' +
        toggle("showHitboxes", "Show hitboxes", p.showHitboxes);
      for (const key of ["infiniteBoost", "showHitboxes"] as const)
        host.querySelector<HTMLInputElement>(`#${key}`)!.onchange = (e) => {
          p[key] = (e.target as HTMLInputElement).checked;
          this.save();
        };
      host.querySelector<HTMLSelectElement>("#quickChat")!.onchange = (e) => {
        p.quickChat = (e.target as HTMLSelectElement)
          .value as typeof p.quickChat;
        this.save();
      };
    } else if (this.tab === "camera") {
      const labels = {
        fov: "Field of view",
        distance: "Distance",
        height: "Height",
        angle: "Angle",
        stiffness: "Stiffness",
        swivel: "Swivel speed",
        transition: "Transition speed",
      };
      host.innerHTML = (Object.keys(cameraRanges) as (keyof CameraSettings)[])
        .map((k) =>
          range(
            k,
            labels[k],
            p.camera[k],
            ...cameraRanges[k],
            k === "fov" || k === "angle" ? "°" : "",
          ),
        )
        .join("");
      for (const key of Object.keys(cameraRanges) as (keyof CameraSettings)[])
        host.querySelector<HTMLInputElement>(`#${key}`)!.oninput = (e) => {
          p.camera[key] = Number((e.target as HTMLInputElement).value);
          this.rangeOutput(e);
          this.save();
        };
    } else if (this.tab === "controls") {
      host.innerHTML = `<div class="binding-list">${(
        Object.keys(defaultBindings) as Action[]
      )
        .filter((k) => k !== "reset")
        .map(
          (k) =>
            `<div class="setting-row"><span>${actionLabels[k]}</span><button class="binding ${conflicts(p.bindings, k).length ? "conflict" : ""}" data-action="${k}">${keyName(p.bindings[k])}</button></div>`,
        )
        .join(
          "",
        )}</div><p id="binding-note" class="field-note" role="status">${Object.keys(p.bindings).some((k) => conflicts(p.bindings, k as Action).length) ? "Duplicate bindings highlighted. Both actions will run." : "Select an action, then press a key. Escape cancels."}</p><button id="reset-bindings" class="small-button">RESET BINDINGS</button>`;
      host.querySelectorAll<HTMLButtonElement>("[data-action]").forEach(
        (b) =>
          (b.onclick = () => {
            this.stopCapture();
            this.render();
            this.capture = b.dataset.action as Action;
            this.input.capturing = true;
            const active = host.querySelector(
              `[data-action="${this.capture}"]`,
            )!;
            active.textContent = "PRESS A KEY";
            active.classList.add("listening");
          }),
      );
      host.querySelector("#reset-bindings")!.addEventListener("click", () => {
        Object.assign(p.bindings, defaultBindings);
        this.save();
        this.render();
      });
    } else if (this.tab === "graphics") {
      host.innerHTML = `<div class="quality-grid">${["low", "medium", "high", "ultra"].map((q) => `<button data-quality="${q}" aria-pressed="${p.quality === q}">${q.toUpperCase()}</button>`).join("")}</div><dl class="quality-info"><dt>Resolution</dt><dd>${{ low: "65%", medium: "85%", high: "100%", ultra: "130%" }[p.quality]}</dd><dt>Shadows</dt><dd>${{ low: "OFF", medium: "1024", high: "2048", ultra: "4096" }[p.quality]}</dd><dt>Particles</dt><dd>${{ low: "20%", medium: "50%", high: "100%", ultra: "150%" }[p.quality]}</dd><dt>Edge smoothing</dt><dd>${p.quality === "low" ? "OFF" : "FXAA"}</dd></dl>`;
      host.querySelectorAll<HTMLButtonElement>("[data-quality]").forEach(
        (b) =>
          (b.onclick = () => {
            p.quality = b.dataset.quality as typeof p.quality;
            this.save();
            this.render();
          }),
      );
    } else {
      host.innerHTML = (Object.keys(p.audio) as (keyof AudioSettings)[])
        .map((k) =>
          range(
            `audio-${k}`,
            k.toUpperCase(),
            Math.round(p.audio[k] * 100),
            0,
            100,
            1,
            "%",
          ),
        )
        .join("");
      for (const k of Object.keys(p.audio) as (keyof AudioSettings)[])
        host.querySelector<HTMLInputElement>(`#audio-${k}`)!.oninput = (e) => {
          p.audio[k] = Number((e.target as HTMLInputElement).value) / 100;
          this.rangeOutput(e);
          this.save();
        };
    }
    this.bindNumbers(host);
  }
  private bindNumbers(host: HTMLElement) {
    host.querySelectorAll<HTMLButtonElement>(".number-value").forEach(
      (button) =>
        (button.onclick = () => {
          const range = host.querySelector<HTMLInputElement>(
            `#${button.dataset.range}`,
          )!;
          const editor = document.createElement("input");
          editor.type = "text";
          editor.inputMode = "decimal";
          editor.className = "number-editor";
          editor.value = range.value;
          editor.setAttribute("aria-label", button.getAttribute("aria-label")!);
          button.hidden = true;
          button.after(editor);
          editor.focus();
          editor.select();
          let done = false;
          const finish = (commit: boolean) => {
            if (done) return;
            done = true;
            if (
              commit &&
              editor.value.trim() !== "" &&
              Number.isFinite(Number(editor.value))
            ) {
              range.value = String(
                Math.max(
                  Number(range.min),
                  Math.min(Number(range.max), Number(editor.value)),
                ),
              );
              range.dispatchEvent(new Event("input", { bubbles: true }));
            }
            editor.remove();
            button.hidden = false;
          };
          editor.onblur = () => finish(true);
          editor.onkeydown = (e) => {
            if (e.key === "Enter" || e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              finish(e.key === "Enter");
              button.focus();
            }
          };
        }),
    );
  }
  private rangeOutput(e: Event) {
    const el = e.target as HTMLInputElement;
    el.parentElement!.querySelector(".number-value")!.textContent =
      el.value +
      (el.id.startsWith("audio-")
        ? "%"
        : el.id === "fov" || el.id === "angle"
          ? "°"
          : "");
  }
}
