const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict"),
  { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8236);
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      args: ["--enable-unsafe-swiftshader"],
    });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
    });
    page.setDefaultTimeout(45000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem(
        "octane-arena-settings",
        JSON.stringify({ quality: "low" }),
      );
      window.pad = {
        id: "Rumble test controller",
        index: 0,
        connected: true,
        mapping: "standard",
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => ({
          value: 0,
          pressed: false,
        })),
      };
      Object.defineProperty(navigator, "getGamepads", {
        value: () => [window.pad],
      });
    });
    await page.goto(server.url);
    await page.waitForFunction(() => window.__arena);
    await page.locator("#play").click();
    await page.locator("#bot-mode").click();
    await page.locator("#bot-mode-next").click();
    assert.equal(
      await page.locator("#bot-game-mode").textContent(),
      "HEATSEEKER",
    );
    await page.locator("#bot-mode-next").click();
    assert.equal(await page.locator("#bot-game-mode").textContent(), "RUMBLE");
    for (const [width, height] of [
      [1920, 1080],
      [1366, 768],
      [1280, 720],
      [600, 720],
    ]) {
      await page.setViewportSize({ width, height });
      for (const selector of [
        "#bot-game-mode",
        "#bot-size",
        "#bot-difficulty",
        "#bot-launch",
      ]) {
        const b = await page.locator(selector).boundingBox();
        assert.ok(
          b && b.y >= 0 && b.y + b.height <= height,
          selector + " visible at " + width,
        );
      }
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.locator("#bot-launch").click();
    assert.equal(
      await page.evaluate(() => window.__arena.simulation.gameMode),
      "rumble",
    );
    await page.waitForFunction(
      () => !document.querySelector("#rumble-hud").hidden,
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.__arena.simulation.rumble.players.get(
            window.__arena.simulation.cars[0].id,
          ).cooldown,
      ),
      10,
      "Countdown freezes cooldown",
    );
    await page.waitForFunction(() => window.__arena.match.phase === "playing");
    await page.evaluate(() => {
      const a = window.__arena;
      for (const c of a.simulation.cars.slice(1)) {
        c.collider.setCollisionGroups(0);
        c.body.setEnabled(false);
      }
      a.simulation.rumble.players.get(a.simulation.cars[0].id).cooldown = 0.1;
    });
    await page.waitForFunction(
      () => document.querySelector("#rumble-hud").dataset.state === "ready",
    );
    const setup = async (item) => {
      await frames();
      await page.evaluate((item) => {
        const a = window.__arena,
          s = a.simulation,
          r = s.rumble,
          c = s.cars[0];
        r.end(c.id);
        c.reset(0, 12, 0, 10);
        s.ball.setTranslation({ x: 0, y: 10, z: 0 }, true);
        s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
        s.ballPose.snap();
        r.grant(c.id, item);
      }, item);
      await frames();
    };
    const frames = () =>
      page.evaluate(
        () =>
          new Promise((resolve) => {
            let n = 3;
            const f = () => (--n ? requestAnimationFrame(f) : resolve());
            requestAnimationFrame(f);
          }),
      );
    await setup("HAYMAKER");
    await frames();
    await page.waitForFunction(
      () => !document.querySelector("#rumble-target").hidden,
    );
    assert.equal(await page.locator(".rumble-name").textContent(), "HAYMAKER");
    await page.keyboard.down("f");
    await page.waitForFunction(() =>
      window.__arena.simulation.rumble.events.some(
        (e) => e.kind === "POWERUP_USED" && e.item === "HAYMAKER",
      ),
    );
    await frames();
    assert.equal(
      await page.evaluate(
        () =>
          window.__arena.simulation.rumble.events.filter(
            (e) => e.kind === "POWERUP_USED" && e.item === "HAYMAKER",
          ).length,
      ),
      1,
    );
    await page.keyboard.up("f");
    await frames();
    await setup("GRAPPLING_HOOK");
    await page.evaluate(
      () => (window.pad.buttons[10] = { value: 1, pressed: true }),
    );
    await frames();
    await page.evaluate(
      () => (window.pad.buttons[10] = { value: 0, pressed: false }),
    );
    await page.waitForFunction(
      () => window.__arena.rumbleEffects.slots[0].tether.visible,
    );
    assert.equal(await page.locator(".rumble-name").textContent(), "GRAPPLE");
    await frames();
    await setup("PLUNGER");
    await page.keyboard.press("f");
    await page.waitForFunction(
      () => window.__arena.rumbleEffects.slots[0].tether.visible,
    );
    assert.equal(await page.locator(".rumble-name").textContent(), "PLUNGER");
    await setup("POWER_HITTER");
    await page.keyboard.press("f");
    await page.waitForFunction(
      () => window.__arena.rumbleEffects.slots[0].aura.visible,
    );
    assert.equal(
      await page.locator("#rumble-hud").getAttribute("data-state"),
      "active",
    );
    await page.screenshot({ path: "docs/rumble-hud.png" });
    await setup("SPIKES");
    await page.keyboard.press("f");
    await page.waitForFunction(
      () => window.__arena.rumbleEffects.slots[0].spikes.visible,
    );
    await frames();
    await page.screenshot({ path: "docs/rumble-spikes.png" });
    await setup("HAYMAKER");
    await page.evaluate(() => {
      const s = window.__arena.simulation;
      s.ball.setTranslation({ x: 0, y: 10, z: -40 }, true);
      s.ballPose.snap();
    });
    await frames();
    await page.waitForFunction(
      () => document.querySelector("#rumble-target").hidden,
    );
    await page.keyboard.press("f");
    await frames();
    assert.equal(
      await page.evaluate(
        () =>
          window.__arena.simulation.rumble.players.get(
            window.__arena.simulation.cars[0].id,
          ).phase,
      ),
      "ready",
      "Out-of-range use is not consumed",
    );
    // Both bindings appear in existing keyboard/controller settings, rather than a second input path.
    await page.keyboard.press("Escape");
    await page.locator("#pause-controls").click();
    assert.ok(
      (await page.getByText("Use power-up", { exact: true }).count()) > 0,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS production Rumble mode selection/responsive setup, kickoff timer lock, random ready HUD, keyboard/controller activation, one-press use, range target, all five original effects, existing bindable controls, no browser errors",
    );
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
