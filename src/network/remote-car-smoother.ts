import type { CarSnapshot, MatchSnapshot } from "../../shared/network";
import { interpolateCar, type SnapshotSample } from "./snapshot-buffer";

/** Remote visuals only. Explicit discontinuities create a new per-car timeline.
 * Hold the first post-teleport pose until delayed playback reaches it; following
 * each newest packet during that gap would later rewind when interpolation resumes.
 */
export class RemoteCarSmoother {
  private epoch = "";
  private anchors = new Map<
    string,
    { car: CarSnapshot; tick: number; time: number }
  >();

  sample(
    id: string,
    latest: MatchSnapshot,
    sample: SnapshotSample,
  ): CarSnapshot {
    const epoch = latest.matchId + ":" + latest.reset;
    if (this.epoch !== epoch) {
      this.epoch = epoch;
      this.anchors.clear();
    }
    const authoritative = latest.cars.find((c) => c.id === id)!;
    let anchor = this.anchors.get(id);
    if (
      !anchor ||
      (anchor.car.teleportSequence ?? 0) !==
        (authoritative.teleportSequence ?? 0) ||
      anchor.car.enabled !== authoritative.enabled
    ) {
      anchor = { car: authoritative, tick: latest.tick, time: latest.time };
      this.anchors.set(id, anchor);
      return authoritative;
    }
    const b = sample.newer.cars.find((c) => c.id === id);
    if (
      !b ||
      sample.newer.reset !== latest.reset ||
      sample.newer.tick < anchor.tick ||
      sample.time < anchor.time
    )
      return anchor.car;
    const a = sample.older.cars.find((c) => c.id === id) ?? b;
    // Never cross a previous lifetime, even if late packets fill older history.
    if (
      sample.older.tick < anchor.tick ||
      (a.teleportSequence ?? 0) !== (anchor.car.teleportSequence ?? 0) ||
      a.enabled !== anchor.car.enabled
    ) {
      return interpolateCar(anchor.car, b, {
        ...sample,
        alpha:
          sample.newer.time <= anchor.time
            ? 1
            : Math.max(
                0,
                Math.min(
                  1,
                  (sample.time - anchor.time) /
                    (sample.newer.time - anchor.time),
                ),
              ),
      });
    }
    return interpolateCar(a, b, sample);
  }
}
