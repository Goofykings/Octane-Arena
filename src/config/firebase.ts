import type { FirebaseOptions } from "firebase/app";
/** Paste ONLY your Firebase web app configuration here (Project settings -> Your apps).
 * Web configuration is public. Never paste Admin SDK/service-account credentials. */
export const firebaseConfig = {
  apiKey: "AIzaSyDOh8OxKAe7epFX8tE8Vf6nrPiVHOrjghI",
  authDomain: "octane-arena-e7bad.firebaseapp.com",
  projectId: "octane-arena-e7bad",
  storageBucket: "octane-arena-e7bad.firebasestorage.app",
  messagingSenderId: "233145091711",
  appId: "1:233145091711:web:27299c08f2d21ca496214a",
  measurementId: "G-GQ1X3NWWX6"
};
export const firebaseConfigured = (config: FirebaseOptions = firebaseConfig) =>
  [config.apiKey, config.projectId, config.appId].every(
    (v) => typeof v === "string" && v.trim().length > 0,
  );
