const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright"),
  assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8203);
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
    context.setDefaultTimeout(45000);
    await context.addInitScript(() =>
      localStorage.setItem(
        "octane-arena-settings",
        JSON.stringify({ quality: "low" }),
      ),
    );
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(server.url);
    await page.waitForFunction(() => window.__arena);
    await page.locator("#play").click();
    const background = async (id) => {
      await page.locator(id).hover();
      await page.waitForTimeout(250);
      return page.locator(id).evaluate((e) => ({
        background: getComputedStyle(e).backgroundImage,
        transform: getComputedStyle(e).transform,
      }));
    };
    const bot = await background("#bot-mode"),
      extra = await background("#extra-mode");
    assert.deepEqual(
      extra,
      bot,
      "Extra Modes uses the exact shared hover style",
    );
    await page.locator("#extra-mode").click();
    await page.locator("#dribble-mode").click();
    await page.waitForFunction(
      () => window.__arena.extraSession?.id === "dribble",
    );
    const shoot = async (which) => {
      await page.evaluate((which) => {
        const a = window.__arena,
          s = a.extraSession;
        s.reset();
        const p = s.physics,
          g = p.finishGoal,
          f = g.finish;
        const at = (x, y, z) =>
          g.parts[0].center
            .clone()
            .set(x, y, z)
            .applyQuaternion(g.rotation)
            .add(f.center);
        const cp = at(0, 0.34, 5);
        p.car.reset(cp.x, cp.z, -f.heading, cp.y);
        const part = g.parts.find((x) => x.name === which);
        const bp = part
          ? at(part.center.x, which === "crossbar" ? part.center.y : 3, 2)
          : at(0, 3, 0.1);
        p.ball.setTranslation(bp, true);
        p.ball.setLinvel(
          at(0, 0, which === "center" ? -60 : -12).sub(f.center),
          true,
        );
        p.car.pose.snap();
        p.ballPose.snap();
        s.cameraControl.reset();
      }, which);
    };
    for (const part of ["left-post", "right-post", "crossbar"]) {
      await shoot(part);
      await page.waitForFunction(() => {
        const p = window.__arena.extraSession.physics,
          v = p.ball.linvel(),
          h = p.course.finish.heading;
        return v.z * Math.cos(h) - v.x * Math.sin(h) > 1;
      });
      assert.equal(
        await page.evaluate(
          () => window.__arena.extraSession.run.phase === "complete",
        ),
        false,
      );
      assert.equal(
        await page.evaluate(() =>
          window.__arena.extraSession.level.finishGoal.material.color.getHex(),
        ),
        0xc4e5e7,
      );
    }
    await shoot("center");
    await page.waitForFunction(
      () => window.__arena.extraSession.run.phase === "complete",
    );
    await page.waitForFunction(
      () =>
        window.__arena.extraSession.level.finishGoal.material.color.g > 0.95,
    );
    const goal = await page.evaluate(() => {
      const s = window.__arena.extraSession;
      return {
        colliders: s.physics.goalColliders.length,
        posts: s.level.finishGoal.group.children.filter(
          (x) =>
            x.name.startsWith("dribble-goal-") &&
            x.name !== "dribble-goal-grid",
        ).length,
        grid: s.level.finishGoal.gridMaterial.transparent,
      };
    });
    assert.deepEqual(goal, { colliders: 3, posts: 3, grid: true });
    await page.screenshot({ path: "docs/dribble-goal-green.png" });
    for (const [height, depth] of [
      [-0.5, 1.5],
      [-1.2, 0.3],
    ]) {
      await page.evaluate(
        ({ height, depth }) => {
          const s = window.__arena.extraSession;
          s.reset();
          const p = s.physics,
            g = p.finishGoal;
          const point = g.parts[0].center
            .clone()
            .set(0, height, depth)
            .applyQuaternion(g.rotation)
            .add(g.finish.center);
          p.ball.setTranslation(point, true);
          p.ball.setLinvel(
            g.parts[0].center
              .clone()
              .set(0, -4, -10)
              .applyQuaternion(g.rotation),
            true,
          );
          p.ballPose.snap();
        },
        { height, depth },
      );
      await page.waitForFunction(
        () => window.__arena.extraSession.run.phase === "complete",
      );
      const low = await page.evaluate(() => {
        const s = window.__arena.extraSession;
        return {
          height: s.physics.finishGoal.local(
            s.physics.car.forward.clone().copy(s.physics.ball.translation()),
          ).y,
          green: s.level.finishGoal.material.color.getHex(),
          finished: s.physics.finished(),
        };
      });
      assert.ok(low.height < 0);
      assert.equal(low.green, 0x56ff91);
      assert.equal(low.finished, true);
    }
    await page.locator("#dribble-restart").click();
    assert.equal(
      await page.evaluate(() =>
        window.__arena.extraSession.level.finishGoal.material.color.getHex(),
      ),
      0xc4e5e7,
    );
    await page.keyboard.press("Escape");
    await page.locator("#dribble-exit").click();
    await page.locator("#play").click();
    await page.locator("#bot-mode").click();
    await page.locator("#bot-launch").click();
    await page.waitForFunction(() => window.__arena.match.phase === "playing");
    await page.evaluate(() => {
      const a = window.__arena,
        s = a.simulation,
        c = s.cars[0];
      c.reset(-10, 0, 0, 4);
      c.boost = 100;
      c.body.setLinvel({ x: 0, y: 0, z: -10 }, true);
      c.body.setAngvel({ x: 0.5, y: 1.5, z: 0.3 }, true);
      s.ball.setTranslation({ x: 0, y: 2, z: -52.1 }, true);
      s.ball.setLinvel({ x: 0, y: 0, z: -20 }, true);
      s.ballPose.snap();
    });
    await page.keyboard.down("KeyW");
    await page.keyboard.down("ShiftLeft");
    await page.waitForFunction(() => window.__arena.match.phase === "replay");
    await page.keyboard.up("KeyW");
    await page.keyboard.up("ShiftLeft");
    const replay = await page.evaluate(() => {
      const c = window.__arena.match.replay.clip,
        atTime = (t) => {
          let i = 0;
          while (i < c.count - 1 && c.times[i] < t) i++;
          return i * c.stride + 14;
        },
        a = atTime(c.goal.time + 0.1),
        b = atTime(c.goal.time + 0.9);
      return {
        tail: c.end - c.goal.time,
        moved: Math.hypot(
          ...[0, 1, 2].map((i) => c.frames[b + i] - c.frames[a + i]),
        ),
        boosting: c.frames[b + 15],
        goals: c.events.filter((e) => e.kind === "goal").length,
        score: window.__arena.match.score,
      };
    });
    assert.ok(
      Math.abs(replay.tail - 1) < 1e-7 &&
        replay.moved > 3 &&
        replay.boosting === 1,
    );
    assert.equal(replay.goals, 1);
    assert.equal(replay.score[0], 1);
    await page.locator("#replay-skip-button").click();
    await page.waitForFunction(
      () => window.__arena.match.phase === "countdown",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS production shared Extra Modes hover, three real frame bounces without green, center/low/falling sphere-overlap green/reset, preserved transparent grid, moving/boosting one-second goal replay and skip/kickoff",
    );
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
