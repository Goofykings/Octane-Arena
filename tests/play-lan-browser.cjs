const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { resolve } = require("node:path"),
  { pathToFileURL } = require("node:url");
(async () => {
  const { startLan } = await import(
    pathToFileURL(resolve("server/dist/server/src/lan.js")).href
  );
  const { app, partyMatches, addresses } = await startLan(8097, ":memory:");
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      args: ["--enable-unsafe-swiftshader"],
    });
    const base = `http://${addresses[0] || "127.0.0.1"}:8097`;
    const pages = [];
    const errors = [];
    for (const choice of ["beach", "circuit"]) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
      });
      await context.addInitScript((choice) => {
        localStorage.setItem("octane-arena-map", choice);
        localStorage.setItem(
          "octane-arena-settings",
          JSON.stringify({ quality: "low" }),
        );
      }, choice);
      const p = await context.newPage();
      p.on("pageerror", (e) => errors.push(e.message));
      await p.goto(base + "/?test");
      await p.waitForFunction(
        () =>
          window.__arena?.party.connection === "connected" &&
          !window.__arena.party.busy,
      );
      pages.push(p);
    }
    const [host, guest] = pages;
    const localId = await host.evaluate(
      () => window.__arena.accounts.profile.value.localPlayerId,
    );
    const action = async (p, name, payload = {}) => {
      await p.bringToFront();
      for (let attempt = 0; attempt < 10; attempt++) {
        await p.waitForFunction(() => !window.__arena.party.busy, null, {
          polling: 100,
        });
        const result = await p.evaluate(
          async ({ name, payload }) => {
            const party = window.__arena.party;
            if (party.busy) return null;
            const ok = await party.action(name, payload);
            return { ok, message: party.message };
          },
          { name, payload },
        );
        if (result === null) continue;
        assert.equal(result.ok, true, `${name}: ${result.message}`);
        return;
      }
      throw Error(`Party remained busy during ${name}`);
    };
    await action(host, "create");
    const code = await host.evaluate(() => window.__arena.party.state.code);
    await action(guest, "join", { code });
    const sessionId = await host.evaluate(() => window.__arena.party.playerId);
    await host.bringToFront();
    await host
      .getByRole("button", { name: "Customize Account", exact: true })
      .click();
    await host.locator("#profile-edit-name").fill("LAN Driver");
    await host.locator("#profile-avatar-edit").click();
    await host.locator('[data-avatar="prism"]').click();
    await host.locator('[data-avatar-color="#75DBA6"]').click();
    await host.locator("#profile-form button[type=submit]").click();
    await host.locator("#profile-back").click();
    for (const p of pages) {
      await p.bringToFront();
      await p.waitForFunction(
        (id) =>
          window.__arena.party.state.members.some(
            (m) =>
              m.id === id &&
              m.name === "LAN Driver" &&
              m.avatarId === "prism" &&
              m.avatarColor === "#75DBA6" &&
              !("tag" in m),
          ),
        sessionId,
        { polling: 100, timeout: 60000 },
      );
      assert.equal(
        await p
          .locator(`.party-avatar[data-player="${sessionId}"]`)
          .evaluate((e) => getComputedStyle(e).color),
        "rgb(117, 219, 166)",
      );
    }
    assert.equal(
      await host.evaluate(() => window.__arena.party.playerId),
      sessionId,
    );
    assert.equal(
      await host.evaluate(
        () => window.__arena.accounts.profile.value.localPlayerId,
      ),
      localId,
    );
    await action(host, "stage", { stage: "mode" });
    await action(host, "stage", { stage: "teams" });
    await action(host, "team", { team: 0 });
    await action(guest, "team", { team: 1 });
    await host.waitForFunction(
      () => window.__arena.party.state.members.every((m) => m.team !== null),
      null,
      { polling: 100 },
    );
    let previous;
    for (let match = 0; match < 2; match++) {
      // Software-rendered Chrome can starve the same-process server while three
      // Rapier worlds initialize. Suspend drawing during startup, then resume.
      for (const p of pages)
        await p.evaluate(() => {
          window.profileQaRender = window.__arena.graphics.render;
          window.__arena.graphics.render = () => {};
        });
      await action(host, "launch");
      const game = partyMatches.matches.get(code);
      assert.ok(game);
      assert.ok(["city", "beach", "stadium", "circuit"].includes(game.arenaId));
      assert.notEqual(game.arenaId, previous);
      for (const p of pages) {
        await p.bringToFront();
        await p.waitForFunction(
          ({ id, arena }) =>
            window.__arena.network.latest?.matchId === id &&
            window.__arena.networkView &&
            window.__arena.arena.mapId === arena,
          { id: game.id, arena: game.arenaId },
          { polling: 100, timeout: 60000 },
        );
        assert.equal(
          await p.evaluate(() => window.__arena.network.latest.arenaId),
          game.arenaId,
        );
        const identity = await p.evaluate(
          (id) =>
            window.__arena.network.latest.players.find((p) => p.id === id),
          sessionId,
        );
        assert.equal(identity.localPlayerId, localId);
        assert.equal(identity.name, "LAN Driver");
        assert.equal("tag" in identity, false);
        assert.equal(identity.avatarId, "prism");
        assert.equal(identity.avatarColor, "#75DBA6");
        assert.ok(
          (await p.locator("#network-labels").textContent()).includes(
            "LAN Driver",
          ),
        );
        assert.equal(await p.locator("#arena-select").isVisible(), false);
      }
      for (const p of pages)
        await p.evaluate(() => {
          window.__arena.graphics.render = window.profileQaRender;
        });
      console.log(
        `PASS LAN match ${match + 1}: both clients render server arena ${game.arenaId} despite different saved Free Play choices`,
      );
      previous = game.arenaId;
      // Finish the fixture early; use the normal return/relaunch flow afterward.
      game.match.phase = "finished";
      await action(host, "return");
      for (const p of pages) {
        await p.bringToFront();
        await p.waitForFunction(
          () =>
            window.__arena.party.state.stage === "teams" &&
            !window.__arena.networkView,
          null,
          { polling: 100 },
        );
      }
    }
    await action(guest, "leave");
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
