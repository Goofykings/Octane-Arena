import { firebaseWebApp } from "./firebase-app";
import type { FirebaseOptions } from "firebase/app";
import type { DocumentSnapshot } from "firebase/firestore";
import { firebaseConfig } from "../config/firebase";
import {
  parsePublishedPack,
  serializePublishedPack,
  type CustomTrainingPack,
} from "../../shared/custom-training";
export const TRAINING_COLLECTION = "publishedTrainingPacks";
export const COMMUNITY_PAGE_SIZE = 20;
export interface CommunityEntry {
  pack: CustomTrainingPack;
  /** True when the signed-in anonymous Firebase user published this pack. */
  owned: boolean;
}
export interface CommunityPage {
  entries: CommunityEntry[];
  /** Opaque pagination cursor; null when there are no more packs. */
  cursor: unknown;
  skipped: number;
}
export interface PublishResult {
  documentId: string;
  ownerUid: string;
  version: number;
  publishedAt: number;
}
export interface TrainingCloud {
  publish(pack: CustomTrainingPack, authorName: string): Promise<PublishResult>;
  unpublish(pack: CustomTrainingPack): Promise<void>;
  browse(cursor?: unknown): Promise<CommunityPage>;
  download(documentId: string): Promise<CustomTrainingPack>;
}
/** Validates an untrusted Firestore document; kept as the cloud-facing name for tests/callers. */
export const communityPack = parsePublishedPack;
/** The document ID is derived from the owner and the local pack ID, so republishing
 * always targets the same document and can never create duplicates. */
export const publicationId = (ownerUid: string, packId: string) =>
  ownerUid + "_" + packId;
const ANONYMOUS_DISABLED = [
  "auth/operation-not-allowed",
  "auth/admin-restricted-operation",
];
export class FirebaseTrainingPacks implements TrainingCloud {
  private pending?: ReturnType<FirebaseTrainingPacks["connect"]>;
  constructor(
    private config: FirebaseOptions = firebaseConfig,
    /** Local emulators only; `instance` isolates a second simulated browser/identity in tests. */
    private emulator?: {
      authUrl: string;
      host: string;
      port: number;
      instance?: string;
    },
  ) {}
  private async connect() {
    const [appSDK, authSDK, dbSDK] = await Promise.all([
      import("firebase/app"),
      import("firebase/auth"),
      import("firebase/firestore"),
    ]);
    const name = this.emulator
      ? "octane-training-" +
        this.config.projectId +
        "-emulator" +
        (this.emulator.instance ? "-" + this.emulator.instance : "")
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
  /** Silent anonymous sign-in: the Firebase UID is the security identity, never the local username. */
  private async owner() {
    const s = await this.services();
    await s.auth.authStateReady();
    if (!s.auth.currentUser)
      try {
        await s.authSDK.signInAnonymously(s.auth);
      } catch (error) {
        const code = String((error as { code?: unknown })?.code ?? "");
        if (ANONYMOUS_DISABLED.includes(code))
          console.error(
            "[Octane Arena] Firebase Anonymous Authentication is disabled. Enable it in Firebase Console -> Authentication -> Sign-in method -> Anonymous.",
          );
        throw error;
      }
    return { ...s, uid: s.auth.currentUser!.uid };
  }
  async publish(value: CustomTrainingPack, authorName: string) {
    const payload = serializePublishedPack(value, authorName);
    const { db, dbSDK: sdk, uid } = await this.owner();
    if (value.publishedDocumentId && value.ownerUid && value.ownerUid !== uid)
      throw new Error(
        "This browser no longer owns that publication. Its original Firebase identity is required.",
      );
    const documentId = publicationId(uid, payload.packId);
    if (value.publishedDocumentId && value.publishedDocumentId !== documentId)
      throw new Error("Only the original publisher can update this pack.");
    const ref = sdk.doc(db, TRAINING_COLLECTION, documentId);
    const version = await sdk.runTransaction(db, async (tx) => {
      const existing = await tx.get(ref);
      const old = existing.exists() ? existing.data() : undefined;
      if (old && old.ownerUid !== uid)
        throw new Error("Only the original publisher can update this pack.");
      if (
        old &&
        value.publishedVersion !== undefined &&
        old.version !== value.publishedVersion
      )
        throw new Error(
          "The published version changed elsewhere. Reopen the latest local pack before updating.",
        );
      const version = old ? old.version + 1 : 1;
      tx.set(ref, {
        ...payload,
        // Always taken from the authenticated session, never from pack data.
        ownerUid: uid,
        version,
        createdAt: old ? old.createdAt : sdk.serverTimestamp(),
        publishedAt: old ? old.publishedAt : sdk.serverTimestamp(),
        updatedAt: sdk.serverTimestamp(),
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
    const ref = sdk.doc(db, TRAINING_COLLECTION, pack.publishedDocumentId);
    // Already removed (e.g. from another tab): treat as unpublished.
    if (!(await sdk.getDoc(ref)).exists()) return;
    await sdk.deleteDoc(ref);
  }
  /** Signs in if possible so owned packs can be flagged; browsing still works if auth fails. */
  private async viewerUid() {
    try {
      return (await this.owner()).uid;
    } catch {
      return null;
    }
  }
  async browse(cursor?: unknown) {
    const { db, dbSDK: sdk } = await this.services();
    const uid = await this.viewerUid();
    const result = await sdk.getDocs(
      sdk.query(
        sdk.collection(db, TRAINING_COLLECTION),
        sdk.orderBy("updatedAt", "desc"),
        ...(cursor ? [sdk.startAfter(cursor as DocumentSnapshot)] : []),
        sdk.limit(COMMUNITY_PAGE_SIZE + 1),
      ),
    );
    const docs = result.docs.slice(0, COMMUNITY_PAGE_SIZE),
      entries: CommunityEntry[] = [];
    let skipped = 0;
    for (const doc of docs) {
      try {
        const pack = parsePublishedPack(doc.data(), doc.id);
        entries.push({ pack, owned: !!uid && pack.ownerUid === uid });
      } catch {
        skipped++;
      }
    }
    return {
      entries,
      skipped,
      cursor:
        result.docs.length > COMMUNITY_PAGE_SIZE ? docs[docs.length - 1] : null,
    };
  }
  async download(documentId: string) {
    if (!/^[A-Za-z0-9_-]{1,220}$/.test(documentId))
      throw new Error("Malformed publication ID.");
    const { db, dbSDK: sdk } = await this.services();
    const snap = await sdk.getDoc(sdk.doc(db, TRAINING_COLLECTION, documentId));
    if (!snap.exists()) throw new Error("This pack is no longer published.");
    return parsePublishedPack(snap.data(), snap.id);
  }
}
export function trainingCloudError(error: unknown) {
  const issues = (error as { issues?: { message?: string }[] })?.issues;
  if (Array.isArray(issues) && issues[0]?.message) return issues[0].message;
  const code = String((error as { code?: unknown })?.code ?? "");
  if (ANONYMOUS_DISABLED.some((c) => code.includes(c.slice(5))))
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
