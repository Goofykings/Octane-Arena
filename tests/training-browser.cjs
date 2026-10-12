const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
(async () => {
  const { startLan } = await import(
    pathToFileURL(resolve("server/dist/server/src/lan.js")).href
  );
  const { app } = await startLan(8109, ":memory:");
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      args: ["--enable-unsafe-swiftshader"],
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    context.setDefaultTimeout(30000);
    await context.addInitScript(() =>
      localStorage.setItem(
        "octane-arena-settings",
        JSON.stringify({ quality: "low" }),
      ),
    );
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:8109/?test");
    await page.waitForFunction(() => window.__arena);
    const launch = async (pack) => {
      await page.locator("#play").click();
      await page.locator("#extra-mode").click();
      await page.locator("#training-mode").click();
      await page.locator(`#training-${pack}`).click();
      await page.waitForFunction(
        (id) => window.__arena.extraSession?.pack?.id === id,
        pack,
      );
    };
    const exit = async () => {
      if (
        !(await page.evaluate(
          () =>
            window.__arena.extraSession.paused ||
            window.__arena.extraSession.complete,
        ))
      )
        await page.keyboard.press("Escape");
      await page.locator("#training-exit").click();
      await page.waitForFunction(() => !window.__arena.extraSession);
    };
    const stats = await page.evaluate(() => {
      const s = window.__arena.accounts.profile.value.stats;
      return [s.goals, s.assists, s.saves, s.shots, s.wins, s.losses];
    });
    for (const [width, height] of [
      [1920, 1080],
      [1366, 768],
      [1280, 720],
      [900, 600],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await page.locator("#play").click();
      await page.locator("#extra-mode").click();
      for (const id of ["rings-mode", "dribble-mode", "training-mode"]) {
        await page.locator(`#${id}`).waitFor({ state: "visible" });
        const b = await page.locator(`#${id}`).boundingBox();
        assert.ok(
          b &&
            b.x >= 0 &&
            b.y >= 0 &&
            b.x + b.width <= width + 1 &&
            b.y + b.height <= height,
          `${id} fits ${width}x${height}`,
        );
      }
      await page.locator("#training-mode").click();
      for (const id of ["striker", "goalie", "aerial"]) {
        await page.locator(`#training-${id}`).waitFor({ state: "visible" });
        const b = await page.locator(`#training-${id}`).boundingBox();
        assert.ok(
          b &&
            b.x >= 0 &&
            b.y >= 0 &&
            b.x + b.width <= width + 1 &&
            b.y + b.height <= height,
          `${id} fits category menu`,
        );
      }
      await page.locator("#training-back").click();
      await page.locator("#extras-back").click();
      await page.locator("#modes-back").click();
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    for (const pack of ["striker", "goalie", "aerial"]) {
      await launch(pack);
      await page.waitForFunction(() => window.__arena.extraSession.run.ready);
      const locked = await page.evaluate(() => {
        const s = window.__arena.extraSession;
        return {
          car: { ...s.vehicle.body.translation() },
          ball: { ...s.physics.ball.translation() },
        };
      });
      await page.keyboard.press("KeyC");
      await page.waitForFunction(
        () => !window.__arena.extraSession.cameraControl.ballMode,
      );
      await page.keyboard.press("KeyC");
      await page.waitForFunction(
        () => window.__arena.extraSession.cameraControl.ballMode,
      );
      await page.waitForTimeout(350);
      assert.deepEqual(
        await page.evaluate(() => {
          const s = window.__arena.extraSession;
          return {
            car: { ...s.vehicle.body.translation() },
            ball: { ...s.physics.ball.translation() },
          };
        }),
        locked,
        "Ready pose is locked while camera controls don't start the shot",
      );
      assert.equal(
        await page.evaluate(() => window.__arena.extraSession.run.elapsed),
        0,
      );
      assert.equal(await page.locator("#training-time").textContent(), "10.0");
      assert.equal(
        await page.evaluate(
          () => window.__arena.extraSession.preview.arrow.visible,
        ),
        pack !== "aerial",
      );
      await page.keyboard.down("KeyW");
      await page.waitForFunction(() => !window.__arena.extraSession.run.ready);
      await page.keyboard.up("KeyW");
      assert.equal(
        await page.evaluate(
          () => window.__arena.extraSession.preview.arrow.visible,
        ),
        false,
      );
      assert.equal(await page.locator("#countdown").textContent(), "");
      assert.equal(
        await page.locator("#training-name").textContent(),
        pack.toUpperCase(),
      );
      assert.equal(
        await page.evaluate(
          () => window.__arena.extraSession.physics.cars.length,
        ),
        1,
      );
      assert.equal(await page.locator(".scoreboard").isVisible(), false);
      assert.equal(
        await page.locator("#camera-mode").textContent(),
        "BALL CAMERA",
      );
      for (let index = 1; index < 10; index++) {
        await page.locator("#training-next").click();
        await page.waitForFunction((i) => {
          const s = window.__arena.extraSession,
            v = s.run.shot.ballVelocity;
          return (
            s.run.index === i &&
            s.preview.arrow.visible ===
              (!s.run.shot.ballFrozen && Math.hypot(v.x, v.y, v.z) > 0)
          );
        }, index);
        const preview = await page.evaluate(() => {
          const s = window.__arena.extraSession,
            arrow = s.preview.arrow,
            v = s.run.shot.ballVelocity;
          const speed = Math.hypot(v.x, v.y, v.z),
            direction = s.ball.position
              .clone()
              .set(0, 1, 0)
              .applyQuaternion(arrow.quaternion);
          return {
            visible: arrow.visible,
            expected: !s.run.shot.ballFrozen && speed > 0,
            dot:
              speed > 0
                ? (direction.x * v.x + direction.y * v.y + direction.z * v.z) /
                  speed
                : 1,
            length: arrow.cone.position.y,
            expectedLength: Math.max(1.4, Math.min(6.5, 1.4 + speed * 0.2)),
          };
        });
        assert.equal(preview.visible, preview.expected);
        assert.ok(
          preview.dot > 0.999999 &&
            Math.abs(preview.length - preview.expectedLength) < 1e-6,
          "Rendered arrow matches real launch velocity and speed",
        );
      }
      await page.waitForFunction(
        () => document.getElementById("training-next").disabled,
      );
      assert.equal(await page.locator("#training-next").isDisabled(), true);
      assert.equal(
        await page.locator("#training-shot").textContent(),
        "SHOT 10 / 10",
      );
      await page.keyboard.press("BracketLeft");
      await page.waitForFunction(
        () => window.__arena.extraSession.run.index === 8,
      );
      await page.keyboard.press("BracketRight");
      await page.waitForFunction(
        () => window.__arena.extraSession.run.index === 9,
      );
      const seq = await page.evaluate(
        () => window.__arena.extraSession.resetSequence,
      );
      await page.locator("#training-reset").click();
      await page.waitForFunction(
        (i) => window.__arena.extraSession.resetSequence > i,
        seq,
      );
      if (pack === "aerial") {
        await page.evaluate(() => window.__arena.extraSession.navigate(-9));
        const before = await page.evaluate(() => ({
          ...window.__arena.extraSession.physics.ball.translation(),
        }));
        await page.waitForTimeout(800);
        const after = await page.evaluate(() => ({
          ...window.__arena.extraSession.physics.ball.translation(),
        }));
        assert.deepEqual(after, before);
        await page.keyboard.press("KeyC");
        await page.waitForFunction(
          () => !window.__arena.extraSession.cameraControl.ballMode,
        );
        await page.keyboard.down("KeyB");
        await page.waitForFunction(
          () => window.__arena.extraSession.cameraControl.reverseHeld,
        );
        await page.keyboard.up("KeyB");
        await page.mouse.move(820, 300);
        await page.mouse.down();
        await page.mouse.move(1010, 260, { steps: 8 });
        await page.waitForFunction(
          () => Math.abs(window.__arena.mouseLook.yaw) > 0.1,
        );
        await page.mouse.up();
        await page.waitForFunction(() => !window.__arena.mouseLook.active);
        await page.keyboard.press("KeyC");
        await page.screenshot({ path: "docs/training-aerial.png" });
      }
      await exit();
    }
    await launch("goalie");
    await page.keyboard.down("KeyW");
    await page.waitForFunction(() => !window.__arena.extraSession.run.ready);
    await page.keyboard.up("KeyW");
    await page.evaluate(() => {
      const s = window.__arena.extraSession,
        b = s.physics.ball.translation();
      s.vehicle.reset(b.x, b.z + 2.5, 0, b.y);
      s.vehicle.body.setLinvel({ x: 0, y: 0, z: -10 }, true);
    });
    await page.waitForFunction(
      () => window.__arena.extraSession.run.saveDelay > 0.25,
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.__arena.extraSession.physics.ball.isEnabled() &&
          !window.__arena.extraSession.run.outcome,
      ),
      true,
      "Saved ball keeps moving before delayed completion",
    );
    await page.waitForFunction(
      () => window.__arena.extraSession.run.ballBurstSequence === 1,
    );
    assert.equal(
      await page.evaluate(
        () =>
          !window.__arena.extraSession.ball.visible &&
          window.__arena.extraSession.scene.children.some(
            (o) => Math.abs(o.scale.x - 0.18) < 1e-8 && o.visible,
          ),
      ),
      true,
      "Ball disappears with a small visible explosion",
    );
    await exit();
    await launch("aerial");
    await page.keyboard.down("KeyW");
    await page.waitForFunction(() => !window.__arena.extraSession.run.ready);
    await page.keyboard.up("KeyW");
    await page.evaluate(() => {
      const s = window.__arena.extraSession;
      s.run.frozen = false;
      s.physics.ball.setGravityScale(1, true);
      s.physics.ball.setTranslation({ x: 0, y: 2, z: -52.1 }, true);
      s.physics.ball.setLinvel({ x: 0, y: 0, z: -20 }, true);
    });
    await page.locator("#goal-replay").waitFor({ state: "visible" });
    await page.keyboard.press("Space");
    await page.waitForFunction(
      () => window.__arena.extraSession.run.index === 1,
    );
    assert.ok(await page.evaluate(() => window.__arena.extraSession.run.ready));
    await exit();
    await launch("striker");
    await page.evaluate(() => {
      const audio = window.__arena.audio,
        original = audio.tone.bind(audio);
      window.__trainingTones = [];
      audio.tone = (...args) => {
        window.__trainingTones.push(args);
        return original(...args);
      };
    });
    await page.evaluate(() => {
      const s = window.__arena.extraSession;
      s.run.results.fill(true);
      s.run.index = 9;
      s.run.reset();
      if (s.run.ready)
        s.run.step({ ...window.__arena.input.sample(), steer: 0.1 });
      s.physics.ball.setTranslation({ x: 0, y: 2, z: -52.1 }, true);
      s.physics.ball.setLinvel({ x: 0, y: 0, z: -20 }, true);
    });
    await page.waitForFunction(
      () =>
        document.getElementById("training-message").textContent === "SUCCESS",
    );
    await page.locator("#goal-replay").waitFor({ state: "visible" });
    assert.equal(
      await page.evaluate(() => window.__arena.extraSession.run.index),
      9,
    );
    assert.equal(
      await page.evaluate(() => window.__arena.extraSession.run.ready),
      false,
    );
    const physical = await page.evaluate(() => {
      const s = window.__arena.extraSession.physics;
      return {
        ball: { ...s.ball.translation() },
        car: { ...s.cars[0].body.translation() },
        clock: s.clock,
      };
    });
    await page.waitForTimeout(100);
    assert.deepEqual(
      await page.evaluate(() => {
        const s = window.__arena.extraSession.physics;
        return {
          ball: { ...s.ball.translation() },
          car: { ...s.cars[0].body.translation() },
          clock: s.clock,
        };
      }),
      physical,
      "Replay is visual only",
    );
    await page.locator("#replay-skip-button").click();
    await page.waitForFunction(() => window.__arena.extraSession.complete);
    await page.waitForFunction(
      () =>
        document.getElementById("training-title").textContent ===
        "TRAINING COMPLETE",
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.__trainingTones.filter((x) => x[0] === 740 && x[4] === "sfx")
            .length,
      ),
      1,
      "Success plays once on the existing SFX bus",
    );
    assert.equal(
      await page.locator("#training-title").textContent(),
      "TRAINING COMPLETE",
    );
    assert.equal(
      await page.locator("#training-result").textContent(),
      "10 / 10",
    );
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("octane-arena-training-striker"),
      ),
      "10",
    );
    await page.locator("#training-retry").click();
    await page.waitForFunction(() => !window.__arena.extraSession.complete);
    await page.evaluate(() => {
      const r = window.__arena.extraSession.run;
      if (r.ready) r.step({ ...window.__arena.input.sample(), steer: 0.1 });
      r.elapsed = r.duration;
    });
    await page.waitForFunction(
      () =>
        document.getElementById("training-message").textContent === "FAILED",
    );
    await exit();
    assert.deepEqual(
      await page.evaluate(
        () =>
          window.__trainingTones.filter((x) => x[0] === 220 && x[4] === "sfx")
            .length,
      ),
      1,
      "Failure plays a distinct single tone",
    );
    assert.deepEqual(
      await page.evaluate(() => {
        const s = window.__arena.accounts.profile.value.stats;
        return [s.goals, s.assists, s.saves, s.shots, s.wins, s.losses];
      }),
      stats,
      "Practice does not award competitive stats",
    );
    await page.locator("#play").click();
    await page.locator("#extra-mode").click();
    await page.locator("#training-mode").click();
    await page.locator("#training-menu").waitFor({ state: "visible" });
    await page.waitForTimeout(400);
    await page.screenshot({ path: "docs/training-packs-menu.png" });
    await page.locator("#training-back").click();
    await page.locator("#extras-back").click();
    await page.locator("#modes-back").click();
    await page.evaluate(() =>
      window.__arena.accounts.profile.completeChallengeLevel("dribble", 11, 20),
    );
    // Use the existing navigation/checkpoint API to inspect the new spinner.
    await page.locator("#play").click();
    await page.locator("#extra-mode").click();
    await page.locator("#dribble-mode").click();
    await page.evaluate(() => {
      const s = window.__arena.extraSession;
      s.run.profile.value.challenges.dribble = 11;
      s.run.select(9);
      s.navigate(0);
    });
    await page.waitForFunction(
      () => window.__arena.extraSession.run.level === 9,
    );
    await page.waitForTimeout(500);
    assert.equal(
      await page.evaluate(() => {
        const s = window.__arena.extraSession;
        const mesh = s.scene.getObjectByName("dribble-spinner-0");
        const q = s.physics.spinners[0].body.rotation();
        return (
          Math.abs(mesh.quaternion.x - q.x) +
            Math.abs(mesh.quaternion.y - q.y) +
            Math.abs(mesh.quaternion.z - q.z) +
            Math.abs(mesh.quaternion.w - q.w) <
          0.00001
        );
      }),
      true,
    );
    await page.screenshot({ path: "docs/dribble-spinner.png" });
    assert.deepEqual(errors, []);
    console.log(
      "PASS production Training categories/30-shot navigation, resets, results/persistence, Ball Cam/reverse/mouse look, failure/success HUD, competitive stats isolation, responsive 3-card menus and live spinner/collider sync",
    );
  } finally {
    if (browser) await browser.close();
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
