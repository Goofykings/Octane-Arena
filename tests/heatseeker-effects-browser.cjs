const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
(async () => {
  const { startLan } = await import(
    pathToFileURL(resolve("server/dist/server/src/lan.js")).href
  );
  const { app } = await startLan(8111, ":memory:");
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      args: ["--enable-unsafe-swiftshader"],
    });
    const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
      }),
      page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error" && /shader|WebGL/i.test(m.text()))
        errors.push(m.text());
    });
    await page.goto("http://127.0.0.1:8111/?test");
    await page.waitForFunction(() => window.__arena);
    await page.locator("#play").click();
    await page.locator("#freeplay-mode").click();
    await page.locator("#freeplay-launch").click();
    await page.waitForFunction(() => window.__arena.match.phase === "playing");
    // Render-only curved-path fixture. Real contact/authority tests are separate.
    // Freeze stepping/camera in this isolated browser, without changing game code.
    await page.evaluate(() => {
      const a = window.__arena,
        ball = a.ballTrails.mesh.parent.children.find(
          (o) => o.userData.panelMaterial,
        );
      window.__heatBall = ball;
      window.__soccarColor = ball.userData.panelMaterial.color.getHex();
      a.simulation.step = () => {};
      a.simulation.setGameMode("heatseeker");
      a.cameraControl.update = () => {};
      a.camera.position.set(22, 17, 29);
      a.camera.lookAt(0, 6, -8);
      a.simulation.ball.setTranslation({ x: 10, y: 7, z: -8 }, true);
      a.simulation.ballPose.snap();
      a.ballTrails.reset();
    });
    await page.waitForFunction(
      () =>
        window.__heatBall.userData.panelMaterial.color.getHex() === 0xf5f8ff,
    );
    await page.evaluate(() => {
      const camera = window.__arena.camera;
      camera.position.set(12, 9, -3);
      camera.lookAt(10, 7, -8);
    });
    await page.waitForTimeout(80);
    await page.screenshot({ path: "docs/heatseeker-white.png" });
    await page.evaluate(() => {
      const camera = window.__arena.camera;
      camera.position.set(22, 17, 29);
      camera.lookAt(0, 6, -8);
    });
    for (const team of [0, 1]) {
      await page.evaluate(
        (team) =>
          window.__arena.simulation.heatseeker.touch(
            "visual-" + team,
            team,
            team + 1,
          ),
        team,
      );
      await page.waitForFunction(
        (color) =>
          window.__heatBall.userData.panelMaterial.color.getHex() === color,
        team === 0 ? 0x399cff : 0xff8b32,
      );
      assert.equal(
        await page.evaluate(
          () => window.__arena.simulation.heatseeker.state.ownerTeam,
        ),
        team,
      );
    }
    await page.evaluate(() => {
      const h = window.__arena.simulation.heatseeker;
      while (h.state.speed < 60)
        h.touch("progress", h.state.ownerTeam === 0 ? 1 : 0, h.state.tier + 10);
    });
    await page.waitForFunction(
      () =>
        window.__heatBall.userData.panelMaterial.color.getHex() === 0xf6a9ff,
    );
    for (const quality of ["low", "medium", "high", "ultra"]) {
      await page.evaluate((quality) => {
        const a = window.__arena,
          t = a.ballTrails,
          b = window.__heatBall;
        a.settings.value.quality = quality;
        a.graphics.apply(quality);
        t.quality = quality;
        t.reset();
        const state = a.simulation.heatseeker.state;
        for (let i = 0; i < 144; i++) {
          const u = i / 143;
          b.position.set(-25 + 50 * u, 7, -8 - 18 * Math.sin(Math.PI * u));
          t.updateBall(
            b,
            60,
            state.ownerTeam,
            1 / 60,
            true,
            a.camera.position,
            1,
            state,
          );
        }
        a.simulation.ball.setTranslation(b.position, true);
        a.simulation.ballPose.snap();
      }, quality);
      await page.waitForTimeout(80);
      const vertices = await page.evaluate(
        () =>
          window.__arena.ballTrails.heatseeker.mesh.geometry.drawRange.count,
      );
      assert.ok(
        vertices > 24 && vertices <= 192 * 18,
        quality + " keeps visible bounded trail",
      );
      assert.equal(
        await page.evaluate(() =>
          window.__arena.ballTrails.heatseeker.mesh.material.uniforms.color.value.getHex(),
        ),
        0xf6a9ff,
      );
      if (quality === "high")
        await page.screenshot({ path: "docs/heatseeker-pink-trail.png" });
    }
    const owner = await page.evaluate(
      () => window.__arena.simulation.heatseeker.state.ownerTeam,
    );
    await page.evaluate(() => {
      const h = window.__arena.simulation.heatseeker;
      h.touch("switch", h.state.ownerTeam === 0 ? 1 : 0, 999);
    });
    await page.waitForTimeout(250);
    assert.equal(
      await page.evaluate(() =>
        window.__heatBall.userData.panelMaterial.color.getHex(),
      ),
      0xf6a9ff,
    );
    assert.notEqual(
      await page.evaluate(
        () => window.__arena.simulation.heatseeker.state.ownerTeam,
      ),
      owner,
    );
    await page.evaluate(() => window.__arena.simulation.heatseeker.reset(0));
    await page.waitForFunction(
      () =>
        window.__heatBall.userData.panelMaterial.color.getHex() === 0xf5f8ff,
    );
    assert.equal(
      await page.evaluate(() =>
        window.__arena.ballTrails.heatseeker.mesh.material.uniforms.color.value.getHex(),
      ),
      0xf5f8ff,
    );
    assert.ok(
      await page.evaluate(
        () => window.__arena.ballTrails.heatseeker.count < 30,
      ),
      "New kickoff cleared previous rally history",
    );
    await page.evaluate(() => window.__arena.simulation.setGameMode("soccar"));
    await page.waitForFunction(
      () =>
        window.__heatBall.userData.panelMaterial.color.getHex() ===
        window.__soccarColor,
    );
    assert.equal(
      await page.evaluate(
        () => window.__arena.ballTrails.heatseeker.mesh.visible,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS actual WebGL white/team/pink materials, curved history ribbons on every quality, max-speed ownership preservation, kickoff history cleanup and exact Soccar restoration; render fixtures only",
    );
  } finally {
    if (browser) await browser.close();
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
