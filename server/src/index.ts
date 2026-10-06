import { configuration } from "./config.js";
import { createApp } from "./app.js";
import { existsSync } from "node:fs";
// Secrets/config stay on the backend; the frontend only needs the public API URL.
let app: Awaited<ReturnType<typeof createApp>>["app"] | undefined;
try {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const config = configuration();
  ({ app } = await createApp(config));
  await app.listen({ host: config.host, port: config.port });
  console.log(
    `Octane Arena party API listening on ${config.host}:${config.port}`,
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      void app!.close().then(() => process.exit(0));
    });
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  const message =
    !app && error instanceof Error
      ? error.message
      : "Check HOST/PORT and server availability.";
  console.error(
    `Party server could not start${code ? ` (${code})` : ""}: ${message}`,
  );
  await app?.close();
  process.exitCode = 1;
}
