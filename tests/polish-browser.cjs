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
            : "text/html",
      );
      res.end(data);
    });
  });
  await new Promise((r) => server.listen(4182, "127.0.0.1", r));
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
    const check = (ok, message) => {
      assert.ok(ok, message);
      console.log("PASS " + message);
    };
    await page.goto("http://127.0.0.1:4182/?test");
    await page.waitForFunction(() => window.__arena);
    const fits = async (selector) =>
      page.locator(selector).evaluateAll((elements) =>
        elements
          .filter((e) => !e.hidden && e.getBoundingClientRect().width > 0)
          .every((e) => {
            const r = e.getBoundingClientRect();
            return (
              r.x >= 0 &&
              r.y >= 0 &&
              r.right <= innerWidth + 1 &&
              r.bottom <= innerHeight + 1
            );
          }),
      );
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
      await page.waitForTimeout(100);
      check(
        await fits("#play,#garage-open,#settings-open,#profile"),
        `home fits ${width}x${height}`,
      );
      await page.locator("#play").click();
      check(
        await fits(".mode-card,#modes-back"),
        `modes fit ${width}x${height}`,
      );
      await page.locator("#modes-back").click();
      await page.locator("#garage-open").click();
      check(
        await fits("#customize-car,#new-preset,#garage-back"),
        `garage fits ${width}x${height}`,
      );
      await page.locator("#customize-car").click();
      await page.locator('[data-category="paint"]').click();
      const layout = await page.evaluate(() => {
        const p = document
            .querySelector(".garage-left")
            .getBoundingClientRect(),
          b = document
            .querySelector("#garage-screen .screen-footer")
            .getBoundingClientRect();
        return p.bottom + 4 <= b.top;
      });
      if (
        !layout ||
        !(await fits(".category-tabs button,#garage-back,#team-preview"))
      ) {
        console.log(
          await page.evaluate(() =>
            [
              ".garage-left",
              ".screen-footer",
              "#garage-back",
              "#team-preview",
              ".category-tabs",
            ].map((s) => ({
              selector: s,
              rect: document.querySelector(s).getBoundingClientRect().toJSON(),
            })),
          ),
        );
        await page.screenshot({ path: "docs/layout-failure.png" });
      }
      check(
        layout &&
          (await fits(".category-tabs button,#garage-back,#team-preview")),
        `paint stays above clickable footer ${width}x${height}`,
      );
      await page.locator(".swatch").last().scrollIntoViewIfNeeded();
      await page.locator(".swatch").last().click();
      if (width === 1280 || width === 390)
        await page.screenshot({ path: `docs/paint-${width}.png` });
      await page.locator("#garage-back").click();
      await page.locator("#garage-back").click();
      await page.locator("#settings-open").click();
      check(
        await fits(".settings-tabs button,#close-settings"),
        `settings tabs fit ${width}x${height}`,
      );
      await page.locator('[data-tab="controls"]').click();
      await page.locator("[data-action]").last().scrollIntoViewIfNeeded();
      await page.locator("#close-settings").click();
      await page.locator("#profile").click();
      check(
        await fits("#account .dialog-heading"),
        `account fits ${width}x${height}`,
      );
      await page.keyboard.press("Escape");
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.locator("#garage-open").click();
    await page.locator("#customize-car").click();
    for (let i = 0; i < 5; i++) {
      await page.mouse.move(1050, 350);
      await page.mouse.down();
      await page.mouse.move(1200, 350);
      await page.mouse.up();
      check(
        await page.evaluate(() => !window.__arena.preview.dragging),
        "garage normal drag releases",
      );
    }
    await page.mouse.move(1000, 350);
    await page.mouse.down();
    await page.mouse.move(5, 5);
    await page.mouse.up();
    check(
      await page.evaluate(
        () =>
          !window.__arena.preview.dragging &&
          window.__arena.cameraDrag.pointer === null,
      ),
      "release outside preview clears capture",
    );
    await page.mouse.move(1000, 350);
    await page.mouse.down();
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.mouse.up();
    check(
      await page.evaluate(() => !window.__arena.preview.dragging),
      "window focus loss clears drag",
    );
    await page.mouse.move(1000, 350);
    await page.mouse.down();
    await page.evaluate(() =>
      document.querySelector('[data-category="paint"]').click(),
    );
    await page.mouse.up();
    check(
      await page.evaluate(() => !window.__arena.preview.dragging),
      "category replacement clears drag",
    );
    await page.mouse.move(1000, 350);
    await page.mouse.down();
    await page.evaluate(() => {
      const p = window.__arena.cameraDrag;
      document.querySelector("#app").releasePointerCapture(p.pointer);
    });
    await page.waitForTimeout(80);
    await page.mouse.up();
    check(
      await page.evaluate(() => !window.__arena.preview.dragging),
      "lost pointer capture clears drag",
    );
    const touch = await page.context().newCDPSession(page);
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: 1000, y: 350 }],
    });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: 1100, y: 350 }],
    });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    check(
      await page.evaluate(() => !window.__arena.preview.dragging),
      "touch drag terminates cleanly",
    );
    await page.locator('[data-category="boost"]').click();
    await page.locator('[data-item="ember"]').click();
    await page.waitForTimeout(200);
    check(
      await page.evaluate(
        () =>
          window.__arena.preview.boostEffects.flames.visible &&
          window.__arena.preview.boostEffects.glow.intensity > 0,
      ),
      "selected boost previews continuously with light",
    );
    await page.screenshot({ path: "docs/garage-boost-preview.png" });
    await page.locator('[data-category="explosion"]').click();
    await page.waitForTimeout(200);
    check(
      await page.evaluate(
        () =>
          window.__arena.preview.renderScene ===
            window.__arena.preview.goalScene &&
          window.__arena.preview.previewAge === -1,
      ),
      "goal preview waits for item click",
    );
    for (let i = 0; i < 2; i++) {
      await page.locator('[data-item="pulse"]').click();
      await page.waitForFunction(() => window.__arena.preview.exploded);
      if (i === 0)
        await page.screenshot({ path: "docs/garage-goal-preview.png" });
      await page.waitForFunction(
        () => window.__arena.preview.previewAge === -1,
      );
      await page.waitForTimeout(200);
      check(
        await page.evaluate(() => window.__arena.preview.previewAge === -1),
        "one click plays one goal explosion; no loop",
      );
    }
    await page.locator("#garage-back").click();
    await page.locator("#garage-back").click();
    await page.locator("#play").click();
    await page.locator("#bot-mode").click();
    check(
      await page.evaluate(() =>
        window.__arena.simulation.cars.every((c) => c.boost === 33),
      ),
      "bot kickoff starts both players at 33 boost",
    );
    check(
      await page.evaluate(
        () =>
          Number(
            getComputedStyle(document.querySelector("#countdown")).zIndex,
          ) >
          Number(getComputedStyle(document.querySelector("#bot-tag")).zIndex),
      ),
      "countdown layer is above nametags",
    );
    await page.keyboard.press("Escape");
    check(
      await page.locator("#pause-reset").isHidden(),
      "bot pause has no reset control",
    );
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
      check(await fits("#pause .nav-button"), `pause fits ${width}x${height}`);
      await page.evaluate(() => (window.__arena.match.phase = "finished"));
      await page.waitForTimeout(80);
      check(await fits("#again,#home"), `post-game fits ${width}x${height}`);
      await page.evaluate(() => (window.__arena.match.phase = "paused"));
      await page.waitForTimeout(80);
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.locator("#resume").click();
    await page.waitForFunction(() => window.__arena.match.phase === "playing");
    const resetSeq = await page.evaluate(
      () => window.__arena.match.resetSequence,
    );
    await page.keyboard.press("r");
    await page.keyboard.press("1");
    await page.waitForTimeout(100);
    check(
      (await page.evaluate(() => window.__arena.match.resetSequence)) ===
        resetSeq,
      "match rejects legacy and training reset keys",
    );
    await page.evaluate(() => {
      const s = window.__arena.simulation;
      s.cars[0].reset(0, 3, 0);
      s.cars[1].reset(0, 0, Math.PI);
      s.cars[0].body.setLinvel({ x: 0, y: 0, z: -23 }, true);
      s.ball.setTranslation({ x: 15, y: 1, z: 0 }, true);
    });
    await page.waitForFunction(
      () => window.__arena.simulation.cars[1].demolitionState === "demolished",
    );
    check(
      await page.evaluate(() => !window.__arena.visuals[1].parent.visible),
      "demolished opponent is hidden",
    );
    await page.screenshot({ path: "docs/demolition.png" });
    await page.waitForFunction(
      () => window.__arena.simulation.cars[1].demolitionState === "active",
    );
    check(true, "opponent respawns and re-enters gameplay");
    await page.keyboard.press("Escape");
    await page.locator("#pause-home").click();
    if (await page.locator("#leave-confirm").evaluate((d) => d.open))
      await page.locator("#leave-confirm-yes").click();
    await page.locator("#play").click();
    await page.locator("#freeplay-mode").click();
    await page.locator("#freeplay-launch").click();
    await page.evaluate(() => {
      const c = window.__arena.simulation.cars[0];
      c.reset(0, 10, 0);
      c.body.setLinvel({ x: 12, y: 0, z: -14 }, true);
    });
    await page.keyboard.down("ControlLeft");
    await page.waitForFunction(
      () => window.__arena.audio.skidGain.gain.value > 0.005,
    );
    check(true, "actual powerslide slip activates tire audio");
    check(
      await page.evaluate(() => window.__arena.skidMarks[0].cursor > 0),
      "rear skid mark pool receives contact segments",
    );
    await page.screenshot({ path: "docs/skid-marks.png" });
    await page.keyboard.up("ControlLeft");
    await page.waitForFunction(
      () => window.__arena.audio.skidGain.gain.value < 0.001,
    );
    check(true, "tire audio fades after release");
    await page.keyboard.down("ControlLeft");
    await page.keyboard.press("Space");
    await page.waitForTimeout(180);
    check(
      await page.evaluate(
        () => window.__arena.simulation.cars[0].skidIntensity === 0,
      ),
      "airborne car has no skid emission",
    );
    await page.keyboard.up("ControlLeft");
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
      check(
        await fits(".boost-hud,.camera-status"),
        `Free Play HUD fits ${width}x${height}`,
      );
      check(
        await page.locator(".scoreboard").isHidden(),
        "training scoreboard remains hidden",
      );
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => {
      const a = window.__arena,
        s = a.simulation;
      s.step = () => {};
      a.cameraControl.update = () => {
        a.camera.position.set(3, 3, -46);
        a.camera.lookAt(0, 1.5, -51.2);
        a.camera.updateProjectionMatrix();
      };
      s.ball.setTranslation({ x: 0, y: 1.5, z: -51.2 }, true);
      s.ballPose.snap();
    });
    await page.waitForTimeout(200);
    check(
      await page.evaluate(() => window.__arena.goalPlanes.rings[0].visible),
      "ball at goal plane has a visible intersection ring",
    );
    check(
      await page.evaluate(() => window.__arena.match.phase === "playing"),
      "ball center crossing does not score",
    );
    await page.screenshot({ path: "docs/goal-plane-intersection.png" });
    await page.evaluate(() => {
      const s = window.__arena.simulation;
      s.ball.setTranslation({ x: 0, y: 1.5, z: -49 }, true);
      s.ballPose.snap();
    });
    await page.waitForTimeout(120);
    check(
      await page.evaluate(() =>
        window.__arena.goalPlanes.rings.every((r) => !r.visible),
      ),
      "ball outside goal has no intersection ring",
    );
    check(
      errors.length === 0,
      "no browser runtime errors: " + errors.join("; "),
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
