import type { FirebaseOptions } from "firebase/app";
const configuredApps = new Set<string>();
/** Shared web app: configure App Check before any feedback or community request. */
export async function firebaseWebApp(
  config: FirebaseOptions,
  name = "octane-web-" + config.projectId,
  emulator = false,
) {
  const { getApps, initializeApp } = await import("firebase/app");
  const existing = getApps().find((a) => a.name === name);
  const app = existing ?? initializeApp(config, name);
  if (!existing && import.meta.env?.DEV)
    console.info("[Octane Arena] Firebase project:", config.projectId);
  const siteKey = import.meta.env?.VITE_FIREBASE_APP_CHECK_SITE_KEY;
  if (siteKey && !emulator && !configuredApps.has(name)) {
    const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import(
      "firebase/app-check"
    );
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
    configuredApps.add(name);
  }
  return app;
}
