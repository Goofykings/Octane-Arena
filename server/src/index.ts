import { configuration } from "./config.js";
import { createApp } from "./app.js";
import { existsSync } from "node:fs";
// Secrets/config stay on the backend; the frontend only needs the public API URL.
if (existsSync(".env")) process.loadEnvFile(".env");
const config = configuration(),
  { app } = await createApp(config);
await app.listen({ host: config.host, port: config.port });
console.log(
  `Octane Arena account API listening on ${config.host}:${config.port}`,
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
