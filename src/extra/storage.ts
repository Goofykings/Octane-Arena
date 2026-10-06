export interface RingsRecord {
  bestRings: number;
  bestTime: number | null;
}
export interface RecordStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
/** Same optional, namespaced localStorage pattern as settings and the garage.
 * Course versions keep future layouts from inheriting incomparable best times. */
export class ExtraRecords {
  value: RingsRecord = { bestRings: 0, bestTime: null };
  private key: string;
  constructor(
    courseId: string,
    private storage?: RecordStorage,
  ) {
    this.key = `octane-arena-extra-${courseId}`;
    try {
      const raw = JSON.parse(storage?.getItem(this.key) ?? "{}");
      if (Number.isInteger(raw.bestRings))
        this.value.bestRings = Math.max(0, Math.min(40, raw.bestRings));
      if (
        typeof raw.bestTime === "number" &&
        Number.isFinite(raw.bestTime) &&
        raw.bestTime > 0
      )
        this.value.bestTime = raw.bestTime;
    } catch {
      /* Local saves are optional, as with settings. */
    }
  }
  progress(count: number) {
    if (count <= this.value.bestRings) return;
    this.value.bestRings = count;
    this.save();
  }
  complete(time: number) {
    if (this.value.bestTime === null || time < this.value.bestTime) {
      this.value.bestTime = time;
      this.save();
    }
  }
  private save() {
    try {
      this.storage?.setItem(
        this.key,
        JSON.stringify({ version: 1, ...this.value }),
      );
    } catch {
      /* Continue with session records when storage is unavailable/full. */
    }
  }
}
