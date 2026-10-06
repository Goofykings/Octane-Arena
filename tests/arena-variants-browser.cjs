const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  http = require("node:http"),
  path = require("node:path");

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
            : file.endsWith(".json")
              ? "application/json"
              : "text/html",
      );
      res.end(data);
    });
  });
  await new Promise((r) => server.listen(4188, "127.0.0.1", r));
  const browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  try {
    const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
      }),
      errors = [],
      results = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.goto("http://127.0.0.1:4188/?test");
    await page.waitForFunction(() => window.__arena);
    await page.locator("#play").click();
    await page.screenshot({ path: "docs/arena-selection.png" });
    for (const id of ["city", "beach", "stadium", "circuit"]) {
      await page.locator("#freeplay-mode").click();
      await page.locator(`[data-arena="${id}"]`).click();
      assert.equal(
        await page.locator(`[data-arena="${id}"]`).getAttribute("aria-pressed"),
        "true",
      );
      await page.locator("#freeplay-launch").click();
      await page.waitForFunction(
        () => window.__arena.match.phase === "playing",
      );
      const state = await page.evaluate((id) => {
        const a = window.__arena,
          s = a.simulation;
        window.mapGeometry ??= {
          floor: a.arena.floor.geometry,
          walls: a.arena.wall.geometry,
          collider: s.arenaCollider,
          pads: JSON.stringify(
            a.pads.items.map(({ x, z, large }) => ({ x, z, large })),
          ),
        };
        const g = window.mapGeometry,
          texture = a.arena.floor.material.map,
          ctx = texture.image.getContext("2d"),
          data = ctx.getImageData(0, 0, 64, 64).data,
          colors = new Set();
        for (let i = 0; i < data.length; i += 4)
          colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
        const env = a.arena.environment;
        const shells = a.graphics.renderPass.scene.children.filter((o) =>
          o.name.startsWith("environment-"),
        );
        return {
          id: a.arena.mapId,
          environment: env.name,
          shared:
            g.floor === a.arena.floor.geometry &&
            g.walls === a.arena.wall.geometry &&
            g.collider === s.arenaCollider,
          pads:
            g.pads ===
            JSON.stringify(
              a.pads.items.map(({ x, z, large }) => ({ x, z, large })),
            ),
          colors: colors.size,
          canvas: texture.image.width,
          environments: shells.length,
          props:
            id === "beach"
              ? !!env.getObjectByName("coastal-ocean") &&
                !!env.getObjectByName("palm-fronds")
              : id === "stadium"
                ? env.getObjectByName("egg-crowd").count
                : env.children.length,
          neutral: a.match.rules.training,
          indicator: a.ballHeight.group.visible,
          outline: a.ballHeight.outline.material.color.getHex(),
          effectsFailed: a.graphics.effectsUnavailable,
          floorSize: a.arena.floor.geometry.parameters,
          colliders: s.world.colliders.len(),
        };
      }, id);
      assert.equal(state.id, id);
      assert.equal(state.environment, `environment-${id}`);
      assert.ok(state.shared && state.pads && state.neutral && state.indicator);
      assert.ok(state.colors >= 3 && state.props && !state.effectsFailed);
      assert.equal(state.environments, 1);
      assert.equal(state.canvas, 512);
      assert.equal(state.outline, 0x172d37);
      results.push(state);
      if (id === "circuit") {
        const art = await page.evaluate(() => {
          const a = window.__arena,
            mesh = a.arena.group.getObjectByName("circuit-field-paint");
          const canvas = mesh.material.map.image,
            ctx = canvas.getContext("2d");
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let painted = 0;
          for (let i = 3; i < data.length; i += 4) if (data[i] > 60) painted++;
          const sample = (x, z) =>
            Array.from(
              ctx.getImageData(
                Math.floor(((x + 40.96) / 81.92) * canvas.width),
                Math.floor(((z + 60) / 120) * canvas.height),
                1,
                1,
              ).data,
            );
          const colors = a.arena.wall.geometry.getAttribute("color"),
            positions = a.arena.wall.geometry.getAttribute("position");
          const ramp = { blue: false, orange: false, fade: false };
          for (let i = 0; i < positions.count; i++) {
            const y = positions.getY(i),
              z = positions.getZ(i);
            if (y < 0.1 && z > 14 && colors.getZ(i) > colors.getX(i))
              ramp.blue = true;
            if (y < 0.1 && z < -14 && colors.getX(i) > colors.getZ(i))
              ramp.orange = true;
            if (y > 2.15 && y < 2.5 && Math.abs(z) > 14)
              ramp.fade ||= Math.abs(colors.getX(i) - colors.getZ(i)) < 0.12;
          }
          return {
            coverage: painted / (data.length / 4),
            center: sample(0, 0),
            blue: sample(10.5, 22),
            orange: sample(10.5, -22),
            padClear: a.pads.items.every(
              (pad) => sample(pad.x, pad.z)[3] === 0,
            ),
            ramp,
            visible: mesh.visible,
          };
        });
        assert.ok(art.visible && art.coverage > 0.08 && art.coverage < 0.45);
        assert.equal(art.center[3], 0);
        assert.ok(art.blue[2] > art.blue[0] && art.orange[0] > art.orange[2]);
        assert.ok(
          art.padClear && art.ramp.blue && art.ramp.orange && art.ramp.fade,
        );
        results.at(-1).fieldArt = art;
      }
      // Actual gameplay view at the canonical kickoff, then a clear overview.
      await page.waitForTimeout(350);
      await page.screenshot({ path: `docs/arena-${id}-gameplay.png` });
      await page.evaluate(() => {
        const a = window.__arena;
        window.mapStep ??= a.simulation.step.bind(a.simulation);
        window.mapCamera ??= a.cameraControl.update.bind(a.cameraControl);
        a.simulation.step = () => {};
        a.cameraControl.update = () => {};
        a.camera.clearViewOffset();
        a.camera.up.set(0, 1, 0);
        a.camera.position.set(70, 58, 91);
        a.camera.lookAt(0, 3, 0);
        a.camera.fov = 66;
        a.camera.updateProjectionMatrix();
      });
      await page.waitForTimeout(100);
      await page.screenshot({ path: `docs/arena-${id}-overview.png` });
      // A visual swap must neither recreate the Rapier world nor alter its trajectory.
      const trajectory = await page.evaluate(() => {
        const a = window.__arena,
          s = a.simulation;
        s.reset();
        s.cars[1].body.setEnabled(false);
        s.ball.setEnabled(false);
        const n = {
          throttle: 1,
          steer: 0.25,
          pitch: 0,
          yaw: 0,
          roll: 0,
          boost: true,
          jump: false,
          slide: false,
        };
        for (let i = 0; i < 180; i++) window.mapStep([n, {}]);
        return {
          position: { ...s.cars[0].body.translation() },
          rotation: { ...s.cars[0].body.rotation() },
          velocity: { ...s.cars[0].body.linvel() },
        };
      });
      results.at(-1).trajectory = trajectory;
      await page.evaluate(() => {
        const a = window.__arena;
        a.simulation.step = window.mapStep;
        a.cameraControl.update = window.mapCamera;
      });
      await page.keyboard.press("Escape");
      await page.locator("#pause-home").click();
      await page.locator("#play").click();
      await page.locator("#bot-mode").click();
      await page.waitForFunction(
        () => window.__arena.match.phase === "playing",
        null,
        { timeout: 20000 },
      );
      assert.ok(
        ["city", "beach", "stadium", "circuit"].includes(
          await page.evaluate(() => window.__arena.arena.mapId),
        ),
      );
      assert.equal(
        await page.evaluate(() =>
          window.__arena.simulation.cars[1].body.isEnabled(),
        ),
        true,
      );
      await page.keyboard.press("Escape");
      await page.locator("#pause-home").click();
      await page.locator("#leave-confirm-yes").click();
      await page.locator("#play").click();
    }
    // Reload persistence, all quality tiers, repeated swaps/disposal and unobscured controls.
    await page.reload();
    await page.waitForFunction(() => window.__arena);
    assert.equal(
      await page.evaluate(() => window.__arena.arena.mapId),
      "circuit",
    );
    await page.locator("#play").click();
    await page.locator("#freeplay-mode").click();
    for (const quality of ["low", "medium", "high", "ultra"])
      for (const id of ["beach", "stadium", "circuit", "city"]) {
        await page.evaluate((q) => window.__arena.graphics.apply(q), quality);
        await page.locator(`[data-arena="${id}"]`).click();
        await page.waitForTimeout(100);
        assert.equal(
          await page.evaluate(() => window.__arena.graphics.effectsUnavailable),
          false,
        );
      }
    await page.evaluate(() => window.__arena.graphics.apply("high"));
    await page.waitForTimeout(200);
    const memoryBefore = await page.evaluate(() => ({
      ...window.__arena.graphics.renderer.info.memory,
    }));
    for (let cycle = 0; cycle < 3; cycle++)
      for (const id of ["beach", "stadium", "circuit", "city"]) {
        await page.locator(`[data-arena="${id}"]`).click();
        await page.waitForTimeout(100);
      }
    const memoryAfter = await page.evaluate(() => ({
      ...window.__arena.graphics.renderer.info.memory,
    }));
    assert.ok(
      memoryAfter.geometries <= memoryBefore.geometries + 2,
      "arena swaps leak geometry",
    );
    assert.ok(
      memoryAfter.textures <= memoryBefore.textures + 2,
      "arena swaps leak textures",
    );
    results[0].resourceCheck = { before: memoryBefore, after: memoryAfter };
    await page.locator("#freeplay-back").click();
    await page.setViewportSize({ width: 1280, height: 720 });
    assert.equal(await page.locator("#freeplay-mode").isVisible(), true);
    const layout = await page.locator("#freeplay-mode").boundingBox();
    assert.ok(layout.y + layout.height < 660, "mode buttons overlap footer");
    await page.screenshot({ path: "docs/arena-selection.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileMode = await page.locator("#freeplay-mode").boundingBox();
    const mobileBack = await page.locator("#modes-back").boundingBox();
    assert.ok(
      mobileMode.y + mobileMode.height <= mobileBack.y,
      "mobile mode controls overlap Back",
    );
    await page.screenshot({ path: "docs/arena-selection-mobile.png" });
    assert.deepEqual(errors, []);
    for (const result of results) {
      for (const component of ["position", "rotation", "velocity"])
        for (const key of Object.keys(result.trajectory[component]))
          assert.ok(
            Math.abs(
              result.trajectory[component][key] -
                results[0].trajectory[component][key],
            ) < 1e-5,
            "map changed physics trajectory",
          );
    }
    fs.writeFileSync(
      "docs/arena-variants-verification.json",
      JSON.stringify(results, null, 2),
    );
    console.log(
      "PASS all 4 arena styles: Free Play and VS Bot, preserved meshes/collider/pads, neutral center/pad sockets, partial team paint and faded ramps, ball indicator, identical driving trajectory, persisted selection, all quality tiers, repeated swaps, clear controls and no browser errors",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
