/** Shared motion contract. Exiting panels become inert immediately; gameplay never waits. */
export const UI_MOTION = {
  enter: 220,
  exit: 150,
  feedback: 120,
  easing: "cubic-bezier(.2,.8,.2,1)",
} as const;
export const reducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;
const reveals = new WeakMap<HTMLElement, Animation>();
export function stopReveal(element: HTMLElement) {
  reveals.get(element)?.cancel();
  reveals.delete(element);
}
export function reveal(element: HTMLElement, distance = 10) {
  stopReveal(element);
  if (reducedMotion()) return;
  const animation = element.animate(
    [
      { opacity: 0, translate: `${distance}px 0` },
      { opacity: 1, translate: "0 0" },
    ],
    { duration: UI_MOTION.enter, easing: UI_MOTION.easing },
  );
  reveals.set(element, animation);
  animation.finished
    .catch(() => {})
    .then(() => {
      if (reveals.get(element) === animation) reveals.delete(element);
    });
}
export class ScreenTransitions {
  private states = new WeakMap<
    HTMLElement,
    { visible: boolean; animation?: Animation }
  >();
  setVisible(element: HTMLElement, visible: boolean) {
    let state = this.states.get(element);
    if (!state) {
      state = { visible: !visible };
      this.states.set(element, state);
      element.dataset.transitionManaged = "";
    }
    if (
      state.visible === visible &&
      (visible ? !element.hidden : element.hidden || !!state.animation)
    )
      return;
    state.visible = visible;
    state.animation?.cancel();
    state.animation = undefined;
    element.inert = !visible;
    if (reducedMotion()) {
      element.hidden = !visible;
      return;
    }
    if (visible) {
      element.hidden = false;
      const animation = element.animate(
        [
          { opacity: 0, translate: "12px 0" },
          { opacity: 1, translate: "0 0" },
        ],
        { duration: UI_MOTION.enter, easing: UI_MOTION.easing },
      );
      state.animation = animation;
      animation.finished
        .catch(() => {})
        .then(() => {
          if (state!.animation === animation) state!.animation = undefined;
        });
    } else if (!element.hidden) {
      // Independent CSS translate preserves existing panel positioning/transforms.
      const animation = element.animate(
        [
          { opacity: 1, translate: "0 0" },
          { opacity: 0, translate: "-8px 0" },
        ],
        { duration: UI_MOTION.exit, easing: UI_MOTION.easing },
      );
      state.animation = animation;
      animation.finished
        .catch(() => {})
        .then(() => {
          if (state!.animation !== animation) return;
          state!.animation = undefined;
          element.hidden = true;
        });
    }
  }
}

const flashes = new WeakMap<HTMLElement, Animation>();
/** Keyed to the changed control, with no parent/sibling animation or layout motion. */
export function flashControl(element: HTMLElement) {
  flashes.get(element)?.cancel();
  if (reducedMotion()) return;
  element.dataset.changedControlId =
    element.id ||
    element.dataset.value ||
    element.dataset.item ||
    element.dataset.color ||
    "value";
  const animation = element.animate(
    [
      { opacity: 0.48, filter: "brightness(1.45)" },
      { opacity: 1, filter: "brightness(1)" },
    ],
    { duration: UI_MOTION.feedback, easing: UI_MOTION.easing },
  );
  flashes.set(element, animation);
  animation.finished
    .catch(() => {})
    .then(() => {
      if (flashes.get(element) === animation) {
        flashes.delete(element);
        delete element.dataset.changedControlId;
      }
    });
}
export function setControlText(element: Element, value: string) {
  if (element.textContent === value) return false;
  element.textContent = value;
  return true;
}
