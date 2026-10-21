const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8315);
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      args: ["--enable-unsafe-swiftshader"],
    });
    const page = await browser.newPage({
      viewport: { width: 1366, height: 768 },
    });
    page.setDefaultTimeout(45000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem(
        "octane-arena-settings",
        JSON.stringify({ quality: "low" }),
      );
      window.pad = {
        id: "Mode UI test",
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
    await page.goto(server.url);
    await page.waitForFunction(() => window.__arena);
    await page.locator("#play").click();
    await page.locator("#bot-mode").click();
    await page.locator("#bot-mutators").click();
    const dialog = page.locator(".mutators-panel[open]");
    const boost = dialog.locator("[data-mutator=boostAmount]");
    for (
      let i = 0;
      i < 5 &&
      (await dialog.locator("[data-value=boostAmount]").textContent()) !==
        "RECHARGE SLOW";
      i++
    )
      await boost.locator("[data-step=next]").click();
    assert.equal(
      await page.evaluate(() => __arena.botSetup.mutators.boostAmount),
      "RECHARGE SLOW",
    );
    await dialog.locator("[data-nav-back]").click();
    const mode = async (name) => {
      for (let i = 0; i < 6; i++) {
        if ((await page.evaluate(() => __arena.botSetup.gameMode)) === name)
          return;
        await page.locator("#bot-mode-next").click();
      }
      throw Error("mode not found");
    };
    await mode("heatseeker");
    await page.locator("#bot-mutators").click();
    const verifyLocked = async () => {
      assert.equal(
        await dialog.locator("[data-value=boostAmount]").textContent(),
        "UNLIMITED",
      );
      assert.equal(await boost.getAttribute("aria-disabled"), "true");
      assert.equal(await boost.locator("button:enabled").count(), 0);
      assert.ok(
        (await boost.evaluate((e) =>
          Number(getComputedStyle(e.closest(".mutator-row")).opacity),
        )) < 0.6,
      );
    };
    await verifyLocked();
    await dialog.locator("[data-randomize]").click();
    await verifyLocked();
    await dialog.locator("[data-reset]").click();
    await verifyLocked();
    assert.equal(
      await page.evaluate(() => __arena.botSetup.mutators.boostAmount),
      "RECHARGE SLOW",
      "Forced display does not overwrite normal-mode preference",
    );
    await dialog.locator("[data-nav-back]").click();
    await mode("soccar");
    await page.locator("#bot-mutators").click();
    assert.equal(
      await dialog.locator("[data-value=boostAmount]").textContent(),
      "RECHARGE SLOW",
    );
    assert.equal(await boost.locator("button:enabled").count(), 2);
    await dialog.locator("[data-nav-back]").click();
    await mode("heatseeker");
    await page.locator("#bot-launch").click();
    await page.waitForFunction(
      () =>
        __arena.simulation.gameMode === "heatseeker" &&
        __arena.match.phase === "countdown",
    );
    assert.equal(
      await page.evaluate(() =>
        __arena.simulation.cars.every(
          (c) => c.infiniteBoost && c.boost === 100,
        ),
      ),
      true,
    );
    await page.evaluate(() => {
      __arena.simulation.cars.forEach((c) => {
        c.boost = 1;
        c.applyBoostRule();
      });
    });
    assert.equal(
      await page.evaluate(() =>
        __arena.simulation.cars.every((c) => c.boost === 100),
      ),
      true,
    );
    await page.evaluate(() => __arena.match.finish());
    await page.locator("#home").click();
    // State fixtures exercise the existing party UI for both roles; no external signaling is mocked as a successful connection.
    for (const host of [true, false]) {
      await page.evaluate((host) => {
        const p = __arena.party;
        const member = {
          id: p.playerId,
          name: "Guest",
          title: "",
          avatarId: "helmet",
          avatarColor: "#67d9ff",
          level: 1,
          preset: structuredClone(__arena.garage.current),
          team: 0,
          ready: false,
        };
        p.state = {
          code: "UITEST",
          hostId: host ? p.playerId : "other-host",
          maxPlayers: 8,
          members: host
            ? [member]
            : [member, { ...member, id: "other-host", name: "Host" }],
          mode: "1v1",
          mutators: structuredClone(__arena.botSetup.mutators),
          gameMode: "heatseeker",
          stage: "mode",
          transport: "webrtc",
        };
        __arena.partyPanel.flow.updateVisibility(true);
        __arena.partyPanel.flow.openSetup();
        __arena.partyPanel.flow.mutatorsPanel.show();
      }, host);
      await verifyLocked();
      assert.equal(await dialog.locator("[data-reset]").isDisabled(), !host);
      assert.equal(
        await dialog.locator("[data-mutator=gravity] button:enabled").count(),
        host ? 2 : 0,
      );
      if (!host) {
        const row = dialog.locator("[data-mutator=gravity]");
        assert.equal(
          await row.getAttribute("aria-disabled"),
          "false",
          "Guest can still navigate non-forced read-only values",
        );
        await row.focus();
        assert.equal(
          await row.evaluate((e) => e === document.activeElement),
          true,
        );
      }
      await page.screenshot({
        path: ".tools/mode-tweaks-" + (host ? "host" : "guest") + ".png",
      });
      await dialog.locator("[data-nav-back]").click();
      await page.evaluate(() => {
        __arena.party.state = null;
      });
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS Heatseeker forced/gray infinite boost in bot/party host/guest menus; reset/randomize cannot change it; normal boost preference restored; actual Heatseeker physics stays infinite; guest rows remain navigable.",
    );
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
