const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8303);
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      args: ["--enable-unsafe-swiftshader"],
    });
    const errors = [];
    const configure = (p) =>
      p.evaluate(() => {
        Object.assign(__arena.trainingCloud, {
          config: {
            apiKey: "demo-api-key",
            projectId: "demo-octane-training",
            appId: "demo-app",
            authDomain: "localhost",
          },
          emulator: {
            authUrl: "http://127.0.0.1:9099",
            host: "127.0.0.1",
            port: 8087,
          },
        });
      });
    const make = async () => {
      const context = await browser.newContext({
        viewport: { width: 1366, height: 768 },
      });
      await context.addInitScript(() => {
        localStorage.setItem(
          "octane-arena-settings",
          JSON.stringify({ quality: "low" }),
        );
        window.pad = {
          id: "Editor controller",
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
      const page = await context.newPage();
      page.setDefaultTimeout(45000);
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(server.url);
      await page.waitForFunction(() => window.__arena);
      await configure(page);
      return { page, context };
    };
    const { page, context } = await make();
    const menu = async (p) => {
      await p.locator("#play").click();
      await p.locator("#extra-mode").click();
      await p.locator("#training-mode").click();
    };
    const packName = "Cleanup browser " + Date.now();
    await menu(page);
    await page.locator("#training-create").click();
    await page.locator("#new-training-pack").click();
    await page.locator("#training-pack-name").fill(packName);
    await page
      .locator("#training-pack-prompt")
      .getByRole("button", { name: "CREATE", exact: true })
      .click();
    await page.locator("#training-pack-prompt").waitFor({ state: "hidden" });
    const edit = async () => {
      await page
        .locator(".training-pack-row")
        .getByRole("button", { name: "EDIT", exact: true })
        .click();
      await page
        .locator("#custom-training-editor")
        .waitFor({ state: "visible" });
    };
    await edit();
    const state = () =>
      page.evaluate(() =>
        structuredClone(__arena.extraSession.draft.pack.shots),
      );
    const selected = () =>
      page.evaluate(() => __arena.extraSession.draft.index);
    const shotRows = () => page.locator("#custom-shot-nav [data-shot-select]");
    const field = async (id, value) => {
      await page.locator("#custom-" + id).fill(String(value));
      await page.locator("#custom-" + id).dispatchEvent("change");
    };
    const object = async (kind) => {
      await page.locator("#custom-select-" + kind).click();
      if (
        (await page.locator("#custom-more").getAttribute("aria-expanded")) !==
        "true"
      )
        await page.locator("#custom-more").click();
    };
    const save = async () => {
      await page.keyboard.press("Control+s");
      assert.equal(
        await page.evaluate(() => __arena.extraSession.draft.dirty),
        false,
      );
    };
    const openMenu = async () => {
      await page.locator("#custom-editor-menu-open").click();
      await page.locator("#custom-editor-menu").waitFor({ state: "visible" });
    };
    const returnMenu = async () => {
      await page.locator("#custom-menu-return").click();
      await page.locator("#custom-editor-menu").waitFor({ state: "hidden" });
    };
    const confirm = (name) =>
      page
        .locator(".training-pack-prompt[open]")
        .getByRole("button", { name, exact: true })
        .click();
    await page.waitForFunction(() => __arena.extraSession.dots.count > 0);
    assert.ok(
      Math.abs(
        (await page.evaluate(() => __arena.extraSession.orbit.target.z)) - 9,
      ) < 0.001,
      "Initial authoring view frames both ball and car",
    );
    assert.ok(
      (await page.locator("#custom-undo").boundingBox()).height <= 29,
      "Compact shot-action icons honor their height",
    );
    assert.equal(await page.locator("#custom-edit-details").isVisible(), false);
    assert.equal(
      await page.evaluate(() => __arena.extraSession.transform.enabled),
      false,
    );
    assert.equal(
      await page.evaluate(() => __arena.extraSession.launcher.visible),
      false,
    );
    assert.equal(await page.locator("#custom-save-pack").count(), 0);
    assert.equal(await page.locator("#custom-publish").count(), 0);
    assert.equal(await page.locator("#custom-undo").innerText(), "");
    await page.screenshot({ path: ".tools/training-cleanup-default.png" });
    const initial = await page.evaluate(() =>
      __arena.extraSession.points.map((p) => p.toArray()),
    );
    await object("ball");
    await field("ball-speed", 24);
    await field("ball-heading", 60);
    await field("ball-elevation", 25);
    await field("position-y", 7);
    await page.waitForFunction(() => !__arena.extraSession.pending);
    assert.notDeepEqual(
      await page.evaluate(() =>
        __arena.extraSession.points.map((p) => p.toArray()),
      ),
      initial,
    );
    // Real blank-scene drag/zoom must still orbit without moving authored objects.
    const ballBefore = (await state())[0].ballPosition;
    const cameraBefore = await page.evaluate(() =>
      __arena.extraSession.orbit.object.position.toArray(),
    );
    await page.mouse.move(1150, 350);
    await page.mouse.down();
    await page.mouse.move(1220, 390, { steps: 8 });
    await page.mouse.up();
    await page.mouse.wheel(0, -200);
    await page.waitForTimeout(300);
    assert.notDeepEqual(
      await page.evaluate(() =>
        __arena.extraSession.orbit.object.position.toArray(),
      ),
      cameraBefore,
    );
    assert.deepEqual((await state())[0].ballPosition, ballBefore);
    // Direct ball selection and dragging, coalesced into one history step.
    await page.locator("#custom-focus-object").click();
    const project = (name) =>
      page.evaluate((name) => {
        const s = __arena.extraSession,
          p = s[name]
            .getWorldPosition(s.ball.position.clone())
            .project(s.orbit.object);
        return {
          x: ((p.x + 1) * innerWidth) / 2,
          y: ((1 - p.y) * innerHeight) / 2,
        };
      }, name);
    const drag = async (name, dx, dy) => {
      const p = await project(name);
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.mouse.move(p.x + dx, p.y + dy, { steps: 12 });
      await page.mouse.up();
    };
    await drag("ball", 60, 20);
    assert.notDeepEqual(
      (await state())[0].ballPosition,
      ballBefore,
      "Direct ball drag changes placement",
    );
    await page.locator("#custom-undo").click();
    assert.deepEqual(
      (await state())[0].ballPosition,
      ballBefore,
      "One undo restores full drag",
    );
    await page.locator("#custom-redo").click();
    // Drag the ball arrow in screen space: both direction/power and predictor update.
    const arrowBefore = (await state())[0];
    await drag("ballHandle", 70, -20);
    const arrowAfter = (await state())[0];
    assert.notEqual(arrowAfter.ballLaunchSpeed, arrowBefore.ballLaunchSpeed);
    assert.notDeepEqual(
      arrowAfter.ballLaunchDirection,
      arrowBefore.ballLaunchDirection,
    );
    await page.waitForFunction(() => !__arena.extraSession.pending);
    assert.equal(
      Number(await page.locator("#custom-ball-speed").inputValue()),
      Math.round(arrowAfter.ballLaunchSpeed * 1000) / 1000,
    );
    // Dragging an already-full arrow farther cannot exceed the existing physics cap.
    const maxPower = Number(
      await page.locator("#custom-ball-speed").getAttribute("max"),
    );
    await field("ball-heading", 90);
    await field("ball-elevation", 0);
    await field("ball-speed", maxPower);
    await page.locator("#custom-focus-object").click();
    await drag("ballHandle", 80, 0);
    assert.equal((await state())[0].ballLaunchSpeed, maxPower);
    assert.equal(
      await page.evaluate(() => __arena.extraSession.ballPowerArrow.length),
      18,
    );
    assert.equal(
      await page.evaluate(() =>
        __arena.extraSession.ballPowerArrow.shaft.material.color.getHex(),
      ),
      0xff3030,
    );
    await field("ball-speed", 24);
    // Existing advanced translation and rotation remain opt-in on the selected object.
    await page.locator("#custom-transform-toggle").click();
    assert.equal(
      await page.evaluate(() => __arena.extraSession.transform.enabled),
      true,
    );
    await page.locator("#custom-focus-object").click();
    const gizmoPoint = await page.evaluate(() => {
      const s = __arena.extraSession;
      const mesh = s.transform._gizmo.picker.translate.children.find(
        (c) => c.name === "X",
      );
      mesh.geometry.computeBoundingSphere();
      const p = mesh.geometry.boundingSphere.center
        .clone()
        .applyMatrix4(mesh.matrixWorld)
        .project(s.orbit.object);
      return {
        x: ((p.x + 1) * innerWidth) / 2,
        y: ((1 - p.y) * innerHeight) / 2,
      };
    });
    const gizmoBefore = (await state())[0].ballPosition;
    await page.mouse.move(gizmoPoint.x, gizmoPoint.y);
    await page.waitForTimeout(80);
    assert.equal(
      await page.evaluate(() => __arena.extraSession.transform.axis),
      "X",
    );
    await page.mouse.down();
    await page.mouse.move(gizmoPoint.x + 60, gizmoPoint.y, { steps: 10 });
    await page.mouse.up();
    assert.notDeepEqual(
      (await state())[0].ballPosition,
      gizmoBefore,
      "Opt-in three-axis gizmo still moves the selected object",
    );
    await page.locator("#custom-select-car").click();
    assert.equal(
      await page.evaluate(() => __arena.extraSession.transform.enabled),
      false,
    );
    assert.equal(await page.locator("#custom-edit-details").isVisible(), false);
    // A zero-velocity car still has a draggable short arrow, independently of the car model.
    await page.locator("#custom-focus-object").click();
    await drag("carHandle", 55, -35);
    assert.ok(
      Math.hypot(...Object.values((await state())[0].carVelocity)) > 0.1,
    );
    const carBefore = (await state())[0].carPosition;
    await drag("model", 45, 15);
    assert.notDeepEqual(
      (await state())[0].carPosition,
      carBefore,
      "Direct car-body dragging changes placement",
    );
    // Distinct settings make persistence, enabled filtering and switching observable.
    for (let i = 0; i < 3; i++) {
      if (i) await page.locator("#custom-add-shot").click();
      await object("ball");
      await field("position-x", i * 3);
      await field("position-y", 5 + i);
      await field("ball-speed", 15 + i * 5);
      await field("ball-heading", i * 30);
      await object("car");
      await field("position-x", i * 2);
      await field("position-y", 0.6 + i);
      await field("car-speed", 3 + i);
      await field("car-heading", 30 + i * 20);
      await field("car-yaw", i * 15);
    }
    assert.equal(new Set((await state()).map((s) => s.id)).size, 3);
    await shotRows().nth(1).click();
    const middleBefore = (await state())[1];
    await page
      .getByRole("button", { name: "Disable Shot 2", exact: true })
      .click();
    assert.equal((await state())[1].enabled, false);
    assert.equal(await page.locator("#custom-play-shot").isDisabled(), true);
    assert.equal(
      await page
        .locator(".custom-shot-row")
        .nth(1)
        .getAttribute("data-enabled"),
      "false",
    );
    await page.locator("#custom-undo").click();
    assert.equal((await state())[1].enabled, true);
    await page.locator("#custom-redo").click();
    await page
      .getByRole("button", { name: "Enable Shot 2", exact: true })
      .click();
    const restored = (await state())[1];
    assert.deepEqual(restored.ballPosition, middleBefore.ballPosition);
    assert.deepEqual(restored.carVelocity, middleBefore.carVelocity);
    await page
      .getByRole("button", { name: "Disable Shot 2", exact: true })
      .click();
    await page.locator("#custom-duplicate-shot").click();
    const duplicate = (await state())[2];
    assert.notEqual(duplicate.id, middleBefore.id);
    assert.equal(duplicate.enabled, true);
    assert.equal(await selected(), 2);
    assert.deepEqual(duplicate.ballPosition, middleBefore.ballPosition);
    await page.locator("#custom-delete-shot").hover();
    assert.equal(
      await page
        .locator("#custom-delete-shot")
        .evaluate((e) => getComputedStyle(e).color),
      "rgb(255, 111, 120)",
    );
    await page.locator("#custom-delete-shot").click();
    const confirmBox = await page
      .locator(".training-pack-prompt[open]")
      .boundingBox();
    assert.ok(
      confirmBox.height < 400,
      "Confirmation fits its content, not the whole screen: " +
        confirmBox.height,
    );
    await page.screenshot({ path: ".tools/training-dialog-fit.png" });
    await confirm("CANCEL");
    assert.equal((await state()).length, 4);
    await page.locator("#custom-delete-shot").click();
    await confirm("DELETE");
    assert.equal((await state()).length, 3);
    // Three shots fit without scrolling; the entire left panel collapses, not the right actions.
    await save();
    const navBox = await page.locator("#custom-shot-nav").boundingBox();
    for (let i = 0; i < 3; i++) {
      const b = await shotRows().nth(i).boundingBox();
      assert.ok(
        b.y >= navBox.y && b.y + b.height <= navBox.y + navBox.height + 1,
      );
    }
    assert.equal(await page.locator(".custom-toolbar-shell").count(), 0);
    const actions = await page.locator(".custom-editor-right").boundingBox();
    assert.ok(
      actions.x > 1000 && actions.y < 160,
      "Shot actions live on the right",
    );
    await page.locator("#custom-sidebar-toggle").click();
    await page.waitForTimeout(350);
    assert.equal(
      await page.locator(".custom-editor-left").evaluate((e) => e.inert),
      true,
    );
    assert.equal(
      await page.locator(".custom-edit-controls").isVisible(),
      false,
    );
    const handle = await page.locator("#custom-sidebar-toggle").boundingBox();
    assert.ok(handle.x >= -1 && handle.x + handle.width < 45);
    assert.equal(await page.locator(".custom-editor-right").isVisible(), true);
    assert.equal(
      await page.evaluate(() => __arena.extraSession.draft.dirty),
      false,
    );
    await page.locator("#custom-sidebar-toggle").click();
    await page.waitForTimeout(350);
    // Controller navigation retains normal object controls and opens menu with Start.
    const tap = async (i) => {
      await page.evaluate(
        (i) => (window.pad.buttons[i] = { pressed: true, value: 1 }),
        i,
      );
      await page.waitForTimeout(220);
      await page.evaluate(
        (i) => (window.pad.buttons[i] = { pressed: false, value: 0 }),
        i,
      );
      await page.waitForTimeout(220);
    };
    await page.locator("#custom-select-ball").click();
    await tap(11);
    await tap(15);
    await tap(0);
    assert.equal(
      await page.evaluate(() => __arena.extraSession.selected),
      "car",
    );
    await tap(9);
    await page.locator("#custom-editor-menu").waitFor({ state: "visible" });
    await returnMenu();
    // Escape only toggles menu; Return does not save.
    await object("ball");
    await field("ball-speed", 29);
    await page.keyboard.press("Escape");
    await page.locator("#custom-editor-menu").waitFor({ state: "visible" });
    assert.deepEqual(
      await page.locator("#custom-editor-menu nav button").allTextContents(),
      ["RETURN", "PUBLISH", "SAVE AND EXIT", "EXIT"],
    );
    await page.keyboard.press("Escape");
    await page.locator("#custom-editor-menu").waitFor({ state: "hidden" });
    assert.equal(
      await page.evaluate(() => __arena.extraSession.draft.dirty),
      true,
    );
    await openMenu();
    await page.locator("#custom-save-exit").click();
    await page.locator("#custom-training").waitFor({ state: "visible" });
    await edit();
    const saved = await state();
    assert.equal(saved[1].enabled, false);
    assert.equal(
      await page.evaluate(() => __arena.extraSession.draft.dirty),
      false,
    );
    // Enabled-only test list switches immediately, preserving authored state on return.
    await shotRows().nth(0).click();
    await page.locator("#custom-play-shot").click();
    assert.equal(await shotRows().count(), 2);
    assert.deepEqual(await shotRows().allTextContents(), ["SHOT 1", "SHOT 2"]);
    assert.equal(
      await page.evaluate(() => __arena.extraSession.editing),
      false,
    );
    // A real scoring position starts the existing explosion; mouse Skip advances immediately.
    const scoreGoal = async () => {
      await page.evaluate(() => {
        const s = __arena.extraSession;
        s.physics.ball.setTranslation({ x: 0, y: 2, z: 53 }, true);
        s.physics.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
      });
      await page.waitForFunction(
        () => __arena.extraSession.goalExplosion.active,
      );
      assert.equal(await page.locator("#custom-skip-goal").isVisible(), true);
      assert.equal(
        await page.evaluate(() =>
          __arena.extraSession.physics.ball.isEnabled(),
        ),
        false,
      );
      assert.notEqual(
        await page.locator(".custom-edit-status").textContent(),
        "GOAL",
      );
    };
    await scoreGoal();
    await page.locator("#custom-skip-goal").click();
    assert.equal(await selected(), 2);
    assert.equal(
      await page.evaluate(() => __arena.extraSession.goalExplosion.active),
      false,
    );
    await shotRows().nth(0).click();
    await scoreGoal();
    await page.keyboard.press("Space");
    assert.equal(await selected(), 2);
    await shotRows().nth(0).click();
    await scoreGoal();
    await tap(0);
    assert.equal(await selected(), 2);
    await shotRows().nth(0).click();
    await scoreGoal();
    await page.waitForFunction(
      () =>
        __arena.extraSession.draft.index === 2 &&
        !__arena.extraSession.goalExplosion.active,
    );
    await shotRows().nth(0).click();
    const resetSequence = await page.evaluate(
      () => __arena.extraSession.resetSequence,
    );
    await shotRows().nth(1).click();
    assert.equal(await selected(), 2);
    assert.ok(
      (await page.evaluate(() => __arena.extraSession.resetSequence)) >
        resetSequence,
    );
    const reset = await page.evaluate(() => {
      const s = __arena.extraSession;
      s.reset();
      return {
        ball: s.physics.ball.translation(),
        velocity: s.vehicle.body.linvel(),
        boost: s.vehicle.boost,
      };
    });
    assert.ok(Math.abs(reset.ball.y - saved[2].ballPosition.y) < 0.0001);
    assert.ok(Math.abs(reset.velocity.x - saved[2].carVelocity.x) < 0.0001);
    assert.equal(reset.boost, 100);
    await page.keyboard.down("w");
    await page.waitForTimeout(300);
    await page.keyboard.up("w");
    assert.ok(
      (await page.evaluate(() => __arena.extraSession.run.elapsed)) > 0,
    );
    await page.locator("#custom-return-edit").click();
    assert.deepEqual(await state(), saved);
    // Dirty Exit never modifies the prior local save; Cancel keeps the draft.
    await object("ball");
    await field("ball-speed", 31);
    await openMenu();
    await page.locator("#custom-editor-back").click();
    await page
      .getByRole("heading", { name: "UNSAVED CHANGES", exact: true })
      .waitFor();
    await confirm("CANCEL");
    assert.equal((await state())[2].ballLaunchSpeed, 31);
    await page.locator("#custom-editor-back").click();
    await confirm("EXIT WITHOUT SAVING");
    await page.locator("#custom-training").waitFor({ state: "visible" });
    await page.reload();
    await page.waitForFunction(() => window.__arena);
    await configure(page);
    await menu(page);
    await page.locator("#training-create").click();
    await edit();
    assert.deepEqual(await state(), saved);
    // Responsive bounds plus reachable top controls/list; no horizontal clipping.
    for (const [width, height] of [
      [2560, 1440],
      [1920, 1080],
      [1366, 768],
      [1280, 720],
      [900, 600],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(150);
      assert.equal(
        await page
          .locator("#custom-training-editor")
          .evaluate((e) => e.scrollWidth > e.clientWidth + 1),
        false,
        "editor overflow at " + width,
      );
      for (const id of [
        "#custom-play-shot",
        "#custom-editor-menu-open",
        "#custom-shot-nav",
        "#custom-sidebar-toggle",
      ]) {
        const b = await page.locator(id).boundingBox();
        assert.ok(
          b.x >= 0 &&
            b.y >= 0 &&
            b.x + b.width <= width + 1 &&
            b.y + b.height <= height + 1,
          id + " fits " + width,
        );
      }
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: ".tools/training-cleanup.png" });
    console.log(
      "Verified direct object/arrow dragging, history, clean/advanced controls, enabled-only test switching, controller, menu safety, exact persistence and responsive layout.",
    );
    // Actual anonymous-auth Firestore publication through the menu, never production.
    const publish = async (label = "PUBLISH") => {
      await page.locator("#custom-publish").click();
      await confirm(label);
    };
    await openMenu();
    await publish();
    await page.waitForFunction(
      () => __arena.extraSession.draft.pack.publishedVersion === 1,
    );
    await page
      .locator("#custom-editor-menu")
      .getByText("PUBLISHED SUCCESSFULLY", { exact: true })
      .waitFor();
    assert.equal((await state()).length, 3);
    assert.equal((await state())[1].enabled, false);
    await returnMenu();
    await object("ball");
    await field("ball-speed", 32);
    assert.match(
      await page.locator("#custom-edit-mode").textContent(),
      /PUBLISHED • CHANGES NOT PUBLISHED/,
    );
    await openMenu();
    assert.equal(
      await page.locator("#custom-publish").textContent(),
      "UPDATE PUBLISHED PACK",
    );
    await publish("UPDATE");
    await page.waitForFunction(
      () => __arena.extraSession.draft.pack.publishedVersion === 2,
    );
    const { page: friend, context: friendContext } = await make();
    await menu(friend);
    await friend.locator("#training-community").click();
    const friendRow = friend.locator(".training-pack-row").filter({
      has: friend.getByRole("heading", { name: packName, exact: true }),
    });
    await friendRow.waitFor();
    // Someone else's pack is read-only: PLAY is the only action, and no UID is shown.
    assert.deepEqual(await friendRow.getByRole("button").allTextContents(), [
      "PLAY",
    ]);
    assert.doesNotMatch(await friendRow.textContent(), /OWNED/);
    await friendRow.getByRole("button", { name: "PLAY", exact: true }).click();
    await friend
      .locator("#custom-training-editor")
      .waitFor({ state: "visible" });
    assert.equal(
      await friend.evaluate(() => __arena.extraSession.editable),
      false,
    );
    assert.equal(await friend.locator("#custom-return-edit").count(), 0);
    assert.equal(
      await friend.evaluate(() => __arena.extraSession.draft.pack.shots.length),
      2,
    );
    assert.equal(
      await friend.evaluate(
        () => __arena.extraSession.draft.pack.shots[0].ballLaunchSpeed,
      ),
      32,
    );
    await friendContext.close();
    await page.locator("#custom-save-exit").click();
    await page.locator("#custom-training").waitFor({ state: "visible" });
    // Deleting a published pack must offer an explicit choice, never silently unpublish.
    await page
      .locator(".training-pack-row")
      .getByRole("button", { name: "DELETE", exact: true })
      .click();
    const deletePrompt = page.locator("#training-pack-prompt");
    assert.deepEqual(await deletePrompt.getByRole("button").allTextContents(), [
      "CANCEL",
      "DELETE LOCAL COPY",
      "UNPUBLISH AND DELETE",
    ]);
    await deletePrompt.getByRole("button", { name: "CANCEL", exact: true }).click();
    await deletePrompt.waitFor({ state: "hidden" });
    await page
      .locator(".training-pack-row")
      .getByRole("button", { name: "UNPUBLISH", exact: true })
      .click();
    await page
      .locator("#training-pack-prompt")
      .getByRole("button", { name: "UNPUBLISH", exact: true })
      .click();
    await page.locator("#training-pack-prompt").waitFor({ state: "hidden" });
    assert.equal(
      await page.evaluate(
        () => __arena.accounts.profile.value.progression.totalXP,
      ),
      0,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS custom training cleanup browser: enabled-only cloud publication/update/read-only community playback, disabled local draft retained, no XP, no runtime errors.",
    );
    await context.close();
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
