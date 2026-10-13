const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright"),
  assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8242);
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      args: [
        "--enable-unsafe-swiftshader",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
      ],
    });
    const errors = [];
    const open = async (name) => {
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 720 },
      });
      ctx.setDefaultTimeout(45000);
      await ctx.addInitScript((name) => {
        localStorage.setItem(
          "octane-arena-profile",
          JSON.stringify({
            profileVersion: 1,
            localPlayerId: crypto.randomUUID(),
            name,
            avatarId: "helmet",
          }),
        );
        localStorage.setItem(
          "octane-arena-settings",
          JSON.stringify({ quality: "low" }),
        );
      }, name);
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(server.url);
      await page.waitForFunction(() => window.__arena);
      return page;
    };
    const host = await open("Rumble Host"),
      guest = await open("Rumble Guest");
    const action = async (p, name, data = {}) => {
      await p.waitForFunction(() => !window.__arena.party.busy);
      const out = await p.evaluate(
        async ({ name, data }) => ({
          ok: await window.__arena.party.action(name, data),
          message: window.__arena.party.message,
        }),
        { name, data },
      );
      assert.equal(out.ok, true, out.message);
    };
    await host.locator("#party-create").click();
    await host.waitForFunction(() => window.__arena.party.state);
    const code = await host.evaluate(() => window.__arena.party.state.code);
    await guest.locator("#party-join-open").click();
    await guest.locator("#party-input").fill(code);
    await guest.locator("#party-join button[type=submit]").click();
    for (const p of [host, guest])
      await p.waitForFunction(
        () =>
          window.__arena.party.state?.members.length === 2 &&
          window.octaneArenaNetwork.diagnostics().peers[0]
            ?.bidirectionalVerified,
      );
    await action(host, "stage", { stage: "mode" });
    await action(host, "gamemode", { gameMode: "rumble" });
    await guest.waitForFunction(
      () => window.__arena.party.state?.gameMode === "rumble",
    );
    await guest.evaluate(() => {
      const original = window.__arena.graphics.prepare.bind(
        window.__arena.graphics,
      );
      window.__arena.graphics.prepare = async (...args) => {
        window.waitingForWarm = true;
        await new Promise((resolve) => (window.releaseWarm = resolve));
        return original(...args);
      };
    });
    await action(host, "launch");
    await guest.waitForFunction(() => window.waitingForWarm);
    await host.waitForFunction(() => window.__arena.network.scenePrepared);
    assert.equal(
      await host.evaluate(() => window.__arena.network.latest.tick),
      0,
      "Authority is stopped until the slow guest is ready",
    );
    const before = await host.evaluate(
      () => window.__arena.network.latest.countdown,
    );
    await host.waitForTimeout(500);
    assert.equal(
      await host.evaluate(() => window.__arena.network.latest.tick),
      0,
    );
    assert.equal(
      await host.evaluate(() => window.__arena.network.latest.countdown),
      before,
    );
    await guest.evaluate(() => window.releaseWarm());
    for (const p of [host, guest])
      await p.waitForFunction(
        () =>
          window.__arena.network.latest?.phase === "playing" &&
          window.__arena.network.latest?.rumble?.players.length === 2,
      );
    const roster = await host.evaluate(() =>
      window.__arena.network.latest.rumble.players
        .map((s) => s.playerId)
        .sort(),
    );
    assert.deepEqual(
      await guest.evaluate(() =>
        window.__arena.network.latest.rumble.players
          .map((s) => s.playerId)
          .sort(),
      ),
      roster,
    );
    for (const p of [host, guest])
      await p.waitForFunction(() =>
        window.__arena.network.latest.rumble.players.every(
          (s) => s.phase === "ready",
        ),
      );
    const items = await host.evaluate(() =>
      window.__arena.network.latest.rumble.players
        .map((s) => [s.playerId, s.item])
        .sort(),
    );
    assert.deepEqual(
      await guest.evaluate(() =>
        window.__arena.network.latest.rumble.players
          .map((s) => [s.playerId, s.item])
          .sort(),
      ),
      items,
      "Both browsers receive host-owned random rolls",
    );
    await host.keyboard.down("w");
    await host.keyboard.down("Shift");
    await host.waitForFunction(() => {
      const a = window.__arena,
        s = a.network.latest,
        c = s.cars.find((c) => c.id === a.party.playerId);
      return (
        Math.hypot(
          c.position.x - s.ball.position.x,
          c.position.y - s.ball.position.y,
          c.position.z - s.ball.position.z,
        ) < 15
      );
    });
    await host.keyboard.up("w");
    await host.keyboard.up("Shift");
    await host.keyboard.press("f");
    for (const p of [host, guest])
      await p.waitForFunction(() => {
        const a = window.__arena;
        return a.network.latest.rumble.events.some(
          (e) =>
            e.kind === "POWERUP_USED" && e.playerId === a.party.state.hostId,
        );
      });
    assert.equal(await guest.locator("#rumble-hud").isVisible(), true);
    await action(guest, "leave");
    await host.waitForFunction(
      () => window.__arena.party.state?.members.length === 1,
    );
    assert.deepEqual(errors, []);
    assert.equal(
      server.apiRequests(),
      0,
      "Static Pages launch needs no application API",
    );
    console.log(
      "PASS delayed scene readiness barrier (no host clock/physics ticks before all render resources), two isolated Chrome sessions over real PeerJS Cloud + WebRTC: party/mode/arena/IDs, host-worker 120Hz Rumble state, same random grants, real input activation replicated both ways, HUD and clean leave. Not a physical two-device/NAT test.",
    );
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
