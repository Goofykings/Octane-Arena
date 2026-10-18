/** Explicit QA aid, disabled by default. Full state/replay/control messages are
 * never lost; optional loss applies only to replaceable motion frames. */
export class PacketImpairment {
  private conditions = { latencyMs: 0, jitterMs: 0, loss: 0 };
  private timers = new Set<ReturnType<typeof setTimeout>>();
  dropped = 0;
  configure(value: Partial<typeof this.conditions>) {
    this.clear();
    this.conditions = {
      latencyMs: Math.max(0, Math.min(500, value.latencyMs ?? 0)),
      jitterMs: Math.max(0, Math.min(100, value.jitterMs ?? 0)),
      loss: Math.max(0, Math.min(0.3, value.loss ?? 0)),
    };
  }
  receive(data: unknown, deliver: () => void) {
    const c = this.conditions;
    if (!c.latencyMs && !c.jitterMs && !c.loss) {
      deliver();
      return;
    }
    if (
      (data as { type?: string })?.type === "frame" &&
      Math.random() < c.loss
    ) {
      this.dropped++;
      return;
    }
    if (this.timers.size >= 120) {
      this.dropped++;
      return;
    }
    const delay = Math.max(
        0,
        c.latencyMs + (Math.random() * 2 - 1) * c.jitterMs,
      ),
      timer = setTimeout(() => {
        this.timers.delete(timer);
        deliver();
      }, delay);
    this.timers.add(timer);
  }
  clear() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
}
