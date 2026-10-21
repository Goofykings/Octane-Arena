import { newLocalPlayerId as newTrainingPackId } from "../../shared/local-profile";
import {
  trainingLibrarySchema,
  customTrainingPackSchema,
  packNameSchema,
  type CustomTrainingPack,
} from "../../shared/custom-training";

// Replace this adapter with IndexedDB/server storage later without changing the UI or pack IDs.
export interface TrainingPackStorage {
  read(): CustomTrainingPack[];
  write(packs: CustomTrainingPack[]): void;
}
export class LocalTrainingPackStorage implements TrainingPackStorage {
  readonly key: string;
  constructor(
    private storage: Pick<Storage, "getItem" | "setItem">,
    profileId: string,
  ) {
    this.key = "octane-arena-custom-training:" + profileId;
  }
  read(): CustomTrainingPack[] {
    const raw = this.storage.getItem(this.key);
    if (raw === null) return [];
    const result = trainingLibrarySchema.safeParse(JSON.parse(raw));
    if (!result.success)
      throw new Error(
        "Saved packs could not be read. Your saved data has not been changed.",
      );
    const packs = result.data.packs;
    if (new Set(packs.map((p) => p.id)).size !== packs.length)
      throw new Error(
        "Saved pack IDs conflict. Your saved data has not been changed.",
      );
    return packs.map((p) => {
      if (!p.publishedDocumentId) p.published = false;
      return p;
    });
  }
  write(packs: CustomTrainingPack[]) {
    this.storage.setItem(
      this.key,
      JSON.stringify(trainingLibrarySchema.parse({ schemaVersion: 1, packs })),
    );
  }
}
export class CustomTrainingLibrary {
  constructor(
    private storage: TrainingPackStorage,
    private now = Date.now,
    private newId: () => string = newTrainingPackId,
  ) {}
  list() {
    return this.storage.read();
  }
  get(id: string) {
    return this.list().find((p) => p.id === id);
  }
  create(name: string) {
    const validName = packNameSchema.parse(name);
    const packs = this.list();
    const id = this.newId();
    if (packs.some((p) => p.id === id))
      throw new Error("Could not generate a unique pack ID. Please try again.");
    const time = this.now();
    const pack: CustomTrainingPack = {
      id,
      name: validName,
      createdAt: time,
      updatedAt: time,
      published: false,
      shots: [],
      version: 1,
      authorName: "Guest",
    };
    this.storage.write([...packs, pack]);
    return pack;
  }
  private update(id: string, change: (pack: CustomTrainingPack) => void) {
    const packs = this.list();
    const pack = packs.find((p) => p.id === id);
    if (!pack) throw new Error("This pack no longer exists.");
    change(pack);
    pack.updatedAt = Math.max(this.now(), pack.updatedAt + 1);
    this.storage.write(packs);
    return pack;
  }
  rename(id: string, name: string) {
    const validName = packNameSchema.parse(name);
    return this.update(id, (p) => {
      p.name = validName;
    });
  }
  saveDraft(draft: CustomTrainingPack) {
    const valid = customTrainingPackSchema.parse(draft);
    return this.update(valid.id, (pack) => {
      const { shots, name, authorName } = valid;
      Object.assign(pack, { shots, name, authorName });
    });
  }
  markPublished(
    id: string,
    cloud: {
      documentId: string;
      ownerUid: string;
      version: number;
      publishedAt: number;
    },
    revision: number,
  ) {
    const packs = this.list(),
      pack = packs.find((p) => p.id === id);
    if (!pack)
      throw new Error(
        "Published successfully, but the local pack was removed.",
      );
    Object.assign(pack, {
      published: true,
      publishedDocumentId: cloud.documentId,
      ownerUid: cloud.ownerUid,
      publishedVersion: cloud.version,
      publishedAt: cloud.publishedAt,
      publishedRevision: revision,
      version: cloud.version,
    });
    this.storage.write(packs);
    return pack;
  }
  markUnpublished(id: string) {
    return this.update(id, (p) => {
      p.published = false;
      delete p.publishedDocumentId;
      delete p.publishedRevision;
    });
  }
  delete(id: string) {
    const packs = this.list();
    if (!packs.some((p) => p.id === id))
      throw new Error("This pack no longer exists.");
    this.storage.write(packs.filter((p) => p.id !== id));
  }
}
