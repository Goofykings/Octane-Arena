import { firebaseWebApp } from "./firebase-app";
import type { FirebaseOptions } from "firebase/app";
import { firebaseConfig, firebaseConfigured } from "../config/firebase";
import {
  FEEDBACK_COLLECTION,
  type FeedbackReport,
} from "../../shared/feedback";
import type { FeedbackWriter } from "../game/feedback";
const connected = new Set<string>();
/** One-shot Firestore Lite writes: no reads, listeners, offline queues or admin credentials. */
export function firestoreFeedbackWriter(
  config: FirebaseOptions = firebaseConfig,
  /** Local Firestore emulator for tests only; production never sets this. */
  emulator?: { host: string; port: number },
): FeedbackWriter {
  return async (report: FeedbackReport) => {
    if (!firebaseConfigured(config))
      throw Error(
        "Feedback is not configured yet. Please try again later. Your text has been kept.",
      );
    const {
      getFirestore,
      collection,
      addDoc,
      serverTimestamp,
      connectFirestoreEmulator,
    } = await import("firebase/firestore/lite");
    const name =
      "octane-web-" + config.projectId + (emulator ? "-emulator" : "");
    const app = await firebaseWebApp(config, name, !!emulator);
    const db = getFirestore(app);
    if (emulator && !connected.has(name)) {
      connectFirestoreEmulator(db, emulator.host, emulator.port);
      connected.add(name);
    }
    try {
      // No auth involved: the rules allow validated anonymous creates only.
      await addDoc(collection(db, FEEDBACK_COLLECTION), {
        ...report,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      // Diagnostic only: identifies the target without logging keys or report text.
      console.error("[Octane Arena] Feedback report write failed", {
        code: (error as { code?: unknown })?.code,
        message: (error as { message?: unknown })?.message,
        projectId: config.projectId,
        collection: FEEDBACK_COLLECTION,
      });
      throw error;
    }
  };
}
