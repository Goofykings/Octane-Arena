const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("node:fs"),
  http = require("node:http"),
  path = require("node:path"),
  assert = require("node:assert/strict");
(async () => {
  const root = path.resolve("dist"),
    server = http.createServer((req, res) => {
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
  await new Promise((r) => server.listen(4185, "127.0.0.1", r));
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
    await page.goto("http://127.0.0.1:4185/?test");
    await page.waitForFunction(() => window.__arena);
    await page.locator("#play").click();
    await page.locator("#freeplay-mode").click();
    await page.evaluate(() => {
      const a = window.__arena,
        s = a.simulation;
      a.physicsStep = s.step.bind(s);
      s.step = () => {};
      s.ball.setEnabled(false);
      s.ballCollider.setCollisionGroups(0);
      s.cars[1].collider.setCollisionGroups(0);
      a.cameraControl.update = () => {
        const p = s.cars[0].body.translation();
        a.camera.position.set(p.x - 4, p.y + (p.y > 18 ? -1.6 : 1.6), p.z + 4);
        a.camera.lookAt(p.x, p.y, p.z);
        a.camera.fov = 48;
        a.camera.updateProjectionMatrix();
      };
    });
    for (const id of ["ion", "vector"]) {
      await page.evaluate((id) => {
        const s = window.__arena.simulation,
          c = s.cars[0];
        window.__arena.garage.current.body=id; window.__arena.garagePanel.change();
        c.reset(29, 0, -Math.PI / 2);
        c.body.setLinvel({ x: 23, y: 0, z: 0 }, true);
      }, id);
      for (const [name, height] of [
        ["floor", 0.36],
        ["curve", 1],
        ["wall", 8],
        ["ceiling", 20.1],
      ]) {
        const result = await page.evaluate(
          ({ height, name }) => {
            const a = window.__arena,
              s = a.simulation,
              c = s.cars[0],
              idle = {
                throttle: 0,
                steer: 0,
                pitch: 0,
                yaw: 0,
                roll: 0,
                jump: false,
                boost: false,
                slide: false,
              };
            let i = 0;
            do {
              c.boost = 100;
              a.physicsStep([{ ...idle, throttle: 1, boost: true }, idle]);
              i++;
            } while ((name === "floor" ? i < 20 : c.body.translation().y < height) && i < 600);
            c.pose.snap();
            return { steps: i, position: c.body.translation() };
          },
          { height, name },
        );
        assert.ok(result.steps < 600, JSON.stringify(result));
        await page.waitForTimeout(150);
        await page.screenshot({ path: `docs/rigid-${id}-${name}.png` });
        console.log(`PASS rendered ${id} ${name}`, JSON.stringify(result));
      }
    }
    assert.deepEqual(errors, []);
    console.log("PASS no runtime or shader errors");
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

