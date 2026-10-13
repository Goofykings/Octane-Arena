const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright"),
  assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8252);
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      args: [
        "--enable-unsafe-swiftshader",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
      ],
    });
    const errors = [];
    const open = async (name) => {
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 720 },
      });
      ctx.setDefaultTimeout(45000);
      await ctx.addInitScript((name) => {
        localStorage.setItem(
          "octane-arena-profile",
          JSON.stringify({
            profileVersion: 1,
            localPlayerId: crypto.randomUUID(),
            name,
            avatarId: "helmet",
          }),
        );
        localStorage.setItem(
          "octane-arena-settings",
          JSON.stringify({ quality: "low" }),
        );
      }, name);
      if (name.includes("Host"))
        await ctx.addInitScript(() => {
          window.pad = {
            id: "Party flow controller",
            index: 0,
            connected: true,
            mapping: "standard",
            axes: [0, 0, 0, 0],
            buttons: Array.from({ length: 17 }, () => ({
              pressed: false,
              value: 0,
            })),
          };
          Object.defineProperty(navigator, "getGamepads", {
            value: () => [window.pad],
          });
        });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(server.url);
      await page.waitForFunction(() => window.__arena);
      return page;
    };
    const host = await open("Rumble Host"),
      guest = await open("Rumble Guest");
    const action = async (p, name, data = {}) => {
      await p.waitForFunction(() => !window.__arena.party.busy);
      const out = await p.evaluate(
        async ({ name, data }) => ({
          ok: await window.__arena.party.action(name, data),
          message: window.__arena.party.message,
        }),
        { name, data },
      );
      assert.equal(out.ok, true, out.message);
    };
    await host.locator("#party-create").click();
    await host.waitForFunction(() => window.__arena.party.state);
    const code = await host.evaluate(() => window.__arena.party.state.code);
    await guest.locator("#party-join-open").click();
    await guest.locator("#party-input").fill(code);
    await guest.locator("#party-join button[type=submit]").click();
    for (const p of [host, guest])
      await p.waitForFunction(
        () =>
          window.__arena.party.state?.members.length === 2 &&
          window.octaneArenaNetwork.diagnostics().peers[0]
            ?.bidirectionalVerified,
      );
    await action(host, "stage", { stage: "mode" });
    await action(host, "gamemode", { gameMode: "rumble" });
    await guest.waitForFunction(
      () => window.__arena.party.state?.gameMode === "rumble",
    );
    assert.equal(await host.locator("#party-setup-launch").count(), 0);
    assert.equal(await host.locator("#party-continue").innerText(), "CONTINUE");
    const press = async (i) => {
      await host.bringToFront();
      await host.evaluate(
        (i) => (pad.buttons[i] = { pressed: true, value: 1 }),
        i,
      );
      await host.waitForTimeout(140);
      await host.evaluate(
        (i) => (pad.buttons[i] = { pressed: false, value: 0 }),
        i,
      );
      await host.waitForTimeout(140);
    };
    await press(13);
    assert.equal(
      await host.evaluate(() => document.activeElement.id),
      "party-continue",
    );
    await press(0);
    for (const p of [host, guest])
      await p.waitForFunction(
        () =>
          __arena.party.state.stage === "teams" &&
          document.getElementById("party-flow").open &&
          !__arena.matchLoader.active,
      );
    const chosen = await host.evaluate(() => __arena.party.state.matchArenaId);
    for (const p of [host, guest]) {
      assert.equal(await p.evaluate(() => __arena.arena.mapId), chosen);
      assert.equal(await p.locator("#party-launch").innerText(), "START MATCH");
    }
    assert.equal(await host.locator("#party-launch").isDisabled(), true);
    assert.equal(await guest.locator("#party-launch").isVisible(), false);
    await host.waitForFunction(() =>
      document.activeElement.matches('.party-team-join[data-team="0"]'),
    );
    await press(0);
    await guest.waitForFunction(() =>
      __arena.party.state.members.some((m) => m.team === 0),
    );
    assert.equal(await host.locator("#party-launch").isDisabled(), true);
    assert.equal(
      await guest.locator('.party-team-join[data-team="0"]').isDisabled(),
      true,
    );
    await guest.locator('.party-team-join[data-team="1"]').click();
    await host.waitForFunction(
      () => !document.getElementById("party-launch").disabled,
    );
    await host.waitForFunction(
      () => document.activeElement.id === "party-launch",
    );
    await press(0);
    for (const p of [host, guest])
      await p.waitForFunction(
        () => __arena.network.latest?.phase === "playing",
      );
    for (const p of [host, guest])
      assert.equal(
        await p.evaluate(() => __arena.network.latest.arenaId),
        chosen,
      );
    await action(guest, "leave");
    await host.waitForFunction(
      () =>
        __arena.party.state.members.length === 1 &&
        __arena.party.state.stage === "teams" &&
        document.getElementById("party-flow").open &&
        !__arena.matchLoader.active,
    );
    assert.equal(await host.locator("#party-launch").isDisabled(), true);
    assert.deepEqual(errors, []);
    console.log(
      "PASS two real PeerJS browser sessions: Continue loads same host arena before team UI, synchronized capacity/teams, host-only enabled Start Match, retained match arena and disconnect recovery",
    );
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
