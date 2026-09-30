const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const errors = [];
    context.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
    const base = process.env.GAME_URL || "http://127.0.0.1:5173";
    async function open() {
      const p = await context.newPage();
      await p.goto(base + "/?test");
      await p.waitForFunction(
        () =>
          window.__arena?.party.connection === "connected" &&
          !window.__arena.party.busy,
      );
      return p;
    }
    const host = await open();
    await host.locator("#party-create").click();
    await host.waitForFunction(() => window.__arena.party.state?.code);
    const code = await host.evaluate(() => window.__arena.party.state.code);
    const guest = await open();
    await guest.locator("#party-join-open").click();
    await guest.locator("#party-input").fill(code);
    await guest.locator("#party-join button[type=submit]").click();
    await host.waitForFunction(
      () => window.__arena.party.state.members.length === 2,
    );
    assert.equal(
      await host.locator("#party-mode,#party-team,#party-ready").count(),
      0,
    );
    await host.screenshot({ path: "docs/party-home-updated.png" });
    assert.ok(await guest.locator("#party-start").isDisabled());
    await host.locator("#party-start").click();
    await guest.locator("#party-mode-screen").waitFor({ state: "visible" });
    assert.equal(await host.locator(".party-mode-card").count(), 3);
    await host.waitForTimeout(350);
    await host.screenshot({ path: "docs/party-mode-selection.png" });
    await host.locator("#party-continue").click();
    await guest.locator("#party-team-screen").waitFor({ state: "visible" });
    assert.ok(
      await guest.evaluate(() =>
        window.__arena.party.state.members.every((m) => m.team === null),
      ),
    );
    // Block polling to prove team changes travel over the live event channel.
    await host.route("**/api/party", (r) => r.abort());
    await guest.locator('.party-team-join[data-team="0"]').click();
    await host.waitForFunction(
      () =>
        window.__arena.party.state.members.some(
          (m) => m.id !== window.__arena.party.playerId && m.team === 0,
        ),
      null,
      { timeout: 1500 },
    );
    assert.ok(
      await host.locator('.party-team-join[data-team="0"]').isDisabled(),
    );
    await host.locator('.party-team-join[data-team="1"]').click();
    await guest.waitForFunction(() =>
      window.__arena.party.state.members.some((m) => m.team === 1),
    );
    // Ready remains a protocol foundation; the requested UI replaces its button.
    assert.equal(await guest.evaluate(() => window.__arena.party.action("ready", { ready: true })), true);
    await host.waitForFunction(() => window.__arena.party.state.members.some(m => m.id !== window.__arena.party.playerId && m.ready), null, {timeout:1500});
    console.log("PASS ready state synchronizes over live events");
    await host.unroute("**/api/party");
    await host.screenshot({ path: "docs/party-team-selection.png" });
    console.log(
      "PASS shared mode/Continue flow; 1v1 capacity and live team updates without polling",
    );
    await host.locator('[data-stage="mode"]').click();
    await host.locator('[data-mode="2v2bots"]').click();
    await host.locator("#party-continue").click();
    await guest.locator("#party-team-screen").waitFor({ state: "visible" });
    for (const p of [host, guest]) {
      await p.locator('.party-team-join[data-team="0"]').click();
      assert.ok(
        await p.locator('.party-team-join[data-team="1"]').isDisabled(),
      );
    }
    await host.waitForFunction(() =>
      window.__arena.party.state.members.every((m) => m.team === 0),
    );
    assert.match(
      await guest.locator('.party-team-column[data-team="1"]').textContent(),
      /CIRCUIT.*BOT.*RELAY.*BOT/s,
    );
    await host.screenshot({ path: "docs/party-bot-team.png" });
    console.log(
      "PASS 2 vs 2 bots reserves opponents and accepts both humans on blue",
    );
    for (const size of [
      { width: 390, height: 844 },
      { width: 900, height: 600 },
    ]) {
      await host.setViewportSize(size);
      assert.ok(
        await host.locator(".party-team-board").evaluate((e) => {
          const r = e.getBoundingClientRect();
          return r.left >= 0 && r.right <= innerWidth;
        }),
      );
      await host.screenshot({ path: `docs/party-team-${size.width}.png` });
    }
    await host.setViewportSize({ width: 1280, height: 800 });
    await host.locator('[data-stage="mode"]').click();
    await host.locator('[data-mode="2v2"]').click();
    await host.locator('[data-stage="home"]').click();
    await guest.waitForFunction(
      () => !document.querySelector("#party-flow").open,
    );
    console.log("PASS host back navigation closes setup for both clients");
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
