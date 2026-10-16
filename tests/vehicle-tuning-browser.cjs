const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright"),
  assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8248);
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
    await page.addInitScript(() =>
      localStorage.setItem(
        "octane-arena-settings",
        JSON.stringify({ quality: "low" }),
      ),
    );
    await page.goto(server.url);
    await page.waitForFunction(() => window.__arena);
    const version = await page.locator("#game-version").innerText();
    assert.equal(version, "V0.1.9");
    await page.locator("#game-version").click();
    assert.equal(await page.locator("#version-updates").isVisible(), true);
    assert.equal(await page.locator(".updates-version").innerText(), version);
    const notes = await page.locator("#version-updates ul").innerText();
    assert.match(notes, /New Car Models/);
    assert.doesNotMatch(notes, /multiplayer/i);
    await page.locator(".updates-back").click();
    assert.equal(await page.locator("#version-updates").isVisible(), false);
    await page.locator("#play").click();
    await page.locator("#freeplay-mode").click();
    await page.locator("#freeplay-launch").click();
    await page.waitForFunction(
      () => __arena.match.phase === "playing" && !__arena.matchLoader.active,
    );
    await page.evaluate(() => {
      const s = __arena.simulation,
        step = s.step.bind(s);
      window.recoveryStarts = 0;
      let wasRecovering = false;
      s.step = (...args) => {
        step(...args);
        const active = s.cars[0].recovering;
        if (active && !wasRecovering) recoveryStarts++;
        wasRecovering = active;
      };
    });
    await page.keyboard.down("w");
    await page.evaluate(() => {
      const c = __arena.simulation.cars[0];
      // Start on the roof: W also binds aerial pitch, so a long falling
      // fixture would rotate before reaching the floor and miss roof support.
      c.setBody("ion");
      c.reset(0, 15, 0, 0.228);
      c.body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true);
    });
    await page.waitForFunction(
      () => recoveryStarts === 1 && __arena.simulation.cars[0].recovering,
    );
    await page.waitForFunction(
      () =>
        __arena.simulation.cars[0].up.y > 0.99 &&
        __arena.simulation.cars[0].contacts >= 3,
    );
    await page.waitForTimeout(600);
    assert.ok(
      await page.evaluate(
        () =>
          __arena.simulation.cars[0].up.y > 0.99 &&
          !__arena.simulation.cars[0].recovering,
      ),
      "One held press stays recovered without retriggering",
    );
    await page.keyboard.up("w");
    await page.evaluate(() => {
      const c = __arena.simulation.cars[0];
      c.reset(0, 15, 0, 0.44);
      c.body.setRotation(
        { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 },
        true,
      );
      window.partialRollInputs = 0;
      const s = __arena.simulation,
        step = s.step.bind(s);
      s.step = (...args) => {
        step(...args);
        const input = args[0],
          local = Array.isArray(input) ? input[0] : input.get(c.id);
        if (local?.roll && !c.stableContact && c.aerialControl > 0)
          partialRollInputs++;
      };
    });
    await page.keyboard.down("e");
    await page.waitForFunction(() => partialRollInputs >= 3);
    await page.keyboard.up("e");
    assert.deepEqual(errors, []);
    console.log(
      "PASS production version number/clickable notes, removed Multiplayer text, real Free Play preheld keyboard throttle starts roof recovery immediately, stable upright recovery and wheel-edge air-roll",
    );
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
