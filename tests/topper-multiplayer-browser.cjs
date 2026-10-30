const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
(async () => {
  const server = await require("./static-game.cjs").staticGame(8263);
  const signaling = await require("./local-peer-server.cjs").localPeer(9036);
  let browser;
  const errors = [];
  try {
    browser = await chromium.launch({
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      args: [
        "--enable-unsafe-swiftshader",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
      ],
    });
    const open = async (topper) => {
      const context = await browser.newContext({
        viewport: { width: 1000, height: 760 },
      });
      await context.addInitScript((topper) => {
        localStorage.setItem(
          "octane-arena-settings",
          JSON.stringify({ quality: "low" }),
        );
        localStorage.setItem(
          "octane-arena-garage",
          JSON.stringify({
            inventoryVersion: 4,
            owned: { topper: [topper] },
            presets: [
              {
                id: "starter",
                name: "Network Topper",
                body: "vector",
                blue: "#36cedd",
                orange: "#f89a49",
                wheels: "apex",
                boost: "plasma",
                topper,
                explosion: "pulse",
              },
            ],
          }),
        );
      }, topper);
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => {
        if (
          m.type() === "error" &&
          /THREE.WebGLProgram|Shader Error|GL_INVALID/.test(m.text())
        )
          errors.push(m.text());
      });
      page.setDefaultTimeout(60000);
      await page.goto(server.url);
      await page.waitForFunction(() => window.__arena);
      await page.evaluate(() => {
        __arena.party.transport.options = {
          host: "127.0.0.1",
          port: 9036,
          path: "/peer",
          secure: false,
          debug: 0,
          config: { iceServers: [] },
        };
      });
      return page;
    };
    const host = await open("beanie"),
      guest = await open("ufo");
    await host.locator("#party-create").click();
    await host.waitForFunction(() => __arena.party.state?.code);
    const code = await host.evaluate(() => __arena.party.state.code);
    await guest.locator("#party-join-open").click();
    await guest.locator("#party-input").fill(code);
    await guest.locator("#party-join button[type=submit]").click();
    await host.waitForFunction(() => __arena.party.state?.members.length === 2);
    await guest.waitForFunction(() =>
      __arena.party.state?.members.some((m) => m.preset.topper === "beanie"),
    );
    for (const page of [host, guest]) {
      await page.waitForFunction(() =>
        [...__arena.homeLobby.displays.values()].some(
          (d) =>
            d.model.userData.topper.userData.topperId === "ufo" &&
            d.model.userData.topper.userData.assetLoaded,
        ),
      );
      assert.ok(
        await page.evaluate(() =>
          [...__arena.homeLobby.displays.values()].some((d) => {
            const b = d.model.getObjectByName("Beam");
            return b && b.material.transparent && b.material.opacity <= 0.14;
          }),
        ),
      );
    }
    await host.locator("#party-start").click();
    await host.locator("#party-continue").click();
    await host.locator('.party-team-join[data-team="0"]').click();
    await guest.locator('.party-team-join[data-team="1"]').click();
    await host.locator("#party-launch").click();
    for (const page of [host, guest])
      await page.waitForFunction(
        () => __arena.networkView?.match.phase === "playing",
      );
    const hostId = await host.evaluate(() => __arena.party.playerId);
    await host.keyboard.press("Space");
    for (const page of [host, guest]) {
      await page.waitForFunction((id) => {
        const view = __arena.networkView;
        const i = view.simulation.cars.findIndex((c) => c.id === id);
        let rotor;
        view.cars[i].traverse((o) => {
          if (o.userData.rotor) rotor = o.userData.rotor;
        });
        return rotor?.speed > 0;
      }, hostId);
      assert.deepEqual(
        await page.evaluate(() =>
          __arena.network.latest.players.map((p) => p.preset.topper).sort(),
        ),
        ["beanie", "ufo"],
      );
      assert.equal(
        await page.evaluate(() =>
          Object.keys(__arena.network.latest.cars[0]).some((k) =>
            /propeller|beam|topperAngle/i.test(k),
          ),
        ),
        false,
      );
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS two real local PeerJS browsers: topper IDs synchronize in lobby/match, both real GLBs load, beam alpha survives home fading, actual jump spins host and remote propeller without wire animation state",
    );
  } finally {
    await browser?.close();
    await server.close();
    await signaling.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
