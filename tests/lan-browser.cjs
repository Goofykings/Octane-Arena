const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
(async () => {
  const address = Object.values(os.networkInterfaces())
    .flat()
    .find((a) => a && a.family === "IPv4" && !a.internal)?.address;
  const base = process.env.LAN_URL || `http://${address || "127.0.0.1"}:8093`;
  assert.equal((await fetch(base + "/")).status, 200);
  assert.equal((await (await fetch(base + "/config.json")).json()).apiUrl, "/");
  console.log(
    "PASS frontend and same-origin config served on LAN address",
    base,
  );
  const browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  try {
    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
      }),
      pages = [],
      errors = [];
    async function open() {
      const p = await context.newPage();
      p.on("pageerror", (e) => errors.push(e.message));
      await p.goto(base + "/?test");
      await p.waitForFunction(
        () =>
          window.__arena?.party.playerId !== "local" &&
          window.__arena?.party.connection === "connected",
      );
      pages.push(p);
      return p;
    }
    const host = await open();
    await host.locator("#party-create").click();
    await host.waitForFunction(() => window.__arena.party.state?.code);
    const code = await host.evaluate(() => window.__arena.party.state.code);
    assert.match(code, /^[A-HJKMNP-Z2-9]{6}$/);
    await host.screenshot({ path: "docs/lan-lobby-1.png" });
    console.log("PASS create party and one-car home");
    const guest = await open();
    assert.notEqual(
      await host.evaluate(() => window.__arena.party.playerId),
      await guest.evaluate(() => window.__arena.party.playerId),
    );
    await guest.locator("#party-join-open").click();
    await guest.locator("#party-input").fill("O0I1L");
    await guest.locator("#party-join button[type=submit]").click();
    await guest.waitForFunction(
      () =>
        document.querySelector("#party-message").textContent === "INVALID CODE",
    );
    await guest.locator("#party-input").fill(code.toLowerCase());
    await guest.locator("#party-join button[type=submit]").click();
    await host.waitForFunction(
      () => window.__arena.party.state?.members.length === 2,
    );
    console.log(
      "PASS two ordinary tabs have independent IDs and join/state sync",
    );
    assert.equal(await guest.locator("#party-start").isDisabled(), true);
    await host.locator("#party-start").click();
    await host.locator('[data-mode="2v2"]').click();
    await guest.waitForFunction(
      () =>
        window.__arena.party.state.mode === "2v2" &&
        window.__arena.party.state.members.every((m) => !m.ready),
    );
    await host.locator("#party-continue").click();
    await host.locator('.party-team-join[data-team="0"]').click();
    await guest.locator('.party-team-join[data-team="0"]').click();
    await host.waitForFunction(() =>
      window.__arena.party.state.members.every((m) => m.team === 0),
    );
    await host.locator('[data-stage="mode"]').click();
    await host.locator('[data-stage="home"]').click();
    console.log("PASS mode flow and team state synchronize");
    for (let i = 2; i < 4; i++) {
      const p = await open();
      await p.locator("#party-join-open").click();
      await p.locator("#party-input").fill(code);
      await p.locator("#party-join button[type=submit]").click();
      await host.waitForFunction(
        (n) => window.__arena.party.state?.members.length === n,
        i + 1,
      );
    }
    await host.waitForTimeout(400);
    assert.equal(await host.locator("#party-members button").count(), 4);
    const ids = await host.evaluate(() =>
      window.__arena.party.state.members.map((m) => m.id),
    );
    assert.equal(new Set(ids).size, 4);
    console.log("PASS four uniquely identified lobby cars");
    for (const [w, h] of [
      [1280, 800],
      [1920, 1080],
      [900, 600],
      [390, 844],
    ]) {
      await host.setViewportSize({ width: w, height: h });
      await host.waitForTimeout(500);
      assert.ok(
        await host
          .locator("#party-panel button:not([hidden]),#party-panel select")
          .evaluateAll((es) =>
            es
              .filter((e) => e.getClientRects().length)
              .every((e) => {
                const r = e.getBoundingClientRect();
                return (
                  r.left >= 0 &&
                  r.top >= 0 &&
                  r.right <= innerWidth &&
                  r.bottom <= innerHeight
                );
              }),
          ),
      );
      const cars = await host.evaluate(() => {
        const a = window.__arena;
        a.camera.updateMatrixWorld(true);
        return a.homeLobby.group.children.map((c) =>
          c.position.clone().project(a.camera).toArray(),
        );
      });
      assert.ok(
        cars.every(
          (p) => Math.abs(p[0]) < 0.95 && Math.abs(p[1]) < 0.95 && p[2] < 1,
        ),
        JSON.stringify(cars),
      );
      await host.screenshot({ path: `docs/lan-lobby-4-${w}.png` });
      console.log("PASS responsive four-car lobby", w, h);
    }
    await host.setViewportSize({ width: 1280, height: 800 });
    const fifth = await open();
    await fifth.locator("#party-join-open").click();
    await fifth.locator("#party-input").fill(code);
    await fifth.locator("#party-join button[type=submit]").click();
    await fifth.waitForFunction(
      () =>
        document.querySelector("#party-message").textContent === "PARTY FULL",
    );
    await fifth.close();
    console.log("PASS fifth client rejected");
    await host.locator("#garage-open").click();
    await host.locator("#customize-car").click();
    await host.locator('[data-item="vector"]').click();
    await guest.waitForFunction(
      (id) =>
        window.__arena.party.state.members.find((m) => m.id === id).preset
          .body === "vector",
      ids[0],
    );
    await host.locator("#garage-back").click();
    await host.locator("#garage-back").click();
    await host.locator("#settings-open").click();
    await pages[3].locator("#party-leave").click();
    await host.waitForFunction(
      () => window.__arena.party.state.members.length === 3,
    );
    await host.keyboard.press("Escape");
    console.log(
      "PASS garage appearance and membership update while in settings",
    );
    await pages[2].close();
    await host.waitForFunction(
      () => window.__arena.party.state.members.length === 2,
    );
    console.log("PASS closing tab removes participant");
    await host.locator("#party-start").click();
    await host.locator('[data-mode="1v1"]').click();
    await guest.waitForFunction(
      () => window.__arena.party.state.mode === "1v1",
    );
    await host.locator('[data-stage="home"]').click();
    await host.locator(`[data-player="${ids[1]}"]`).click();
    await host.locator("#party-kick").click();
    await guest.waitForFunction(
      () =>
        !window.__arena.party.state &&
        window.__arena.party.message.includes("REMOVED"),
    );
    console.log("PASS host kick and removed-player explanation");
    await host.bringToFront();
    await host.locator("#play").click();
    await host.locator("#freeplay-mode").click();
    await host.locator("#freeplay-launch").click();
    await host.waitForFunction(
      () =>
        window.__arena.match.mode === "freeplay" &&
        window.__arena.match.phase === "playing",
    );
    await host.keyboard.down("KeyW");
    await host.waitForTimeout(400);
    await host.keyboard.up("KeyW");
    assert.ok(
      await host.evaluate(
        () => window.__arena.simulation.cars[0].forwardSpeed > 0,
      ),
    );
    await host.keyboard.press("Escape");
    await host.locator("#pause-home").click();
    await host.waitForFunction(() => window.__arena.match.phase === "home");
    console.log("PASS Free Play drive and exit");
    await host.locator("#play").click();
    await host.locator("#bot-mode").click();
    await host.waitForFunction(() => window.__arena.match.phase === "playing");
    await host.keyboard.press("Escape");
    await host.locator("#pause-home").click();
    await host.waitForFunction(
      () => document.querySelector("#leave-confirm").open,
    );
    const clock = await host.evaluate(() => window.__arena.match.remaining);
    await host.waitForTimeout(300);
    assert.equal(
      await host.evaluate(() => window.__arena.match.remaining),
      clock,
    );
    await host.locator("#leave-confirm-stay").click();
    await host.waitForFunction(() => window.__arena.match.phase === "playing");
    await host.keyboard.press("Escape");
    await host.locator("#pause-home").click();
    await host.locator("#leave-confirm-yes").click();
    await host.waitForFunction(() => window.__arena.match.phase === "home");
    assert.equal(
      await host.evaluate(() => window.__arena.party.state.code),
      code,
    );
    console.log("PASS VS Bot pause/stay/leave preserves party");
    await guest.locator("#party-join-open").click();
    await guest.locator("#party-input").fill(code);
    await guest.locator("#party-join button[type=submit]").click();
    await host.waitForFunction(
      () => window.__arena.party.state.members.length === 2,
    );
    await host.locator("#party-leave").click();
    await guest.waitForFunction(
      () => window.__arena.party.state.hostId === window.__arena.party.playerId,
    );
    console.log("PASS host leave transfers leadership");
    await context.setOffline(true);
    await guest.waitForFunction(
      () => window.__arena.party.connection === "offline",
      {},
      { timeout: 15000 },
    );
    await context.setOffline(false);
    await guest.waitForFunction(
      () => window.__arena.party.connection === "connected",
    );
    console.log("PASS offline/reconnect without crash");
    assert.deepEqual(errors, []);
    console.log("PASS no browser runtime errors");
    await context.close();
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
