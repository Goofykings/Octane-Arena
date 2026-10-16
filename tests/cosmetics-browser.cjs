const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8252);
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      args: ["--enable-unsafe-swiftshader"],
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    page.setDefaultTimeout(45000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (
        m.type() === "error" &&
        /THREE.WebGLProgram|Shader Error|GL_INVALID/.test(m.text())
      )
        errors.push(m.text());
    });
    await page.addInitScript(() =>
      localStorage.setItem(
        "octane-arena-settings",
        JSON.stringify({ quality: "low" }),
      ),
    );
    await page.goto(server.url);
    await page.waitForFunction(() => window.__arena);
    await page.locator("#garage-open").click();
    await page.locator("#customize-car").click();
    const ids = ["vector", "ion", "cargo", "slicer", "wraith"];
    for (const body of ids) {
      await page.locator('[data-category="body"]').click();
      assert.equal(
        await page.locator(".inventory-grid [data-item]").count(),
        5,
      );
      await page.locator('[data-item="' + body + '"]').click();
      assert.ok(
        await page.evaluate(
          (id) =>
            __arena.preview.car.userData.bodyId === id &&
            __arena.visuals[0].userData.bodyId === id,
          body,
        ),
      );
      await page.locator('[data-category="topper"]').click();
      assert.equal(
        await page.locator(".inventory-grid [data-item]").count(),
        11,
      );
      for (const topper of [
        "none",
        "top-hat",
        "cat-ears",
        "birthday",
        "pickle",
        "crown",
        "cone",
        "beanie",
        "halo",
        "ufo",
        "pirate",
      ]) {
        await page.locator('[data-item="' + topper + '"]').click();
        assert.ok(
          await page.evaluate(
            (id) =>
              __arena.preview.car.userData.topper.name === "topper-" + id &&
              __arena.visuals[0].userData.topper.name === "topper-" + id,
            topper,
          ),
        );
        if (body === "vector" && topper !== "none")
          await page.screenshot({
            path: ".tools/cosmetic-topper-" + topper + ".png",
          });
      }
      await page.locator('[data-item="none"]').click();
      await page.locator('[data-category="body"]').click();
      await page.screenshot({ path: ".tools/cosmetic-" + body + ".png" });
    }
    await page.locator('[data-category="boost"]').click();
    assert.equal(await page.locator(".inventory-grid [data-item]").count(), 10);
    const colors = [];
    for (const boost of [
      "standard",
      "ember",
      "ion",
      "lightning",
      "plasma",
      "thermal",
      "sparkles",
      "sacred",
      "datastream",
      "dust",
    ]) {
      await page.locator('[data-item="' + boost + '"]').click();
      await page.waitForTimeout(100);
      await page.screenshot({ path: ".tools/boost-style-" + boost + ".png" });
      colors.push(
        await page.evaluate(() => {
          const fx = __arena.preview.boostEffects;
          if (!fx.flames.visible || !fx.glow.intensity)
            throw Error("Missing boost preview");
          return fx.glow.color.getHex();
        }),
      );
    }
    assert.equal(new Set(colors).size, 10, "each boost retains its own color");
    await page.evaluate(() => __arena.graphics.apply("ultra"));
    await page.waitForTimeout(400);
    await page.screenshot({ path: ".tools/cosmetic-boost.png" });
    await page.evaluate(() => __arena.graphics.apply("low"));
    await page.locator('[data-category="topper"]').click();
    await page.locator('[data-item="ufo"]').click();
    await page.reload();
    await page.waitForFunction(() => window.__arena);
    assert.deepEqual(
      await page.evaluate(() => {
        const p = __arena.garage.current;
        return [p.body, p.topper, p.boost];
      }),
      ["wraith", "ufo", "dust"],
    );
    // Home/party lineup uses the same saved model and topper, keyed by player ID.
    await page.waitForFunction(() =>
      [...__arena.homeLobby.displays.values()].some(
        (d) => d.model.userData.bodyId === "wraith",
      ),
    );
    assert.ok(
      await page.evaluate(() =>
        [...__arena.homeLobby.displays.values()].some(
          (d) => d.model.userData.topper.name === "topper-ufo",
        ),
      ),
    );
    await page.locator("#play").click();
    await page.locator("#freeplay-mode").click();
    await page.locator("#freeplay-launch").click();
    await page.waitForFunction(
      () => __arena.match.phase === "playing" && !__arena.matchLoader.active,
    );
    for (const body of ids) {
      await page.evaluate((body) => {
        __arena.garage.current.body = body;
        __arena.garagePanel.change();
      }, body);
      assert.equal(
        await page.evaluate(() => __arena.simulation.cars[0].bodyId),
        body,
      );
      await page.keyboard.down("w");
      await page.keyboard.down("Shift");
      await page.waitForTimeout(120);
      await page.keyboard.up("Shift");
      await page.keyboard.up("w");
      assert.ok(
        await page.evaluate(
          () => __arena.visuals[0].userData.topper.name === "topper-ufo",
        ),
      );
    }
    await page.screenshot({ path: ".tools/cosmetic-gameplay.png" });
    // Exercise the actual replay renderer using a captured live goal, with the
    // newly equipped shell/topper retained throughout playback.
    await page.evaluate(() => {
      const a = __arena,
        m = a.match,
        s = a.simulation;
      m.mode = "bot";
      m.phase = "playing";
      s.ball.setEnabled(true);
      s.lastTouchId = s.cars[0].id;
      s.lastTouchTime = s.clock;
      s.ball.setTranslation({ x: 0, y: 2, z: -53.6 }, true);
      s.ball.setLinvel({ x: 0, y: 0, z: -20 }, true);
      m.tick(s, a.pads);
      for (let i = 0; i < 150 && m.recorder.pendingGoal; i++) {
        s.step(
          s.cars.map(() => ({
            throttle: 0,
            steer: 0,
            pitch: 0,
            yaw: 0,
            roll: 0,
            airRoll: 0,
            boost: false,
            jump: false,
            slide: false,
          })),
        );
        m.tick(s, a.pads);
      }
      if (!m.replay) throw Error("Expected captured replay");
      m.phase = "replay";
    });
    await page.waitForTimeout(200);
    assert.ok(
      await page.evaluate(
        () =>
          __arena.visuals[0].userData.bodyId === "wraith" &&
          __arena.visuals[0].userData.topper.name === "topper-ufo",
      ),
    );
    await page.screenshot({ path: ".tools/cosmetic-replay.png" });
    assert.deepEqual(errors, []);
    console.log(
      "PASS real garage selection of five bodies/55 toppers/ten continuous distinct boosts, saved reload, home lineup and all five in gameplay; no browser errors",
    );
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
