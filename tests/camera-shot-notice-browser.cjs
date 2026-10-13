const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict"),
  { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8240);
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
    page.setDefaultTimeout(45000);
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
    await page.waitForFunction(
      () =>
        window.__arena.match.stats &&
        window.__arena.match.phase === "countdown",
    );
    const frames = () =>
      page.evaluate(
        () =>
          new Promise((resolve) => {
            let n = 3;
            const tick = () => (--n ? requestAnimationFrame(tick) : resolve());
            requestAnimationFrame(tick);
          }),
      );
    await page.evaluate(() => {
      const a = window.__arena;
      a.match.countdown = 1000;
      a.simulation.cars.slice(1).forEach((c) => c.body.setEnabled(false));
      a.simulation.cars[0].reset(0, 0, 0);
      a.simulation.ball.setTranslation({ x: 12, y: 5, z: -14 }, true);
      a.simulation.ballPose.snap();
      a.cameraControl.reset();
    });
    await frames();
    // Hold the automatic scene time stationary to isolate mouse movement from ordinary tracking.
    await page.evaluate(() => {
      const rig = window.__arena.cameraControl;
      window.originalUpdate = rig.update.bind(rig);
      rig.update = (car, ball, sim, dt, home, time, goal) =>
        window.originalUpdate(car, ball, sim, 0, home, time, goal);
    });
    for (const ballMode of [true, false]) {
      await page.evaluate((value) => {
        window.__arena.cameraControl.ballMode = value;
        window.__arena.cameraControl.reset();
        window.__arena.mouseLook.reset();
      }, ballMode);
      await frames();
      const points = [
        [640, 360],
        [1, 360],
        [1278, 360],
        [640, 1],
        [640, 718],
        [1, 1],
        [1278, 1],
        [1, 718],
        [1278, 718],
      ];
      for (const [x, y] of points) {
        await page.evaluate(() => window.__arena.mouseLook.reset());
        await frames();
        await page.mouse.move(x, y);
        await frames();
        const before = await page.evaluate(() => ({
          position: window.__arena.camera.position.toArray(),
          rotation: window.__arena.camera.quaternion.toArray(),
          fov: window.__arena.camera.fov,
        }));
        await page.mouse.down();
        assert.equal(
          await page.evaluate(() => window.__arena.mouseLook.dragging),
          true,
          "Drag accepted at " + x + "," + y,
        );
        await frames();
        const after = await page.evaluate(() => ({
          position: window.__arena.camera.position.toArray(),
          rotation: window.__arena.camera.quaternion.toArray(),
          fov: window.__arena.camera.fov,
        }));
        assert.ok(
          Math.hypot(...before.position.map((v, i) => v - after.position[i])) <
            1e-8,
          "Click without moving preserves position",
        );
        assert.ok(
          Math.hypot(...before.rotation.map((v, i) => v - after.rotation[i])) <
            1e-8,
          "Click without moving preserves framed orientation",
        );
        assert.equal(after.fov, before.fov);
        const dx = x > 640 ? -2 : 2,
          dy = y > 360 ? -2 : 2;
        await page.mouse.move(x + dx, y + dy);
        await frames();
        const result = await page.evaluate(() => ({
          yaw: window.__arena.mouseLook.targetYaw,
          pitch: window.__arena.mouseLook.targetPitch,
          rotation: window.__arena.camera.quaternion.toArray(),
        }));
        assert.ok(Math.sign(result.yaw) === Math.sign(dx));
        assert.ok(
          Math.abs(result.yaw) < 0.01 && Math.abs(result.pitch) < 0.01,
          "Relative delta independent of absolute click position",
        );
        assert.ok(
          Math.hypot(...after.rotation.map((v, i) => v - result.rotation[i])) <
            0.02,
          "First tiny movement has no aim jump",
        );
        await page.mouse.up();
        await page.waitForFunction(() => !window.__arena.mouseLook.active);
      }
    }
    await page.evaluate(
      () => (window.__arena.cameraControl.update = window.originalUpdate),
    );
    console.log(
      "PASS actual center/four edges/four corners: click-only preserves rendered camera exactly, tiny relative drag is smooth in Ball Cam and Car Cam, release returns",
    );
    // Authoritative events feed the ordinary overlay; animation is a display only.
    await page.evaluate(() => {
      const a = window.__arena,
        s = a.simulation;
      a.match.stats.touch(
        {
          playerId: s.cars[0].id,
          before: {
            position: { x: 0, y: 2, z: 0 },
            velocity: { x: 0, y: 0, z: 0 },
            heat: null,
          },
          after: {
            position: { x: 0, y: 2, z: -35 },
            velocity: { x: 0, y: 0, z: -25 },
            heat: null,
          },
        },
        s,
      );
    });
    await page.waitForFunction(
      () =>
        !document.querySelector("#match-award").hidden &&
        document.querySelector("#match-award strong")?.textContent ===
          "SHOT ON GOAL",
    );
    const timing = await page.evaluate(() => {
      const el = document.querySelector("#match-award"),
        anim = el.getAnimations()[0];
      window.firstNotice = anim;
      anim.pause();
      anim.currentTime = 200;
      const keys = anim.effect.getKeyframes(),
        t = anim.effect.getTiming();
      return {
        duration: t.duration,
        easing: t.easing,
        hold: (keys[2].offset - keys[1].offset) * t.duration,
      };
    });
    assert.equal(timing.duration, 1400);
    assert.equal(timing.easing, "linear");
    assert.ok(Math.abs(timing.hold - 1000) < 1e-8);
    for (const time of [200, 500, 900, 1199]) {
      await page.evaluate(
        (time) => (window.firstNotice.currentTime = time),
        time,
      );
      await frames();
      const style = await page.locator("#match-award").evaluate((e) => ({
        opacity: getComputedStyle(e).opacity,
        transform: getComputedStyle(e).transform,
      }));
      assert.equal(style.opacity, "1");
      assert.match(
        style.transform,
        /, 0\)$/,
        "Stationary readable hold lasts the full second",
      );
    }
    await page.evaluate(() => {
      const a = window.__arena;
      a.match.stats.goal(
        {
          id: "notification-real-goal",
          scorerId: a.simulation.cars[0].id,
          team: 0,
          ownGoal: false,
        },
        a.simulation.clock,
      );
    });
    await frames();
    assert.equal(
      await page.locator("#match-award strong").textContent(),
      "SHOT ON GOAL",
      "Goal cannot truncate shot notice",
    );
    assert.equal(
      await page.evaluate(
        () =>
          document.querySelector("#match-award").getAnimations()[0] ===
          window.firstNotice,
      ),
      true,
    );
    const totals = await page.evaluate(() =>
      window.__arena.match.stats.snapshot(),
    );
    const extra = [
      "SAVE",
      "ASSIST",
      "SHOT",
      "GOAL",
      "SAVE",
      "ASSIST",
      "SHOT",
      "GOAL",
      "SAVE",
      "ASSIST",
    ];
    await page.evaluate((types) => {
      const a = window.__arena,
        events = a.match.stats.events;
      let id = events.at(-1).id;
      for (const type of types)
        events.push({
          id: ++id,
          type,
          playerId: a.simulation.cars[0].id,
          team: 0,
          scoreAward: type === "GOAL" ? 100 : type === "SHOT" ? 10 : 50,
          timestamp: a.simulation.clock,
        });
    }, extra);
    await frames();
    for (const expected of ["GOAL", ...extra]) {
      await page
        .locator("#match-award")
        .evaluate((e) => e.getAnimations()[0].finish());
      await page.waitForFunction(
        (expected) =>
          !document.querySelector("#match-award").hidden &&
          document.querySelector("#match-award strong")?.textContent ===
            (expected === "SHOT" ? "SHOT ON GOAL" : expected),
        expected,
      );
      assert.equal(
        await page
          .locator("#match-award")
          .evaluate((e) => e.getAnimations()[0].effect.getTiming().duration),
        1400,
      );
    }
    await page
      .locator("#match-award")
      .evaluate((e) => e.getAnimations()[0].finish());
    await page.waitForFunction(
      () => document.querySelector("#match-award").hidden,
    );
    assert.deepEqual(
      await page.evaluate(() => window.__arena.match.stats.snapshot()),
      totals,
      "Notifications never award stats or duplicate ledger events",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS real Web Animations: 200ms enter + full 1000ms stationary hold + 200ms exit; goal does not truncate shot, all 11 queued notifications retain order/lifetime, repeated snapshots do not duplicate and UI never changes stats",
    );
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
