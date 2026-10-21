import { firebaseWebApp } from "./firebase-app";
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
    const { getFirestore, collection, addDoc, serverTimestamp } = await import(
      "firebase/firestore/lite"
    );
    const name = "octane-web-" + config.projectId;
    const app = await firebaseWebApp(config, name);
    await addDoc(collection(getFirestore(app), FEEDBACK_COLLECTION), {
      ...report,
      createdAt: serverTimestamp(),
    });
  };
}
