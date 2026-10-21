import { newLocalPlayerId } from "../../shared/local-profile";
import {
  customTrainingPackSchema,
  MAX_TRAINING_SHOTS,
  type TrainingShot,
  type CustomTrainingPack,
} from "../../shared/custom-training";
import { CustomTrainingLibrary } from "./custom-training";
export function defaultTrainingShot(now = Date.now()): TrainingShot {
  return {
    id: newLocalPlayerId(),
    name: "Shot",
    enabled: true,
    carPosition: { x: 0, y: 0.36, z: 18 },
    carRotation: { x: 0, y: 0, z: 0, w: 1 },
    carVelocity: { x: 0, y: 0, z: 0 },
    ballPosition: { x: 0, y: 2, z: 0 },
    ballLaunchDirection: { x: 0, y: 0, z: 1 },
    ballLaunchSpeed: 10,
    ballAngularVelocity: { x: 0, y: 0, z: 0 },
    timeLimit: 20,
    createdAt: now,
    updatedAt: now,
  };
}
export const plainVector = (v: { x: number; y: number; z: number }) => ({
  x: v.x,
  y: v.y,
  z: v.z,
});
export function anglesVector(heading: number, elevation: number) {
  const a = (heading * Math.PI) / 180,
    b = (elevation * Math.PI) / 180;
  return {
    x: Math.sin(a) * Math.cos(b),
    y: Math.sin(b),
    z: -Math.cos(a) * Math.cos(b),
  };
}
export function vectorAngles(v: { x: number; y: number; z: number }) {
  return {
    heading: (Math.atan2(v.x, -v.z) * 180) / Math.PI,
    elevation: (Math.atan2(v.y, Math.hypot(v.x, v.z)) * 180) / Math.PI,
  };
}
type DraftSnapshot = {
  name: string;
  authorName: string;
  shots: TrainingShot[];
  selectedId: string;
};
/** View selection and cloud receipts are not edits. History holds only authored data. */
const fingerprint = (snapshot: DraftSnapshot) =>
  JSON.stringify({
    name: snapshot.name,
    authorName: snapshot.authorName,
    shots: snapshot.shots.map(({ createdAt, updatedAt, ...shot }) => shot),
  });
export class TrainingDraft {
  readonly pack: CustomTrainingPack;
  index = 0;
  dirty = false;
  private past: DraftSnapshot[] = [];
  private future: DraftSnapshot[] = [];
  private committed: DraftSnapshot;
  private savedFingerprint: string;
  private group: DraftSnapshot | undefined;
  constructor(pack: CustomTrainingPack) {
    this.pack = structuredClone(customTrainingPackSchema.parse(pack));
    this.savedFingerprint = fingerprint(this.snapshot());
    if (!this.pack.shots.length) this.pack.shots.push(defaultTrainingShot());
    this.committed = this.snapshot();
    this.refreshDirty();
  }
  get shot() {
    return this.pack.shots[this.index];
  }
  get canUndo() {
    return this.past.length > 0 && !this.group;
  }
  get canRedo() {
    return this.future.length > 0 && !this.group;
  }
  private snapshot(): DraftSnapshot {
    return structuredClone({
      name: this.pack.name,
      authorName: this.pack.authorName,
      shots: this.pack.shots,
      selectedId: this.pack.shots[this.index]?.id ?? "",
    });
  }
  private refreshDirty() {
    this.dirty = fingerprint(this.snapshot()) !== this.savedFingerprint;
  }
  private push(snapshot: DraftSnapshot) {
    this.past.push(snapshot);
    if (this.past.length > 80) this.past.shift();
  }
  changed() {
    const next = this.snapshot();
    if (fingerprint(next) === fingerprint(this.committed)) return false;
    if (!this.group) {
      this.push(this.committed);
      this.future = [];
    }
    this.shot.updatedAt = Date.now();
    this.committed = this.snapshot();
    this.refreshDirty();
    return true;
  }
  beginChange() {
    if (!this.group) this.group = this.snapshot();
  }
  endChange() {
    if (!this.group) return;
    const before = this.group;
    this.group = undefined;
    if (fingerprint(before) !== fingerprint(this.snapshot())) {
      this.push(before);
      this.future = [];
    }
    this.committed = this.snapshot();
    this.refreshDirty();
  }
  private restore(snapshot: DraftSnapshot) {
    this.pack.name = snapshot.name;
    this.pack.authorName = snapshot.authorName;
    this.pack.shots = structuredClone(snapshot.shots);
    this.index = Math.max(
      0,
      this.pack.shots.findIndex((s) => s.id === snapshot.selectedId),
    );
    this.committed = this.snapshot();
    this.refreshDirty();
  }
  undo() {
    if (!this.canUndo) return false;
    this.future.push(this.snapshot());
    this.restore(this.past.pop()!);
    return true;
  }
  redo() {
    if (!this.canRedo) return false;
    this.push(this.snapshot());
    this.restore(this.future.pop()!);
    return true;
  }
  select(index: number) {
    if (index < 0 || index >= this.pack.shots.length) return false;
    this.index = index;
    this.committed.selectedId = this.shot.id;
    return true;
  }
  add(copy = false) {
    if (this.pack.shots.length >= MAX_TRAINING_SHOTS)
      throw new Error("Maximum 50 shots per pack.");
    const shot = copy ? structuredClone(this.shot) : defaultTrainingShot();
    shot.id = newLocalPlayerId();
    shot.enabled = true;
    shot.createdAt = shot.updatedAt = Date.now();
    const index = copy ? this.index + 1 : this.pack.shots.length;
    this.pack.shots.splice(index, 0, shot);
    this.index = index;
    this.changed();
  }
  delete() {
    if (this.pack.shots.length === 1)
      this.pack.shots[0] = defaultTrainingShot();
    else this.pack.shots.splice(this.index, 1);
    this.index = Math.min(this.index, this.pack.shots.length - 1);
    this.changed();
  }
  setEnabled(id: string, enabled: boolean) {
    const shot = this.pack.shots.find((s) => s.id === id);
    if (!shot || shot.enabled === enabled) return;
    shot.enabled = enabled;
    shot.updatedAt = Date.now();
    this.changed();
  }
  reorder(delta: number) {
    const next = this.index + delta;
    if (next < 0 || next >= this.pack.shots.length) return;
    [this.pack.shots[this.index], this.pack.shots[next]] = [
      this.pack.shots[next],
      this.pack.shots[this.index],
    ];
    this.index = next;
    this.changed();
  }
  save(library: CustomTrainingLibrary, authorName: string) {
    this.endChange();
    if (this.pack.authorName !== authorName) {
      this.pack.authorName = authorName;
    }
    const saved = library.saveDraft(this.pack);
    Object.assign(this.pack, saved);
    this.committed = this.snapshot();
    this.savedFingerprint = fingerprint(this.committed);
    this.refreshDirty();
    return saved;
  }
}
