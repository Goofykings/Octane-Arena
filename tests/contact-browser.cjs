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
  await new Promise((r) => server.listen(4184, "127.0.0.1", r));
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
    await page.goto("http://127.0.0.1:4184/?test");
    await page.waitForFunction(() => window.__arena);
    await page.locator("#play").click();
    await page.locator("#freeplay-mode").click();
    await page.evaluate(() => {
      window.__arena.simulation.step = () => {};
    });
    for (const [name, position, ball, roll] of [
      ["ahead", [0, 0.34, 0], [0, 1, -14], 0],
      ["behind", [0, 0.34, 0], [0, 1, 14], 0],
      ["near-overhead", [0, 0.34, 0], [0.1, 7, 0.1], 0],
      ["wall-center", [40.6, 10, 0], [0, 1, 0], Math.PI / 2],
      ["overhead", [0, 0.34, 0], [0.1, 19.4, 0.1], 0],
      ["wall", [40.6, 10, 0], [39, 19.4, 0], Math.PI / 2],
      ["ceiling", [35, 20.1, 0], [30, 16, 0], Math.PI],
    ]) {
      await page.evaluate(
        ({ position, ball, roll }) => {
          const a = window.__arena,
            s = a.simulation,
            c = s.cars[0];
          c.reset(position[0], position[2], 0, position[1]);
          c.body.setRotation(
            { x: 0, y: 0, z: Math.sin(roll / 2), w: Math.cos(roll / 2) },
            true,
          );
          c.pose.snap();
          s.ball.setTranslation({ x: ball[0], y: ball[1], z: ball[2] }, true);
          s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
          s.ballPose.snap();
          a.cameraControl.reset();
          a.cameraControl.ballMode = true;
        },
        { position, ball, roll },
      );
      await page.waitForTimeout(1200);
      const frame = await page.evaluate(() => {
        const a = window.__arena,
          c = a.camera;
        c.updateMatrixWorld(true);
        return [
          a.simulation.cars[0].pose.current,
          a.simulation.ballPose.current,
        ].map((p) => p.clone().project(c).toArray());
      });
      assert.ok(
        frame.every(
          (p) => Math.abs(p[0]) < 0.95 && Math.abs(p[1]) < 0.95 && p[2] < 1,
        ),
        name + JSON.stringify(frame),
      );
      await page.screenshot({ path: "docs/framing-" + name + ".png" });
      console.log("PASS live framing " + name);
    }
    // Render both directions of the real curve path, then both camera toggles.
    for (const direction of [1, -1]) {
      for (let step = 0; step <= 30; step++) {
        await page.evaluate(
          ({ step, direction }) => {
            const a = window.__arena,
              s = a.simulation,
              c = s.cars[0];
            const angle =
              ((direction === 1 ? step / 30 : 1 - step / 30) * Math.PI) / 2;
            c.reset(
              40.96 - 2.4 + 2.06 * Math.sin(angle),
              0,
              0,
              2.4 - 2.06 * Math.cos(angle),
            );
            c.body.setRotation(
              { x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) },
              true,
            );
            c.pose.snap();
            s.ball.setTranslation({ x: 0, y: 1, z: 0 }, true);
            s.ballPose.snap();
            if (step === 0 && direction === 1) a.cameraControl.reset();
          },
          { step, direction },
        );
        await page.waitForTimeout(50);
      }
      await page.screenshot({ path: `docs/framing-curve-${direction}.png` });
      assert.ok(
        await page.evaluate(() => {
          const a = window.__arena,
            p = a.simulation.ballPose.current.clone().project(a.camera);
          return (
            Math.abs(p.x) < 1 &&
            Math.abs(p.y) < 1 &&
            p.z < 1 &&
            Math.abs(a.camera.rotation.z) < 1e-8
          );
        }),
      );
      console.log(`PASS live curve direction ${direction}`);
    }
    for (const ballMode of [false, true]) {
      await page.evaluate(
        (ballMode) => (window.__arena.cameraControl.ballMode = ballMode),
        ballMode,
      );
      await page.waitForTimeout(250);
      await page.screenshot({ path: `docs/framing-toggle-${ballMode}.png` });
      await page.waitForTimeout(750);
      console.log(`PASS live camera toggle ${ballMode}`);
    }
    await page.evaluate(() => {
      const a = window.__arena,
        s = a.simulation;
      s.cars[0].reset(0, 0, 0);
      s.ball.setTranslation({ x: 0, y: 2, z: -8 }, true);
      s.ballPose.snap();
      a.match.mode = "bot";
      a.match.phase = "playing";
      a.cameraControl.reset();
    });
    for (const team of [0, 1, null]) {
      await page.evaluate((team) => {
        const a = window.__arena,
          s = a.simulation;
        s.lastTouchId = team === null ? null : s.cars[team].id;
        s.ball.setTranslation({ x: -3, y: 2, z: -8 }, true);
        s.ball.setLinvel({ x: 18, y: 0, z: 0 }, true);
        let angle = 0;
        s.step = () => {
          const p = s.ball.translation();
          p.x += 18 / 120;
          s.ball.setTranslation(p, true);
          angle += 4 / 120;
          s.ball.setRotation(
            { x: Math.sin(angle / 2), y: 0, z: 0, w: Math.cos(angle / 2) },
            true,
          );
          s.ballPose.snap();
        };
      }, team);
      await page.waitForTimeout(250);
      assert.equal(
        await page.evaluate(() =>
          window.__arena.ballTrails.mesh.material.uniforms.color.value.getHex(),
        ),
        team === 0 ? 0x69cfff : team === 1 ? 0xffa34a : 0xc4c4c4,
      );
      assert.ok(
        await page.evaluate(() => window.__arena.ballTrails.mesh.visible),
      );
      await page.screenshot({ path: "docs/ball-streaks-" + team + ".png" });
      console.log("PASS live ball trail team " + team);
    }
    await page.evaluate(() => {
      const s = window.__arena.simulation,
        c = s.cars[0];
      c.reset(0, 0, 0, 3);
      c.jump.flipLeft = 0.4;
      let angle = 0;
      s.step = () => {
        angle += 7 / 120;
        c.body.setRotation(
          { x: Math.sin(angle / 2), y: 0, z: 0, w: Math.cos(angle / 2) },
          true,
        );
        c.pose.snap();
      };
    });
    await page.waitForTimeout(160);
    assert.ok(
      await page.evaluate(() => window.__arena.flipTrails[0].mesh.visible),
    );
    await page.screenshot({ path: "docs/flip-streaks.png" });
    await page.evaluate(() => {
      window.__arena.simulation.cars[0].jump.flipLeft = 0;
    });
    await page.waitForFunction(
      () => !window.__arena.flipTrails[0].mesh.visible,
    );
    console.log("PASS live flip trail and expiry");
    await page.evaluate(() => {
      const a = window.__arena,
        s = a.simulation,
        c = s.cars[0];
      s.step = () => {};
      c.reset(-30, 8, 0);
      s.ball.setTranslation({ x: -30, y: 1, z: 0 }, true);
      s.ballPose.snap();
      a.pads.tick = () => [];
      a.pads.items.forEach((p) => (p.cooldown = p.large ? 5 : 2));
      a.cameraControl.ballMode = false;
      a.cameraControl.reset();
    });
    await page.waitForTimeout(400);
    assert.ok(
      await page.evaluate(() =>
        window.__arena.padRecharge.every(
          (v) =>
            v.mesh.visible &&
            Math.abs(v.mesh.material.uniforms.progress.value - 0.5) < 0.001,
        ),
      ),
    );
    await page.screenshot({ path: "docs/pad-recharge.png" });
    console.log("PASS live half-charged pads");
    await page.evaluate(() => {
      const a = window.__arena,
        s = a.simulation;
      s.cars[0].reset(0, 43, Math.PI);
      s.ball.setTranslation({ x: 0, y: 2, z: 51.2 }, true);
      s.ballPose.snap();
      a.cameraControl.ballMode = true;
      a.cameraControl.reset();
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: "docs/goal-mouth-alignment.png" });
    assert.deepEqual(errors, []);
    console.log("PASS no browser or shader errors");
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
