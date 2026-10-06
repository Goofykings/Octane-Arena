const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const http = require("node:http"),
  fs = require("node:fs"),
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
  await new Promise((r) => server.listen(4187, "127.0.0.1", r));
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
    await page.goto("http://127.0.0.1:4187/?test");
    await page.waitForFunction(() => window.__arena);
    await page.locator("#play").click();
    await page.locator("#freeplay-mode").click();
    await page.locator("#freeplay-launch").click();
    await page.evaluate(() => {
      const a = window.__arena;
      a.qaStep = a.simulation.step.bind(a.simulation);
      a.simulation.step = () => {};
      a.cameraControl.update = () => {};
      a.camera.position.set(5, 8, 12);
      a.camera.lookAt(0, 0.5, 0);
      a.camera.updateMatrixWorld(true);
      a.simulation.cars[0].reset(0, 7, 0);
    });
    const ratios = [];
    for (const [name, height] of [
      ["low", 0.93],
      ["middle", 8],
      ["ceiling", 19.5275],
    ]) {
      await page.evaluate((y) => {
        const a = window.__arena;
        a.simulation.ball.setTranslation({ x: 0, y, z: 0 }, true);
        a.simulation.ballPose.snap();
      }, height);
      await page.waitForTimeout(180);
      const data = await page.evaluate(() => {
        const b = window.__arena.ballHeight;
        return {
          ratio: b.inner.scale.x / b.outer.scale.x,
          visible: b.inner.visible && b.group.visible,
          position: b.group.position.toArray(),
          height: b.height,
        };
      });
      assert.ok(data.visible);
      assert.ok(
        Math.abs(data.position[0]) < 1e-6 &&
          Math.abs(data.position[2]) < 1e-6 &&
          Math.abs(data.position[1] - 0.03) < 1e-5,
      );
      ratios.push(data.ratio);
      await page.screenshot({ path: `docs/ball-height-${name}.png` });
    }
    assert.ok(
      ratios[0] > 0.89 &&
        ratios[1] < 0.4 &&
        ratios[1] > 0.15 &&
        ratios[2] < 0.1,
    );
    const old = ratios[2];
    await page.evaluate(() => {
      const a = window.__arena;
      a.camera.position.set(0, 10, 30);
      a.camera.lookAt(0, 0, 0);
    });
    await page.waitForTimeout(180);
    assert.equal(
      await page.evaluate(() => {
        const b = window.__arena.ballHeight;
        return b.inner.scale.x / b.outer.scale.x;
      }),
      old,
    );
    console.log(
      "PASS low/middle/ceiling inner ring sizes, grounded projection, and camera-independent mapping",
      ratios,
    );
    await page.evaluate(() => {
      const a = window.__arena,
        s = a.simulation,
        c = s.cars[0];
      s.ball.setTranslation({ x: 0, y: 1, z: 20 }, true);
      c.reset(29, 0, -Math.PI / 2);
      c.body.setLinvel({ x: 23, y: 0, z: 0 }, true);
      a.qaMounts = a.visuals[0].userData.wheelMounts.map((m) =>
        m.position.toArray(),
      );
    });
    for (let frame = 0; frame < 90; frame++) {
      await page.evaluate(() => {
        const a = window.__arena,
          c = a.simulation.cars[0];
        c.boost = 100;
        for (let i = 0; i < 2; i++)
          a.qaStep([
            {
              throttle: 1,
              steer: 0,
              pitch: 0,
              yaw: 0,
              roll: 0,
              boost: true,
              jump: false,
              slide: false,
            },
            {},
          ]);
      });
      await page.waitForTimeout(16);
      assert.ok(
        await page.evaluate(() => {
          const a = window.__arena;
          return a.visuals[0].userData.wheelMounts.every((m, i) =>
            m.position.toArray().every((x, k) => x === a.qaMounts[i][k]),
          );
        }),
      );
    }
    assert.equal(
      await page.evaluate(
        () => window.__arena.simulation.containmentRecoveries,
      ),
      0,
    );
    console.log(
      "PASS rendered wheels remain fixed during full-boost floor/wall/upper-curve travel",
    );
    await page.keyboard.press("F3");
    await page.waitForTimeout(100);
    assert.ok(
      (await page.locator("#debug").textContent()).includes("Ball contact"),
    );
    assert.deepEqual(errors, []);
    console.log("PASS contact debug values visible; no browser runtime errors");
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
