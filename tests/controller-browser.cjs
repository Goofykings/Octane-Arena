const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8225);
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
        localStorage.getItem("octane-arena-settings") ||
          JSON.stringify({ quality: "low" }),
      );
      window.__pad = {
        id: "Xbox Wireless Controller",
        index: 0,
        connected: true,
        mapping: "standard",
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => ({
          value: 0,
          pressed: false,
        })),
      };
      window.__pads = [window.__pad];
      Object.defineProperty(navigator, "getGamepads", {
        configurable: true,
        value: () => window.__pads,
      });
    });
    await page.goto(server.url);
    await page.waitForFunction(() => window.__arena);
    const button = async (index, value) => {
      await page.evaluate(
        ([i, v]) => {
          window.__pad.buttons[i] = { value: v, pressed: v > 0.5 };
        },
        [index, value],
      );
      await page.waitForTimeout(120);
    };
    const axis = async (index, value) => {
      await page.evaluate(
        ([i, v]) => (window.__pad.axes[i] = v),
        [index, value],
      );
      await page.waitForTimeout(120);
    };
    await page.locator("#settings-open").click();
    await page.locator("#tab-controls").click();
    await page.waitForFunction(() =>
      document.getElementById("controller-status").textContent.includes("Xbox"),
    );
    assert.equal(
      await page.locator("[data-action]").count(),
      await page.locator("[data-controller]").count(),
    );
    // Opening capture with A already held cannot bind until neutral/new press.
    await button(0, 1);
    await page.locator('[data-controller="jump"]').click();
    await page.waitForTimeout(250);
    assert.ok(await page.locator("#binding-capture").isVisible());
    await page.keyboard.press("KeyK");
    assert.ok(
      await page.locator("#binding-capture").isVisible(),
      "Keyboard cannot complete controller capture",
    );
    await button(0, 0);
    await axis(0, 0.1);
    assert.ok(await page.locator("#binding-capture").isVisible());
    await button(0, 1);
    await page.waitForFunction(
      () => document.getElementById("binding-capture").hidden,
    );
    await button(0, 0);
    await axis(0, 0);
    assert.match(
      await page.locator('[data-controller="jump"]').textContent(),
      /A \/ Cross/,
    );
    await page.locator('[data-controller="cameraLeft"]').click();
    await page.waitForTimeout(120);
    await axis(3, -0.4);
    assert.ok(await page.locator("#binding-capture").isVisible());
    await axis(3, -0.85);
    await page.waitForFunction(
      () => document.getElementById("binding-capture").hidden,
    );
    await axis(3, 0);
    assert.match(
      await page.locator('[data-controller="cameraLeft"]').textContent(),
      /Right Stick Up/,
    );
    await page.locator('[data-controller="boost"]').click();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#binding-capture").isVisible(), false);
    await page.locator('[data-action="jump"]').click();
    await page.keyboard.press("KeyJ");
    assert.equal(await page.locator('[data-action="jump"]').textContent(), "J");
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("octane-arena-settings")),
    );
    assert.equal(stored.bindings.jump, "KeyJ");
    assert.deepEqual(stored.controller.bindings.cameraLeft, {
      type: "axis",
      axis: 3,
      direction: -1,
      threshold: 0.5,
      analog: true,
    });
    await page.reload();
    await page.waitForFunction(() => window.__arena);
    await page.locator("#settings-open").click();
    await page.locator("#tab-controls").click();
    assert.equal(await page.locator('[data-action="jump"]').textContent(), "J");
    assert.match(
      await page.locator('[data-controller="cameraLeft"]').textContent(),
      /Right Stick Up/,
    );
    await page.screenshot({ path: "docs/controller-bindings.png" });
    console.log(
      "PASS controller settings capture, neutral/drift checks and reload persistence",
    );
    await page.locator("#reset-controller").click();
    assert.equal(
      await page.locator('[data-action="jump"]').textContent(),
      "J",
      "Reset controller preserves keyboard",
    );
    await page.locator("#reset-bindings").click();
    assert.equal(
      await page.locator('[data-action="jump"]').textContent(),
      "Space",
    );
    await page.locator("#close-settings").click();
    assert.equal(
      await page.evaluate(() => window.__arena.input.sample().throttle),
      0,
    );
    await page.locator("#play").focus();
    await button(0, 1);
    await page.waitForFunction(
      () => document.getElementById("app").dataset.screen === "modes",
    );
    await button(0, 0);
    await button(1, 1);
    await page.waitForFunction(
      () => document.getElementById("app").dataset.screen === "home",
    );
    await button(1, 0);
    await page.locator("#play").focus();
    await button(13, 1);
    await button(13, 0);
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "garage-open",
      "D-pad moves menu focus",
    );
    await page.locator("#play").click();
    await page.locator("#freeplay-mode").click();
    await page.locator("#freeplay-launch").click();
    await page.waitForFunction(() => window.__arena.match.phase === "playing");
    await button(7, 0.42);
    let sample = await page.evaluate(() => window.__arena.input.sample());
    assert.ok(Math.abs(sample.throttle - 0.42) < 1e-6);
    assert.equal(sample.pitch, 0);
    await axis(0, 0.6);
    sample = await page.evaluate(() => window.__arena.input.sample());
    assert.ok(sample.steer > 0.3 && sample.steer < 0.8);
    await page.keyboard.down("KeyA");
    assert.equal(
      await page.evaluate(() => window.__arena.input.sample().steer),
      -1,
    );
    await page.keyboard.up("KeyA");
    await button(7, 0);
    await axis(0, 0);
    await button(0, 1);
    await page.waitForFunction(
      () => window.__arena.simulation.cars[0].body.translation().y > 0.7,
    );
    await button(0, 0);
    await axis(2, 0.75);
    await page.waitForFunction(() => window.__arena.mouseLook.yaw > 0.05);
    await axis(2, 0);
    await page.waitForFunction(
      () => Math.abs(window.__arena.mouseLook.yaw) < 0.005,
    );
    await button(3, 1);
    const ballMode = await page.evaluate(
      () => window.__arena.cameraControl.ballMode,
    );
    await page.waitForTimeout(250);
    assert.equal(
      await page.evaluate(() => window.__arena.cameraControl.ballMode),
      ballMode,
      "Held Ball Cam toggles once",
    );
    await button(3, 0);
    await button(9, 1);
    await page.waitForFunction(() => window.__arena.match.phase === "paused");
    await button(9, 0);
    await button(7, 1);
    assert.equal(
      await page.evaluate(() => window.__arena.input.sample().throttle),
      0,
      "Paused menus never drive car",
    );
    await button(7, 0);
    await button(1, 1);
    await page.waitForFunction(() => window.__arena.match.phase === "playing");
    await button(1, 0);
    await page.evaluate(() => {
      const event = new Event("gamepaddisconnected");
      Object.defineProperty(event, "gamepad", { value: window.__pad });
      window.__pads = [];
      window.dispatchEvent(event);
    });
    await page.keyboard.down("KeyW");
    assert.equal(
      await page.evaluate(() => window.__arena.input.sample().throttle),
      1,
    );
    await page.keyboard.up("KeyW");
    await page.evaluate(() => {
      window.__pad.id = "DualSense Wireless Controller";
      window.__pads = [window.__pad];
      const event = new Event("gamepadconnected");
      Object.defineProperty(event, "gamepad", { value: window.__pad });
      window.dispatchEvent(event);
    });
    await button(7, 0.6);
    assert.ok(
      Math.abs(
        (await page.evaluate(() => window.__arena.input.sample().throttle)) -
          0.6,
      ) < 1e-6,
    );
    await button(7, 0);
    assert.deepEqual(errors, []);
    console.log(
      "PASS production simulated Xbox/PlayStation connection, settings columns/button/axis binds, neutral/drift/keyboard capture isolation, persistence/resets, A/B/D-pad menus, analog gameplay/jump/camera/keyboard coexistence and disconnect/reconnect",
    );
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
