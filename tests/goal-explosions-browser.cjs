const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8255);
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
    await page.addInitScript(() => {
      localStorage.setItem(
        "octane-arena-settings",
        JSON.stringify({ quality: "low" }),
      );
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem(
          "octane-arena-garage",
          JSON.stringify({
            presets: [
              {
                id: "legacy",
                name: "Legacy",
                body: "boxy",
                blue: "#36cedd",
                orange: "#f89a49",
                wheels: "glow",
                boost: "ember",
                topper: "ufo",
                decal: "circuit",
              },
            ],
            index: 0,
          }),
        );
        sessionStorage.setItem("seeded", "1");
      }
    });
    await page.goto(server.url);
    await page.waitForFunction(() => window.__arena);
    assert.equal(
      await page.evaluate(() => "decal" in __arena.garage.current),
      false,
    );
    assert.equal(
      await page.evaluate(() => __arena.garage.current.explosion),
      "pulse",
    );
    await page.locator("#garage-open").click();
    await page.locator("#customize-car").click();
    assert.equal(await page.locator('[data-category="decal"]').count(), 0);
    assert.equal(await page.locator("[data-category]").count(), 6);
    await page.locator('[data-category="explosion"]').click();
    assert.equal(await page.locator(".inventory-grid [data-item]").count(), 10);
    // First demo starts naturally from the category click, without any manual loop.
    await page.waitForFunction(() => __arena.preview.goalExplosion.active);
    for (const id of [
      "pulse",
      "inferno",
      "electric",
      "confetti",
      "crystal",
      "bubbles",
      "digital",
      "debris",
      "blue-wash",
      "violet-wash",
    ]) {
      await page.locator('[data-item="' + id + '"]').click();
      await page.evaluate(() => {
        __arena.preview.previewAge = 1.4;
      });
      await page.waitForFunction(() => __arena.preview.goalExplosion.active);
      assert.equal(
        await page.evaluate(() => __arena.preview.goalExplosion.selectedId),
        id,
      );
      await page.evaluate(() => {
        const e = __arena.preview.goalExplosion;
        e.age = 0.65;
        e.update(0);
      });
      await page.screenshot({ path: ".tools/explosion-" + id + ".png" });
      assert.equal(
        await page.evaluate(
          () => __arena.preview.goalExplosion.washStrength > 0,
        ),
        id.endsWith("wash"),
      );
      // Finish the effect through the real preview updater and ensure it resets.
      await page.evaluate(() => {
        const p = __arena.preview;
        p.goalExplosion.update(10);
        p.update(innerWidth, innerHeight, 0, "explosion");
      });
      assert.equal(await page.evaluate(() => __arena.preview.previewAge), -1);
      assert.equal(
        await page.evaluate(() => __arena.preview.goalBall.visible),
        true,
      );
      await page.waitForTimeout(80);
      assert.equal(
        await page.evaluate(() => __arena.preview.goalExplosion.active),
        false,
        "preview must not loop",
      );
    }
    await page.reload();
    await page.waitForFunction(() => window.__arena);
    assert.equal(
      await page.evaluate(() => __arena.garage.current.explosion),
      "violet-wash",
    );
    assert.equal(
      await page.evaluate(
        () =>
          "decal" in
          JSON.parse(localStorage.getItem("octane-arena-garage")).presets[0],
      ),
      false,
    );
    await page.locator("#play").click();
    await page.locator("#bot-mode").click();
    await page.locator("#bot-launch").click();
    await page.waitForFunction(
      () => __arena.match.phase === "playing" && !__arena.matchLoader.active,
    );
    const colors = await page.evaluate(() => {
      const out = [];
      __arena.arena.group.traverse((o) => {
        if (o.material)
          for (const m of Array.isArray(o.material) ? o.material : [o.material])
            if (m.color) out.push([m.uuid, m.color.getHex()]);
      });
      return out;
    });
    await page.evaluate(() => {
      const s = __arena.simulation;
      s.lastTouchId = s.cars[0].id;
      s.lastTouchTime = s.clock;
      s.ball.setTranslation({ x: 0, y: 2, z: -53.6 }, true);
      s.ball.setLinvel({ x: 0, y: 0, z: -20 }, true);
    });
    await page.waitForFunction(
      () => __arena.match.phase === "goal" && __arena.explosion.active,
    );
    assert.equal(
      await page.evaluate(() => __arena.explosion.selectedId),
      "violet-wash",
    );
    await page.waitForFunction(() => __arena.explosion.washStrength > 0.94);
    await page.screenshot({ path: ".tools/explosion-live-wash.png" });
    const after = await page.evaluate(() => {
      const out = [];
      __arena.arena.group.traverse((o) => {
        if (o.material)
          for (const m of Array.isArray(o.material) ? o.material : [o.material])
            if (m.color) out.push([m.uuid, m.color.getHex()]);
      });
      return out;
    });
    assert.deepEqual(after, colors);
    await page.waitForFunction(() => __arena.match.phase === "replay");
    assert.equal(
      await page.evaluate(() => __arena.match.replay.clip.goal.explosion),
      "violet-wash",
    );
    await page.evaluate(() => {
      __arena.match.replay.clock.time =
        __arena.match.replay.clip.goal.time - 0.05;
    });
    await page.waitForFunction(
      () =>
        __arena.explosion.active &&
        __arena.explosion.selectedId === "violet-wash",
    );
    await page.evaluate(() => {
      __arena.match.skipReplay(
        __arena.simulation.cars[0].id,
        __arena.match.replay.clip.goal.id,
        __arena.simulation,
      );
    });
    await page.waitForFunction(() => __arena.match.phase === "countdown");
    assert.equal(await page.evaluate(() => __arena.explosion.washStrength), 0);
    assert.deepEqual(errors, []);
    console.log(
      "PASS removed decal tab and legacy migration; ten selected one-shot previews/reset; preserved presets; actual selected scorer effect, full-map wash without material mutation, matching replay and clean kickoff cleanup; no shader/browser errors",
    );
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
