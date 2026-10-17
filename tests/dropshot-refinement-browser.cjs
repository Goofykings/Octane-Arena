const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8276);
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      args: ["--enable-unsafe-swiftshader"],
    });
    const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (e) => {
      if (e.type() === "error" && /shader|webgl|THREE/i.test(e.text()))
        errors.push(e.text());
    });
    page.setDefaultTimeout(60000);
    await page.addInitScript(() =>
      localStorage.setItem(
        "octane-arena-settings",
        JSON.stringify({ quality: "low", infiniteBoost: false }),
      ),
    );
    await page.goto(server.url);
    await page.waitForFunction(() => window.__arena);
    await page.locator("#play").click();
    await page.locator("#freeplay-mode").click();
    await page.locator('[data-arena="dropshot"]').click();
    await page.locator("#freeplay-launch").click();
    await page.waitForFunction(
      () => __arena.match.phase === "playing" && !__arena.matchLoader.active,
    );
    // Render the depth alone, without opaque floor/walls hiding leaks. Every
    // colored pixel must project through an actual OPEN physical tile footprint.
    const clipping = await page.evaluate(() => {
      const a = __arena,
        sim = a.simulation,
        d = sim.dropshot,
        scene = a.arena.group.parent,
        renderer = a.graphics.renderer,
        camera = a.camera;
      sim.cars.forEach((c) => c.body.setEnabled(false));
      sim.ball.setEnabled(false);
      a.cameraControl.update = () => {};
      const render = (eye, look, ids) => {
        const hidden = [];
        scene.traverse((o) => {
          if (
            (o.isMesh || o.isPoints || o.isLine) &&
            o.name !== "dropshot-open-depth"
          ) {
            hidden.push([o, o.visible]);
            o.visible = false;
          }
        });
        const background = scene.background,
          clear = renderer.getClearColor(
            a.arena.group
              .getObjectByName("dropshot-tiles")
              .material.color.clone(),
          ),
          alpha = renderer.getClearAlpha(),
          target = renderer.getRenderTarget();
        scene.background = null;
        renderer.setClearColor(0x000000, 1);
        renderer.setRenderTarget(null);
        camera.position.set(...eye);
        camera.lookAt(...look);
        camera.updateMatrixWorld(true);
        scene.updateMatrixWorld(true);
        renderer.clear(true, true, true);
        renderer.render(scene, camera);
        const w = renderer.domElement.width,
          h = renderer.domElement.height,
          pixels = new Uint8Array(w * h * 4),
          gl = renderer.getContext();
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let colored = 0,
          escaped = 0;
        const ray = camera.position.clone();
        for (let i = 0; i < w * h; i++)
          if (pixels[i * 4] + pixels[i * 4 + 1] + pixels[i * 4 + 2] > 4) {
            colored++;
            ray
              .set(
                (((i % w) + 0.5) / w) * 2 - 1,
                ((Math.floor(i / w) + 0.5) / h) * 2 - 1,
                0.5,
              )
              .unproject(camera)
              .sub(camera.position);
            const k = -camera.position.y / ray.y,
              x = camera.position.x + ray.x * k,
              z = camera.position.z + ray.z * k;
            const inside = ids.some((id) => {
              const p = d.arena.tiles[id].projectPoint(
                { x, y: 0, z },
                false,
              ).point;
              return Math.hypot(p.x - x, p.z - z) < 0.075;
            });
            if (!inside) escaped++;
          }
        hidden.forEach(([o, v]) => (o.visible = v));
        scene.background = background;
        renderer.setClearColor(clear, alpha);
        renderer.setRenderTarget(target);
        return { colored, escaped };
      };
      const update = () =>
        a.arena.updateDropshot(d.snapshot(sim.clock, true), 0.08);
      d.reset();
      update();
      const noOpen = render([75, 6, 0], [0, -8, 0], []);
      const t = d.arena.tiles[90].translation();
      for (const id of [90]) {
        d.touch(sim.cars[0].id, 0, 0);
        d.damage(id, 8, sim.clock);
        d.damage(id, 8, sim.clock + 0.21);
        sim.clock += 0.5;
      }
      update();
      const one = render([t.x + 3, 9, t.z + 9], [t.x, -3, t.z], [90]);
      const falling = a.arena.group.getObjectByName(
        "dropshot-falling-tiles",
      ).visible;
      const immediate = !d.arena.tiles[90].isEnabled();
      const outside = render([75, 6, 0], [t.x, -8, t.z], [90]),
        below = render([t.x + 5, -4, t.z + 5], [t.x, -9, t.z], [90]);
      d.touch(sim.cars[0].id, 0, 0);
      d.damage(91, 8, sim.clock);
      d.damage(91, 8, sim.clock + 0.21);
      sim.clock += 0.5;
      update();
      const combined = render([t.x, 18, t.z + 5], [t.x, -6, t.z], [90, 91]);
      d.reset();
      update();
      sim.ball.setEnabled(true);
      return { noOpen, one, outside, below, combined, falling, immediate };
    });
    assert.equal(clipping.noOpen.colored, 0);
    assert.ok(clipping.one.colored > 30);
    assert.equal(clipping.one.escaped, 0);
    assert.equal(clipping.outside.colored, 0);
    assert.equal(clipping.below.colored, 0);
    assert.ok(clipping.combined.colored > 30);
    assert.equal(clipping.combined.escaped, 0);
    assert.ok(clipping.falling && clipping.immediate);
    console.log("PASS GPU hole-only clipping", clipping);
    // Freeze only the test camera, with live rendering, material updates and gameplay intact.
    await page.evaluate(() => {
      const a = __arena,
        s = a.simulation,
        d = s.dropshot;
      a.cameraControl.update = () => {};
      a.camera.position.set(0, 47, 38);
      a.camera.lookAt(0, 0, 0);
      s.cars.forEach((c) => c.body.setEnabled(false));
      s.ball.setTranslation({ x: 0, y: 5, z: 0 }, true);
      s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
      s.world.gravity = { x: 0, y: 0, z: 0 };
      for (const [id, team] of [
        [90, 0],
        [24, 1],
      ]) {
        d.touch(s.cars[0].id, team, 0);
        d.damage(id, 8, s.clock);
        d.damage(id, 8, s.clock + 0.21);
        s.clock += 0.5;
      }
      d.touch(s.cars[0].id, 0, 30);
      d.damage(108, 8, s.clock);
      s.clock += 0.5;
    });
    await page.waitForTimeout(800);
    await page.screenshot({ path: ".tools/dropshot-refined-overview.png" });
    const info = await page.evaluate(() => {
      const g = __arena.arena.group.getObjectByName("dropshot-reactor");
      return {
        extensions: !!g.getObjectByName("dropshot-clipped-hex-extensions"),
        rims: g.getObjectByName("dropshot-exposed-rims").geometry.drawRange
          .count,
        poles: g.children.filter((o) => o.name === "dropshot-light-pole")
          .length,
        drawCalls: __arena.graphics.renderer.info.render.calls,
      };
    });
    assert.ok(info.extensions && info.rims > 0 && info.poles === 18);
    await page.evaluate(() => {
      const p = __arena.simulation.dropshot.arena.tiles[90].translation();
      __arena.camera.position.set(p.x + 3, 9, p.z + 10);
      __arena.camera.lookAt(p.x, -1, p.z);
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: ".tools/dropshot-refined-hole.png" });
    for (const level of [0, 1, 2]) {
      await page.evaluate((level) => {
        const s = __arena.simulation,
          d = s.dropshot;
        d.energy = [0, 4000, 12000][level];
        d.touch(s.cars[0].id, 0, 0);
        s.ball.setTranslation({ x: 0, y: 5, z: 0 }, true);
        s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
        s.ballPose.snap();
        __arena.camera.position.set(0, 7, 8);
        __arena.camera.lookAt(0, 5, 0);
      }, level);
      await page.waitForTimeout(level === 2 ? 100 : 600);
      await page.screenshot({
        path: `.tools/dropshot-refined-charge-${level}.png`,
      });
    }
    const effect = await page.evaluate(() => {
      const g = __arena.arena.group.parent;
      let fx;
      g.traverse((o) => {
        if (o.name === "dropshot-charge-fx" && o.visible) fx = o;
      });
      const sizes = fx.getObjectByName("dropshot-charge-particles").geometry
        .attributes.size.array;
      return {
        parent: fx.parent.name,
        active: Array.from(sizes).filter((v) => v > 0).length,
        wave: fx.getObjectByName("dropshot-super-wave").visible,
      };
    });
    assert.ok(
      effect.active >= 50 && effect.wave,
      "Super transition is visibly active in production renderer",
    );
    assert.deepEqual(errors, []);
    console.log("PASS refined Dropshot production renderer:", { info, effect });
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
