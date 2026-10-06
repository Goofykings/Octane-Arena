const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("node:fs"),
  http = require("node:http"),
  path = require("node:path"),
  assert = require("node:assert/strict");
(async () => {
  const root = path.resolve("dist"),
    server = http.createServer((req, res) => {
      if (req.url === "/favicon.ico") {
        res.writeHead(204);
        return res.end();
      }
      const file = path.resolve(
        root,
        req.url.split("?")[0].replace(/^\//, "") || "index.html",
      );
      if (!file.startsWith(root + path.sep)) {
        res.writeHead(403);
        return res.end();
      }
      fs.readFile(file, (e, data) => {
        if (e) {
          res.writeHead(404);
          return res.end();
        }
        res.setHeader(
          "Content-Type",
          file.endsWith(".js")
            ? "text/javascript"
            : file.endsWith(".css")
              ? "text/css"
              : "text/html",
        );
        res.end(data);
      });
    });
  await new Promise((r) => server.listen(4183, "127.0.0.1", r));
  const browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  try {
    const page = await browser.newPage({
        viewport: { width: 1280, height: 720 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.goto("http://127.0.0.1:4183/?test");
    await page.waitForFunction(() => window.__arena);
    await page.locator("#play").click();
    await page.locator("#bot-mode").click();
    for (const [width, height] of [
      [1920, 1080],
      [2560, 1440],
      [1366, 768],
      [1280, 720],
      [2560, 1080],
      [900, 600],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      assert.ok(
        await page
          .locator(".scoreboard,.boost-hud,.camera-status")
          .evaluateAll((es) =>
            es.every((e) => {
              const r = e.getBoundingClientRect();
              return (
                r.x >= 0 &&
                r.y >= 0 &&
                r.right <= innerWidth &&
                r.bottom <= innerHeight
              );
            }),
          ),
      );
      console.log(`PASS match HUD ${width}x${height}`);
    }
    await page.keyboard.press("Escape");
    await page.locator("#pause-home").click();
    if (await page.locator("#leave-confirm").evaluate(d => d.open)) await page.locator("#leave-confirm-yes").click();
    await page.locator("#play").click();
    await page.locator("#freeplay-mode").click();
    await page.locator("#freeplay-launch").click();
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => {
      window.__arena.simulation.step = () => {};
      document.querySelector("#hud").style.visibility = "hidden";
    });
    for (const sign of [-1, 1])
      for (const offset of [-1.1, 0, 0.7]) {
        await page.evaluate(
          ({ sign, offset }) => {
            const a = window.__arena,
              s = a.simulation;
            s.ball.setTranslation(
              { x: 0, y: 1.5, z: sign * (51.2 + offset) },
              true,
            );
            s.ballPose.snap();
            a.cameraControl.update = () => {
              a.camera.position.set(4.2, 3, sign * 47);
              a.camera.lookAt(0, 1.5, sign * 51.2);
              a.camera.updateProjectionMatrix();
            };
          },
          { sign, offset },
        );
        await page.waitForFunction(
          (expected) =>
            window.__arena.goalPlanes.uniforms.goalActive.value === expected,
          offset === -1.1 ? 0 : 1,
        );
        assert.equal(
          await page.evaluate(
            () => window.__arena.goalPlanes.uniforms.goalActive.value,
          ),
          offset === -1.1 ? 0 : 1,
        );
        assert.equal(
          await page.evaluate(() => window.__arena.match.phase),
          "playing",
        );
        await page.screenshot({
          path: `docs/goal-plane-${sign}-${offset}.png`,
        });
        console.log(`PASS goal shader sign ${sign}, offset ${offset}`);
      }
    await page.reload();
    await page.waitForFunction(() => window.__arena);
    await page.locator("#play").click();
    await page.locator("#freeplay-mode").click();
    await page.locator("#freeplay-launch").click();
    assert.ok(
      await page.evaluate(() => {
        const { goalPlanes } = window.__arena;
        return goalPlanes.planes.every(
          (p) => p.material.color.getHex() === 0xa8a8a8,
        );
      }),
    );
    for (const sign of [-1, 1]) {
      await page.evaluate((sign) => {
        const { simulation } = window.__arena;
        simulation.ball.setTranslation({ x: 0, y: 1, z: sign * 53 }, true);
        simulation.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }, sign);
      await page.waitForFunction(() => window.__arena.match.phase === "goal");
      assert.ok(
        await page.evaluate(() => {
          const { match, explosion } = window.__arena;
          return (
            match.score.every((s) => s === 0) &&
            match.message === "" &&
            explosion.group.visible &&
            explosion.flash.material.color.getHex() === 0xa8a8a8 &&
            explosion.rings.every((r) => r.material.color.getHex() === 0xa8a8a8)
          );
        }),
      );
      await page.screenshot({ path: `docs/freeplay-gray-goal-${sign}.png` });
      await page.waitForTimeout(700);
      assert.ok(
        await page.evaluate(() => {
          const a = window.__arena;
          if (!a.match.goalFocus || a.simulation.ball.isEnabled()) return false;
          const p = a.simulation.ballPose.current
            .clone()
            .copy(a.match.goalFocus)
            .project(a.camera);
          return Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && p.z < 1;
        }),
      );
      await page.screenshot({ path: `docs/framing-scored-goal-${sign}.png` });
      await page.waitForFunction(
        () => window.__arena.match.phase === "playing",
      );
      assert.ok(
        await page.evaluate(() => {
          const { match, simulation } = window.__arena;
          return match.countdown === 0 && !simulation.cars[1].body.isEnabled();
        }),
      );
      console.log(
        `PASS neutral Free Play goal ${sign}: gray explosion and scoreless reset`,
      );
    }
    await page.keyboard.press("Escape");
    await page.locator("#pause-home").click();
    if (await page.locator("#leave-confirm").evaluate(d => d.open)) await page.locator("#leave-confirm-yes").click();
    await page.locator("#play").click();
    await page.locator("#bot-mode").click();
    assert.ok(
      await page.evaluate(() => {
        const { goalPlanes, match } = window.__arena;
        return (
          match.phase === "countdown" &&
          goalPlanes.planes[0].material.color.getHex() === 0xffb654 &&
          goalPlanes.planes[1].material.color.getHex() === 0x69e9ff
        );
      }),
    );
    console.log("PASS switching back to bot match restores team goal colors");
    assert.deepEqual(errors, []);
    console.log("PASS no shader or browser errors");
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

