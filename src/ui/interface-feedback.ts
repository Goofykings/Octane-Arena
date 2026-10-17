import type { GameAudio } from "../audio/audio";
import {
  UI_MOTION,
  reducedMotion,
  reveal,
  stopReveal,
  flashControl,
} from "./motion";
const controlSelector =
  'button,a[href],[data-nav-cycle],input[type="range"],input[type="checkbox"],input[type="radio"],select';
/** One delegated feedback layer covers dynamic screens, native dialogs and controller clicks. */
export class InterfaceFeedback {
  private lastChangedControlId: string | null = null;
  private changeAt = -Infinity;
  private pressed = new WeakMap<Element, number>();
  private pendingFrame = new WeakSet<Element>();
  private animations = new WeakMap<Element, Animation>();
  private observer: MutationObserver;
  private abort = new AbortController();
  private on<K extends keyof HTMLElementEventMap>(
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
    capture = false,
  ) {
    this.root.addEventListener(type, handler, {
      capture,
      signal: this.abort.signal,
    });
  }
  constructor(
    private root: HTMLElement,
    private audio: GameAudio,
  ) {
    this.on("pointerover", (e) => {
      const control = (e.target as Element).closest<HTMLElement>(
        controlSelector,
      );
      if (
        !control ||
        (e.relatedTarget instanceof Node &&
          control.contains(e.relatedTarget)) ||
        control.matches(":disabled")
      )
        return;
      if (document.documentElement.dataset.uiInput !== "controller")
        audio.ui("hover");
    });
    this.on("focusin", (e) => {
      if ((e.target as Element).matches(controlSelector)) audio.ui("navigate");
    });
    this.on(
      "click",
      (e) => {
        const control = (e.target as Element).closest<HTMLElement>(
          'button,a[href],input[type="checkbox"],input[type="radio"]',
        );
        if (!control) return;
        if (
          control.closest(
            '[inert],[aria-disabled="true"],dialog:not([open])',
          ) ||
          control.matches(":disabled")
        ) {
          e.preventDefault();
          e.stopImmediatePropagation();
          audio.ui("error");
          return;
        }
        this.lastChangedControlId =
          control.closest<HTMLElement>("[data-nav-cycle]")?.id || null;
        this.changeAt = performance.now();
        const navigation =
          !!control.closest("[data-nav-cycle]") ||
          control.matches('[role="tab"],[data-category]');
        const now = performance.now(),
          previous = this.pressed.get(control) ?? -Infinity;
        if (
          this.pendingFrame.has(control) ||
          now - previous < (navigation ? 0 : 90)
        ) {
          e.preventDefault();
          e.stopImmediatePropagation();
          return;
        }
        this.pressed.set(control, now);
        this.pendingFrame.add(control);
        requestAnimationFrame(() => this.pendingFrame.delete(control));
        const back =
          control.matches("[data-nav-back],.back-button") ||
          /back|close|cancel|leave|exit/.test(control.id);
        const nav = navigation;
        const confirm =
          control.matches(
            '.primary,[type="submit"],#party-launch,#preset-confirm',
          ) || /launch|confirm|submit/.test(control.id);
        audio.ui(
          back ? "back" : nav ? "navigate" : confirm ? "confirm" : "click",
        );
        if (!reducedMotion()) {
          this.animations.get(control)?.cancel();
          const a = control.animate(
            [
              { scale: ".97" },
              { scale: "1.012", offset: 0.65 },
              { scale: "1" },
            ],
            { duration: UI_MOTION.feedback, easing: UI_MOTION.easing },
          );
          this.animations.set(control, a);
        }
      },
      true,
    );
    this.on("input", (e) => {
      if (!(e.target instanceof HTMLInputElement) || e.target.type !== "range")
        return;
      audio.ui("navigate");
      e.target.style.setProperty(
        "--range-progress",
        `${(100 * (Number(e.target.value) - Number(e.target.min))) / (Number(e.target.max) - Number(e.target.min))}%`,
      );
    });
    // Dialog content is often replaced by tab/garage code. Observe mutations only,
    // never poll/rebuild the DOM each frame, and ignore per-frame HUD text updates.
    this.observer = new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target as HTMLElement;
        if (
          record.type === "attributes" &&
          target.matches("dialog") &&
          !target.hasAttribute("open")
        )
          stopReveal(target);
        if (
          record.type === "attributes" &&
          target.matches("dialog") &&
          target.hasAttribute("open") &&
          record.oldValue === null
        )
          reveal(target);
        if (
          record.type === "childList" &&
          target.matches(
            "#settings-content,.inventory-grid,.garage-left,#party-unassigned",
          )
        )
          reveal(target, 6);
        if (
          record.type === "childList" &&
          target.matches(
            "[data-value],#bot-game-mode,#bot-size,#bot-difficulty",
          )
        ) {
          const before = Array.from(record.removedNodes)
            .map((n) => n.textContent ?? "")
            .join("");
          const sameControl =
            !this.lastChangedControlId ||
            performance.now() - this.changeAt > 500 ||
            target.closest<HTMLElement>("[data-nav-cycle]")?.id ===
              this.lastChangedControlId;
          if (sameControl && before !== target.textContent)
            flashControl(target);
        }
        if (
          record.type === "childList" &&
          target.matches(
            '[role="alert"],.mutators-error,[data-state="error"]',
          ) &&
          target.textContent?.trim()
        )
          audio.ui("error");
      }
    });
    this.observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["open"],
      attributeOldValue: true,
    });
  }
  dispose() {
    this.observer.disconnect();
    this.abort.abort();
  }
}
