import type { FirebaseOptions } from "firebase/app";
/** Paste ONLY your Firebase web app configuration here (Project settings -> Your apps).
 * Web configuration is public. Never paste Admin SDK/service-account credentials. */
export const firebaseConfig: FirebaseOptions = {
  apiKey: "AIzaSyCZExJtvDF2y7442SEYpv8ZVC0GcGryF24",
  authDomain: "octane-arena.firebaseapp.com",
  projectId: "octane-arena",
  storageBucket: "octane-arena.firebasestorage.app",
  messagingSenderId: "1086992890194",
  appId: "1:1086992890194:web:7295e399c7bfb4c546e28b",
};
export const firebaseConfigured = (config: FirebaseOptions = firebaseConfig) =>
  [config.apiKey, config.projectId, config.appId].every(
    (v) => typeof v === "string" && v.trim().length > 0,
  );
