import { resolve } from "node:path";
export interface ServerConfig {
  host: string;
  port: number;
  database: string;
  origins: string[];
  production: boolean;
  trustProxy: boolean;
  authLimit: number;
  sessionSeconds: number;
  requestLimit?: number;
  /** Combined LAN hosting may be reached by a local DNS hostname as well as IP. */
  allowSameOrigin?: boolean;
}
export function configuration(
  env: NodeJS.ProcessEnv = process.env,
): ServerConfig {
  const production = env.NODE_ENV === "production";
  const origins = (
    env.FRONTEND_ORIGINS ??
    (production ? "" : "http://127.0.0.1:5173,http://localhost:5173")
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!origins.length)
    throw Error("FRONTEND_ORIGINS is required in production.");
  for (const origin of origins) {
    const url = new URL(origin);
    if (
      url.origin !== origin ||
      (production && url.protocol !== "https:") ||
      !["http:", "https:"].includes(url.protocol)
    )
      throw Error(
        "FRONTEND_ORIGINS must contain exact HTTP(S) origins, using HTTPS in production.",
      );
  }
  const port = Number(env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error("Invalid PORT.");
  return {
    host: env.HOST ?? "127.0.0.1",
    port,
    database: resolve(env.DATABASE_PATH ?? "data/arena.sqlite"),
    origins,
    production,
    trustProxy: env.TRUST_PROXY === "true",
    authLimit: 8,
    sessionSeconds: 7 * 86400,
  };
}
