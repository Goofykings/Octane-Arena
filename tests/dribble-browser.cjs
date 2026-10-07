const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
(async () => {
  const { startLan } = await import(
    pathToFileURL(resolve("server/dist/server/src/lan.js")).href
  );
  const { app } = await startLan(8104, ":memory:");
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
    context.setDefaultTimeout(30000);
    await context.addInitScript(() =>
      localStorage.setItem(
        "octane-arena-settings",
        JSON.stringify({ quality: "low" }),
      ),
    );
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:8104/?test");
    await page.waitForFunction(() => window.__arena);
    const launch = async () => {
      await page.locator("#play").click();
      await page.locator("#extra-mode").click();
      await page.locator("#dribble-mode").click();
      await page.waitForFunction(
        () => window.__arena.extraSession?.id === "dribble",
      );
    };
    await launch();
    await page.waitForTimeout(400);
    assert.equal(await page.locator("#dribble-level").textContent(), "1 / 20");
    assert.equal(
      await page.locator("#dribble-best").textContent(),
      "0 COMPLETED",
    );
    assert.equal(await page.locator("#dribble-next").isDisabled(), true);
    assert.equal(await page.locator(".scoreboard").isVisible(), false);
    assert.equal(await page.locator("#rings-time").count(), 0);
    assert.equal(
      await page.locator("#camera-mode").textContent(),
      "BALL CAMERA",
    );
    assert.equal(
      await page.evaluate(() => {
        const scene = window.__arena.extraSession.scene;
        const start = scene.getObjectByName("dribble-safe-start"),
          wall = scene.getObjectByName("dribble-finish-wall");
        return (
          !!start &&
          !!wall &&
          wall.children[0].material.transparent &&
          wall.children[0].material.depthWrite === false &&
          wall.children[0].material.map !== null
        );
      }),
      true,
    );
    await page.screenshot({ path: "docs/dribble-start.png" });
    await page.keyboard.press("KeyC");
    await page.waitForFunction(
      () => document.getElementById("camera-mode").textContent === "CAR CAMERA",
    );
    assert.equal(
      await page.locator("#camera-mode").textContent(),
      "CAR CAMERA",
    );
    await page.mouse.move(850, 380);
    await page.mouse.down();
    await page.mouse.move(1060, 310, { steps: 10 });
    await page.waitForFunction(
      () => Math.abs(window.__arena.mouseLook.yaw) > 0.1,
    );
    await page.mouse.up();
    await page.waitForFunction(() => !window.__arena.mouseLook.active);
    await page.keyboard.press("KeyC");
    await page.waitForFunction(
      () =>
        document.getElementById("camera-mode").textContent === "BALL CAMERA",
    );
    assert.equal(
      await page.locator("#camera-mode").textContent(),
      "BALL CAMERA",
    );
    await page.evaluate(() => {
      const a = window.__arena,
        p = a.extraSession.physics;
      window.dribbleSequence = a.extraSession.resetSequence;
      p.ball.setTranslation({ x: 0, y: -10, z: 0 }, true);
    });
    await page.waitForFunction(
      () => window.__arena.extraSession.resetSequence > window.dribbleSequence,
    );
    assert.equal(await page.locator("#dribble-level").textContent(), "1 / 20");
    assert.equal(
      await page.evaluate(
        () => window.__arena.extraSession.physics.ball.linvel().x,
      ),
      0,
    );
    await page.locator("#dribble-restart").click();
    // Finish fixtures use the real swept ball-plane crossing and normal completion
    // rule. They verify progression/UI independently of human balancing skill.
    await page.evaluate(() => {
      const p = window.__arena.extraSession.physics,
        f = p.course.finish;
      p.car.reset(f.center.x, f.center.z, -f.heading, f.center.y + 0.34);
      p.ball.setTranslation({ x: 0, y: 4, z: 2 }, true);
    });
    await page.waitForTimeout(300);
    assert.equal(await page.locator("#dribble-level").textContent(), "1 / 20");
    await page.evaluate(() => {
      const p = window.__arena.extraSession.physics,
        f = p.course.finish;
      p.car.reset(0, 8, 0, 2.34);
      p.ball.setTranslation(
        {
          x: f.center.x - Math.sin(f.heading) * 0.1,
          y: f.center.y + 3,
          z: f.center.z + Math.cos(f.heading) * 0.1,
        },
        true,
      );
      p.ball.setLinvel(
        { x: Math.sin(f.heading) * 60, y: 0, z: -Math.cos(f.heading) * 60 },
        true,
      );
    });
    await page.waitForFunction(
      () => window.__arena.extraSession.run.best === 1,
    );
    await page.waitForFunction(
      () => window.__arena.extraSession.run.level === 2,
    );
    assert.equal(
      await page.locator("#dribble-best").textContent(),
      "1 COMPLETED",
    );
    await page.keyboard.press("BracketLeft");
    await page.waitForFunction(
      () => window.__arena.extraSession.run.level === 1,
    );
    await page.keyboard.press("BracketRight");
    await page.waitForFunction(
      () => window.__arena.extraSession.run.level === 2,
    );
    await page.keyboard.press("BracketRight");
    assert.equal(
      await page.evaluate(() => window.__arena.extraSession.run.level),
      2,
    );
    await page.keyboard.press("Escape");
    await page.locator("#dribble-exit").click();
    await page.reload();
    await page.waitForFunction(() => window.__arena);
    await launch();
    assert.equal(await page.locator("#dribble-level").textContent(), "2 / 20");
    assert.equal(
      await page.locator("#dribble-best").textContent(),
      "1 COMPLETED",
    );
    await page.keyboard.press("Escape");
    await page.locator("#dribble-settings").click();
    await page.locator('[data-tab="controls"]').click();
    assert.equal(
      await page.locator('[data-action="previousLevel"]').count(),
      1,
    );
    assert.equal(await page.locator('[data-action="nextLevel"]').count(), 1);
    await page.locator("#close-settings").click();
    await page.locator("#dribble-exit").click();
    for (const [width, height] of [
      [900, 600],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await page.locator("#play").click();
      await page.locator("#extra-mode").click();
      for (const id of ["rings-mode", "dribble-mode"]) {
        await page.locator("#" + id).waitFor({ state: "visible" });
        const bounds = await page.locator("#" + id).boundingBox();
        assert.ok(
          bounds.x >= 0 &&
            bounds.x + bounds.width <= width + 1 &&
            bounds.y + bounds.height <= height,
        );
      }
      await page.locator("#extras-back").click();
      await page.locator("#modes-back").click();
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS Dribble menu/HUD, Ball Cam/manual look return, fast same-level reset, ball-only flick finish, automatic checkpoint, locked navigation, save/reload, bindable actions and responsive Extra Modes",
    );
  } finally {
    if (browser) await browser.close();
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
