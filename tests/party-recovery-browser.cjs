const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");

(async () => {
  const browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  try {
    const context = await browser.newContext();
    const host = await context.newPage();
    const errors = [];
    context.on("page", p => p.on("pageerror", e => errors.push(e.message)));
    host.on("pageerror", e => errors.push(e.message));
    // Reproduce the response from the stale API that caused the user's failure.
    await host.route("**/api/party/**", route => route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ message: "Route not found", error: "Not Found", statusCode: 404 }),
    }));
    const base = process.env.GAME_URL || "http://127.0.0.1:5173";
    await host.goto(base + "/?test");
    await host.waitForFunction(() => window.__arena && !window.__arena.party.busy);
    await host.locator("#party-create").click();
    await host.waitForFunction(() => document.querySelector("#party-message").textContent.includes("PARTY SERVER NEEDS AN UPDATE"));
    console.log("PASS stale backend gives actionable error");
    await host.unroute("**/api/party/**");
    await host.waitForFunction(() => window.__arena.party.connection === "connected" && !window.__arena.party.busy);
    await host.locator("#party-create").click();
    await host.waitForFunction(() => window.__arena.party.state?.code);
    const code = await host.evaluate(() => window.__arena.party.state.code);
    assert.match(code, /^[A-HJKMNP-Z2-9]{6}$/);
    console.log("PASS Create Party recovers without page reload");
    const guest = await context.newPage();
    await guest.goto(base + "/?test");
    await guest.waitForFunction(() => window.__arena?.party.connection === "connected" && !window.__arena.party.busy);
    await guest.locator("#party-join-open").click();
    await guest.locator("#party-input").fill(code);
    await guest.locator("#party-join button[type=submit]").click();
    await host.waitForFunction(() => window.__arena.party.state?.members.length === 2);
    await guest.waitForFunction(() => window.__arena.party.state?.members.length === 2);
    assert.notEqual(await host.evaluate(() => window.__arena.party.playerId), await guest.evaluate(() => window.__arena.party.playerId));
    console.log("PASS second tab joins and both clients synchronize");
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
