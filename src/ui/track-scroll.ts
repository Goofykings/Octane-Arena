/** Mouse scrolling stays independent of keyboard/controller focus navigation. */
export class TrackScroll {
  private events = new AbortController();
  private frame = 0;
  private velocity = 0;
  private previousFrame = 0;
  private pointer: number | null = null;
  private startX = 0;
  private lastX = 0;
  private lastMove = 0;
  private dragged = false;
  private suppressClick = false;
  private reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

  constructor(private viewport: HTMLElement) {
    const signal = this.events.signal;
    viewport.addEventListener("wheel", this.wheel, { passive: false, signal });
    viewport.addEventListener("pointerdown", this.down, { signal });
    window.addEventListener("pointermove", this.move, {
      passive: false,
      signal,
    });
    window.addEventListener("pointerup", this.up, { signal });
    window.addEventListener("pointercancel", this.cancel, { signal });
    viewport.addEventListener("lostpointercapture", this.cancel, { signal });
    window.addEventListener("blur", () => this.finish(false), { signal });
    viewport.addEventListener(
      "click",
      (event) => {
        if (!this.suppressClick || event.detail === 0) return;
        this.suppressClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      { capture: true, signal },
    );
    viewport.addEventListener("dragstart", (event) => event.preventDefault(), {
      signal,
    });
  }

  stop = () => {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.velocity = 0;
  };

  private scroll(delta: number) {
    const before = this.viewport.scrollLeft;
    this.viewport.scrollLeft += delta;
    return this.viewport.scrollLeft - before;
  }

  private coast = (now: number) => {
    this.frame = 0;
    if (this.viewport.closest("[hidden]") || !this.viewport.isConnected) {
      this.stop();
      return;
    }
    const dt = Math.min(0.05, Math.max(0, (now - this.previousFrame) / 1000));
    this.previousFrame = now;
    const decay = Math.exp(-7.5 * dt);
    const distance = (this.velocity * (1 - decay)) / 7.5;
    const moved = this.scroll(distance);
    this.velocity *= decay;
    if (
      Math.abs(this.velocity) < 8 ||
      (Math.abs(distance) > 0.5 && Math.abs(moved) < 0.5)
    ) {
      this.stop();
      return;
    }
    this.frame = requestAnimationFrame(this.coast);
  };

  private startCoast() {
    if (this.reducedMotion.matches || Math.abs(this.velocity) < 8) {
      this.stop();
      return;
    }
    if (!this.frame) {
      this.previousFrame = performance.now();
      this.frame = requestAnimationFrame(this.coast);
    }
  }

  private wheel = (event: WheelEvent) => {
    if (event.ctrlKey || this.pointer !== null) return;
    const unit =
      event.deltaMode === 1
        ? 18
        : event.deltaMode === 2
          ? this.viewport.clientWidth
          : 1;
    const delta =
      (Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ? event.deltaX
        : event.deltaY) * unit;
    if (!delta) return;
    event.preventDefault();
    if (this.reducedMotion.matches) {
      this.stop();
      this.scroll(delta);
    } else {
      this.velocity = Math.max(
        -4500,
        Math.min(4500, this.velocity + delta * 7.5),
      );
      this.startCoast();
    }
  };

  private down = (event: PointerEvent) => {
    // Touch retains the browser's own native swipe scrolling and inertia.
    if (
      event.pointerType !== "mouse" ||
      event.button !== 0 ||
      this.pointer !== null
    )
      return;
    this.stop();
    this.pointer = event.pointerId;
    this.startX = this.lastX = event.clientX;
    this.lastMove = performance.now();
    this.dragged = this.suppressClick = false;
    // Mouse focus would otherwise scroll a reward into view before dragging.
    event.preventDefault();
  };

  private move = (event: PointerEvent) => {
    if (event.pointerId !== this.pointer) return;
    if (!this.dragged && Math.abs(event.clientX - this.startX) < 5) return;
    if (!this.dragged) {
      this.dragged = true;
      this.viewport.classList.add("pass-dragging");
      this.viewport.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    const now = performance.now(),
      dt = Math.max(1 / 240, (now - this.lastMove) / 1000);
    const moved = this.scroll(this.lastX - event.clientX);
    const speed = Math.max(-4500, Math.min(4500, moved / dt));
    this.velocity += (speed - this.velocity) * (1 - Math.exp(-dt / 0.035));
    this.lastMove = now;
    this.lastX = event.clientX;
  };

  private finish(inertia: boolean) {
    if (this.pointer === null) return;
    const id = this.pointer;
    this.pointer = null;
    this.viewport.classList.remove("pass-dragging");
    if (this.viewport.hasPointerCapture(id))
      this.viewport.releasePointerCapture(id);
    this.suppressClick = this.dragged;
    const idle = (performance.now() - this.lastMove) / 1000;
    if (inertia && this.dragged && idle < 0.1) {
      this.velocity *= Math.exp(-idle / 0.06);
      this.startCoast();
    } else this.stop();
  }
  private up = (event: PointerEvent) => {
    if (event.pointerId === this.pointer) this.finish(true);
  };
  private cancel = (event: PointerEvent) => {
    if (event.pointerId === this.pointer) this.finish(false);
  };

  dispose() {
    this.finish(false);
    this.stop();
    this.events.abort();
  }
}
