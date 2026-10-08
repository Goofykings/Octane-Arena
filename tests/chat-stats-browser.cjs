const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict"),
  { resolve } = require("node:path"),
  { pathToFileURL } = require("node:url");
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
      const { app, partyMatches } = await startLan(8106, ":memory:", {
        matchTransport: transport,
        stunUrls: [],
      });
      const pages = [],
        errors = [];
      try {
        const open = async (name) => {
          const context = await browser.newContext({
            viewport: { width: 1280, height: 720 },
          });
          await context.addInitScript((name) => {
            localStorage.setItem(
              "octane-arena-settings",
              JSON.stringify({ quality: "low" }),
            );
            localStorage.setItem(
              "octane-arena-profile",
              JSON.stringify({
                profileVersion: 1,
                localPlayerId: crypto.randomUUID(),
                name,
                avatarId: "helmet",
              }),
            );
          }, name);
          const p = await context.newPage();
          p.setDefaultTimeout(30000);
          p.on("pageerror", (e) => errors.push(e.message));
          await p.goto("http://127.0.0.1:8106/?test");
          await p.waitForFunction(
            () =>
              window.__arena?.party.connection === "connected" &&
              !window.__arena.party.busy,
          );
          pages.push(p);
          return p;
        };
        const host = await open("Alpha"),
          guest = await open("Bravo");
        const action = async (p, name, data = {}) => {
          await p.waitForFunction(() => !window.__arena.party.busy);
          const result = await p.evaluate(
            async ({ name, data }) => ({
              ok: await window.__arena.party.action(name, data),
              message: window.__arena.party.message,
            }),
            { name, data },
          );
          assert.equal(result.ok, true, result.message);
        };
        await action(host, "create");
        const code = await host.evaluate(() => window.__arena.party.state.code);
        await action(guest, "join", { code });
        await action(host, "stage", { stage: "mode" });
        await action(host, "launch");
        for (const p of pages)
          await p.waitForFunction(
            () => window.__arena.network.latest?.phase === "playing",
          );
        const hostId = await host.evaluate(() => window.__arena.party.playerId),
          guestId = await guest.evaluate(() => window.__arena.party.playerId);
        for (const p of pages)
          await p.evaluate(() => {
            const a = window.__arena,
              original = a.audio.tone.bind(a.audio);
            window.statSounds = 0;
            a.audio.tone = (...args) => {
              if (args[0] === 740 && args[1] === 0.09) window.statSounds++;
              return original(...args);
            };
          });
        await guest.waitForFunction(
          (id) =>
            window.__arena.network.latest.stats.find((s) => s.playerId === id)
              .ping !== null,
          guestId,
        );
        const ping = await guest.evaluate(
          (id) =>
            window.__arena.network.latest.stats.find((s) => s.playerId === id)
              .ping,
          guestId,
        );
        assert.ok(ping >= 0 && ping < 10000);
        if (transport === "webrtc")
          assert.equal(
            await host.evaluate(
              (id) =>
                window.__arena.network.latest.stats.find(
                  (s) => s.playerId === id,
                ).ping,
              hostId,
            ),
            null,
          );
        await host.bringToFront();
        await host.keyboard.press("KeyT");
        await host.locator("#chat-input").waitFor({ state: "visible" });
        assert.equal(
          await host
            .locator("#chat-input")
            .evaluate((el) => document.activeElement === el),
          true,
        );
        await host.keyboard.type("wasd ");
        const controls = await host.evaluate(() =>
          window.__arena.input.sample(),
        );
        assert.equal(controls.throttle, 0);
        assert.equal(controls.steer, 0);
        assert.equal(controls.jump, false);
        await host.waitForTimeout(2800);
        assert.equal(
          await host
            .locator("#match-chat")
            .evaluate((el) => getComputedStyle(el).opacity),
          "1",
        );
        const text = "<img src=x onerror=alert(1)> Nice shot!";
        await host.locator("#chat-input").fill(text);
        await host.keyboard.press("Enter");
        for (const p of pages)
          await p.waitForFunction(
            (text) =>
              document
                .querySelector("#match-chat .chat-lines")
                .textContent.includes(text),
            text,
          );
        assert.equal(await guest.locator("#match-chat img").count(), 0);
        assert.equal(
          await guest
            .locator("#match-chat .chat-lines b")
            .first()
            .textContent(),
          "Alpha: ",
        );
        assert.equal(
          await guest
            .locator("#match-chat .chat-lines b")
            .first()
            .evaluate((el) => getComputedStyle(el).color),
          "rgb(116, 200, 255)",
        );
        await host.waitForFunction(() => !window.__arena.input.typing);
        await host.waitForTimeout(2900);
        assert.equal(
          await guest
            .locator("#match-chat")
            .evaluate((el) => getComputedStyle(el).opacity),
          "0",
        );
        await guest.bringToFront();
        await guest.keyboard.press("KeyT");
        await guest.locator("#chat-input").fill("GG");
        await guest.keyboard.press("Enter");
        await host.waitForFunction(() =>
          document
            .querySelector("#match-chat .chat-lines")
            .textContent.includes("Bravo: GG"),
        );
        await guest.keyboard.press("KeyT");
        await guest.locator("#chat-input").fill("spam");
        await guest.keyboard.press("Enter");
        await guest.waitForFunction(() =>
          document
            .querySelector("#match-chat small")
            .textContent.includes("wait"),
        );
        assert.equal(
          await guest.evaluate(() => window.__arena.input.typing),
          true,
        );
        await guest.keyboard.press("Escape");
        await guest.keyboard.down("Tab");
        await guest.locator("#match-board").waitFor({ state: "visible" });
        assert.equal(
          await guest.locator("#match-board .stat-row[data-player]").count(),
          2,
        );
        assert.equal(
          await guest
            .locator("#match-board .local-player")
            .getAttribute("data-player"),
          guestId,
        );
        await guest.keyboard.up("Tab");
        await guest.locator("#match-board").waitFor({ state: "hidden" });
        // Actual movement produces authoritative discrete touch statistics in both transports.
        await host.bringToFront();
        await host.keyboard.down("KeyW");
        await host.keyboard.down("ShiftLeft");
        for (let i = 0; i < 160; i++) {
          if (
            await host.evaluate(
              (id) =>
                window.__arena.network.latest.stats.find(
                  (s) => s.playerId === id,
                ).touches > 0,
              hostId,
            )
          )
            break;
          await host.evaluate(() => {
            const a = window.__arena,
              s = a.network.latest,
              c = s.cars.find((c) => c.id === a.party.playerId),
              q = c.rotation;
            const dx = s.ball.position.x - c.position.x,
              dz = s.ball.position.z - c.position.z;
            const fx = -2 * (q.x * q.z + q.y * q.w),
              fz = -(1 - 2 * (q.x * q.x + q.y * q.y)),
              rx = 1 - 2 * (q.y * q.y + q.z * q.z),
              rz = 2 * (q.x * q.z - q.y * q.w);
            const error = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
            a.input.keys.delete(a.input.bindings.left);
            a.input.keys.delete(a.input.bindings.right);
            if (Math.abs(error) > 0.06)
              a.input.keys.add(
                error > 0 ? a.input.bindings.right : a.input.bindings.left,
              );
          });
          await host.waitForTimeout(80);
        }
        await host.keyboard.up("KeyW");
        await host.keyboard.up("ShiftLeft");
        await host.evaluate(() => window.__arena.input.clear());
        await guest.waitForFunction(
          (id) =>
            window.__arena.network.latest.stats.find((s) => s.playerId === id)
              .touches > 0,
          hostId,
        );
        if (transport === "server") {
          const game = partyMatches.matches.get(code);
          game.simulation.ball.setTranslation({ x: 0, y: 2, z: -54 }, true);
          game.simulation.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
          await host.waitForFunction(
            (id) =>
              window.__arena.network.latest.stats.find((s) => s.playerId === id)
                .goals === 1,
            hostId,
          );
          await guest.waitForFunction(
            (id) =>
              window.__arena.network.latest.stats.find((s) => s.playerId === id)
                .goals === 1,
            hostId,
          );
          const counts = await host.evaluate(() =>
            window.__arena.network.latest.stats.map(({ ping, ...s }) => s),
          );
          await host.waitForFunction(
            () =>
              document.querySelector("#match-award strong")?.textContent ===
              "GOAL",
          );
          assert.ok(await host.evaluate(() => window.statSounds > 0));
          assert.equal(
            await guest.locator("#match-award strong").count(),
            0,
            "Remote goal must not create a local achievement",
          );
          await guest.waitForFunction(
            () => window.__arena.network.latest.phase === "replay",
          );
          await guest.bringToFront();
          await guest.keyboard.down("Tab");
          await guest.locator("#match-board").waitFor({ state: "visible" });
          await guest.keyboard.up("Tab");
          await guest.keyboard.press("KeyT");
          await guest.locator("#chat-input").fill("Replay chat");
          await guest.keyboard.press("Enter");
          await host.waitForFunction(() =>
            document
              .querySelector("#match-chat .chat-lines")
              .textContent.includes("Replay chat"),
          );
          assert.deepEqual(
            await host.evaluate(() =>
              window.__arena.network.latest.stats.map(({ ping, ...s }) => s),
            ),
            counts,
          );
          game.match.kickoff(game.simulation);
        }
        await host.bringToFront();
        await host.keyboard.down("Tab");
        await host.locator("#match-board").waitFor({ state: "visible" });
        await host.screenshot({
          path: "docs/match-scoreboard-" + transport + ".png",
        });
        await host.keyboard.up("Tab");
        await host.setViewportSize({ width: 390, height: 844 });
        await host.keyboard.down("Tab");
        const bounds = await host.locator("#match-board").boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391);
        await host.screenshot({ path: "docs/match-scoreboard-small.png" });
        await host.keyboard.up("Tab");
        assert.deepEqual(errors, []);
        console.log(
          "PASS " +
            transport +
            ": T/focus/neutral typing, safe team-colored chat, send/receive/fade/scrollback/rate limit/Escape, hold/release scoreboard, real synchronized ping, shared touch stats and responsive rows",
        );
      } finally {
        for (const p of pages) await p.context().close();
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
