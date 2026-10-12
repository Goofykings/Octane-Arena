import { PAD } from "../../shared/controller";
import type { ControllerInput } from "./controller";

type Direction = "up" | "down" | "left" | "right";
interface Scope {
  root: HTMLElement;
  key: string;
}
const controls = 'button,a[href],input,select,[tabindex="0"],[data-nav-cycle]';
const textField = (e: Element | null) =>
  !!e?.matches(
    'textarea,[contenteditable="true"],input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="color"])',
  );
const visible = (e: HTMLElement) => {
  if (
    e.closest('[hidden],[aria-hidden="true"]') ||
    e.matches(':disabled,[aria-disabled="true"]')
  )
    return false;
  const style = getComputedStyle(e);
  return (
    e.getClientRects().length > 0 &&
    style.visibility !== "hidden" &&
    style.display !== "none"
  );
};

/** Shared DOM focus manager. Components declare scopes/default/back/cycle metadata;
 * input mode and focus memory are centralized, never added to button handlers. */
export class MenuNavigation {
  mode: "mouse" | "controller" = "mouse";
  private focus: HTMLElement | null = null;
  private scope: Scope | null = null;
  private memory = new Map<string, string>();
  private visited = new Set<string>();
  private direction = "";
  private repeat = 0;
  private confirm = false;
  private back = false;
  private leftTab = false;
  private rightTab = false;
  private buttons = new Float32Array(64);
  private axes = new Float32Array(64);
  private device = "";
  private editing = false;
  private mouseX = NaN;
  private mouseY = NaN;
  private mouseDistance = 0;
  constructor(
    private controller: ControllerInput,
    private onBack: () => void,
    private onSelect: () => void,
  ) {
    document.documentElement.dataset.uiInput = this.mode;
    window.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      if (Number.isFinite(this.mouseX))
        this.mouseDistance += Math.hypot(
          e.clientX - this.mouseX,
          e.clientY - this.mouseY,
        );
      else
        this.mouseDistance += e.isTrusted
          ? 2
          : Math.hypot(e.movementX, e.movementY);
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      if (this.mouseDistance >= 2) {
        this.mouseDistance = 0;
        this.mouseMode();
      }
    });
    window.addEventListener(
      "pointerdown",
      (e) => {
        if (e.pointerType !== "mouse") return;
        const target = (e.target as HTMLElement).closest<HTMLElement>(controls);
        if (target && this.scope?.root.contains(target))
          this.memory.set(this.scope.key, this.token(target));
        this.mouseMode();
      },
      true,
    );
    window.addEventListener("keydown", () => {
      this.focus?.classList.remove("controller-focus-origin");
      this.mouseMode();
      if (textField(document.activeElement)) this.editing = true;
    });
  }
  private mouseMode() {
    this.mode = "mouse";
    document.documentElement.dataset.uiInput = this.mode;
    this.focus?.classList.remove("gamepad-focus");
  }
  private activity() {
    const pad = this.controller.pad;
    if (!pad) {
      this.device = "";
      this.buttons.fill(0);
      this.axes.fill(0);
      this.mouseMode();
      return false;
    }
    const device = pad.index + ":" + pad.id;
    if (device !== this.device) {
      this.buttons.fill(0);
      this.axes.fill(0);
      this.device = device;
    }
    let active = false;
    for (let i = 0; i < 64; i++) {
      const button = pad.buttons[i],
        value = button?.pressed
          ? Math.max(0.6, button.value)
          : (button?.value ?? 0);
      if (value > 0.12 && value - this.buttons[i] > 0.08) active = true;
      this.buttons[i] = value;
      const axis = this.controller.axisValue(i);
      if (Math.abs(axis) > 0.05 && Math.abs(axis - this.axes[i]) > 0.04)
        active = true;
      this.axes[i] = axis;
    }
    return active;
  }
  private getScope(): Scope | null {
    const dialogs =
      document.querySelectorAll<HTMLDialogElement>("dialog[open]");
    let root: HTMLElement | null = dialogs.length
      ? dialogs[dialogs.length - 1]
      : null;
    const candidates =
      (root ?? document.getElementById("app")!)?.querySelectorAll<HTMLElement>(
        "[data-nav-scope]",
      ) ?? [];
    let priority = -Infinity;
    for (const candidate of candidates) {
      if (!visible(candidate)) continue;
      const value = Number(candidate.dataset.navPriority ?? 0);
      if (value >= priority) {
        root = candidate;
        priority = value;
      }
    }
    if (!root) return null;
    let key = root.dataset.navScope ?? root.id;
    // Home includes the profile/party strip outside the primary menu section.
    if (key === "home") root = document.getElementById("app")!;
    const tab = Array.from(
      root.querySelectorAll<HTMLElement>(
        '[role="tablist"] [aria-selected="true"]',
      ),
    ).find(visible);
    key +=
      ":" +
      (root.dataset.stage ?? "") +
      ":" +
      (tab?.id || tab?.getAttribute("data-category") || "");
    return { root, key };
  }
  private token(e: HTMLElement) {
    if (e.id) return "#" + CSS.escape(e.id);
    for (const key of [
      "data-nav-key",
      "data-action",
      "data-controller",
      "data-category",
      "data-item",
      "data-color",
      "data-quality",
      "data-avatar",
      "data-avatar-color",
      "data-player",
      "data-stage",
      "aria-label",
    ]) {
      const value = e.getAttribute(key);
      if (value !== null) return "[" + key + '="' + CSS.escape(value) + '"]';
    }
    if (!e.dataset.navKey)
      e.dataset.navKey = "item-" + Math.random().toString(36).slice(2);
    return '[data-nav-key="' + e.dataset.navKey + '"]';
  }
  private list(scope: Scope) {
    return Array.from(
      scope.root.querySelectorAll<HTMLElement>(controls),
    ).filter(
      (e) =>
        visible(e) &&
        (!e.closest("[data-nav-cycle]") || e.matches("[data-nav-cycle]")),
    );
  }
  private remember() {
    if (this.scope && this.focus && this.scope.root.contains(this.focus))
      this.memory.set(this.scope.key, this.token(this.focus));
  }
  private choose(scope: Scope, elements: HTMLElement[]) {
    const saved = this.memory.get(scope.key);
    const remembered = saved
      ? scope.root.querySelector<HTMLElement>(saved)
      : null;
    if (
      remembered &&
      elements.includes(remembered) &&
      this.visited.has(scope.key) &&
      !remembered.matches('[role="tab"][aria-selected="false"]')
    )
      return remembered;
    if (scope.key.startsWith("home:") && !this.visited.has(scope.key))
      return scope.root.querySelector<HTMLElement>("#play") ?? elements[0];
    const preferred = scope.root.dataset.navDefault;
    const declared = preferred
      ? scope.root.querySelector<HTMLElement>(preferred)
      : null;
    return declared && elements.includes(declared)
      ? declared
      : (elements.find((e) => e.hasAttribute("autofocus")) ??
          elements.find((e) =>
            e.matches(
              '[role="tab"][aria-selected="true"],[aria-pressed="true"]',
            ),
          ) ??
          elements.find(
            (e) => !e.matches(".icon-button,.back-button,[data-nav-back]"),
          ) ??
          elements[0]);
  }
  private setFocus(next: HTMLElement, scroll = true) {
    this.focus?.classList.remove("gamepad-focus", "controller-focus-origin");
    this.focus = next;
    next.classList.add("gamepad-focus", "controller-focus-origin");
    next.focus({ preventScroll: true });
    if (scroll) next.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (this.scope) this.visited.add(this.scope.key);
    this.remember();
  }
  private backAction() {
    if (this.editing) {
      this.editing = false;
      (document.activeElement as HTMLElement)?.blur();
      return;
    }
    this.onSelect();
    const root = this.scope?.root;
    const target = root?.dataset.navBackTarget;
    const back = target
      ? document.querySelector<HTMLElement>(target)
      : Array.from(
          root?.querySelectorAll<HTMLElement>("[data-nav-back]") ?? [],
        ).find(visible);
    if (back && visible(back)) back.click();
    else this.onBack();
  }
  private editColor(input: HTMLInputElement) {
    // Native OS color dialogs cannot consume Gamepad API input. Keep mouse
    // behavior intact; controller selection offers the existing text-entry
    // exception as a temporary hex field instead of opening that dialog.
    const editor = document.createElement("input");
    editor.type = "text";
    editor.className = "controller-color-editor";
    editor.value = input.value;
    editor.maxLength = 7;
    editor.setAttribute("aria-label", "Custom color hex");
    input.hidden = true;
    input.after(editor);
    this.editing = true;
    this.setFocus(editor);
    editor.select();
    let done = false;
    const finish = (commit: boolean, restore = false) => {
      if (done) return;
      done = true;
      if (commit && /^#[0-9a-f]{6}$/i.test(editor.value.trim())) {
        input.value = editor.value.trim();
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      editor.remove();
      input.hidden = false;
      this.editing = false;
      if (this.mode === "controller") this.setFocus(input);
      else {
        this.focus = input;
        this.remember();
        if (restore) input.focus();
      }
    };
    editor.onblur = () => finish(true);
    editor.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish(e.key === "Enter", true);
      }
    };
  }
  private move(direction: Direction, elements: HTMLElement[]) {
    const active = this.focus!;
    if (
      active.matches("[data-nav-cycle]") &&
      (direction === "up" || direction === "down")
    ) {
      const index = elements.indexOf(active);
      const next = elements[index + (direction === "up" ? -1 : 1)];
      if (next) this.setFocus(next);
      return;
    }
    const panel = this.scope?.root.querySelector('[role="tabpanel"]');
    if (direction === "down" && active.matches('[role="tab"]') && panel) {
      const first = elements.find((e) => panel.contains(e));
      if (first) this.setFocus(first);
      return;
    }
    if (
      direction === "up" &&
      panel?.contains(active) &&
      elements.find((e) => panel.contains(e)) === active
    ) {
      const selected = elements.find((e) =>
        e.matches('[role="tab"][aria-selected="true"]'),
      );
      if (selected) this.setFocus(selected);
      return;
    }
    if (
      (direction === "left" || direction === "right") &&
      active.matches("[data-nav-cycle]")
    ) {
      const selector =
        direction === "left" ? active.dataset.navPrev : active.dataset.navNext;
      const button = selector
        ? active.querySelector<HTMLButtonElement>(selector)
        : null;
      if (button && visible(button)) button.click();
      return;
    }
    if (
      (direction === "left" || direction === "right") &&
      active instanceof HTMLInputElement &&
      active.type === "range"
    ) {
      active.value = String(
        Number(active.value) +
          Number(active.step || 1) * (direction === "left" ? -1 : 1),
      );
      active.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    if (
      (direction === "left" || direction === "right") &&
      active instanceof HTMLSelectElement
    ) {
      active.selectedIndex = Math.max(
        0,
        Math.min(
          active.options.length - 1,
          active.selectedIndex + (direction === "left" ? -1 : 1),
        ),
      );
      active.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    const row = active.closest(".binding-columns");
    if (row) {
      const column = active.matches("[data-controller]")
        ? "[data-controller]"
        : "[data-action]";
      if (direction === "left" || direction === "right") {
        const sibling = row.querySelector<HTMLElement>(
          direction === "left" ? "[data-action]" : "[data-controller]",
        );
        if (sibling && visible(sibling)) {
          this.setFocus(sibling);
          return;
        }
      } else {
        let sibling =
          direction === "up"
            ? row.previousElementSibling
            : row.nextElementSibling;
        while (sibling?.matches(".binding-columns")) {
          const button = sibling.querySelector<HTMLElement>(column);
          if (button && visible(button)) {
            this.setFocus(button);
            return;
          }
          sibling =
            direction === "up"
              ? sibling.previousElementSibling
              : sibling.nextElementSibling;
        }
      }
    }
    // Settings rows can contain narrow toggles or wide selects/sliders. Use
    // their declared DOM order vertically instead of skipping an off-axis row.
    const settingRow = active.closest(".setting-row");
    if (settingRow && (direction === "up" || direction === "down")) {
      let sibling =
        direction === "up"
          ? settingRow.previousElementSibling
          : settingRow.nextElementSibling;
      while (sibling) {
        const target = elements.find((e) => sibling!.contains(e));
        if (target) {
          this.setFocus(target);
          return;
        }
        sibling =
          direction === "up"
            ? sibling.previousElementSibling
            : sibling.nextElementSibling;
      }
    }
    const origin = active.getBoundingClientRect();
    let next = active,
      best = Infinity;
    for (const candidate of elements) {
      if (candidate === active) continue;
      const r = candidate.getBoundingClientRect(),
        dx = (r.left + r.right - origin.left - origin.right) / 2,
        dy = (r.top + r.bottom - origin.top - origin.bottom) / 2;
      const forward =
        direction === "left"
          ? -dx
          : direction === "right"
            ? dx
            : direction === "up"
              ? -dy
              : dy;
      const cross =
        direction === "left" || direction === "right"
          ? Math.abs(dy)
          : Math.abs(dx);
      const score = forward + cross * 4;
      if (forward > 4 && score < best) {
        next = candidate;
        best = score;
      }
    }
    this.setFocus(next);
    // Tabs are selectors: horizontal traversal also displays the selected page.
    if (
      (direction === "left" || direction === "right") &&
      active.matches('[role="tab"]') &&
      next.matches('[role="tab"]') &&
      next !== active
    )
      next.click();
  }
  update(dt: number, enabled: boolean, capturing: boolean) {
    const pad = this.controller.pad,
      activity = this.activity();
    const confirm = !!pad?.buttons[PAD.jump]?.pressed,
      back = !!pad?.buttons[PAD.boost]?.pressed;
    const newConfirm = confirm && !this.confirm,
      newBack = back && !this.back;
    const leftTab = !!pad?.buttons[PAD.rollLeft]?.pressed;
    const rightTab = !!pad?.buttons[PAD.rollRight]?.pressed;
    const tabStep =
      Number(rightTab && !this.rightTab) - Number(leftTab && !this.leftTab);
    this.leftTab = leftTab;
    this.rightTab = rightTab;
    this.confirm = confirm;
    this.back = back;
    if (activity) {
      this.mode = "controller";
      document.documentElement.dataset.uiInput = this.mode;
    }
    if (document.querySelector("#match-chat.typing")) {
      this.focus?.classList.remove("gamepad-focus");
      if (newBack) {
        this.onSelect();
        this.onBack();
      }
      return;
    }
    if (capturing) {
      const cancel = document.querySelector<HTMLElement>("#cancel-binding");
      if (newBack && !this.controller.binding && cancel && visible(cancel))
        cancel.click();
      return;
    }
    if (!enabled || document.hidden || !pad) {
      this.focus?.classList.remove("gamepad-focus");
      this.direction = "";
      this.repeat = 0;
      return;
    }
    const nextScope = this.getScope();
    if (!nextScope) return;
    const changed = nextScope.key !== this.scope?.key;
    if (changed) {
      this.remember();
      this.focus?.classList.remove("gamepad-focus", "controller-focus-origin");
      this.scope = nextScope;
      this.focus = null;
      this.editing = false;
      this.direction = "";
      this.repeat = 0;
    }
    if (this.mode !== "controller") return;
    const elements = this.list(nextScope);
    if (!elements.length) return;
    const entering =
      changed ||
      !this.focus?.classList.contains("gamepad-focus") ||
      !elements.includes(this.focus);
    if (entering) this.setFocus(this.choose(nextScope, elements));
    if (newBack) {
      this.backAction();
      return;
    }
    if (tabStep) {
      const tabs = elements.filter((e) => e.matches('[role="tab"]'));
      const index = tabs.findIndex(
        (e) => e.getAttribute("aria-selected") === "true",
      );
      if (index >= 0) {
        const next = tabs[(index + tabStep + tabs.length) % tabs.length];
        this.remember();
        this.setFocus(next);
        next.click();
        return;
      }
    }
    const x = this.controller.axisValue(0),
      y = this.controller.axisValue(1);
    const direction: Direction | "" = pad.buttons[PAD.up]?.pressed
      ? "up"
      : pad.buttons[PAD.down]?.pressed
        ? "down"
        : pad.buttons[PAD.left]?.pressed
          ? "left"
          : pad.buttons[PAD.right]?.pressed
            ? "right"
            : Math.max(Math.abs(x), Math.abs(y)) < 0.5
              ? ""
              : Math.abs(x) > Math.abs(y)
                ? x < 0
                  ? "left"
                  : "right"
                : y < 0
                  ? "up"
                  : "down";
    this.repeat -= dt;
    if (entering && direction) this.repeat = 0.4;
    if (
      !this.editing &&
      direction &&
      !entering &&
      (direction !== this.direction || this.repeat <= 0)
    ) {
      this.move(direction, elements);
      this.repeat = direction !== this.direction ? 0.4 : 0.16;
    }
    if (newConfirm) {
      this.remember();
      if (textField(this.focus)) this.editing = true;
      else if (
        this.focus instanceof HTMLInputElement &&
        this.focus.type === "color"
      )
        this.editColor(this.focus);
      else if (
        !this.focus?.matches('[data-nav-cycle],select,input[type="range"]')
      )
        this.focus?.click();
      this.onSelect();
    }
    this.direction = direction;
  }
}
