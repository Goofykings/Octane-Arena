const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8221);
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
      a.simulation.step = () => {};
      document.getElementById("hud").style.visibility = "hidden";
    });
    for (const sign of [-1, 1]) {
      await page.evaluate((sign) => {
        const a = window.__arena;
        a.cameraControl.update = () => {
          a.camera.clearViewOffset();
          a.camera.position.set(5, 4.5, sign * (51.2 - 15));
          a.camera.up.set(0, 1, 0);
          a.camera.lookAt(0, 3, sign * (51.2 + 2));
          a.camera.fov = 58;
          a.camera.updateProjectionMatrix();
          a.camera.updateMatrixWorld(true);
        };
      }, sign);
      await page.waitForTimeout(1000);
      const shape = await page.evaluate((sign) => {
        const a = window.__arena,
          scene = a.visuals[0].parent.parent;
        const lining = scene.getObjectByName(`goal-interior-${sign}`);
        const frame = [];
        scene.traverse((o) => {
          if (!o.name.startsWith(`goal-frame-${sign}-`)) return;
          const positions = o.geometry.getAttribute("position"),
            ids = o.geometry.index;
          let minDepth = Infinity;
          for (let i = 0; i < ids.count; i++) {
            const id = ids.getX(i);
            if (positions.getY(id) > 2.41)
              minDepth = Math.min(minDepth, positions.getZ(id) * sign - 51.2);
          }
          frame.push({
            type: o.geometry.type,
            color: o.material.color.getHex(),
            minDepth,
            positionedAtOrigin: o.position.lengthSq() === 0,
          });
        });
        return {
          frame,
          triangles: lining.geometry.index.count / 3,
          opacity: lining.material.opacity,
          transparent: lining.material.transparent,
        };
      }, sign);
      assert.equal(shape.frame.length, 3);
      assert.ok(shape.triangles > 1000);
      assert.equal(shape.opacity, 1);
      assert.equal(
        shape.transparent,
        false,
        "flicker fix must retain solid lining",
      );
      for (const beam of shape.frame) {
        assert.equal(beam.type, "BufferGeometry");
        assert.equal(beam.color, sign > 0 ? 0x41d9f2 : 0xffb44f);
        assert.ok(
          beam.positionedAtOrigin && beam.minDepth >= -1e-4,
          "frame is shared wall faces, without a floating field-side beam",
        );
      }
      await page.screenshot({ path: `docs/goal-remake-${sign}.png` });
      const clip = { x: 290, y: 170, width: 700, height: 165 };
      const first = await page.screenshot({ clip });
      for (let i = 0; i < 3; i++) {
        await page.waitForTimeout(150);
        const next = await page.screenshot({ clip });
        assert.deepEqual(
          next,
          first,
          `goal ${sign} top pixels remain stable across frames`,
        );
      }
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS production blue/orange goal rendering, three flush shared-face color regions, solid lining, no overlapping roof accents, stable top pixels across repeated frames",
    );
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
