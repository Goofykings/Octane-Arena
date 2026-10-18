/** Fixed sample windows; no overlay or logging unless explicitly enabled. */
export class NetworkMetrics {
  private received: { at: number; tick: number; bytes: number }[] = [];
  private sent: { at: number; bytes: number; tick: number }[] = [];
  private frames: number[] = [];
  correctionDistance = 0;
  hardCorrections = 0;
  record(
    direction: "send" | "receive",
    packet: unknown,
    tick = 0,
    now = performance.now(),
  ) {
    const bytes = new TextEncoder().encode(JSON.stringify(packet)).byteLength;
    if (direction === "send") {
      if (this.sent.at(-1)?.tick === tick) return;
      this.sent.push({ at: now, bytes, tick });
      if (this.sent.length > 180) this.sent.shift();
    } else {
      this.received.push({ at: now, tick, bytes });
      if (this.received.length > 180) this.received.shift();
    }
  }
  frame(now = performance.now()) {
    this.frames.push(now);
    if (this.frames.length > 180) this.frames.shift();
  }
  reset() {
    this.received = [];
    this.sent = [];
    this.frames = [];
    this.correctionDistance = this.hardCorrections = 0;
  }
  report(now = performance.now()) {
    const recent = <T extends { at: number }>(a: T[]) =>
        a.filter((x) => x.at > now - 3000),
      r = recent(this.received),
      s = recent(this.sent),
      f = this.frames.filter((x) => x > now - 3000),
      hz = (a: { at: number }[]) =>
        a.length < 2 ? 0 : ((a.length - 1) * 1000) / (a.at(-1)!.at - a[0].at),
      intervals = r.slice(1).map((v, i) => v.at - r[i].at),
      average =
        intervals.reduce((a, b) => a + b, 0) / Math.max(1, intervals.length);
    return {
      snapshotSendHz: hz(s),
      snapshotReceiveHz: hz(r),
      averagePacketIntervalMs: average,
      jitterMs: Math.sqrt(
        intervals.reduce((a, b) => a + (b - average) ** 2, 0) /
          Math.max(1, intervals.length),
      ),
      averagePacketBytes:
        r.reduce((a, b) => a + b.bytes, 0) / Math.max(1, r.length),
      sendPacketBytes:
        s.reduce((a, b) => a + b.bytes, 0) / Math.max(1, s.length),
      physicsHz:
        r.length > 1
          ? ((r.at(-1)!.tick - r[0].tick) * 1000) / (r.at(-1)!.at - r[0].at)
          : 0,
      renderFPS:
        f.length > 1 ? ((f.length - 1) * 1000) / (f.at(-1)! - f[0]) : 0,
      correctionDistance: this.correctionDistance,
      hardCorrections: this.hardCorrections,
    };
  }
}
