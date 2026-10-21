const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { staticGame } = require("./static-game.cjs");
const assert = require("node:assert/strict");
(async () => {
  const server = await staticGame(8326);
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      args: ["--enable-unsafe-swiftshader"],
    });
    const page = await browser.newPage({
      viewport: { width: 1366, height: 768 },
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
    await page.locator("#play").click();
    await page.locator("#freeplay-mode").click();
    await page.locator("#freeplay-launch").click();
    await page.waitForFunction(
      () => __arena.match.phase === "playing" && !__arena.matchLoader.active,
    );
    assert.equal(await page.locator("#debug").isVisible(), false);
    await page.evaluate(() => {
      const s = __arena.simulation,
        c = s.cars[0];
      window.physicsStep = s.step.bind(s);
      s.step = () => {};
      s.ball.setEnabled(false);
      s.ballCollider.setCollisionGroups(0);
      s.cars.slice(1).forEach((c) => {
        c.body.setEnabled(false);
        c.collider.setCollisionGroups(0);
      });
      c.setBody("ion");
      c.reset(0, 15, 0, 2);
      c.body.setRotation(
        { x: 0, y: 0, z: Math.sin(0.065), w: Math.cos(0.065) },
        true,
      );
      c.body.setLinvel({ x: 2, y: -3, z: -5 }, true);
      const n = {
        throttle: 0,
        steer: 0,
        pitch: 0,
        yaw: 0,
        roll: 0,
        jump: false,
        boost: false,
        slide: false,
        dodgeX: 0,
        dodgeY: 0,
      };
      window.testInput = n;
      window.assistTicks = 0;
      for (let i = 0; i < 300; i++) {
        physicsStep([n, n]);
        if (c.landing.rate > 0) assistTicks++;
      }
      c.pose.snap();
    });
    assert.ok(
      await page.evaluate(
        () => assistTicks > 0 && __arena.simulation.cars[0].up.y > 0.995,
      ),
    );
    await page.keyboard.press("F3");
    await page.waitForFunction(() =>
      document.getElementById("debug").textContent.includes("CONTACT GROUNDED"),
    );
    const text = await page.locator("#debug").innerText();
    assert.match(text, /FL 1 FR 1 RL 1 RR 1/);
    assert.match(text, /FLOOR/);
    assert.match(text, /Loaded wheel support 4\/4/);
    assert.match(text, /Landing assist OFF/);
    assert.match(text, /COM Y -0.007/);
    await page.screenshot({ path: ".tools/landing-floor-debug.png" });
    await page.evaluate(() => {
      const c = __arena.simulation.cars[0];
      c.reset(0, 15, 0, 12);
      for (let i = 0; i < 12; i++)
        physicsStep([{ ...testInput, roll: 1 }, testInput]);
      c.pose.snap();
    });
    await page.waitForFunction(() =>
      document.getElementById("debug").textContent.includes("CONTACT AIRBORNE"),
    );
    assert.match(
      await page.locator("#debug").innerText(),
      /Landing assist OFF/,
    );
    await page.keyboard.press("F3");
    await page.waitForFunction(() => document.getElementById("debug").hidden);
    assert.deepEqual(errors, []);
    console.log(
      "PASS production Free Play launch, real tilted drop/assist/settling, F3 disabled by default, live GROUNDED/AIRBORNE wheel/surface/COM diagnostics, no airborne assist, clean browser runtime",
    );
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
