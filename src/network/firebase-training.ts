import { firebaseWebApp } from "./firebase-app";
import type { FirebaseOptions } from "firebase/app";
import { firebaseConfig } from "../config/firebase";
import {
  validatePlayablePack,
  type CustomTrainingPack,
} from "../../shared/custom-training";
export const TRAINING_COLLECTION = "publishedTrainingPacks";
export interface CommunityPage {
  packs: CustomTrainingPack[];
  cursor: string | null;
  skipped: number;
}
export interface TrainingCloud {
  publish(
    pack: CustomTrainingPack,
    authorName: string,
  ): Promise<{
    documentId: string;
    ownerUid: string;
    version: number;
    publishedAt: number;
  }>;
  unpublish(pack: CustomTrainingPack): Promise<void>;
  browse(cursor?: string | null): Promise<CommunityPage>;
}
export function communityPack(
  value: unknown,
  documentId: string,
): CustomTrainingPack {
  const d = value as Record<string, unknown>;
  if (
    !d ||
    d.published !== true ||
    typeof d.ownerUid !== "string" ||
    typeof d.shotCount !== "number"
  )
    throw new Error("Invalid published pack.");
  const millis = (t: unknown) => {
    if (t && typeof (t as { toMillis?: unknown }).toMillis === "function")
      return (t as { toMillis(): number }).toMillis();
    throw new Error("Invalid publication timestamp.");
  };
  const pack = validatePlayablePack({
    id: d.packId,
    name: d.name,
    authorName: d.authorName,
    version: d.version,
    createdAt: millis(d.createdAt),
    updatedAt: millis(d.updatedAt),
    published: true,
    shots: d.shots,
    ownerUid: d.ownerUid,
    publishedDocumentId: documentId,
    publishedAt: millis(d.publishedAt),
    publishedVersion: d.version,
  });
  if (pack.shots.length !== d.shotCount) throw new Error("Invalid shot count.");
  return pack;
}
export class FirebaseTrainingPacks implements TrainingCloud {
  private pending?: ReturnType<FirebaseTrainingPacks["connect"]>;
  constructor(
    private config: FirebaseOptions = firebaseConfig,
    private emulator?: { authUrl: string; host: string; port: number },
  ) {}
  private async connect() {
    const [appSDK, authSDK, dbSDK] = await Promise.all([
      import("firebase/app"),
      import("firebase/auth"),
      import("firebase/firestore"),
    ]);
    const name = this.emulator
      ? "octane-training-" + this.config.projectId + "-emulator"
      : "octane-web-" + this.config.projectId;
    const existed = appSDK.getApps().find((a) => a.name === name),
      app = await firebaseWebApp(this.config, name, !!this.emulator);
    // App Check can be initialized on this app before requests; no secrets/admin SDK.
    const auth = authSDK.getAuth(app),
      db = dbSDK.getFirestore(app);
    if (this.emulator && !existed) {
      authSDK.connectAuthEmulator(auth, this.emulator.authUrl, {
        disableWarnings: true,
      });
      dbSDK.connectFirestoreEmulator(
        db,
        this.emulator.host,
        this.emulator.port,
      );
    }
    return { auth, db, authSDK, dbSDK };
  }
  private services() {
    return (this.pending ??= this.connect().catch((error) => {
      this.pending = undefined;
      throw error;
    }));
  }
  private async owner() {
    const s = await this.services();
    await s.auth.authStateReady();
    if (!s.auth.currentUser) await s.authSDK.signInAnonymously(s.auth);
    return { ...s, uid: s.auth.currentUser!.uid };
  }
  async publish(value: CustomTrainingPack, authorName: string) {
    const pack = validatePlayablePack({ ...value, authorName });
    const { db, dbSDK: sdk, uid } = await this.owner();
    if (pack.ownerUid && pack.ownerUid !== uid)
      throw new Error(
        "This browser no longer owns that publication. Its original Firebase identity is required.",
      );
    const documentId = pack.publishedDocumentId ?? uid + "_" + pack.id;
    if (!/^[a-zA-Z0-9_-]{1,220}$/.test(documentId))
      throw new Error("Invalid publication ID.");
    const ref = sdk.doc(db, TRAINING_COLLECTION, documentId);
    const version = await sdk.runTransaction(db, async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists() && existing.data().ownerUid !== uid)
        throw new Error("Only the original publisher can update this pack.");
      if (
        existing.exists() &&
        existing.data().version !== (pack.publishedVersion ?? 0)
      )
        throw new Error(
          "The published version changed. Reopen the latest local pack before updating.",
        );
      const version = existing.exists() ? existing.data().version + 1 : 1;
      tx.set(ref, {
        packId: pack.id,
        ownerUid: uid,
        authorName: pack.authorName,
        name: pack.name,
        version,
        createdAt: existing.exists()
          ? existing.data().createdAt
          : sdk.serverTimestamp(),
        updatedAt: sdk.serverTimestamp(),
        publishedAt: sdk.serverTimestamp(),
        shotCount: pack.shots.length,
        shots: pack.shots,
        published: true,
      });
      return version;
    });
    const saved = await sdk.getDoc(ref);
    return {
      documentId,
      ownerUid: uid,
      version,
      publishedAt: saved.data()!.publishedAt.toMillis(),
    };
  }
  async unpublish(pack: CustomTrainingPack) {
    if (!pack.publishedDocumentId) return;
    const { db, dbSDK: sdk, uid } = await this.owner();
    if (pack.ownerUid !== uid)
      throw new Error("Only the original publisher can unpublish this pack.");
    await sdk.deleteDoc(
      sdk.doc(db, TRAINING_COLLECTION, pack.publishedDocumentId),
    );
  }
  async browse(cursor?: string | null) {
    const { db, dbSDK: sdk } = await this.services();
    const constraints = [
      sdk.where("published", "==", true),
      sdk.orderBy(sdk.documentId()),
      ...(cursor ? [sdk.startAfter(cursor)] : []),
      sdk.limit(21),
    ];
    const result = await sdk.getDocs(
      sdk.query(sdk.collection(db, TRAINING_COLLECTION), ...constraints),
    );
    const docs = result.docs.slice(0, 20),
      packs: CustomTrainingPack[] = [];
    let skipped = 0;
    for (const doc of docs) {
      try {
        packs.push(communityPack(doc.data(), doc.id));
      } catch {
        skipped++;
      }
    }
    return {
      packs,
      skipped,
      cursor: result.docs.length > 20 ? docs[docs.length - 1].id : null,
    };
  }
}
export function trainingCloudError(error: unknown) {
  const issues = (error as { issues?: { message?: string }[] })?.issues;
  if (Array.isArray(issues) && issues[0]?.message) return issues[0].message;
  const code = String((error as { code?: unknown })?.code ?? "");
  if (code.includes("operation-not-allowed"))
    return "Publishing is unavailable: enable Anonymous sign-in in Firebase Authentication.";
  if (code.includes("unauthorized-domain"))
    return "Add this website to Firebase Authentication's authorized domains.";
  if (code.includes("permission-denied"))
    return "Firebase denied this request. Check the published training rules and publisher ownership.";
  if (code.includes("unavailable") || code.includes("network"))
    return "Could not reach Firebase. Your local pack is safe; try again when online.";
  return error instanceof Error
    ? error.message
    : "Could not complete the cloud request. Your local pack is safe.";
}
