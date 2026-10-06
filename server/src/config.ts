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
  matchTransport?: "server" | "webrtc";
  stunUrls?: string[];
  turnUrls?: string[];
  turnSecret?: string;
  icePolicy?: "all" | "relay";
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
      (production &&
        url.protocol !== "https:" &&
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) ||
      !["http:", "https:"].includes(url.protocol)
    )
      throw Error(
        "FRONTEND_ORIGINS must contain exact HTTP(S) origins; public production origins require HTTPS.",
      );
  }
  const port = Number(env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error("Invalid PORT.");
  const matchTransport =
    env.MATCH_TRANSPORT ?? (production ? "webrtc" : "server");
  if (matchTransport !== "server" && matchTransport !== "webrtc")
    throw Error("MATCH_TRANSPORT must be server or webrtc.");
  const urls = (value: string | undefined, protocols: string[]) =>
    (value ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((url) => {
        const parsed =
          /^(stun|stuns|turn|turns):(\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+)(?::(\d+))?(?:\?transport=(udp|tcp))?$/.exec(
            url,
          );
        if (
          !parsed ||
          (parsed[3] && (Number(parsed[3]) < 1 || Number(parsed[3]) > 65535)) ||
          !protocols.some((protocol) => url.startsWith(protocol)) ||
          /[\s@]/.test(url)
        )
          throw Error("Invalid STUN/TURN URL.");
        return url;
      });
  const stunUrls = urls(env.STUN_URLS ?? "stun:stun.l.google.com:19302", [
    "stun:",
    "stuns:",
  ]);
  const turnUrls = urls(env.TURN_URLS, ["turn:", "turns:"]);
  if (turnUrls.length && !env.TURN_SECRET)
    throw Error("TURN_SECRET is required with TURN_URLS.");
  if (env.ICE_POLICY && env.ICE_POLICY !== "all" && env.ICE_POLICY !== "relay")
    throw Error("ICE_POLICY must be all or relay.");
  if (env.ICE_POLICY === "relay" && !turnUrls.length)
    throw Error("Relay-only mode requires TURN_URLS.");
  return {
    host: env.HOST ?? (production ? "0.0.0.0" : "127.0.0.1"),
    port,
    database: resolve(env.DATABASE_PATH ?? "data/arena.sqlite"),
    origins,
    production,
    trustProxy: env.TRUST_PROXY === "true",
    matchTransport,
    stunUrls,
    turnUrls,
    turnSecret: env.TURN_SECRET,
    icePolicy: env.ICE_POLICY === "relay" ? "relay" : "all",
    authLimit: 8,
    sessionSeconds: 7 * 86400,
  };
}
