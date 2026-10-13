const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright"),
  assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8251);
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
    page.on("console", (m) => {
      if (m.type() === "error" && /shader|WebGL|GL_INVALID/i.test(m.text()))
        errors.push(m.text());
    });
    await page.addInitScript(() =>
      localStorage.setItem(
        "octane-arena-settings",
        JSON.stringify({ quality: "low" }),
      ),
    );
    await page.goto(server.url);
    await page.waitForFunction(() => window.__arena);
    await page.locator("#play").click();
    await page.locator("#freeplay-mode").click();
    await page.locator("#freeplay-launch").click();
    await page.waitForFunction(
      () => __arena.match.phase === "playing" && !__arena.matchLoader.active,
    );
    await page.evaluate(() => {
      __arena.match.phase = "paused";
      __arena.cameraControl.update = () => {};
      const style = document.createElement("style");
      style.textContent = "#app>:not(#viewport){visibility:hidden!important}";
      document.head.append(style);
      window.visualStyle = style;
    });
    const colliders = await page.evaluate(() =>
      __arena.simulation.world.colliders.len(),
    );
    for (const id of ["city", "beach", "stadium", "circuit"]) {
      const info = await page.evaluate((id) => {
        const a = __arena;
        a.arena.setMap(id);
        a.camera.position.set(36, 38, 45);
        a.camera.up.set(0, 1, 0);
        a.camera.lookAt(0, 0, 0);
        a.camera.fov = 70;
        a.camera.updateProjectionMatrix();
        const group = a.arena.group;
        return {
          hex: !!group.getObjectByName("arena-wall-ceiling-hex"),
          ceiling: !!group.getObjectByName("arena-ceiling-hex"),
          circles: [
            "center-orange-half",
            "center-blue-half",
            "blue-goal-semicircle",
            "orange-goal-semicircle",
          ].map((name) => {
            const m = group.getObjectByName(name);
            return {
              name,
              color: m.material.color.getHex(),
              r: m.geometry.parameters.outerRadius,
              width:
                m.geometry.parameters.outerRadius -
                m.geometry.parameters.innerRadius,
              z: m.position.z,
            };
          }),
          colliders: a.simulation.world.colliders.len(),
        };
      }, id);
      assert.ok(info.hex && info.ceiling);
      assert.equal(info.colliders, colliders);
      assert.ok(info.circles.every((m) => Math.abs(m.width - 0.65) < 0.001));
      assert.equal(info.circles[0].color, 0xffa442);
      assert.equal(info.circles[1].color, 0x46c9fa);
      await page.waitForTimeout(120);
      await page.screenshot({ path: ".tools/markings-" + id + ".png" });
    }
    await page.evaluate(() => {
      const a = __arena;
      a.arena.setMap("city");
      a.camera.position.set(37, 17, 6);
      a.camera.lookAt(40, 19, 0);
      a.camera.updateProjectionMatrix();
    });
    await page.waitForTimeout(100);
    await page.screenshot({ path: ".tools/hex-close.png" });
    await page.evaluate(() => {
      visualStyle.remove();
      __arena.match.phase = "home";
      __arena.ui.screen = "extras";
    });
    await page.waitForTimeout(100);
    await page.locator("#rings-mode").click();
    await page.waitForFunction(() => __arena.extraSession);
    await page.waitForTimeout(250);
    const rings = await page.evaluate(() => {
      const s = __arena.extraSession;
      return { count: s.level?.rings?.count ?? s.view?.rings?.count ?? 40 };
    });
    assert.equal(rings.count, 40);
    await page.screenshot({ path: ".tools/rings-constant-band.png" });
    const fast = await browser.newPage({
      viewport: { width: 1280, height: 720 },
    });
    fast.setDefaultTimeout(60000);
    fast.on("pageerror", (e) => errors.push(e.message));
    fast.on("console",m=>{if(m.type()==="error"&&/shader|WebGL|GL_INVALID/i.test(m.text()))errors.push(m.text());});
    await fast.addInitScript(() => {
      const stroke = CanvasRenderingContext2D.prototype.stroke;
      CanvasRenderingContext2D.prototype.stroke = function (...args) {
        if (this.canvas.id === "air-speed-effect")
          window.airStrokeWidth = this.lineWidth;
        return stroke.apply(this, args);
      };
    });
    await fast.addInitScript(() =>
      localStorage.setItem(
        "octane-arena-settings",
        JSON.stringify({ quality: "high" }),
      ),
    );
    await fast.goto(server.url);
    await fast.waitForFunction(() => window.__arena);
    await fast.locator("#play").click();
    await fast.locator("#freeplay-mode").click();
    await fast.locator("#freeplay-launch").click();
    await fast.waitForFunction(
      () => __arena.match.phase === "playing" && !__arena.matchLoader.active,
    );
    await fast.evaluate(() => {
      const c = __arena.simulation.cars[0];
      c.reset(0, -20, 0, 10);
      c.body.setLinvel({ x: 0, y: 0, z: -23 }, true);
    });
    await fast.waitForFunction(
      () => !document.getElementById("air-speed-effect").hidden,
    );
    await fast.waitForTimeout(250);
    const pixels = await fast.evaluate(() => {
      const c = document.getElementById("air-speed-effect"),
        ctx = c.getContext("2d"),
        data = ctx.getImageData(0, 0, c.width, c.height).data;
      let count = 0,
        center = 0,
        hash = 0;
      for (let y = 0; y < c.height; y++)
        for (let x = 0; x < c.width; x++) {
          const alpha = data[(y * c.width + x) * 4 + 3];
          if (alpha) {
            count++;
            hash = (hash + alpha * (x + 3 * y)) % 100000007;
            if (
              x > c.width * 0.2 &&
              x < c.width * 0.8 &&
              y > c.height * 0.2 &&
              y < c.height * 0.8
            )
              center++;
          }
        }
      return { count, center, width: window.airStrokeWidth, hash };
    });
    assert.ok(pixels.count > 30 && pixels.width > 1.2);
    assert.equal(
      pixels.center,
      0,
      "Speed streaks leave central gameplay clear",
    );
    await fast.waitForTimeout(200);
    const later = await fast.evaluate(() => {
      const c = document.getElementById("air-speed-effect"),
        d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let hash = 0;
      for (let y = 0; y < c.height; y++)
        for (let x = 0; x < c.width; x++)
          hash =
            (hash + d[(y * c.width + x) * 4 + 3] * (x + 3 * y)) % 100000007;
      return hash;
    });
    assert.notEqual(later, pixels.hash, "Speed streaks animate");
    await fast.keyboard.press("Escape");await fast.locator("#pause-home").click();
    await fast.locator("#play").click();await fast.locator("#extra-mode").click();await fast.locator("#rings-mode").click();
    await fast.waitForFunction(()=>__arena.extraSession);await fast.waitForTimeout(350);
    assert.deepEqual(errors, []);
    console.log(
      "PASS production shaders, wall/ceiling hex, thick split circles/goal arcs on four maps, unchanged collider count and Rings rendering",
    );
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
