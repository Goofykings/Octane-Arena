const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8254);
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
    const styles = [
      "apex",
      "disc",
      "filament",
      "dish",
      "offroad",
      "turbine",
      "glow",
      "star",
      "steel",
      "experimental",
    ];
    const shapes = new Set();
    for (const body of ["vector", "ion", "cargo", "slicer", "wraith"]) {
      await page.locator('[data-category="body"]').click();
      await page.locator('[data-item="' + body + '"]').click();
      await page.locator('[data-category="wheels"]').click();
      assert.equal(
        await page.locator(".inventory-grid [data-item]").count(),
        10,
      );
      for (const style of styles) {
        await page.locator('[data-item="' + style + '"]').click();
        assert.equal(
          await page
            .locator('[data-item="' + style + '"]')
            .getAttribute("aria-pressed"),
          "true",
        );
        const result = await page.evaluate(() => {
          const a = __arena,
            p = a.garage.current,
            live = a.visuals[0].userData.wheels,
            preview = a.preview.car.userData.wheels;
          return {
            body: p.body,
            wheel: p.wheels,
            saved: JSON.parse(localStorage.getItem("octane-arena-garage"))
              .presets[0].wheels,
            live: live.map((w) => w.userData.designId),
            preview: preview.map((w) => w.userData.designId),
            shape: preview[0].children[1].children
              .map((m) => m.geometry.getAttribute("position").count)
              .join(","),
          };
        });
        assert.equal(result.body, body);
        assert.equal(result.wheel, style);
        assert.equal(result.saved, style);
        assert.deepEqual(result.live, Array(4).fill(style));
        assert.deepEqual(result.preview, result.live);
        if (body === "vector") {
          shapes.add(result.shape);
          await page.screenshot({ path: ".tools/wheel-" + style + ".png" });
        }
      }
    }
    assert.equal(shapes.size, 10, "different rim meshes, not recolors");
    // Rims remain visible with the higher-quality material/shader path as well.
    await page.evaluate(() => __arena.graphics.apply("ultra"));
    await page.locator('[data-item="glow"]').click();
    await page.waitForTimeout(100);
    await page.screenshot({ path: ".tools/wheel-pulse-ultra.png" });
    await page.reload();
    await page.waitForFunction(() => window.__arena);
    assert.deepEqual(
      await page.evaluate(() => [
        __arena.garage.current.body,
        __arena.garage.current.wheels,
      ]),
      ["wraith", "glow"],
    );
    await page.waitForFunction(() =>
      [...__arena.homeLobby.displays.values()].some((d) =>
        d.model.userData.wheels.every((w) => w.userData.designId === "glow"),
      ),
    );
    await page.locator("#play").click();
    await page.locator("#freeplay-mode").click();
    await page.locator("#freeplay-launch").click();
    await page.waitForFunction(
      () => __arena.match.phase === "playing" && !__arena.matchLoader.active,
    );
    const before = await page.evaluate(
      () => __arena.visuals[0].userData.wheels[0].rotation.x,
    );
    await page.keyboard.down("w");
    await page.keyboard.down("a");
    await page.waitForTimeout(500);
    const motion = await page.evaluate(() => ({
      spin: __arena.visuals[0].userData.wheels[0].rotation.x,
      steer: __arena.visuals[0].userData.frontWheels[0].rotation.y,
      design: __arena.visuals[0].userData.wheels[0].userData.designId,
    }));
    await page.keyboard.up("a");
    await page.keyboard.up("w");
    assert.notEqual(motion.spin, before);
    assert.ok(Math.abs(motion.steer) > 0.01);
    assert.equal(motion.design, "glow");
    await page.screenshot({ path: ".tools/wheel-gameplay.png" });
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
    await page.waitForTimeout(150);
    assert.ok(
      await page.evaluate(() =>
        __arena.visuals[0].userData.wheels.every(
          (w) => w.userData.designId === "glow",
        ),
      ),
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS all 50 garage body/wheel combinations, instant preview/live meshes, ten distinct rims, preset reload, home lineup, actual driving spin/front steering, replay and ultra shader rendering",
    );
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
