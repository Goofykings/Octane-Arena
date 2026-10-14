import type { FirebaseOptions } from "firebase/app";
import { firebaseConfig, firebaseConfigured } from "../config/firebase";
import {
  FEEDBACK_COLLECTION,
  type FeedbackReport,
} from "../../shared/feedback";
import type { FeedbackWriter } from "../game/feedback";
/** One-shot Firestore Lite writes: no reads, listeners, offline queues or admin credentials. */
export function firestoreFeedbackWriter(
  config: FirebaseOptions = firebaseConfig,
): FeedbackWriter {
  return async (report: FeedbackReport) => {
    if (!firebaseConfigured(config))
      throw Error(
        "Feedback is not configured yet. Please try again later. Your text has been kept.",
      );
    const [
      { getApps, initializeApp },
      { getFirestore, collection, addDoc, serverTimestamp },
    ] = await Promise.all([
      import("firebase/app"),
      import("firebase/firestore/lite"),
    ]);
    const name = "octane-feedback-" + config.projectId;
    const app =
      getApps().find((a) => a.name === name) ?? initializeApp(config, name);
    await addDoc(collection(getFirestore(app), FEEDBACK_COLLECTION), {
      ...report,
      createdAt: serverTimestamp(),
    });
  };
}
