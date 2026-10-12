const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright"),
  assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8202);
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
    await page.goto(server.url);
    await page.waitForFunction(() => window.__arena);
    for (const mode of ["home", "garage"]) {
      if (mode === "garage") {
        await page.locator("#garage-open").click();
        await page.locator("#customize-car").click();
      }
      const before = await page.evaluate((mode) => {
        const a = window.__arena;
        return {
          q: (mode === "home"
            ? a.homeLobby.group.children[0]
            : a.preview.car
          ).quaternion.toArray(),
          body: { ...a.simulation.cars[0].body.translation() },
        };
      }, mode);
      await page.mouse.move(850, 370);
      await page.mouse.down();
      await page.mouse.move(1070, 320, { steps: 12 });
      await page.waitForFunction(
        () => Math.abs(window.__arena.mouseLook.yaw) > 0.1,
      );
      assert.equal(
        await page.evaluate(() => window.__arena.mouseLook.behavior),
        "orbit",
      );
      assert.deepEqual(
        await page.evaluate((mode) => {
          const a = window.__arena;
          return {
            q: (mode === "home"
              ? a.homeLobby.group.children[0]
              : a.preview.car
            ).quaternion.toArray(),
            body: { ...a.simulation.cars[0].body.translation() },
          };
        }, mode),
        before,
        "Display drag changes view, not car pose",
      );
      await page.mouse.up();
      const release = await page.evaluate(() => ({
        v: Math.abs(window.__arena.mouseLook.yawVelocity),
        yaw: window.__arena.mouseLook.targetYaw,
      }));
      await page.waitForTimeout(200);
      const coast = await page.evaluate(() => ({
        v: Math.abs(window.__arena.mouseLook.yawVelocity),
        yaw: window.__arena.mouseLook.targetYaw,
      }));
      assert.ok(
        coast.v < release.v && Math.abs(coast.yaw - release.yaw) > 0.01,
        "Display orbit keeps momentum and friction",
      );
      await page.waitForFunction(() => !window.__arena.mouseLook.moving);
      const yaw = await page.evaluate(() => window.__arena.mouseLook.yaw);
      assert.ok(Math.abs(yaw) > 0.1);
      await page.waitForTimeout(200);
      assert.ok(
        Math.abs(
          (await page.evaluate(() => window.__arena.mouseLook.yaw)) - yaw,
        ) < 1e-5,
        "Settled display angle remains held",
      );
      if (mode === "garage") {
        await page.locator("#garage-back").click();
        await page.locator("#garage-back").click();
      }
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS production Home/Garage display orbit, momentum/friction, retained settled angle, unmodified car poses and menu navigation",
    );
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
