import { networkInterfaces } from "node:os";
import { resolve, extname, sep } from "node:path";
import { createReadStream, existsSync, statSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createApp } from "./app.js";
import type { ServerConfig } from "./config.js";
export async function startLan(
  port = Number(process.env.LAN_PORT ?? 8090),
  database = process.env.DATABASE_PATH ?? resolve("server/data/arena.sqlite"),
  rtc: Pick<
    ServerConfig,
    "matchTransport" | "stunUrls" | "turnUrls" | "turnSecret" | "icePolicy"
  > = {},
) {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error("LAN_PORT must be 1–65535");
  const root = resolve("dist");
  if (!existsSync(resolve(root, "index.html")))
    throw Error("Build the frontend first: npm run build");
  // The same production build can target a Pages subpath and still launch on
  // LAN. Honor its actual asset prefix rather than requiring a second build.
  const script = readFileSync(resolve(root, "index.html"), "utf8").match(
    /<script[^>]*\ssrc="([^"]*\/assets\/[^"]+)"/,
  )?.[1];
  const assetPath = script
    ? new URL(script, "http://localhost").pathname
    : "/assets/";
  const prefix =
    assetPath.slice(0, assetPath.lastIndexOf("/assets/") + 1) || "/";
  const addresses = [
    ...new Set(
      Object.values(networkInterfaces()).flatMap((v) =>
        (v ?? [])
          .filter((a) => a.family === "IPv4" && !a.internal)
          .map((a) => a.address),
      ),
    ),
  ];
  const origins = [
    "http://localhost:" + port,
    "http://127.0.0.1:" + port,
    ...addresses.map((ip) => `http://${ip}:${port}`),
  ];
  const { app, partyMatches } = await createApp({
    host: "0.0.0.0",
    port,
    database,
    origins,
    production: false,
    trustProxy: false,
    authLimit: 50,
    sessionSeconds: 86400,
    requestLimit: 1800,
    allowSameOrigin: true,
    ...rtc,
  });
  app.get("/config.json", async () => ({ lan: true, apiUrl: "/" }));
  if (prefix !== "/")
    app.get(prefix + "config.json", async () => ({ lan: true, apiUrl: "/" }));
  app.get("/*", async (req, reply) => {
    let pathname = new URL(req.url, "http://localhost").pathname;
    if (prefix !== "/" && pathname.startsWith(prefix))
      pathname = "/" + pathname.slice(prefix.length);
    if (pathname.startsWith("/api/"))
      return reply.code(404).send({ error: { message: "NOT FOUND" } });
    const file = resolve(
      root,
      "." + decodeURIComponent(pathname === "/" ? "/index.html" : pathname),
    );
    if (
      !file.startsWith(root + sep) ||
      !existsSync(file) ||
      !statSync(file).isFile()
    )
      return reply.code(404).send("Not found");
    const mime: Record<string, string> = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".wasm": "application/wasm",
      ".ttf": "font/ttf",
      ".woff2": "font/woff2",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".jpg": "image/jpeg",
    };
    reply.removeHeader("Content-Security-Policy");
    return reply
      .type(mime[extname(file)] ?? "application/octet-stream")
      .send(createReadStream(file));
  });
  await app.listen({ host: "0.0.0.0", port });
  return { app, origins, addresses, port, partyMatches };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { app, addresses, port } = await startLan();
  console.log(
    `Octane Arena LAN ready on 0.0.0.0:${port}\nThis computer: http://localhost:${port}\nSame Wi-Fi: ${addresses.map((ip) => `http://${ip}:${port}`).join(" or ") || "No LAN IPv4 address detected"}\nCreate Party / Join Party, choose a mode and sides, then the host selects KICK OFF.`,
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => void app.close().then(() => process.exit(0)));
}
