const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
(async () => {
  const { startLan } = await import(
    pathToFileURL(resolve("server/dist/server/src/lan.js")).href
  );
  const browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  try {
    for (const transport of ["server", "webrtc"]) {
      const { app, partyMatches } = await startLan(8105, ":memory:", {
        matchTransport: transport,
        stunUrls: [],
      });
      const pages = [],
        errors = [];
      try {
        const open = async () => {
          const context = await browser.newContext({
            viewport: { width: 1280, height: 720 },
          });
          await context.addInitScript(() =>
            localStorage.setItem(
              "octane-arena-settings",
              JSON.stringify({ quality: "low" }),
            ),
          );
          const page = await context.newPage();
          page.setDefaultTimeout(30000);
          page.on("pageerror", (e) => errors.push(e.message));
          await page.goto("http://127.0.0.1:8105/?test");
          await page.waitForFunction(
            () =>
              window.__arena?.party.connection === "connected" &&
              !window.__arena.party.busy,
          );
          pages.push(page);
          return page;
        };
        const host = await open(),
          guest = await open();
        const action = async (page, name, data = {}) => {
          await page.waitForFunction(() => !window.__arena.party.busy);
          const result = await page.evaluate(
            async ({ name, data }) => {
              const p = window.__arena.party;
              return { ok: await p.action(name, data), message: p.message };
            },
            { name, data },
          );
          assert.equal(result.ok, true, result.message);
        };
        if (transport === "server") {
          await host.bringToFront();
          await host.locator("#play").click();
          await host.locator("#freeplay-mode").click();
          await host.locator("#freeplay-launch").click();
          await host.waitForFunction(
            () => window.__arena.match.phase === "playing",
          );
          const normal = await host.evaluate(
            () => window.__arena.cameraControl.ballMode,
          );
          await host.keyboard.down("KeyB");
          await host.waitForFunction(
            () => window.__arena.cameraControl.debug.mode === "Reverse Cam",
          );
          await host.keyboard.up("KeyB");
          await host.waitForFunction(
            () => window.__arena.cameraControl.debug.mode !== "Reverse Cam",
          );
          assert.equal(
            await host.evaluate(() => window.__arena.cameraControl.ballMode),
            normal,
          );
          await host.keyboard.press("Escape");
          await host.locator("#pause-settings").click();
          await host.locator('[data-tab="controls"]').click();
          assert.equal(
            await host.locator('[data-action="reverseCam"]').count(),
            1,
          );
          await host.locator("#close-settings").click();
          await host.locator("#resume").click();
          await host.evaluate(() => {
            const a = window.__arena;
            a.input.bindings.reverseCam = "KeyN";
            a.settings.value.quality = "high";
            const c = a.simulation.cars[0];
            c.body.setTranslation({ x: 0, y: 14, z: 0 }, true);
            c.body.setLinvel({ x: 0, y: 0, z: -23 }, true);
            c.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
            c.pose.snap();
          });
          await host.keyboard.down("KeyN");
          await host.waitForFunction(
            () => window.__arena.cameraControl.debug.mode === "Reverse Cam",
          );
          await host.keyboard.up("KeyN");
          await host.waitForFunction(
            () => !document.getElementById("air-speed-effect").hidden,
          );
          const mask = await host.evaluate(() => {
            const canvas = document.getElementById("air-speed-effect"),
              ctx = canvas.getContext("2d");
            const middle = ctx.getImageData(
              canvas.width * 0.5,
              canvas.height * 0.5,
              1,
              1,
            ).data[3];
            return {
              middle,
              pointer: canvas.style.pointerEvents,
              z: canvas.style.zIndex,
            };
          });
          assert.equal(mask.middle, 0);
          assert.equal(mask.pointer, "none");
          assert.equal(mask.z, "1");
          await host.screenshot({ path: "docs/air-speed-reverse.png" });
          await host.evaluate(
            () => (window.__arena.settings.value.quality = "low"),
          );
          await host.waitForFunction(
            () => document.getElementById("air-speed-effect").hidden,
          );
          await host.keyboard.press("Escape");
          await host.locator("#pause-home").click();
        }
        await action(host, "create");
        const code = await host.evaluate(() => window.__arena.party.state.code);
        await action(guest, "join", { code });
        await guest.locator("#play").click();
        await guest.locator("#party-mode-screen").waitFor({ state: "visible" });
        assert.ok(await guest.locator("#party-setup-launch").isDisabled());
        await host.locator("#play").click();
        await host.locator("#party-mode-screen").waitFor({ state: "visible" });
        await host
          .locator('[data-cycle="gamemode"][data-direction="1"]')
          .click();
        await guest.waitForFunction(
          () =>
            document.getElementById("setup-gamemode").textContent ===
            "HEATSEEKER",
        );
        await host
          .locator('[data-cycle="gamemode"][data-direction="1"]')
          .click();
        await guest.waitForFunction(
          () =>
            document.getElementById("setup-gamemode").textContent === "SOCCAR",
        );
        await host
          .locator('[data-cycle="gamemode"][data-direction="-1"]')
          .click();
        await guest.waitForFunction(
          () =>
            document.getElementById("setup-gamemode").textContent ===
            "HEATSEEKER",
        );
        for (const label of ["2v2", "2vBOTS", "1v1"]) {
          await host.waitForFunction(() => !window.__arena.party.busy);
          await host.locator('[data-cycle="mode"][data-direction="1"]').click();
          await guest.waitForFunction(
            (label) =>
              document.getElementById("setup-players").textContent === label,
            label,
          );
        }
        for (const width of [1280, 900, 390]) {
          await host.setViewportSize({
            width,
            height: width === 390 ? 844 : 720,
          });
          const bounds = await host
            .locator("#party-setup-launch")
            .boundingBox();
          assert.ok(
            bounds.x >= 0 &&
              bounds.x + bounds.width <= width + 1 &&
              bounds.y + bounds.height < (width === 390 ? 844 : 720),
          );
          if (width === 1280)
            await host.screenshot({ path: "docs/match-setup.png" });
        }
        await host.setViewportSize({ width: 1280, height: 720 });
        await host.locator("#party-setup-launch").click();
        for (const page of pages)
          await page.waitForFunction(
            () =>
              window.__arena.network.latest?.gameMode === "heatseeker" &&
              window.__arena.network.latest.phase === "playing",
            null,
            { timeout: 45000 },
          );
        const snapshot = await host.evaluate(
          () => window.__arena.network.latest,
        );
        assert.equal(snapshot.heatseeker.active, false);
        assert.notEqual(snapshot.ball.position.z, 0);
        const peer = await guest.evaluate(() => window.__arena.network.latest);
        assert.equal(peer.matchId, snapshot.matchId);
        assert.equal(peer.arenaId, snapshot.arenaId);
        assert.equal(
          peer.heatseeker.kickoffTeam,
          snapshot.heatseeker.kickoffTeam,
        );
        // The receiving player drives into the neutral ball using actual inputs.
        const receiving = snapshot.players.find(
          (p) => p.team === snapshot.heatseeker.kickoffTeam,
        ).id;
        const driver =
          receiving ===
          (await host.evaluate(() => window.__arena.party.playerId))
            ? host
            : guest;
        await driver.bringToFront();
        await driver.keyboard.down("KeyW");
        await driver.keyboard.down("ShiftLeft");
        for (let i = 0; i < 150; i++) {
          if (
            await guest.evaluate(
              () => window.__arena.network.latest.heatseeker.active,
            )
          )
            break;
          await driver.evaluate(() => {
            const a = window.__arena,
              s = a.network.latest,
              c = s.cars.find((c) => c.id === a.party.playerId),
              q = c.rotation;
            const dx = s.ball.position.x - c.position.x,
              dz = s.ball.position.z - c.position.z;
            const forwardX = -2 * (q.x * q.z + q.y * q.w),
              forwardZ = -(1 - 2 * (q.x * q.x + q.y * q.y));
            const rightX = 1 - 2 * (q.y * q.y + q.z * q.z),
              rightZ = 2 * (q.x * q.z - q.y * q.w);
            const error = Math.atan2(
              dx * rightX + dz * rightZ,
              dx * forwardX + dz * forwardZ,
            );
            a.input.keys.delete(a.input.bindings.left);
            a.input.keys.delete(a.input.bindings.right);
            if (Math.abs(error) > 0.06)
              a.input.keys.add(
                error > 0 ? a.input.bindings.right : a.input.bindings.left,
              );
          });
          await driver.waitForTimeout(80);
        }
        assert.ok(
          await guest.evaluate(
            () => window.__arena.network.latest.heatseeker.active,
          ),
        );
        await driver.evaluate(() => {
          const a = window.__arena;
          a.input.keys.delete(a.input.bindings.left);
          a.input.keys.delete(a.input.bindings.right);
        });
        await driver.keyboard.up("KeyW");
        await driver.keyboard.up("ShiftLeft");
        const state = await guest.evaluate(
          () => window.__arena.network.latest.heatseeker,
        );
        assert.equal(state.lastTouchPlayerId, receiving);
        assert.equal(state.ownerTeam, snapshot.heatseeker.kickoffTeam);
        assert.equal(state.targetTeam, 1 - state.ownerTeam);
        assert.ok(state.tier >= 1);
        await host.waitForFunction(
          (tier) => window.__arena.network.latest.heatseeker.tier >= tier,
          state.tier,
        );
        assert.equal(
          await host.evaluate(() =>
            window.__arena.networkView.ball.userData.panelMaterial.emissive.getHex(),
          ),
          state.ownerTeam === 0 ? 0x399cff : 0xff8b32,
        );
        if (transport === "webrtc") assert.equal(partyMatches.matches.size, 0);
        assert.deepEqual(errors, []);
        console.log(
          "PASS " +
            transport +
            ": party PLAY, guest read-only setup, looping synchronized selectors, responsive Start Match, same arena/kickoff, actual input touch, shared Heatseeker authority and ownership visuals",
        );
      } finally {
        for (const page of pages) await page.context().close();
        await app.close();
      }
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
