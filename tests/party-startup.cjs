const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { createServer } = require("node:net");
const { resolve } = require("node:path");

(async () => {
  const reserve = createServer();
  await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
  const port = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
  const run = (port) =>
    spawn(process.execPath, ["dist/server/src/index.js"], {
      cwd: resolve("server"),
      env: {
        ...process.env,
        NODE_ENV: "production",
        HOST: "0.0.0.0",
        PORT: String(port),
        FRONTEND_ORIGINS: "https://goofykings.github.io",
      },
      windowsHide: true,
    });
  const child = run(port);
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  try {
    const deadline = Date.now() + 30000;
    while (
      !output.includes("party API listening") &&
      Date.now() < deadline &&
      child.exitCode === null
    )
      await new Promise((resolve) => setTimeout(resolve, 100));
    assert.match(output, new RegExp(`0.0.0.0:${port}`));
    assert.deepEqual(
      await (await fetch(`http://127.0.0.1:${port}/health`)).json(),
      { status: "ok" },
    );
    console.log(
      "PASS compiled production entry starts without frontend files and honors host/PORT; health responds",
    );
  } finally {
    child.kill();
    if (child.exitCode === null)
      await new Promise((resolve) => child.once("exit", resolve));
  }
  const invalid = run(0);
  let error = "";
  invalid.stderr.on("data", (chunk) => (error += chunk));
  const code = await new Promise((resolve) => invalid.once("exit", resolve));
  assert.equal(code, 1);
  assert.match(error, /Party server could not start: Invalid PORT/);
  assert.doesNotMatch(error, /\n\s+at /);
  console.log(
    "PASS invalid production config exits cleanly with an actionable error",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
