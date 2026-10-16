const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8262);
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
    page.on("console", (m) => {
      if (
        m.type() === "error" &&
        /Shader Error|THREE.WebGLProgram|GL_INVALID/.test(m.text())
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
    await page.locator('[data-category="boost"]').click();
    for (const id of [
      "ember",
      "ion",
      "lightning",
      "plasma",
      "sparkles",
      "sacred",
      "datastream",
      "dust",
    ]) {
      await page.locator('[data-item="' + id + '"]').click();
      await page.waitForFunction(
        () => __arena.preview.boostEffects.flames.activeParticles,
      );
      const early = await page.evaluate(() => {
        const p = __arena.preview.boostEffects.flames;
        return p.particleLayers.reduce(
          (n, l) =>
            n + Array.from(l.born).filter((t) => Number.isFinite(t)).length,
          0,
        );
      });
      await page.waitForTimeout(650);
      const full = await page.evaluate(() => {
        const p = __arena.preview.boostEffects.flames;
        return p.particleLayers.reduce(
          (n, l) =>
            n + Array.from(l.born).filter((t) => Number.isFinite(t)).length,
          0,
        );
      });
      assert.ok(full >= early);
      assert.ok(
        await page.evaluate(() => __arena.preview.boostEffects.flames.visible),
      );
      await page.screenshot({ path: ".tools/boost-emission-" + id + ".png" });
    }
    await page.locator('[data-item="plasma"]').click();
    for (const mode of ["freeplay", "bot"]) {
      await page.reload();
      await page.waitForFunction(() => window.__arena);
      await page.locator("#play").click();
      await page.locator("#" + mode + "-mode").click();
      await page.locator("#" + mode + "-launch").click();
      await page.waitForFunction(
        () => __arena.match.phase === "playing" && !__arena.matchLoader.active,
      );
      await page.keyboard.down("w");
      await page.keyboard.down("Shift");
      await page.waitForFunction(
        () =>
          __arena.simulation.cars[0].boosting &&
          __arena.vehicleEffects[0].flames.visible,
      );
      await page.waitForTimeout(700);
      await page.keyboard.up("Shift");
      await page.keyboard.up("w");
      await page.waitForFunction(() => !__arena.simulation.cars[0].boosting);
      assert.ok(
        await page.evaluate(
          () => __arena.vehicleEffects[0].flames.activeParticles,
        ),
        "release tail in " + mode,
      );
      const released = await page.evaluate(() => __arena.simulation.clock);
      await page.waitForTimeout(850);
      assert.equal(
        await page.evaluate(() => __arena.vehicleEffects[0].flames.visible),
        false,
      );
      await page.screenshot({ path: ".tools/boost-emission-" + mode + ".png" });
      if (mode === "bot") {
        await page.evaluate(() => {
          const s = __arena.simulation;
          s.lastTouchId = s.cars[0].id;
          s.lastTouchTime = s.clock;
          s.ball.setTranslation({ x: 0, y: 2, z: -53.6 }, true);
          s.ball.setLinvel({ x: 0, y: 0, z: -20 }, true);
        });
        await page.waitForFunction(
          () => __arena.match.phase === "replay" && __arena.replayView.active,
        );
        const result = await page.evaluate((released) => {
          const v = __arena.replayView,
            clip = __arena.match.replay.clip;
          v.stop();
          let hasBoost = false,
            hasTail = false;
          for (
            let t = clip.start;
            t < Math.min(clip.goal.time, released + 0.7);
            t += 1 / 60
          ) {
            v.render(clip, t, 1, 1 / 60);
            const on = v.proxies[0].car.boosting,
              p = v.effects.vehicles[0].flames;
            if (on && p.visible) hasBoost = true;
            if (!on && t > released && t < released + 0.3 && p.activeParticles)
              hasTail = true;
          }
          return {
            hasBoost,
            hasTail,
            expired: !v.effects.vehicles[0].flames.visible,
          };
        }, released);
        assert.deepEqual(
          result,
          { hasBoost: true, hasTail: true, expired: true },
          "actual recorded replay emits and drains",
        );
      }
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS eight Garage particle previews, actual Free Play and VS Bot boost/release, recorded replay emission and fade, no browser/shader errors",
    );
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
