const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright"),
  assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8293);
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
      // Test boundary fixture: replicate a final authoritative snapshot through
      // the real Worker -> host -> PeerJS -> guest pipeline. No product debug API.
      await ctx.addInitScript(() => {
        const NativeWorker = window.Worker;
        window.Worker = class extends NativeWorker {
          set onmessage(handler) {
            super.onmessage = (event) => {
              if (window.testFinish && event.data.type === "snapshot") {
                event.data.phase = "finished";
                event.data.score = [3, 2];
                event.data.remaining = 0;
                event.data.stats.forEach((s, i) => {
                  s.score = i === 1 ? 212 : 12;
                  s.goals = i === 1 ? 1 : 0;
                  s.assists = i === 1 ? 1 : 0;
                  s.saves = i === 1 ? 1 : 0;
                  s.shots = 1;
                });
                // Fixture final stats/time at the authoritative Worker boundary; real
                // PeerJS delivery, validation, profile award and UI run unmodified.
                event.data.completion = {
                  id: event.data.matchId,
                  mode: "network",
                  activeSeconds: 300,
                  score: [3, 2],
                  mvpId: event.data.players[1].id,
                  players: event.data.players.map((p, i) => ({
                    id: p.id,
                    team: p.team,
                    controller: p.controller,
                    completed: true,
                    score: i === 1 ? 212 : 12,
                    activeSeconds: 300,
                    activitySeconds: 5,
                  })),
                };
                event.data.message = "MATCH COMPLETE";
              }
              handler(event);
            };
          }
        };
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
    await action(host, "launch");
    for (const p of [host, guest])
      await p.waitForFunction(
        () => __arena.network.latest?.phase === "playing",
      );
    const before = await host.evaluate(() => ({
      id: __arena.party.state.matchId,
      arena: __arena.party.state.matchArenaId,
      teams: __arena.party.state.members.map((m) => [m.id, m.team]),
    }));
    await host.evaluate(() => (window.testFinish = true));
    for (const p of [host, guest])
      await p.waitForFunction(
        () =>
          __arena.network.latest?.phase === "finished" &&
          !!document.querySelector(".mvp-badge"),
      );
    await host.waitForFunction(() => __arena.party.state.matchFinished);
    for (const [p, total] of [
      [host, 1301],
      [guest, 1271],
    ]) {
      await p.waitForFunction(
        (total) => __arena.accounts.profile.value.progression.totalXP === total,
        total,
      );
      assert.equal(
        await p.locator("#xp-earned").innerText(),
        "+" + (p === host ? 1301 : 1271).toLocaleString(),
      );
      assert.equal(await p.locator("#profile-level").innerText(), "2");
    }
    for (const p of [host, guest])
      await p.waitForFunction(() =>
        __arena.party.state.members.every((m) => m.level === 2),
      );
    await host.waitForTimeout(400);
    assert.equal(
      await host.evaluate(
        () =>
          Object.values(__arena.accounts.profile.value.xpAwards).filter(
            (a) => a.source.type === "MATCH",
          ).length,
      ),
      1,
    );
    assert.equal(
      await guest.evaluate(
        () =>
          Object.values(__arena.accounts.profile.value.xpAwards).filter(
            (a) => a.source.type === "MATCH",
          ).length,
      ),
      1,
    );
    for (const [page, count] of [
      [host, 0],
      [guest, 0],
    ])
      assert.equal(
        await page.evaluate(
          () =>
            Object.values(__arena.accounts.profile.value.xpAwards).filter(
              (a) => a.source.type === "CHALLENGE",
            ).length,
        ),
        count,
      );
    assert.equal(await host.locator("#again").isVisible(), true);
    assert.equal(await guest.locator("#again").isVisible(), false);
    assert.equal(
      await host.locator("#result-score").innerText(),
      "BLUE 3 - 2 ORANGE",
    );
    assert.equal(
      await guest.locator("#result-score").innerText(),
      "BLUE 3 - 2 ORANGE",
    );
    assert.equal(
      await guest
        .locator(".mvp-badge")
        .evaluate((e) => e.closest("[data-player]").dataset.player),
      await host
        .locator(".mvp-badge")
        .evaluate((e) => e.closest("[data-player]").dataset.player),
    );
    await guest.locator("#home").click();
    await guest.waitForFunction(
      () => !__arena.networkView && __arena.match.phase === "home",
    );
    await guest.locator("#play").waitFor({ state: "visible" });
    assert.equal(await guest.locator("#play").isVisible(), true);
    assert.equal(
      await guest.evaluate(() => __arena.party.state.members.length),
      2,
    );
    await host.locator("#again").click();
    await host.evaluate(() => (window.testFinish = false));
    for (const p of [host, guest])
      await p.waitForFunction(
        (old) =>
          __arena.network.latest?.phase === "playing" &&
          __arena.network.latest.matchId !== old,
        before.id,
      );
    const after = await host.evaluate(() => ({
      id: __arena.party.state.matchId,
      arena: __arena.party.state.matchArenaId,
      teams: __arena.party.state.members.map((m) => [m.id, m.team]),
      mode: __arena.network.latest.gameMode,
      stats: __arena.network.latest.stats,
    }));
    assert.notEqual(after.id, before.id);
    assert.notEqual(after.arena, before.arena);
    assert.deepEqual(after.teams, before.teams);
    assert.equal(after.mode, "rumble");
    assert.ok(after.stats.every((s) => s.score === 0));
    assert.equal(
      await guest.evaluate(() => __arena.networkView.matchId),
      after.id,
    );
    await host.evaluate(() => (window.testFinish = true));
    await host.waitForFunction(
      () =>
        __arena.party.state.matchFinished &&
        document.querySelector(".mvp-badge"),
    );
    for (const [p, total] of [
      [host, 2602],
      [guest, 2542],
    ])
      await p.waitForFunction(
        (total) => __arena.accounts.profile.value.progression.totalXP === total,
        total,
      );
    await host.locator("#home").click();
    for (const p of [host, guest])
      await p.waitForFunction(
        () =>
          __arena.party.state?.stage === "home" &&
          __arena.match.phase === "home",
      );
    assert.equal(
      await host.evaluate(() => __arena.party.state.members.length),
      2,
    );
    await guest.locator("#play").waitFor({ state: "visible" });
    assert.equal(await guest.locator("#play").isVisible(), true);
    await host.evaluate(() => (window.testFinish = false));
    await action(host, "stage", { stage: "mode" });
    await action(host, "launch");
    for (const p of [host, guest])
      await p.waitForFunction(
        () => __arena.network.latest?.phase === "playing",
      );
    await host.evaluate(() => (window.testFinish = true));
    await guest.waitForFunction(
      () => __arena.network.latest?.phase === "finished",
    );
    for (const [p, total] of [
      [host, 3903],
      [guest, 3813],
    ])
      await p.waitForFunction(
        (total) => __arena.accounts.profile.value.progression.totalXP === total,
        total,
      );
    await guest.locator("#results-leave").click();
    await guest.waitForFunction(() => !__arena.party.state);
    await guest.locator("#play").waitFor({ state: "visible" });
    assert.equal(await guest.locator("#play").isVisible(), true);
    await host.waitForFunction(() => __arena.party.state.members.length === 1);
    assert.deepEqual(errors, []);
    console.log(
      "PASS real PeerJS browser sessions with authoritative completion fixture: independent host/guest XP, same MVP, party levels, duplicate protection, rematch awards, Home/Leave cleanup",
    );
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
