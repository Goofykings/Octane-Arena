const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8258);
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
    page.setDefaultTimeout(60000);
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
    await page.waitForFunction(() =>
      [...__arena.homeLobby.displays.values()].some(
        (d) => d.model.userData.bodyId === "vector",
      ),
    );
    await page.waitForTimeout(700);
    assert.ok(
      await page.evaluate(() =>
        [...__arena.homeLobby.displays.values()].every((d) => {
          const glass = d.model.getObjectByName("vector-glass");
          return (
            glass.material.transparent &&
            glass.material.opacity > 0.94 &&
            glass.material.opacity <= 0.97
          );
        }),
      ),
      "Home fade retains glass",
    );
    await page.screenshot({ path: ".tools/vector-quality-home.png" });
    await page.locator("#garage-open").click();
    await page.locator("#customize-car").click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: ".tools/vector-quality-garage.png" });
    await page.evaluate(() => __arena.graphics.apply("ultra"));
    await page.waitForTimeout(500);
    assert.equal(
      await page.evaluate(() => __arena.graphics.effectsUnavailable),
      false,
      "Ultra shaders stay enabled without fallback",
    );
    await page.screenshot({ path: ".tools/vector-quality-garage-ultra.png" });
    await page.evaluate(() => {
      __arena.preview.angle -= Math.PI;
    });
    await page.waitForTimeout(200);
    await page.screenshot({ path: ".tools/vector-quality-rear-ultra.png" });
    // An extra inspection view uses the actual Garage lights/materials.
    await page.evaluate(() => {
      __arena.preview.angle = Math.PI - 0.7;
      __arena.preview.car.rotation.y = -0.7;
      __arena.preview.update = () => {
        const p = __arena.preview;
        p.camera.clearViewOffset();
        p.camera.position.set(1.25, 0.9, -1.7);
        p.camera.lookAt(0, 0.42, 0);
        p.camera.updateProjectionMatrix();
      };
      __arena.preview.car.rotation.y = 0;
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: ".tools/vector-quality-detail.png" });
    await page.evaluate(() => __arena.graphics.apply("ultra"));
    await page.waitForTimeout(500);
    await page.screenshot({ path: ".tools/vector-quality-detail-ultra.png" });
    await page.reload();
    await page.waitForFunction(() => window.__arena);
    await page.locator("#play").click();
    await page.locator("#freeplay-mode").click();
    await page.locator("#freeplay-launch").click();
    await page.waitForFunction(
      () => __arena.match.phase === "playing" && !__arena.matchLoader.active,
    );
    const mounts = await page.evaluate(() =>
      __arena.visuals[0].userData.wheelMounts.map((m) => m.position.toArray()),
    );
    assert.deepEqual(
      await page.evaluate(() => {
        const model = __arena.visuals[0],
          lod = model.getObjectByName("vector-body-lod");
        const camera = __arena.camera.clone();
        model.updateMatrixWorld(true);
        camera.position.copy(model.position).add({ x: 0, y: 0, z: 24 });
        camera.updateMatrixWorld();
        lod.update(camera);
        const far = lod.getCurrentLevel();
        lod.update(__arena.camera);
        return [far, lod.getCurrentLevel()];
      }),
      [1, 0],
      "live car distance LOD restores correctly",
    );
    await page.keyboard.down("w");
    await page.keyboard.down("d");
    await page.keyboard.down("Shift");
    await page.waitForTimeout(600);
    assert.ok(
      await page.evaluate(
        () =>
          __arena.vehicleEffects[0].flames.visible &&
          __arena.vehicleEffects[0].flames.parent ===
            __arena.visuals[0].parent &&
          __arena.vehicleEffects[0].flames.position.equals(
            __arena.visuals[0].userData.exhaust,
          ),
      ),
      "boost remains attached and visible",
    );
    assert.ok(
      await page.evaluate(() =>
        __arena.visuals[0].userData.wheels.every(
          (w) => Math.abs(w.rotation.x) > 0.1,
        ),
      ),
    );
    assert.ok(
      await page.evaluate(() =>
        __arena.visuals[0].userData.frontWheels.every(
          (w) => Math.abs(w.rotation.y) > 0.01,
        ),
      ),
    );
    assert.deepEqual(
      await page.evaluate(() =>
        __arena.visuals[0].userData.wheelMounts.map((m) =>
          m.position.toArray(),
        ),
      ),
      mounts,
    );
    await page.keyboard.up("w");
    await page.keyboard.up("d");
    await page.keyboard.up("Shift");
    await page.screenshot({ path: ".tools/vector-quality-gameplay.png" });
    assert.deepEqual(errors, []);
    console.log(
      "PASS Vector Home transparency, Garage/detail/gameplay renders, live steering/spin, fixed wheel mounts, boost and no runtime/shader errors",
    );
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
