const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
(async () => {
  const { startLan } = await import(pathToFileURL(resolve("server/dist/server/src/lan.js")).href);
  const { app } = await startLan(8095, ":memory:");
  let browser;
  try {
    browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true,
      args: ["--enable-unsafe-swiftshader", "--no-proxy-server", "--host-resolver-rules=MAP arena-pc.test 127.0.0.1"] });
    for (const hostname of ["arena-pc.test", "127.0.0.1"]) {
      const context = await browser.newContext();
      const page = await context.newPage(), origin = `http://${hostname}:8095`, requests = [], errors = [];
      page.on("request", r => { if (new URL(r.url()).pathname.startsWith("/api/")) requests.push(r.url()); });
      page.on("pageerror", e => errors.push(e.message));
      await page.goto(origin + "/?test");
      await page.waitForFunction(() => window.__arena?.party.connection === "connected" && !window.__arena.party.busy);
      await page.locator("#party-create").click();
      await page.waitForFunction(() => window.__arena.party.state?.code);
      await page.waitForResponse(r => r.url().endsWith("/api/party"));
      assert.ok(requests.some(u => u.endsWith("/api/me")), "accounts use resolved API");
      assert.ok(requests.some(u => u.endsWith("/api/party/events")), "live events use resolved API");
      assert.ok(requests.every(u => new URL(u).origin === origin));
      assert.deepEqual(errors, []);
      console.log("PASS automatic same-origin accounts, party creation and live events:", origin);
      await context.close();
    }
  } finally { await browser?.close(); await app.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
