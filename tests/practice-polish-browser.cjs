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
    fs.readFile(file, (error, data) => {
      if (error) {
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
  await new Promise((r) => server.listen(4186, "127.0.0.1", r));
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
    await page.goto("http://127.0.0.1:4186/?test");
    await page.waitForFunction(() => window.__arena);
    await page.locator("#play").click();
    await page.locator("#freeplay-mode").click();
    await page.evaluate(() => {
      const a = window.__arena;
      a.qaStep = a.simulation.step.bind(a.simulation);
      a.simulation.step = () => {};
    });
    const order = [
      "left-diagonal",
      "right-diagonal",
      "back-left",
      "back-right",
      "far-back-center",
    ];
    for (let i = 0; i < 11; i++) {
      assert.equal(
        await page.evaluate(() => window.__arena.match.kickoffFormationId),
        order[i % 5],
      );
      assert.equal(await page.locator("#countdown").textContent(), "");
      const sequence = await page.evaluate(
        () => window.__arena.match.resetSequence,
      );
      await page.keyboard.press("1");
      await page.waitForFunction(
        (seq) => window.__arena.match.resetSequence > seq,
        sequence,
      );
    }
    console.log(
      "PASS real keyboard Free Play reset cycles all shared positions and repeats without countdown",
    );
    for (const delay of [0, 300, 900]) {
      await page.evaluate(() =>
        window.__arena.simulation.ball.setTranslation(
          { x: 0, y: 1, z: -53 },
          true,
        ),
      );
      await page.waitForFunction(
        () =>
          window.__arena.match.phase === "goal" &&
          window.__arena.explosion.group.visible,
      );
      if (delay) await page.waitForTimeout(delay);
      const sequence = await page.evaluate(
        () => window.__arena.match.resetSequence,
      );
      await page.keyboard.press("1");
      await page.waitForFunction(
        (seq) => window.__arena.match.resetSequence > seq,
        sequence,
      );
      const reset = await page.evaluate(() => {
        const a = window.__arena;
        return {
          phase: a.match.phase,
          freeze: a.match.freeze,
          focus: a.match.goalFocus,
          explosion: a.explosion.group.visible,
          particles: Array.from(a.effects.life).some((l) => l > 0.9),
          countdown: a.match.countdown,
        };
      });
      assert.deepEqual(reset, {
        phase: "playing",
        freeze: 0,
        focus: null,
        explosion: false,
        particles: false,
        countdown: 0,
      });
    }
    console.log(
      "PASS reset interrupts early/late goal explosion and clears long-lived particles, timers and camera focus",
    );
    await page.evaluate(
      () => (window.__arena.simulation.step = window.__arena.qaStep),
    );
    await page.keyboard.press("Escape");
    await page.locator("#pause-home").click();
    await page.locator("#play").click();
    await page.locator("#bot-mode").click();
    await page.waitForFunction(() => window.__arena.match.phase === "playing");
    await page.keyboard.press("Escape");
    await page.locator("#pause-home").click();
    await page.waitForFunction(
      () => document.querySelector("#leave-confirm").open,
    );
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((a) => Number.isFinite(a.effect?.getTiming().iterations))
          .map((a) => a.finished.catch(() => {})),
      ),
    );
    const panel = await page.locator("#leave-confirm").boundingBox();
    await page.screenshot({ path: "docs/leave-confirm-small.png" });
    assert.ok(
      panel.width <= 460 && panel.height < 260,
      `leave panel must be compact: ${JSON.stringify(panel)}`,
    );
    assert.ok(
      Math.abs(panel.x + panel.width / 2 - 640) < 3 &&
        Math.abs(panel.y + panel.height / 2 - 360) < 3,
      "leave panel centered",
    );
    const clock = await page.evaluate(() => window.__arena.simulation.clock);
    await page.waitForTimeout(350);
    assert.equal(
      await page.evaluate(() => window.__arena.simulation.clock),
      clock,
    );
    await page.screenshot({ path: "docs/leave-confirm-small.png" });
    await page.locator("#leave-confirm-stay").click();
    await page.waitForFunction(() => window.__arena.match.phase === "playing");
    console.log(
      "PASS compact centered Leave Match card, dimmed backdrop, paused physics and working STAY button",
    );
    await page.keyboard.press("Escape");
    await page.locator("#pause-home").click();
    await page.locator("#leave-confirm-yes").click();
    await page.waitForFunction(() => window.__arena.match.phase === "home");
    await page.locator("#play").click();
    await page.locator("#freeplay-mode").click();
    await page.evaluate(() => {
      const a = window.__arena,
        s = a.simulation,
        c = s.cars[0];
      s.step = () => {};
      s.ball.setTranslation({ x: 0, y: 0.93, z: 12 }, true);
      c.reset(0, 0, 0);
      for (let i = 0; i < 60; i++)
        a.qaStep([
          {
            throttle: 0,
            steer: 0,
            pitch: 0,
            yaw: 0,
            roll: 0,
            boost: false,
            jump: false,
            slide: false,
          },
          {},
        ]);
      a.cameraControl.update = () => {};
      a.camera.position.set(2, 1.5, 3);
      a.camera.lookAt(0, 0.6, 0);
      a.camera.updateMatrixWorld(true);
    });
    const prior = await page.evaluate(
      () => window.__arena.jumpBursts[0].triggers,
    );
    await page.evaluate(() => {
      const a = window.__arena;
      a.qaStep([
        {
          throttle: 0,
          steer: 0,
          pitch: 0,
          yaw: 0,
          roll: 0,
          boost: false,
          jump: true,
          slide: false,
        },
        {},
      ]);
    });
    await page.waitForFunction(
      (t) => window.__arena.jumpBursts[0].triggers === t + 1,
      prior,
    );
    await page.evaluate(() => {
      const a = window.__arena;
      a.jumpBursts[0].update = () => {};
      for (let i = 0; i < 8; i++)
        a.qaStep([
          {
            throttle: 0,
            steer: 0,
            pitch: 0,
            yaw: 0,
            roll: 0,
            boost: false,
            jump: false,
            slide: false,
          },
          {},
        ]);
    });
    await page.screenshot({ path: "docs/normal-jump-burst.png" });
    assert.ok(
      await page.evaluate(() => window.__arena.jumpBursts[0].ring.visible),
    );
    console.log("PASS normal jump event renders its small white burst");
    await page.evaluate(() => {
      const a = window.__arena,
        s = a.simulation,
        c = s.cars[0];
      c.body.setEnabled(false);
      a.cameraControl.update = () => {};
      a.camera.position.set(0, 3.5, -33);
      a.camera.lookAt(0, 2, -51.2);
      a.camera.updateMatrixWorld(true);
      s.ball.setTranslation({ x: 0, y: 0.93, z: 0 }, true);
      a.jumpBursts[0].reset();
    });
    await page.waitForTimeout(100);
    await page.screenshot({ path: "docs/goal-front-clean.png" });
    await page.keyboard.press("Escape");
    await page.locator("#pause-home").click();
    await page.waitForFunction(() => window.__arena.match.phase === "home");
    assert.deepEqual(errors, []);
    console.log(
      "PASS LEAVE MATCH button returns home; no browser runtime errors",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
