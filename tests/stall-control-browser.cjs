const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8222);
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
    await page.locator("#play").click();
    await page.locator("#freeplay-mode").click();
    await page.locator("#freeplay-launch").click();
    await page.waitForFunction(() => window.__arena.match.phase === "playing");
    await page.evaluate(() => {
      const s = window.__arena.simulation,
        c = s.cars[0];
      s.world.gravity = { x: 0, y: 0, z: 0 };
      c.reset(0, 0, 0, 8);
      c.jump.used = true;
      c.jump.second = true;
      c.jump.age = 10;
      s.ball.setTranslation({ x: 0, y: 6.94, z: 0 }, true);
      s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
      c.pose.snap();
      s.ballPose.snap();
    });
    await page.waitForFunction(
      () => window.__arena.simulation.cars[0].flipResetSequence === 1,
    );
    await page.evaluate(() => {
      const s = window.__arena.simulation;
      s.ball.setTranslation({ x: 25, y: 20, z: 0 }, true);
      s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
      s.cars[0].body.setLinvel({ x: 8, y: -3, z: 2 }, true);
    });
    await page.waitForTimeout(1200);
    const binds = await page.evaluate(() => window.__arena.input.bindings);
    const before = await page.evaluate(() => ({
      ...window.__arena.simulation.cars[0].body.rotation(),
    }));
    // Deliver the clean chord in one browser task; three separate automation
    // round trips can pre-spin the car before jump on a software-rendered frame.
    await page.evaluate(
      (codes) => {
        for (const code of codes)
          document.body.dispatchEvent(
            new KeyboardEvent("keydown", {
              code,
              bubbles: true,
              cancelable: true,
            }),
          );
      },
      [binds.left, binds.rollRight, binds.jump],
    );
    await page.waitForFunction(
      () => window.__arena.simulation.cars[0].jump.stall,
    );
    await page.waitForTimeout(700);
    const state = await page.evaluate(() => {
      const c = window.__arena.simulation.cars[0];
      return {
        available: c.jump.available,
        flipLeft: c.jump.flipLeft,
        locked: c.pitchLocked,
        velocity: { ...c.body.linvel() },
        rotation: { ...c.body.rotation() },
      };
    });
    assert.equal(state.available, false);
    assert.equal(state.flipLeft, 0);
    assert.equal(state.locked, false);
    const dot = Math.abs(
      Object.keys(before).reduce(
        (s, k) => s + before[k] * state.rotation[k],
        0,
      ),
    );
    assert.ok(
      2 * Math.acos(Math.min(1, dot)) < 0.25,
      "held keyboard chord produces little rotation",
    );
    assert.ok(
      Math.abs(state.velocity.x - 8) < 0.01 &&
        Math.abs(state.velocity.z - 2) < 0.01,
    );
    assert.ok(state.velocity.y > -1);
    await page.evaluate(
      (codes) => {
        for (const code of codes)
          document.body.dispatchEvent(
            new KeyboardEvent("keyup", { code, bubbles: true }),
          );
      },
      [binds.jump, binds.rollRight, binds.left],
    );
    await page.keyboard.down(binds.pitchBack);
    await page.waitForFunction(() => {
      const c = window.__arena.simulation.cars[0];
      return (
        !c.pitchLocked &&
        Math.abs(c.pitchInput) > 0.9 &&
        Math.abs(c.body.angvel().x) > 0.1
      );
    });
    await page.keyboard.up(binds.pitchBack);
    assert.deepEqual(errors, []);
    console.log(
      "PASS production real underside reset, airborne wait, held keyboard stall with little rotation/retained momentum, consumed dodge and immediate pitch control",
    );
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
