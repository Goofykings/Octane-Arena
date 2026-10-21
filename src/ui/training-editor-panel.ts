import type { TrainingShot } from "../../shared/custom-training";
import { Euler, Quaternion, Vector3 } from "three";
import { P } from "../config/physics";
import { anglesVector, vectorAngles } from "../game/custom-training-editor";
import type { CustomTrainingLibrary } from "../game/custom-training";
import type { CustomTrainingSession } from "../extra/training/custom-session";
import {
  trainingCloudError,
  type TrainingCloud,
} from "../network/firebase-training";
import { icon } from "./icons";
import { TransientStatus } from "./transient-status";
export class TrainingEditorPanel {
  readonly root = document.createElement("section");
  readonly prompt = document.createElement("dialog");
  readonly menu = document.createElement("dialog");
  private status: HTMLElement;
  private notice: TransientStatus;
  private controls: HTMLElement;
  private details: HTMLElement;
  private toolbar: HTMLElement;
  private shots: HTMLElement;
  private tools: HTMLElement;
  private top: HTMLElement;
  private sidebarContent: HTMLElement;
  private handle: HTMLButtonElement;
  private menuStatus = document.createElement("p");
  private menuNotice = new TransientStatus(this.menuStatus);
  private busy = false;
  private more = false;
  private collapsed = false;
  private menuPaused = false;
  private panelObject: "ball" | "car" = "ball";
  private lastEditing: boolean;
  private velocityAims = new Map<
    string,
    { heading: number; elevation: number }
  >();
  private beforeUnload = (event: BeforeUnloadEvent) => {
    if (this.session.editable && this.session.draft.dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  private key = (event: KeyboardEvent) => {
    if (event.isComposing) return;
    const other = Array.from(
      document.querySelectorAll<HTMLDialogElement>("dialog[open]"),
    ).some((d) => d !== this.menu && d !== this.prompt);
    if (other) return;
    if (
      event.code === "Space" &&
      this.session.goalCelebrating &&
      !this.menu.open &&
      !this.prompt.open &&
      !(event.target as HTMLElement)?.closest("input,textarea")
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.session.clearInput();
      this.session.skipGoal();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.session.clearInput();
      if (this.prompt.open) {
        this.prompt.close();
        return;
      }
      if (this.menu.open) this.closeMenu();
      else this.openMenu();
      return;
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "s" &&
      this.session.editing &&
      !this.menu.open &&
      !this.prompt.open &&
      !this.busy
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      (document.activeElement as HTMLElement)?.blur();
      this.session.clearInput();
      this.save();
      return;
    }
    const typing = (event.target as HTMLElement)?.closest(
      "input,textarea,[contenteditable=true]",
    );
    if (
      typing ||
      !this.session.editing ||
      this.menu.open ||
      this.prompt.open ||
      this.busy
    )
      return;
    if (event.ctrlKey || event.metaKey) {
      const key = event.key.toLowerCase();
      if (key === "z" || key === "y" || key === "s") {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.session.clearInput();
        if (key === "s") this.save();
        else this.session.history(key === "y" || event.shiftKey);
      }
    }
  };
  constructor(
    parent: HTMLElement,
    readonly session: CustomTrainingSession,
    private library: CustomTrainingLibrary,
    private cloud: TrainingCloud,
    private username: () => string,
    private exit: () => void,
  ) {
    this.root.id = "custom-training-editor";
    this.root.dataset.navScope = "custom-training-editor";
    this.root.dataset.navPriority = "50";
    this.root.innerHTML =
      '<header class="custom-editor-top"><div class="custom-editor-title"><b id="custom-pack-name"></b><span id="custom-edit-mode"></span></div><div class="custom-editor-top-actions"></div></header><div class="custom-editor-left-shell"><div class="custom-editor-left" id="custom-editor-left-content"><aside class="custom-shot-sidebar"><div class="custom-shot-tools"></div><nav id="custom-shot-nav" aria-label="Training shots"></nav></aside><aside class="custom-edit-controls"></aside></div><button type="button" id="custom-sidebar-toggle" aria-controls="custom-editor-left-content"></button></div><nav class="custom-edit-toolbar custom-editor-right" aria-label="Shot actions"></nav><p class="custom-edit-status" role="status"></p>';
    parent.append(this.root, this.menu, this.prompt);
    this.menu.id = "custom-editor-menu";
    this.menu.dataset.navScope = "custom-editor-menu";
    this.menu.dataset.navDefault = "#custom-menu-return";
    this.menu.setAttribute("aria-label", "Training Editor menu");
    this.prompt.className = "training-pack-prompt";
    this.prompt.dataset.navScope = "custom-editor-confirm";
    this.prompt.setAttribute("aria-label", "Confirm training action");
    this.controls = this.root.querySelector(".custom-edit-controls")!;
    this.details = document.createElement("div");
    this.details.className = "custom-edit-details";
    this.toolbar = this.root.querySelector(".custom-edit-toolbar")!;
    this.sidebarContent = this.root.querySelector(".custom-editor-left")!;
    this.handle = this.root.querySelector("#custom-sidebar-toggle")!;
    this.shots = this.root.querySelector("#custom-shot-nav")!;
    this.tools = this.root.querySelector(".custom-shot-tools")!;
    this.top = this.root.querySelector(".custom-editor-top-actions")!;
    this.status = this.root.querySelector("[role=status]")!;
    this.notice = new TransientStatus(this.status);
    this.handle.onclick = () => {
      this.collapsed = !this.collapsed;
      this.syncSidebar();
    };
    this.syncSidebar();
    this.lastEditing = session.editing;
    session.changed = (fieldsOnly) => {
      if (fieldsOnly) this.syncControls();
      else this.render();
    };
    session.requestExit = () => this.openMenu();
    this.menu.addEventListener("cancel", (event) => {
      event.preventDefault();
      this.closeMenu();
    });
    this.prompt.addEventListener("cancel", () => this.session.clearInput());
    window.addEventListener("beforeunload", this.beforeUnload);
    window.addEventListener("keydown", this.key, true);
    this.render();
  }
  private button(
    parent: HTMLElement,
    label: string,
    action: () => void,
    id?: string,
  ) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "small-button";
    b.textContent = label;
    if (id) b.id = id;
    b.onclick = action;
    parent.append(b);
    return b;
  }
  private iconButton(
    parent: HTMLElement,
    label: string,
    graphic: string,
    action: () => void,
    id?: string,
  ) {
    const b = this.button(parent, "", action, id);
    b.innerHTML = icon(graphic);
    b.classList.add("custom-icon-button");
    b.title = label;
    b.setAttribute("aria-label", label);
    return b;
  }
  private message(text: string, pending = false) {
    this.notice.repeat(text, pending);
    this.menuNotice.repeat(text, pending);
  }
  private save() {
    try {
      this.session.draft.save(this.library, this.username());
      this.message("PACK SAVED");
      this.render();
      return true;
    } catch (error) {
      this.message(trainingCloudError(error));
      return false;
    }
  }
  private confirmation(
    title: string,
    text: string,
    actions: { label: string; action: () => void }[],
  ) {
    this.prompt.replaceChildren();
    const h = document.createElement("h2");
    h.textContent = title;
    const p = document.createElement("p");
    p.textContent = text;
    const footer = document.createElement("footer");
    this.prompt.append(h, p, footer);
    this.prompt.dataset.navDefault = "[data-nav-back]";
    this.button(footer, "CANCEL", () => {
      this.prompt.close();
      this.session.clearInput();
    }).dataset.navBack = "";
    for (const a of actions)
      this.button(footer, a.label, () => {
        this.prompt.close();
        a.action();
      });
    this.prompt.showModal();
    this.session.clearInput();
    this.prompt.querySelector<HTMLButtonElement>("[data-nav-back]")!.focus();
  }
  openMenu() {
    if (this.menu.open || this.prompt.open || this.busy) return;
    (document.activeElement as HTMLElement)?.blur();
    this.session.interaction.finish();
    this.session.clearInput();
    this.menuPaused = this.session.paused;
    this.session.paused = true;
    this.session.setLocked(true);
    this.renderMenu();
    this.menu.showModal();
    this.menu.querySelector<HTMLButtonElement>("#custom-menu-return")!.focus();
  }
  private closeMenu() {
    if (this.busy) return;
    this.menu.close();
    this.session.paused = this.menuPaused;
    this.session.setLocked(false);
    this.session.clearInput();
  }
  private renderMenu() {
    this.menu.replaceChildren();
    const h = document.createElement("h2");
    h.textContent = "TRAINING EDITOR";
    const nav = document.createElement("nav");
    this.menuStatus.setAttribute("role", "status");
    this.menu.append(h, nav, this.menuStatus);
    this.button(
      nav,
      "RETURN",
      () => this.closeMenu(),
      "custom-menu-return",
    ).dataset.navBack = "";
    if (this.session.editable) {
      this.button(nav, "PUBLISH", () => this.publish(), "custom-publish");
      this.button(
        nav,
        "SAVE AND EXIT",
        () => {
          if (this.save()) this.exit();
        },
        "custom-save-exit",
      );
    }
    this.button(nav, "EXIT", () => this.leave(), "custom-editor-back");
    this.menu
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => (b.disabled = this.busy));
  }
  leave() {
    if (this.busy) return;
    if (this.session.editable && this.session.draft.dirty)
      this.confirmation(
        "UNSAVED CHANGES",
        "You have unsaved changes.\nAre you sure you want to exit?",
        [{ label: "EXIT WITHOUT SAVING", action: this.exit }],
      );
    else this.exit();
  }
  private updateDirtyLabel() {
    this.root.querySelector("#custom-edit-mode")!.textContent = this.session
      .editing
      ? this.session.draft.dirty
        ? "EDIT MODE / UNSAVED"
        : "EDIT MODE"
      : this.session.complete
        ? "PACK COMPLETE"
        : this.session.paused
          ? "PAUSED"
          : "PLAY TEST";
  }
  private updateHistoryButtons() {
    const undo = this.root.querySelector<HTMLButtonElement>("#custom-undo"),
      redo = this.root.querySelector<HTMLButtonElement>("#custom-redo");
    if (undo) undo.disabled = this.busy || !this.session.draft.canUndo;
    if (redo) redo.disabled = this.busy || !this.session.draft.canRedo;
  }
  private updateSummary() {
    const summary = this.root.querySelector(".custom-object-summary");
    if (summary) {
      const shot = this.session.draft.shot;
      summary.textContent =
        (this.session.selected === "ball"
          ? shot.ballLaunchSpeed
          : Math.hypot(
              shot.carVelocity.x,
              shot.carVelocity.y,
              shot.carVelocity.z,
            )
        ).toFixed(1) + " m/s";
    }
  }
  private syncSidebar() {
    this.root.querySelector<HTMLElement>(
      ".custom-editor-left-shell",
    )!.dataset.collapsed = String(this.collapsed);
    this.sidebarContent.inert = this.collapsed;
    this.handle.innerHTML = icon(
      this.collapsed ? "chevron-right" : "chevron-left",
    );
    this.handle.setAttribute("aria-expanded", String(!this.collapsed));
    this.handle.setAttribute(
      "aria-label",
      this.collapsed ? "Expand editor panel" : "Collapse editor panel",
    );
    this.handle.title = this.collapsed
      ? "Expand editor panel"
      : "Collapse editor panel";
  }
  private number(
    label: string,
    key: string,
    value: number,
    min: number,
    max: number,
    change: (n: number) => void,
    step = 0.1,
  ) {
    const row = document.createElement("label");
    row.textContent = label;
    const input = document.createElement("input");
    input.type = "number";
    input.id = "custom-" + key;
    input.value = String(Math.round(value * 1000) / 1000);
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.onchange = () => {
      if (!Number.isFinite(input.valueAsNumber)) {
        input.value = String(value);
        return;
      }
      const n = Math.max(min, Math.min(max, input.valueAsNumber));
      input.value = String(n);
      change(n);
      this.session.commit();
    };
    row.append(input);
    this.details.append(row);
  }
  private velocityDirection(shot: TrainingShot) {
    const speed = Math.hypot(
      shot.carVelocity.x,
      shot.carVelocity.y,
      shot.carVelocity.z,
    );
    const angles =
      speed > 0.00001
        ? vectorAngles(shot.carVelocity)
        : (this.velocityAims.get(shot.id) ?? { heading: 0, elevation: 0 });
    this.velocityAims.set(shot.id, angles);
    return angles;
  }
  private setVelocity(
    shot: TrainingShot,
    speed: number,
    heading?: number,
    elevation?: number,
  ) {
    const angles = this.velocityDirection(shot);
    if (heading !== undefined) angles.heading = heading;
    if (elevation !== undefined) angles.elevation = elevation;
    this.velocityAims.set(shot.id, angles);
    const v = new Vector3()
      .copy(anglesVector(angles.heading, angles.elevation))
      .multiplyScalar(speed);
    shot.carVelocity = { x: v.x, y: v.y, z: v.z };
  }
  private syncControls() {
    const shot = this.session.draft.shot,
      pos =
        this.session.selected === "ball" ? shot.ballPosition : shot.carPosition;
    const e = new Euler().setFromQuaternion(
      new Quaternion().copy(shot.carRotation),
      "YXZ",
    );
    const ball = vectorAngles(shot.ballLaunchDirection),
      speed = Math.hypot(
        shot.carVelocity.x,
        shot.carVelocity.y,
        shot.carVelocity.z,
      ),
      car = this.velocityDirection(shot);
    const values: Record<string, number> = {
      "position-x": pos.x,
      "position-y": pos.y,
      "position-z": pos.z,
      "ball-heading": ball.heading,
      "ball-elevation": ball.elevation,
      "ball-speed": shot.ballLaunchSpeed,
      "car-yaw": (e.y * 180) / Math.PI,
      "car-pitch": (e.x * 180) / Math.PI,
      "car-roll": (e.z * 180) / Math.PI,
      "car-speed": speed,
      "car-heading": car.heading,
      "car-elevation": car.elevation,
      "time-limit": shot.timeLimit,
    };
    for (const [key, value] of Object.entries(values)) {
      const input = this.root.querySelector<HTMLInputElement>("#custom-" + key);
      if (input) input.value = String(Math.round(value * 1000) / 1000);
    }
    this.updateDirtyLabel();
    this.updateHistoryButtons();
    this.updateSummary();
  }

  private renderDetails() {
    const s = this.session,
      shot = s.draft.shot;
    const pos = s.selected === "ball" ? shot.ballPosition : shot.carPosition;
    for (const axis of ["x", "y", "z"] as const)
      this.number(
        axis.toUpperCase(),
        "position-" + axis,
        pos[axis],
        axis === "y" ? 0 : -64,
        axis === "y" ? P.arena.height : 64,
        (n) => {
          (s.selected === "ball" ? shot.ballPosition : shot.carPosition)[axis] =
            n;
        },
      );
    if (s.selected === "ball") {
      const angles = vectorAngles(shot.ballLaunchDirection);
      this.number(
        "HEADING",
        "ball-heading",
        angles.heading,
        -180,
        180,
        (n) => {
          shot.ballLaunchDirection = anglesVector(
            n,
            vectorAngles(shot.ballLaunchDirection).elevation,
          );
        },
        1,
      );
      this.number(
        "ELEVATION",
        "ball-elevation",
        angles.elevation,
        -90,
        90,
        (n) => {
          shot.ballLaunchDirection = anglesVector(
            vectorAngles(shot.ballLaunchDirection).heading,
            n,
          );
        },
        1,
      );
      this.number(
        "BALL SPEED (m/s)",
        "ball-speed",
        shot.ballLaunchSpeed,
        0,
        P.ball.maxSpeed,
        (n) => {
          shot.ballLaunchSpeed = n;
        },
      );
    } else {
      const e = new Euler().setFromQuaternion(
        new Quaternion().copy(shot.carRotation),
        "YXZ",
      );
      for (const [label, axis] of [
        ["YAW", "y"],
        ["PITCH", "x"],
        ["ROLL", "z"],
      ] as const)
        this.number(
          label,
          "car-" + label.toLowerCase(),
          (e[axis] * 180) / Math.PI,
          -180,
          180,
          (n) => {
            e.setFromQuaternion(new Quaternion().copy(shot.carRotation), "YXZ");
            e[axis] = (n * Math.PI) / 180;
            const q = new Quaternion().setFromEuler(e);
            shot.carRotation = { x: q.x, y: q.y, z: q.z, w: q.w };
          },
          1,
        );
      const speed = Math.hypot(
          shot.carVelocity.x,
          shot.carVelocity.y,
          shot.carVelocity.z,
        ),
        angles = this.velocityDirection(shot);
      this.number(
        "CAR SPEED (m/s)",
        "car-speed",
        speed,
        0,
        P.car.maxSpeed,
        (n) => {
          this.setVelocity(shot, n);
        },
      );
      this.number(
        "VELOCITY HEADING",
        "car-heading",
        angles.heading,
        -180,
        180,
        (n) => {
          this.setVelocity(
            shot,
            Math.hypot(
              shot.carVelocity.x,
              shot.carVelocity.y,
              shot.carVelocity.z,
            ),
            n,
          );
        },
        1,
      );
      this.number(
        "VELOCITY ELEVATION",
        "car-elevation",
        angles.elevation,
        -90,
        90,
        (n) => {
          this.setVelocity(
            shot,
            Math.hypot(
              shot.carVelocity.x,
              shot.carVelocity.y,
              shot.carVelocity.z,
            ),
            undefined,
            n,
          );
        },
        1,
      );
    }
    this.number(
      "SHOT TIME (s)",
      "time-limit",
      shot.timeLimit,
      1,
      120,
      (n) => {
        shot.timeLimit = n;
      },
      1,
    );
  }
  private render() {
    const s = this.session,
      d = s.draft;
    if (this.lastEditing !== s.editing) {
      this.notice.update("");
      this.lastEditing = s.editing;
    }
    if (this.panelObject !== s.selected) {
      this.more = false;
      this.panelObject = s.selected;
    }
    this.root.dataset.editing = String(s.editing);
    this.root.dataset.stage = s.editing ? "edit" : "play";
    this.root.dataset.navDefault = s.editing
      ? "#custom-select-ball"
      : "#custom-reset-shot";
    this.root.querySelector("#custom-pack-name")!.textContent = d.pack.name;
    this.updateDirtyLabel();
    this.top.replaceChildren();
    if (s.editing) {
      const play = this.button(
        this.top,
        "PLAY SHOT",
        () => {
          try {
            s.play();
          } catch (e) {
            this.message(trainingCloudError(e));
          }
        },
        "custom-play-shot",
      );
      play.classList.add("custom-play-primary");
      play.disabled = !d.shot.enabled || this.busy;
      if (!d.shot.enabled) play.title = "Enable this shot to test it.";
    } else if (s.editable)
      this.button(
        this.top,
        "BACK TO EDITOR",
        () => s.edit(),
        "custom-return-edit",
      );
    if (s.goalCelebrating)
      this.button(
        this.top,
        "SKIP",
        () => s.skipGoal(),
        "custom-skip-goal",
      ).title = "Skip goal animation (Space / controller Jump)";
    this.iconButton(
      this.top,
      "Training Editor menu",
      "menu",
      () => this.openMenu(),
      "custom-editor-menu-open",
    );
    this.tools.replaceChildren();
    this.shots.replaceChildren();
    if (s.editing) {
      this.iconButton(
        this.tools,
        "Undo (Ctrl+Z)",
        "undo",
        () => s.history(),
        "custom-undo",
      );
      this.iconButton(
        this.tools,
        "Redo (Ctrl+Shift+Z)",
        "redo",
        () => s.history(true),
        "custom-redo",
      );
      const copy = this.iconButton(
        this.tools,
        "Duplicate shot",
        "duplicate",
        () => {
          try {
            d.add(true);
            s.load();
            this.render();
          } catch (e) {
            this.message(trainingCloudError(e));
          }
        },
        "custom-duplicate-shot",
      );
      copy.disabled = d.pack.shots.length >= 50;
      const trash = this.iconButton(
        this.tools,
        "Delete shot",
        "trash",
        () =>
          this.confirmation(
            "DELETE SHOT?",
            "This permanently deletes the shot. The final shot is replaced with a new default.",
            [
              {
                label: "DELETE",
                action: () => {
                  d.delete();
                  s.load();
                  this.render();
                },
              },
            ],
          ),
        "custom-delete-shot",
      );
      trash.classList.add("custom-shot-trash");
      this.iconButton(this.tools, "Move shot earlier", "chevron-up", () => {
        d.reorder(-1);
        s.load();
        this.render();
      });
      this.iconButton(this.tools, "Move shot later", "chevron-down", () => {
        d.reorder(1);
        s.load();
        this.render();
      });
    }
    let playable = 0;
    d.pack.shots.forEach((shot, index) => {
      if (!s.editing && !shot.enabled) return;
      playable++;
      const row = document.createElement("div");
      row.className = "custom-shot-row";
      row.dataset.enabled = String(shot.enabled);
      row.dataset.selected = String(index === d.index);
      if (s.editing) {
        const toggle = this.button(row, "\u00d7", () => {
          d.setEnabled(shot.id, !shot.enabled);
          this.render();
        });
        toggle.className = "custom-shot-toggle";
        toggle.title =
          (shot.enabled ? "Disable" : "Enable") + " Shot " + (index + 1);
        toggle.setAttribute("aria-label", toggle.title);
        toggle.setAttribute("aria-pressed", String(!shot.enabled));
        toggle.dataset.navKey = "toggle-" + shot.id;
      }
      const b = this.button(
        row,
        "SHOT " + (s.editing ? index + 1 : playable),
        () => s.selectShot(index),
      );
      b.dataset.shotId = shot.id;
      b.dataset.shotSelect = "";
      b.dataset.navKey = "shot-" + shot.id;
      b.setAttribute("aria-pressed", String(index === d.index));
      if (!shot.enabled)
        b.title = "Disabled: excluded from pack testing and publishing";
      this.shots.append(row);
    });
    if (s.editing) {
      const add = this.button(
        this.shots,
        "+",
        () => {
          try {
            d.add();
            s.load();
            this.render();
          } catch (e) {
            this.message(trainingCloudError(e));
          }
        },
        "custom-add-shot",
      );
      add.setAttribute("aria-label", "Add shot");
      add.disabled = d.pack.shots.length >= 50;
    }
    this.controls.replaceChildren();
    this.details.replaceChildren();
    this.controls.hidden = !s.editing;
    if (s.editing) {
      const tabs = document.createElement("div");
      tabs.className = "custom-object-tabs";
      this.controls.append(tabs);
      this.button(
        tabs,
        "BALL",
        () => s.selectObject("ball"),
        "custom-select-ball",
      ).setAttribute("aria-pressed", String(s.selected === "ball"));
      this.button(
        tabs,
        "CAR",
        () => s.selectObject("car"),
        "custom-select-car",
      ).setAttribute("aria-pressed", String(s.selected === "car"));
      const summary = document.createElement("p");
      summary.className = "custom-object-summary";
      this.controls.append(summary);
      this.updateSummary();
      const advanced = this.button(
        this.controls,
        "TRANSFORM CONTROLS",
        () => s.setAdvanced(!s.advanced),
        "custom-transform-toggle",
      );
      advanced.setAttribute("aria-pressed", String(s.advanced));
      if (s.advanced) {
        const modes = document.createElement("div");
        modes.className = "custom-transform-tools";
        this.controls.append(modes);
        this.button(modes, "MOVE", () => s.selectObject(s.selected, "move"));
        this.button(modes, s.selected === "ball" ? "AIM" : "ROTATE", () =>
          s.selectObject(s.selected, s.selected === "ball" ? "aim" : "rotate"),
        );
      }
      const more = this.button(
        this.controls,
        this.more ? "LESS" : "MORE",
        () => {
          this.more = !this.more;
          this.details.hidden = !this.more;
          more.textContent = this.more ? "LESS" : "MORE";
          more.setAttribute("aria-expanded", String(this.more));
        },
        "custom-more",
      );
      more.setAttribute("aria-expanded", String(this.more));
      more.setAttribute("aria-controls", "custom-edit-details");
      this.details.id = "custom-edit-details";
      this.details.hidden = !this.more;
      this.controls.append(this.details);
      this.renderDetails();
    }
    this.toolbar.replaceChildren();
    if (!s.editing)
      this.button(this.toolbar, "RESET", () => s.reset(), "custom-reset-shot");
    this.button(this.toolbar, "PREVIOUS", () => s.navigate(-1));
    this.button(this.toolbar, "NEXT", () => s.navigate(1));
    if (s.editing)
      this.button(
        this.toolbar,
        "FOCUS",
        () => s.focusSelected(),
        "custom-focus-object",
      );
    this.syncSidebar();
    this.root
      .querySelectorAll<HTMLButtonElement | HTMLInputElement>("button,input")
      .forEach((b) => {
        if (this.busy) b.disabled = true;
      });
    this.updateHistoryButtons();
    if (this.menu.open) this.renderMenu();
  }
  private publish() {
    this.confirmation(
      "PUBLISH TRAINING PACK?",
      "Only enabled shots will be published. Your current draft is saved locally first.",
      [
        {
          label: "PUBLISH",
          action: () => {
            void this.upload();
          },
        },
      ],
    );
  }
  private async upload() {
    if (this.busy || !this.save()) return;
    this.busy = true;
    this.session.setLocked(true);
    this.render();
    this.message("PUBLISHING...", true);
    try {
      const pack = this.library.get(this.session.draft.pack.id)!;
      const cloud = await this.cloud.publish(pack, this.username());
      const saved = this.library.markPublished(pack.id, cloud, pack.updatedAt);
      Object.assign(this.session.draft.pack, {
        published: saved.published,
        publishedDocumentId: saved.publishedDocumentId,
        ownerUid: saved.ownerUid,
        publishedAt: saved.publishedAt,
        publishedVersion: saved.publishedVersion,
        publishedRevision: saved.publishedRevision,
        version: saved.version,
      });
      this.message("PUBLISHED SUCCESSFULLY");
    } catch (e) {
      this.message(trainingCloudError(e));
    } finally {
      this.busy = false;
      this.session.setLocked(this.menu.open);
      if (this.root.isConnected) this.render();
    }
  }
  update() {
    if (!this.session.editing && !this.busy)
      this.notice.update(
        this.session.run.result === "GOAL" ? "" : this.session.run.result,
      );
  }
  dispose() {
    this.session.changed = undefined;
    this.session.requestExit = undefined;
    window.removeEventListener("beforeunload", this.beforeUnload);
    window.removeEventListener("keydown", this.key, true);
    this.notice.dispose();
    this.menuNotice.dispose();
    this.prompt.remove();
    this.menu.remove();
    this.root.remove();
  }
}
