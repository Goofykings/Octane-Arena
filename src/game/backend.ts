export interface BackendConfig {
  lan?: boolean;
  apiUrl?: string;
}

/** LAN runtime configuration wins over a URL baked into a deployment build. */
export function backendEndpoints(
  config: BackendConfig,
  configuredUrl: string | undefined,
  pageOrigin: string,
  development = false,
) {
  const address =
    config.lan === true
      ? pageOrigin
      : configuredUrl ||
        config.apiUrl ||
        (development ? "http://127.0.0.1:8787" : "");
  if (!address) return { apiUrl: "", websocketUrl: "" };
  const url = new URL(address, pageOrigin);
  if (
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        (url.origin === pageOrigin ||
          ["localhost", "127.0.0.1"].includes(url.hostname))
      )) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid API URL");
  const apiUrl = url.href.replace(/\/$/, "");
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return { apiUrl, websocketUrl: url.href.replace(/\/$/, "") };
}

export async function loadBackendEndpoints() {
  // A missing runtime file must not disable an explicitly configured deployment.
  const config: BackendConfig = await fetch(
    `${import.meta.env.BASE_URL}config.json`,
    {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    },
  )
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  return backendEndpoints(
    config ?? {},
    import.meta.env.VITE_API_URL,
    location.origin,
    import.meta.env.DEV,
  );
}
