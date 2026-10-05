const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict"),
  fs = require("node:fs");
(async () => {
  const browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  try {
    const page = await browser.newPage({
        viewport: { width: 1280, height: 720 },
      }),
      errors = [],
      warnings = [],
      samples = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (
        m.type() === "error" &&
        !(m.location().url.endsWith("/api/me") && m.text().includes("401"))
      )
        errors.push(m.text());
      if (m.type() === "warning" && /shader|processing/i.test(m.text()))
        warnings.push(m.text());
    });
    await page.route("**/favicon.ico", (r) => r.fulfill({ status: 204 }));
    await page.goto("http://localhost:8090/?test");
    await page.waitForFunction(() => window.__arena);
    await page.locator("#play").click();
    await page.locator("#freeplay-mode").click();
    await page.evaluate(() => {
      const a = window.__arena;
      a.cameraControl.ballMode = false;
      a.simulation.cars[0].reset(0, 0, 0);
      const scene = a.graphics.renderPass.scene,
        car = a.simulation.cars[0];
      car.boosting = true;
      const model = a.visuals[0].parent;
      window.polishExtras = [];
      for (const x of [-4, 4, 7]) {
        const copy = model.clone();
        copy.position.set(x, 0.36, -4);
        copy.visible = true;
        scene.add(copy);
        window.polishExtras.push(copy);
      }
      a.simulation.step = () => {
        a.simulation.ballPose.before();
        const t = performance.now() / 1000;
        a.simulation.ball.setTranslation(
          { x: Math.sin(t * 2.5) * 12, y: 0.9125, z: -10 },
          true,
        );
        a.simulation.ball.setLinvel({ x: 60, y: 0, z: 0 }, true);
        a.simulation.ballPose.after();
      };
    });
    for (const quality of ["low", "medium", "high", "ultra", "low", "high"]) {
      await page.evaluate((q) => window.__arena.graphics.apply(q), quality);
      await page.waitForTimeout(450);
      const state = await page.evaluate(() => {
        const a = window.__arena,
          g = a.graphics,
          scene = g.renderPass.scene,
          floor = scene.getObjectByName("stadium-turf");
        return {
          quality: g.quality,
          failed: g.effectsUnavailable,
          extra: g.composer.passes.filter(
            (p) => p.enabled && (p === g.glow || p === g.polish),
          ).length,
          bloom: g.glow.enabled,
          polish: g.polish.enabled,
          texture: [
            floor.material.map.image.width,
            floor.material.map.image.height,
          ],
          repeat: floor.material.map.repeat.toArray(),
          bump: !!floor.material.bumpMap,
          target: g.glow.target
            ? [g.glow.target.width, g.glow.target.height]
            : null,
          vignette: g.polish.uniforms.vignette.value,
        };
      });
      assert.equal(state.failed, false);
      assert.deepEqual(state.texture, [512, 512]);
      assert.deepEqual(state.repeat, [14, 18]);
      assert.equal(state.bump, false, "original turf restored");
      const enabled = ["high", "ultra"].includes(quality);
      assert.equal(state.polish, enabled);
      assert.equal(state.extra, enabled ? 2 : 0);
      assert.equal(state.bloom, enabled);
      assert.equal(state.vignette > 0, quality === "ultra");
      console.log(
        "PASS quality switch, original turf, four cars and moving ball",
        state,
      );
      if (["medium", "high", "ultra"].includes(quality))
        await page.screenshot({ path: `docs/polish-${quality}.png` });
      const times = await page.evaluate(async () => {
        const times = [];
        let before = performance.now();
        for (let i = 0; i < 24; i++)
          await new Promise((resolve) =>
            requestAnimationFrame((now) => {
              times.push(now - before);
              before = now;
              resolve();
            }),
          );
        times.sort((a, b) => a - b);
        return { median: times[12], p95: times[22] };
      });
      samples.push({ quality, ...times });
    }
    await page.evaluate(() =>
      window.__arena.explosion.trigger({ x: 0, y: 1, z: -8 }, 0x69e9ff),
    );
    await page.waitForTimeout(400);
    await page.screenshot({ path: "docs/polish-goal.png" });
    assert.equal(
      await page.evaluate(() => window.__arena.explosion.group.visible),
      true,
    );
    await page.waitForTimeout(3000);
    assert.equal(
      await page.evaluate(() => window.__arena.explosion.group.visible),
      false,
      "no lingering goal glow",
    );
    // Optional HDR bloom unavailable, followed by full optional-effect fallback.
    await page.evaluate(() => {
      const g = window.__arena.graphics;
      g.bloomSupported = false;
      g.apply("low");
      g.apply("high");
    });
    await page.waitForTimeout(200);
    assert.deepEqual(
      await page.evaluate(() => {
        const g = window.__arena.graphics;
        return [g.glow.enabled, g.polish.enabled, g.effectsUnavailable];
      }),
      [false, true, false],
    );
    await page.evaluate(() => {
      // Deliberately fail one optional shader. The production error handler
      // must automatically return to the original material on the next frame.
      const floor =
          window.__arena.graphics.renderPass.scene.getObjectByName(
            "stadium-turf",
          ),
        mat = floor.material;
      const compile = mat.onBeforeCompile,
        key = mat.customProgramCacheKey.bind(mat);
      mat.customProgramCacheKey = () => key() + ":failure-fixture";
      mat.onBeforeCompile = (shader, renderer) => {
        compile.call(mat, shader, renderer);
        if (shader.fragmentShader.includes("OCTANE_POLISH"))
          shader.fragmentShader += "\nintentional_compile_failure";
      };
      mat.needsUpdate = true;
    });
    await page.waitForFunction(
      () => window.__arena.graphics.effectsUnavailable,
    );
    await page.waitForTimeout(200);
    assert.deepEqual(
      await page.evaluate(() => {
        const g = window.__arena.graphics;
        return [g.glow.enabled, g.polish.enabled];
      }),
      [false, false],
    );
    await page.evaluate(() => window.__arena.graphics.apply("medium"));
    await page.waitForTimeout(200);
    assert.equal(
      await page.evaluate(() => window.__arena.graphics.quality),
      "medium",
    );
    assert.deepEqual(errors, []);
    assert.ok(
      warnings.some((w) =>
        w.includes(
          "Optional graphics effects were disabled after a shader error",
        ),
      ),
      "actual compilation failure invokes the fallback",
    );
    fs.writeFileSync(
      "docs/graphics-polish-timing.json",
      JSON.stringify(
        {
          environment:
            "Headless Chrome / software SwiftShader; not a hardware GPU benchmark",
          samples,
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS boost, temporary explosion cleanup, unavailable HDR bloom, standard-material fallback, settings still usable, no shader/runtime errors",
      samples,
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
