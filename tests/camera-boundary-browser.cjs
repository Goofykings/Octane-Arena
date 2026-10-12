const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright"),
  assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8201);
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
    page.on("console", (m) => {
      if (m.type() === "error" && /shader|WebGL|program/i.test(m.text()))
        errors.push(m.text());
    });
    await page.goto(server.url);
    await page.waitForFunction(() => window.__arena);
    await page.locator("#play").click();
    await page.locator("#freeplay-mode").click();
    await page.locator("#freeplay-launch").click();
    await page.evaluate(() => {
      const a = window.__arena;
      a.simulation.step = () => {};
      a.cameraControl.ballMode = true;
      a.arena.wall.geometry.computeBoundingBox();
    });
    const pose = async (name, point, target, quality = "low") => {
      await page.evaluate(
        ({ name, point, target, quality }) => {
          const a = window.__arena,
            c = a.simulation.cars[0];
          a.graphics.apply(quality);
          a.mouseLook.reset();
          a.cameraControl.reverseHeld = false;
          c.body.setTranslation(
            { x: point[0], y: point[1], z: point[2] },
            true,
          );
          c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          const e = a.camera.rotation
            .clone()
            .set(
              name.includes("backboard") ? -Math.PI / 2 : 0,
              0,
              name.includes("ceiling")
                ? Math.PI
                : name.includes("wall") || name.includes("orbit")
                  ? Math.PI / 2
                  : 0,
              "YXZ",
            );
          const q = a.camera.quaternion.clone().setFromEuler(e);
          c.body.setRotation(q, true);
          c.pose.snap();
          a.simulation.ball.setTranslation(
            { x: target[0], y: target[1], z: target[2] },
            true,
          );
          a.simulation.ballPose.snap();
          a.cameraControl.reset();
        },
        { name, point, target, quality },
      );
      await page.waitForTimeout(600);
      const result = await page.evaluate(() => {
        const a = window.__arena,
          c = a.simulation.cars[0].body.translation(),
          cam = a.camera;
        return {
          position: cam.position.toArray(),
          car: [c.x, c.y, c.z],
          boom: Math.hypot(
            cam.position.x - c.x,
            cam.position.y - c.y,
            cam.position.z - c.z,
          ),
          roll: cam.rotation.z,
          safe: a.cameraControl.debug.safe,
          blocked: a.cameraControl.clearance.blocked,
          side: a.arena.wall.material[0].side,
          opacity: a.arena.wall.material[0].opacity,
          fallback: a.graphics.effectsUnavailable,
        };
      });
      assert.ok(
        result.boom > 5 &&
          Math.abs(result.roll) < 1e-8 &&
          result.safe &&
          !result.blocked,
        `${name}: readable stable view ${JSON.stringify(result)}`,
      );
      assert.equal(result.side, 0);
      assert.equal(result.opacity, 1);
      assert.equal(result.fallback, false);
      await page.screenshot({ path: `docs/camera-${name}.png` });
      return result;
    };
    const side = await pose("outside-wall", [40.61, 8, 0], [0, 1, 0]);
    assert.ok(side.position[0] > 40.96);
    const faded = await page.evaluate(() => {
      const a = window.__arena,
        scene = a.arena.group;
      const pillar = scene.getObjectByName("arena-exterior-pillar-1-0"),
        clear = scene.getObjectByName("arena-exterior-pillar-1-30");
      return [pillar.material.opacity, clear.material.opacity];
    });
    assert.ok(
      faded[0] < 0.2 && faded[1] === 1,
      "Only the actual decorative obstruction fades",
    );
    await pose("outside-corner", [37, 4, 47], [0, 1, 0], "high");
    const board = await pose(
      "outside-backboard",
      [0, 11, 50.85],
      [0, 4, 0],
      "high",
    );
    assert.ok(board.position[2] > 51.2);
    const ceiling = await pose(
      "above-ceiling",
      [35, 20.09, 0],
      [30, 16, 0],
      "high",
    );
    assert.ok(ceiling.position[1] > 20.44);
    await pose("outside-goal", [0, 3, 55.2], [0, 2, 0]);
    // Actual pointer events must orbit spatially, keep radius, and release to the
    // current automatic rig without changing either gameplay body.
    const before = await pose("orbit-base", [40.61, 8, 0], [0, 1, 0]);
    await page.mouse.move(850, 370);
    await page.mouse.down();
    await page.mouse.move(1010, 325, { steps: 12 });
    await page.waitForFunction(
      () => Math.abs(window.__arena.mouseLook.yaw) > 0.1,
    );
    await page.waitForTimeout(150);
    const manual = await page.evaluate(() => {
      const a = window.__arena,
        c = a.simulation.cars[0].body.translation();
      return {
        p: a.camera.position.toArray(),
        c: [c.x, c.y, c.z],
        boom: a.camera.position.distanceTo(a.cameraControl.pivot),
      };
    });
    assert.deepEqual(manual.c, before.car);
    assert.ok(
      Math.hypot(...manual.p.map((x, i) => x - before.position[i])) > 0.5,
    );
    assert.ok(Math.abs(manual.boom - before.boom) < 0.05);
    await page.screenshot({ path: "docs/camera-wall-orbit.png" });
    await page.mouse.up();
    await page.waitForFunction(() => !window.__arena.mouseLook.active);
    const returned = await page.evaluate(() =>
      window.__arena.camera.position.toArray(),
    );
    assert.ok(
      Math.hypot(...returned.map((x, i) => x - before.position[i])) < 0.05,
    );
    await page.keyboard.down("KeyB");
    await page.waitForFunction(
      () => window.__arena.cameraControl.debug.mode === "Reverse Cam",
    );
    assert.ok(
      await page.evaluate(
        () =>
          window.__arena.camera.position.distanceTo(
            window.__arena.cameraControl.pivot,
          ) > 5,
      ),
    );
    await page.keyboard.up("KeyB");
    // Circuit materials/art remain readable from ordinary interior and outside.
    await page.evaluate(() => window.__arena.arena.setMap("circuit"));
    await pose("circuit-midfield", [0, 0.34, 0], [3, 1, -14], "high");
    await pose("circuit-wall", [40.61, 8, 0], [0, 1, 0], "high");
    await pose("restored-interior", [0, 0.34, 0], [3, 1, -14]);
    assert.equal(
      await page.evaluate(
        () =>
          window.__arena.arena.group.getObjectByName(
            "arena-exterior-pillar-1-0",
          ).material.opacity,
      ),
      1,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS production outside wall/corner/backboard/ceiling/goal rendering, opaque interior/circuit art, selective fade/restore, real mouse orbit/radius/return, Reverse Cam and low/high graphics without shader errors",
    );
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
