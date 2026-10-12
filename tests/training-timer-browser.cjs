const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright"),
  assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8196);
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      args: ["--enable-unsafe-swiftshader"],
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    context.setDefaultTimeout(45000);
    await context.addInitScript(() =>
      localStorage.setItem(
        "octane-arena-settings",
        JSON.stringify({ quality: "low" }),
      ),
    );
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(server.url);
    await page.waitForFunction(() => window.__arena);
    await page.locator("#play").click();
    await page.locator("#extra-mode").click();
    await page.locator("#training-mode").click();
    await page.locator("#training-aerial").click();
    await page.waitForFunction(() => window.__arena.extraSession?.run.ready);
    assert.equal(await page.locator("#training-time").textContent(), "10.0");
    assert.equal(await page.locator("#countdown").textContent(), "");
    await page.keyboard.press("KeyC");
    await page.keyboard.down("Tab");
    await page.keyboard.up("Tab");
    await page.mouse.move(850, 360);
    await page.mouse.down();
    await page.mouse.move(960, 330, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    assert.equal(
      await page.evaluate(
        () =>
          window.__arena.extraSession.run.ready &&
          window.__arena.extraSession.run.elapsed === 0,
      ),
      true,
      "Camera/scoreboard controls don't start practice",
    );
    await page.keyboard.press("Escape");
    await page.locator("#training-resume").click();
    assert.equal(
      await page.evaluate(() => window.__arena.extraSession.run.ready),
      true,
      "Pause/resume don't start practice",
    );
    await page.keyboard.down("KeyW");
    await page.waitForFunction(() => !window.__arena.extraSession.run.ready);
    await page.keyboard.up("KeyW");
    await page.waitForTimeout(160);
    assert.ok(
      await page.evaluate(
        () =>
          window.__arena.extraSession.run.elapsed > 0 &&
          window.__arena.extraSession.run.timeRemaining < 10,
      ),
    );
    assert.ok(
      await page
        .locator("#training-time-fill")
        .evaluate(
          (e) => Number(e.style.transform.match(/scaleX\(([^)]+)\)/)[1]) < 1,
        ),
    );
    await page.screenshot({ path: "docs/training-ready-timer.png" });
    await page.evaluate(() => {
      const s = window.__arena.extraSession;
      s.run.elapsed = s.run.duration;
      s.run.frozen = false;
      s.physics.ball.setGravityScale(1, true);
      s.physics.ball.setTranslation({ x: 0, y: 5, z: 0 }, true);
      s.physics.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
      s.physics.ballPose.snap();
    });
    await page.waitForFunction(
      () => document.getElementById("training-time").textContent === "0.0",
    );
    await page.waitForTimeout(120);
    assert.equal(
      await page.evaluate(() => window.__arena.extraSession.run.outcome),
      null,
    );
    assert.equal(
      await page.locator("#training-time-state").textContent(),
      "ZERO TIME",
    );
    await page.evaluate(() => {
      const s = window.__arena.extraSession;
      s.physics.ball.setTranslation({ x: 0, y: 2, z: -52.1 }, true);
      s.physics.ball.setLinvel({ x: 0, y: 0, z: -20 }, true);
    });
    await page.locator("#goal-replay").waitFor({ state: "visible" });
    assert.equal(
      await page.evaluate(() => window.__arena.extraSession.run.outcome),
      "SUCCESS",
    );
    await page.locator("#replay-skip-button").click();
    await page.waitForFunction(
      () =>
        window.__arena.extraSession.run.ready &&
        window.__arena.extraSession.run.index === 1,
    );
    await page.waitForFunction(
      () => document.getElementById("training-time").textContent === "10.0",
    );
    await page.keyboard.down("ShiftLeft");
    await page.waitForFunction(() => !window.__arena.extraSession.run.ready);
    await page.keyboard.up("ShiftLeft");
    await page.evaluate(() => {
      const s = window.__arena.extraSession;
      s.run.elapsed = s.run.duration;
      s.run.frozen = false;
      s.physics.ball.setGravityScale(1, true);
      s.physics.ball.setTranslation({ x: 0, y: 0.95, z: 0 }, true);
      s.physics.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    });
    await page.waitForFunction(
      () => window.__arena.extraSession.run.outcome === "FAILED",
    );
    assert.ok(
      await page.evaluate(
        () => window.__arena.extraSession.physics.ballGround.sequence > 0,
      ),
    );
    await page.locator("#training-reset").click();
    await page.waitForFunction(() => window.__arena.extraSession.run.ready);
    assert.equal(
      await page.evaluate(() => window.__arena.extraSession.run.timeRemaining),
      10,
    );
    await page.keyboard.press("Escape");
    await page.locator("#training-exit").click();
    await page.locator("#play").click();
    await page.locator("#bot-mode").click();
    await page.locator("#bot-launch").click();
    await page.waitForFunction(() => window.__arena.match.phase === "playing");
    await page.evaluate(() => {
      const a = window.__arena;
      a.match.score = [1, 0];
      a.match.remaining = 0.001;
      a.simulation.cars[1].body.setEnabled(false);
      a.simulation.ball.setTranslation({ x: 0, y: 5, z: 0 }, true);
      a.simulation.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
      a.simulation.ballPose.snap();
    });
    await page.waitForFunction(
      () => document.getElementById("clock").textContent === "0:00",
    );
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(120);
    await page.keyboard.up("KeyW");
    assert.equal(
      await page.evaluate(() => window.__arena.match.phase),
      "playing",
    );
    await page.evaluate(() => {
      const s = window.__arena.simulation;
      s.ball.setTranslation({ x: 0, y: 2, z: -52.1 }, true);
      s.ball.setLinvel({ x: 0, y: 0, z: -20 }, true);
    });
    await page.waitForFunction(() => window.__arena.match.phase === "replay");
    assert.equal(await page.evaluate(() => window.__arena.match.score[0]), 2);
    await page.keyboard.press("Space");
    await page.waitForFunction(() => window.__arena.match.phase === "finished");
    assert.deepEqual(errors, []);
    console.log(
      "PASS production ready/input-only start, compact clock/bar, camera/menu exclusion, zero-time aerial scoring/replay/ready reset, real-ground failure, and normal 0:00 live goal/replay/regulation finish",
    );
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
