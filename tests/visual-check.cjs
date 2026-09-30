const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("node:fs"),
  http = require("node:http"),
  path = require("node:path"),
  assert = require("node:assert/strict");
(async () => {
  const root = path.resolve("dist");
  const server = http.createServer((req, res) => {
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
            : file.endsWith(".json")
              ? "application/json"
              : "text/html",
      );
      res.end(data);
    });
  });
  await new Promise((resolve) => server.listen(4180, "127.0.0.1", resolve));
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    await page.goto("http://127.0.0.1:4180/?test");
    await page.waitForFunction(() => window.__arena);
    await page.locator("#play").click();
    await page.locator("#freeplay-mode").click();
    await page.waitForFunction(() => window.__arena.match.phase === "playing");
    await page.evaluate(() => {
      const c = window.__arena.simulation.cars[0];
      c.reset(0, 15, 0);
      c.body.setLinvel({ x: 0, y: 0, z: -20 }, true);
    });
    await page.keyboard.down("ControlLeft");
    await page.keyboard.down("d");
    await page.waitForTimeout(480);
    const drift = await page.evaluate(() => {
      const c = window.__arena.simulation.cars[0],
        v = c.body.linvel();
      return {
        handbrake: c.handbrake,
        slip: Math.abs(v.x * c.right.x + v.y * c.right.y + v.z * c.right.z),
      };
    });
    assert.equal(drift.handbrake, 1);
    assert.ok(drift.slip > 3);
    await page.screenshot({ path: "docs/powerslide.png" });
    await page.keyboard.up("d");
    await page.keyboard.up("ControlLeft");
    await page.waitForTimeout(600);
    assert.equal(
      await page.evaluate(() => window.__arena.simulation.cars[0].handbrake),
      0,
    );
    console.log(
      "PASS keyboard powerslide engages and releases in live gameplay",
      drift,
    );
    await page.evaluate(() => {
      const a = window.__arena,
        c = a.simulation.cars[0];
      c.reset(40.62, 0, 0, 10);
      c.body.setRotation(
        { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 },
        true,
      );
      c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      c.pose.snap();
      a.match.phase = "countdown";
      a.match.countdown = 999;
      a.cameraControl.ballMode = true;
      a.cameraControl.reset();
      document.querySelector("#countdown").style.visibility = "hidden";
    });
    await page.waitForTimeout(500);
    const wall = await page.evaluate(() => {
      const a = window.__arena,
        model = a.visuals[0];
      let minX = 1,
        maxX = -1,
        minY = 1,
        maxY = -1;
      model.updateWorldMatrix(true, true);
      model.traverse((o) => {
        if (o.isMesh) {
          const positions = o.geometry.getAttribute("position");
          for (let i = 0; i < positions.count; i++) {
            const v = a.camera.position
              .clone()
              .fromBufferAttribute(positions, i);
            o.localToWorld(v);
            v.project(a.camera);
            minX = Math.min(minX, v.x);
            maxX = Math.max(maxX, v.x);
            minY = Math.min(minY, v.y);
            maxY = Math.max(maxY, v.y);
          }
        }
      });
      return {
        distance: a.camera.position.distanceTo(
          a.simulation.cars[0].body.translation(),
        ),
        widthFraction: (maxX - minX) / 2,
        heightFraction: (maxY - minY) / 2,
      };
    });
    console.log(wall);
    await page.screenshot({ path: "docs/wall-camera.png" });
    assert.ok(
      wall.distance > 2.2 &&
        wall.widthFraction < 0.5 &&
        wall.heightFraction < 0.5,
    );
    await page.screenshot({ path: "docs/wall-camera.png" });
    console.log("PASS wall camera keeps car below half the screen", wall);
    await page.evaluate(() => {
      const a = window.__arena;
      a.cameraControl.update = () => {
        a.camera.position.set(3, 2.8, 4);
        a.camera.lookAt(0, 0.9125, 0);
        a.camera.fov = 60;
        a.camera.updateProjectionMatrix();
      };
      a.simulation.ball.setTranslation({ x: 0, y: 0.9125, z: 0 }, true);
      a.simulation.ballPose.snap();
      document.querySelector("#hud").style.visibility = "hidden";
    });
    await page.waitForTimeout(200);
    await page.screenshot({ path: "docs/ball-detail.png" });
    for (const sign of [-1, 1]) {
      await page.evaluate((sign) => {
        const a = window.__arena;
        a.cameraControl.update = () => {
          a.camera.position.set(13, 9, sign * 39);
          a.camera.lookAt(0, 4.5, sign * 53);
          a.camera.fov = 65;
          a.camera.updateProjectionMatrix();
        };
      }, sign);
      await page.waitForTimeout(200);
      await page.screenshot({ path: `docs/goal-corners-${sign}.png` });
    }
    for (const body of ["ion", "vector"]) {
      await page.evaluate((body) => {
        const a = window.__arena;
        a.garage.current.body = body;
      }, body);
      await page.reload();
      await page.waitForFunction(() => window.__arena);
      await page.locator("#garage-open").click();
      await page.locator("#customize-car").click();
      await page.locator(`[data-item="${body}"]`).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `docs/roof-${body}.png` });
    }
    console.log(
      "PASS original ball and both roof models rendered for visual inspection",
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
