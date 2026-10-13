const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright"),
  assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8243);
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
        id: "Camera test gamepad",
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
    await page.locator("#bot-mode-next").click();
    await page.locator("#bot-launch").click();
    await page.waitForFunction(() => window.__arena.matchLoader.active);
    assert.equal(
      await page.evaluate(() => window.__arena.match.phase),
      "home",
      "No playable match while preparing",
    );
    assert.equal(await page.locator("#match-loading").isVisible(), true);
    await page.waitForFunction(() => window.__arena.match.phase === "playing");
    assert.ok(await page.evaluate(() => window.__arena.match.recorder.buffer));
    assert.ok(await page.evaluate(() => window.__arena.simulation.rumble));
    assert.ok(
      await page.evaluate(() =>
        window.__arena.matchLoader.timings.some(
          (t) => t.name === "Materials and shaders",
        ),
      ),
    );
    await page.evaluate(() => {
      const a = window.__arena;
      a.match.phase = "countdown";
      a.match.countdown = 1000;
      a.simulation.cars[0].reset(0, 0, 0);
      a.simulation.cars.slice(1).forEach((c) => c.body.setEnabled(false));
      a.simulation.ball.setTranslation({ x: 8, y: 3, z: 20 }, true);
      a.simulation.ballPose.snap();
    });
    await page.evaluate(() => (window.pad.axes[2] = 0.08));
    await page.waitForTimeout(150);
    assert.equal(
      await page.evaluate(() => window.__arena.mouseLook.targetYaw),
      0,
      "Drift remains inside radial deadzone",
    );
    await page.evaluate(() => (window.pad.axes[2] = 0.5));
    await page.waitForFunction(() => window.__arena.mouseLook.targetYaw > 0.5);
    const half = await page.evaluate(() => ({
      target: window.__arena.mouseLook.targetYaw,
      value: window.__arena.input.controller.values.cameraRight,
    }));
    assert.ok(Math.abs(half.target - half.value * Math.PI * 0.8) < 1e-7);
    await page.evaluate(() => (window.pad.axes[2] = 1));
    await page.waitForFunction(
      () => window.__arena.mouseLook.yaw > Math.PI * 0.8 * 0.95,
    );
    assert.ok(
      Math.abs(
        (await page.evaluate(() => window.__arena.mouseLook.targetYaw)) -
          Math.PI * 0.8,
      ) < 1e-7,
    );
    await page.keyboard.press("c");
    await page.waitForFunction(
      () => window.__arena.cameraControl.transitioning,
    );
    await page.evaluate(() => (window.pad.axes[2] = 0));
    await page.waitForFunction(() => !window.__arena.mouseLook.active);
    await page.waitForFunction(
      () => !window.__arena.cameraControl.transitioning,
    );
    await page.evaluate(() => (window.pad.axes[3] = -0.5));
    await page.waitForFunction(() => window.__arena.mouseLook.pitch < -0.2);
    assert.ok(
      await page.evaluate(() => window.__arena.mouseLook.targetPitch < 0),
    );
    await page.evaluate(() => (window.pad.axes[3] = 0));
    await page.waitForFunction(() => !window.__arena.mouseLook.active);
    assert.deepEqual(errors, []);
    console.log(
      "PASS real production loading/ready UI, preallocated replay/Rumble resources, mocked Gamepad radial drift rejection and proportional half/full targets, quick strong orbit, vertical control, Car/Ball switch while free-looking and smooth centered return",
    );
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
