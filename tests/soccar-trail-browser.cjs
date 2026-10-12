const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8223);
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
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error" && /shader|WebGL/i.test(m.text()))
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
    await page.locator("#play").click();
    await page.locator("#bot-mode").click();
    await page.locator("#bot-launch").click();
    await page.evaluate(() => {
      const a = window.__arena;
      a.match.phase = "playing";
      a.simulation.recordTouch(a.simulation.cars.find((c) => c.team === 0).id);
      let t = 0;
      a.simulation.step = () => {
        t += 1 / 120;
        a.simulation.ballPose.before();
        a.simulation.ball.setTranslation(
          { x: 12 * Math.sin(t), y: 3, z: 12 * Math.cos(t) },
          true,
        );
        a.simulation.ball.setLinvel(
          { x: 12 * Math.cos(t), y: 0, z: -12 * Math.sin(t) },
          true,
        );
        a.simulation.ballPose.after();
      };
      a.cameraControl.update = () => {
        a.camera.position.set(12, 10, 18);
        a.camera.lookAt(8, 3, 0);
        a.camera.updateMatrixWorld(true);
      };
    });
    const inspect = () =>
      page.evaluate(() => {
        const a = window.__arena,
          scene = a.visuals[0].parent.parent;
        const trail = scene.getObjectByName("soccar-history-trail");
        return {
          visible: trail.visible,
          vertices: trail.geometry.drawRange.count,
          color: trail.material.uniforms.color.value.getHex(),
          heat: scene.getObjectByName("heatseeker-history-trail").visible,
        };
      });
    await page.waitForTimeout(2000);
    let value = await inspect();
    assert.ok(value.visible && value.vertices > 12);
    assert.equal(value.color, 0x69cfff);
    assert.equal(value.heat, false);
    await page.screenshot({ path: "docs/soccar-ball-trail.png" });
    await page.evaluate(() => {
      const s = window.__arena.simulation;
      s.recordTouch(s.cars.find((c) => c.team === 1).id);
    });
    await page.waitForTimeout(1500);
    value = await inspect();
    assert.equal(
      value.color,
      0xffa34a,
      "Stable player ID resolves orange ownership through actual render loop",
    );
    await page.evaluate(() => {
      const a = window.__arena;
      a.simulation.step = () => {};
      a.match.kickoff(a.simulation);
    });
    await page.waitForTimeout(300);
    value = await inspect();
    assert.equal(value.visible, false);
    assert.equal(value.color, 0xc4c4c4);
    assert.deepEqual(errors, []);
    console.log(
      "PASS production Soccar ribbon rendering, last-touch blue/orange IDs, Heatseeker isolation, kickoff neutral reset and no browser errors",
    );
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
