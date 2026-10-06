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
      req.url
        .split("?")[0]
        .replace(/^\/Octane-Arena\//, "/")
        .replace(/^\//, "") || "index.html",
    );
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(403);
      return res.end();
    }
    fs.readFile(file, (err, bytes) => {
      if (err) {
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
      res.end(bytes);
    });
  });
  await new Promise((r) => server.listen(4191, "127.0.0.1", r));
  const browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  try {
    const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.goto("http://127.0.0.1:4191/?test");
    await page.waitForFunction(() => !!window.__arena);
    await page.locator("#play").click();
    const friend = await page.locator("#friend-mode").boundingBox(),
      extra = await page.locator("#extra-mode").boundingBox();
    assert.ok(extra.x > friend.x + friend.width);
    assert.equal(
      (await page.locator("#modes").innerText()).includes("RANKED"),
      false,
    );
    await page.locator("#freeplay-mode").click();
    await page.locator('[data-arena="beach"]').click();
    await page.locator("#freeplay-back").click();
    await page.locator("#extra-mode").click();
    await page.locator("#extras").waitFor({ state: "visible" });
    await page.screenshot({ path: "docs/rings-menu.png" });
    await page.locator("#rings-mode").click();
    await page.waitForFunction(() => !!window.__arena.extraSession);
    await page.waitForTimeout(500);
    assert.equal(await page.locator(".scoreboard").isVisible(), false);
    assert.equal(await page.locator("#countdown").textContent(), "");
    assert.equal(await page.locator("#rings-time").textContent(), "0:00.000");
    assert.equal(
      await page.locator("#camera-mode").textContent(),
      "CAR CAMERA",
    );
    const cameraLabel = await page.locator(".camera-status").boundingBox(),
      restartButton = await page.locator("#rings-restart").boundingBox();
    assert.ok(cameraLabel.y + cameraLabel.height <= restartButton.y);
    assert.equal(
      await page.evaluate(() =>
        window.__arena.extraSession.physics.world.bodies.len(),
      ),
      1,
    );
    await page.screenshot({ path: "docs/rings-start.png" });
    const budget = await page.evaluate(() => {
      const a = window.__arena,
        session = a.extraSession,
        renderer = a.graphics.renderer;
      const reset = renderer.info.autoReset;
      renderer.info.autoReset = false;
      renderer.info.reset();
      a.graphics.render(session.scene, a.camera);
      const result = {
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        ringInstances: session.level.rings.count,
        ringTriangles: session.level.rings.geometry.index.count / 3,
      };
      renderer.info.autoReset = reset;
      renderer.info.reset();
      return result;
    });
    assert.equal(budget.ringInstances, 40);
    assert.ok(
      await page.evaluate(
        () => window.__arena.extraSession.level.clouds.count > 300,
      ),
    );
    assert.ok(
      budget.ringTriangles <= 1000 &&
        budget.calls < 400 &&
        budget.triangles < 250000,
    );
    console.log("PASS lightweight Rings rendering " + JSON.stringify(budget));
    const timer = await page.locator("#rings-hud").boundingBox();
    assert.ok(timer.x < 100 && timer.y < 60);
    await page.keyboard.press("c");
    assert.equal(
      await page.evaluate(
        () => window.__arena.extraSession.cameraControl.ballMode,
      ),
      false,
    );
    await page.keyboard.down("w");
    await page.waitForTimeout(400);
    await page.keyboard.up("w");
    assert.notEqual(
      await page.locator("#rings-time").textContent(),
      "0:00.000",
    );
    await page.keyboard.press("Escape");
    await page.locator("#rings-modal").waitFor({ state: "visible" });
    const pausedTime = await page.locator("#rings-time").textContent();
    await page.waitForTimeout(250);
    assert.equal(await page.locator("#rings-time").textContent(), pausedTime);
    await page.locator("#rings-settings").click();
    await page.locator("#settings").waitFor({ state: "visible" });
    await page.evaluate(() => document.getElementById("settings").close());
    await page.locator("#rings-modal-restart").click();
    await page.waitForTimeout(250);
    assert.equal(await page.locator("#rings-time").textContent(), "0:00.000");
    assert.equal(await page.locator("#rings-progress").textContent(), "0 / 40");
    // Use real physics to drop on the finish before completing checkpoints.
    await page.evaluate(() => {
      const s = window.__arena.extraSession,
        f = s.physics.course.finish;
      s.vehicle.reset(f.center.x, f.center.z, 0, f.center.y + 1.4);
      for (let i = 0; i < 180; i++)
        s.physics.step({
          throttle: 0,
          steer: 0,
          pitch: 0,
          yaw: 0,
          roll: 0,
          jump: false,
          boost: false,
          slide: false,
          dodgeX: 0,
          dodgeY: 0,
        });
      s.vehicle.pose.snap();
    });
    await page.waitForTimeout(150);
    assert.equal(
      await page.evaluate(() => window.__arena.extraSession.complete),
      false,
    );
    await page.locator("#rings-restart").click();
    await page.evaluate(() => {
      const s = window.__arena.extraSession,
        now = performance.now();
      s.run.start(now - 45000);
      for (let i = 0; i < 40; i++) {
        const r = s.physics.course.rings[i];
        s.run.observe(
          r.center.clone().addScaledVector(r.normal, -1),
          r.center.clone().addScaledVector(r.normal, 1),
          now,
        );
      }
      const f = s.physics.course.finish;
      s.vehicle.reset(f.center.x, f.center.z, 0, f.center.y + 1.4);
      s.vehicle.pose.snap();
    });
    await page
      .locator("#rings-title")
      .getByText("COMPLETE!", { exact: true })
      .waitFor();
    assert.equal(
      await page.locator("#rings-progress").textContent(),
      "40 / 40",
    );
    assert.equal(await page.locator("#rings-best").textContent(), "40");
    const finalTime = await page.locator("#rings-final").textContent();
    await page.waitForTimeout(200);
    assert.equal(await page.locator("#rings-final").textContent(), finalTime);
    assert.equal(
      await page.locator("#rings-best-time").textContent(),
      finalTime,
    );
    await page.screenshot({ path: "docs/rings-complete.png" });
    await page.locator("#rings-modal-restart").click();
    await page.keyboard.press("Escape");
    await page.locator("#rings-exit").click();
    assert.equal(await page.locator("#rings-ui").count(), 0);
    assert.equal(await page.evaluate(() => window.__arena.camera.far), 340);
    // Check GPU resource disposal over repeated launches without page reload.
    const geometryCounts = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.locator("#play").click();
      await page.locator("#extra-mode").click();
      await page.locator("#rings-mode").click();
      await page.waitForFunction(() => window.__arena.extraSession);
      await page.waitForTimeout(150);
      await page.evaluate(() => {
        const a = window.__arena,
          resources = new Set();
        a.resourceAudit = {
          total: 0,
          disposed: 0,
          instances: false,
          clouds: false,
        };
        const audit = a.resourceAudit;
        a.extraSession.scene.traverse((object) => {
          if (!object.geometry || !object.material) return;
          resources.add(object.geometry);
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material]) {
            resources.add(material);
            for (const value of Object.values(material))
              if (value?.isTexture) resources.add(value);
          }
        });
        audit.total = resources.size;
        resources.forEach((resource) =>
          resource.addEventListener("dispose", () => audit.disposed++),
        );
        a.extraSession.level.rings.addEventListener("dispose", () => {
          audit.instances = true;
        });
        a.extraSession.level.clouds.addEventListener("dispose", () => {
          audit.clouds = true;
        });
      });
      if (attempt === 0) {
        await page.evaluate(() => {
          const a = window.__arena,
            s = a.extraSession;
          a.courseFrame = s.frame;
          s.frame = () => {};
          a.camera.position.set(230, 300, -230);
          a.camera.lookAt(25, 10, -320);
          a.camera.fov = 90;
          a.camera.updateProjectionMatrix();
        });
        await page.waitForTimeout(100);
        await page.screenshot({ path: "docs/rings-course.png" });
        await page.evaluate(() => {
          const a = window.__arena;
          a.extraSession.frame = a.courseFrame;
          delete a.courseFrame;
          a.extraSession.cameraControl.reset();
        });
      }
      await page.keyboard.press("Escape");
      await page.locator("#rings-exit").click();
      await page.waitForTimeout(200);
      const disposed = await page.evaluate(() => {
        const audit = window.__arena.resourceAudit;
        delete window.__arena.resourceAudit;
        return audit;
      });
      assert.equal(
        disposed.disposed,
        disposed.total,
        "Rings resources were not all disposed",
      );
      assert.equal(
        disposed.instances,
        true,
        "Rings instance buffers were not disposed",
      );
      assert.equal(
        disposed.clouds,
        true,
        "Cloud instance buffers were not disposed",
      );
      geometryCounts.push(
        await page.evaluate(
          () => window.__arena.graphics.renderer.info.memory.geometries,
        ),
      );
    }
    // Overall counts also include normal arena objects newly revealed by the
    // returning camera. Check the actual Rings resource disposal above instead.
    console.log(
      "PASS repeated Rings scene disposal " + JSON.stringify(geometryCounts),
    );
    // Returning to soccer keeps its real shell, ball, training and match rules.
    await page.locator("#play").click();
    await page.locator("#freeplay-mode").click();
    await page.locator("#freeplay-launch").click();
    await page.waitForFunction(() => window.__arena.match.phase === "playing");
    assert.equal(
      await page.evaluate(() => window.__arena.simulation.ball.isEnabled()),
      true,
    );
    assert.equal(
      await page.evaluate(() => !!window.__arena.simulation.arenaCollider),
      true,
    );
    await page.keyboard.press("Escape");
    await page.locator("#pause-home").click();
    await page.locator("#play").click();
    await page.locator("#bot-mode").click();
    await page.locator("#countdown").getByText("3", { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(() =>
        window.__arena.simulation.cars[1].body.isEnabled(),
      ),
      true,
    );
    await page.keyboard.press("Escape");
    await page.locator("#pause-home").click();
    await page.locator("#leave-confirm-yes").click();
    await page.reload();
    await page.waitForFunction(() => window.__arena);
    await page.locator("#play").click();
    await page.locator("#extra-mode").click();
    await page.locator("#rings-mode").click();
    await page.waitForFunction(() => window.__arena.extraSession);
    assert.equal(await page.locator("#rings-best").textContent(), "40");
    assert.equal(
      await page.evaluate(
        () => window.__arena.extraSession.run.records.value.bestTime > 0,
      ),
      true,
    );
    await page.keyboard.press("Escape");
    await page.locator("#rings-exit").click();
    await page.setViewportSize({ width: 900, height: 600 });
    await page.locator("#play").click();
    await page.locator("#extra-mode").click();
    await page.locator("#rings-mode").waitFor({ state: "visible" });
    const card = await page.locator("#rings-mode").boundingBox();
    assert.ok(
      card.x >= 0 && card.x + card.width <= 900 && card.y + card.height < 600,
    );
    await page.screenshot({ path: "docs/rings-menu-small.png" });
    assert.deepEqual(errors, []);
    console.log(
      "PASS browser: right-hand Extra Modes/no Ranked; themed Rings launch, idle/start/pause timer, no scoreboard/kickoff/ball/bot, Car Cam, settings, restart, finish skipping, all-40 physical finish landing/results, saved records, resource teardown, Free Play/VS Bot return, responsive menu, no runtime errors",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
