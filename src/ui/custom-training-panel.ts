import type { CustomTrainingLibrary } from "../game/custom-training";
import type { CustomTrainingPack } from "../../shared/custom-training";
import { validatePlayablePack } from "../../shared/custom-training";
import {
  trainingCloudError,
  type TrainingCloud,
} from "../network/firebase-training";
import { reveal } from "./motion";
export class CustomTrainingPanel {
  readonly dialog = document.createElement("dialog");
  readonly prompt = document.createElement("dialog");
  route: { view: "list" | "community" | "editor"; packId?: string } = {
    view: "list",
  };
  private packs: CustomTrainingPack[] = [];
  private cursor: string | null = null;
  private message = "";
  private busy = false;
  private returnFocus?: HTMLElement;
  constructor(
    readonly library: CustomTrainingLibrary,
    parent: HTMLElement,
    private opened: () => void,
    private actions: {
      edit(id: string): void;
      play(pack: CustomTrainingPack): void;
      username(): string;
      cloud: TrainingCloud;
    },
  ) {
    this.dialog.id = "custom-training";
    this.dialog.className = "custom-training-panel";
    this.dialog.dataset.navScope = "custom-training-library";
    this.dialog.setAttribute("aria-label", "Custom Training Packs");
    this.prompt.id = "training-pack-prompt";
    this.prompt.className = "training-pack-prompt";
    this.prompt.dataset.navScope = "training-pack-prompt";
    parent.append(this.dialog, this.prompt);
    this.dialog.addEventListener("cancel", (e) => {
      if (this.busy) e.preventDefault();
    });
    this.prompt.addEventListener("cancel", (e) => {
      if (this.busy) e.preventDefault();
    });
    this.prompt.addEventListener("close", () => {
      if (this.returnFocus?.isConnected) this.returnFocus.focus();
      else
        this.dialog
          .querySelector<HTMLButtonElement>("button:not(:disabled)")
          ?.focus();
    });
  }
  open(community = false) {
    this.opened();
    this.route = { view: community ? "community" : "list" };
    this.message = "";
    this.render();
    this.dialog.showModal();
    if (community) void this.loadCommunity(false);
  }
  private button(label: string, action: () => void) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "small-button";
    b.textContent = label;
    b.onclick = action;
    b.disabled = this.busy;
    return b;
  }
  private render() {
    const community = this.route.view === "community";
    this.dialog.replaceChildren();
    this.dialog.dataset.navDefault = community
      ? "#community-refresh"
      : "#new-training-pack";
    this.dialog.dataset.navScope = community
      ? "community-training"
      : "custom-training-library";
    const header = document.createElement("header"),
      title = document.createElement("h2");
    title.textContent = community ? "COMMUNITY PACKS" : "MY TRAINING PACKS";
    header.append(title);
    const tabs = document.createElement("nav");
    tabs.append(
      this.button(community ? "MY TRAINING PACKS" : "COMMUNITY PACKS", () => {
        this.route = { view: community ? "list" : "community" };
        this.message = "";
        this.render();
        if (!community) void this.loadCommunity(false);
      }),
    );
    if (!community) {
      const create = this.button("NEW TRAINING PACK", () => this.nameForm());
      create.id = "new-training-pack";
      tabs.append(create);
    }
    header.append(tabs);
    const content = document.createElement("div");
    content.className = "training-pack-content";
    try {
      const packs = community ? this.packs : this.library.list();
      if (!packs.length) {
        const empty = document.createElement("div");
        empty.className = "training-pack-empty";
        empty.innerHTML = community
          ? "<h3>COMMUNITY PACKS</h3><p>Published packs will appear here.</p>"
          : "<h3>NO CUSTOM TRAINING PACKS YET</h3><p>Create your first pack to get started.</p>";
        content.append(empty);
      }
      for (const pack of packs) {
        const row = document.createElement("article");
        row.className = "training-pack-row";
        row.dataset.packId = pack.id;
        const detail = document.createElement("div"),
          name = document.createElement("h3"),
          status = document.createElement("p");
        name.textContent = pack.name;
        status.textContent =
          pack.shots.length +
          " SHOTS / " +
          (community
            ? pack.authorName
            : pack.publishedDocumentId
              ? pack.publishedRevision !== pack.updatedAt
                ? "PUBLISHED / MODIFIED"
                : "PUBLISHED"
              : "DRAFT");
        if (pack.publishedDocumentId) status.className = "pack-published";
        detail.append(name, status);
        const buttons = document.createElement("div");
        buttons.className = "training-pack-actions";
        const play = this.button("PLAY PACK", () => {
          try {
            const valid = validatePlayablePack(pack);
            this.dialog.close();
            this.actions.play(valid);
          } catch (e) {
            this.message = trainingCloudError(e);
            this.render();
          }
        });
        play.disabled = this.busy || !pack.shots.length;
        buttons.append(play);
        if (!community) {
          buttons.append(
            this.button("EDIT", () => {
              this.route = { view: "editor", packId: pack.id };
              this.dialog.close();
              this.actions.edit(pack.id);
            }),
            this.button("RENAME", () => this.nameForm(pack.id)),
            this.button(
              pack.publishedDocumentId ? "UPDATE PUBLISHED PACK" : "PUBLISH",
              () => this.confirm("publish", pack),
            ),
            this.button("DELETE", () => this.confirm("delete", pack)),
          );
          if (pack.publishedDocumentId)
            buttons.append(
              this.button("UNPUBLISH", () => this.confirm("unpublish", pack)),
            );
        }
        row.append(detail, buttons);
        content.append(row);
      }
    } catch (e) {
      this.message = trainingCloudError(e);
    }
    if (community) {
      if (this.cursor)
        content.append(
          this.button("LOAD MORE", () => {
            void this.loadCommunity(true);
          }),
        );
      else {
        const refresh = this.button("REFRESH", () => {
          void this.loadCommunity(false);
        });
        refresh.id = "community-refresh";
        content.append(refresh);
      }
    }
    const message = document.createElement("p");
    message.setAttribute("role", "status");
    message.textContent = this.message;
    content.append(message);
    const footer = document.createElement("footer"),
      back = this.button("BACK", () => this.dialog.close());
    back.className = "back-button";
    back.dataset.navBack = "";
    footer.append(back);
    this.dialog.append(header, content, footer);
    reveal(content);
  }
  private async loadCommunity(more: boolean) {
    if (this.busy) return;
    this.busy = true;
    this.message = "LOADING...";
    this.render();
    try {
      const page = await this.actions.cloud.browse(more ? this.cursor : null);
      this.packs = more ? [...this.packs, ...page.packs] : page.packs;
      this.cursor = page.cursor;
      this.message = page.skipped ? "Some invalid packs were omitted." : "";
    } catch (e) {
      this.message = trainingCloudError(e);
    } finally {
      this.busy = false;
      this.render();
    }
  }
  private showPrompt(
    markup: string,
    action: (form: HTMLFormElement) => void | Promise<void>,
    defaultSelector: string,
  ) {
    this.returnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
    this.prompt.innerHTML = markup;
    this.prompt.dataset.navDefault = defaultSelector;
    this.prompt.setAttribute(
      "aria-label",
      this.prompt.querySelector("h2")!.textContent!,
    );
    const form = this.prompt.querySelector("form")!;
    form.querySelector<HTMLButtonElement>("[data-nav-back]")!.onclick = () => {
      if (!this.busy) this.prompt.close();
    };
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (this.busy) return;
      this.busy = true;
      form
        .querySelectorAll<HTMLButtonElement>("button")
        .forEach((b) => (b.disabled = true));
      try {
        await action(form);
        this.prompt.close();
      } catch (e) {
        form.querySelector<HTMLElement>("[role=alert]")!.textContent =
          trainingCloudError(e);
      } finally {
        this.busy = false;
        form
          .querySelectorAll<HTMLButtonElement>("button")
          .forEach((b) => (b.disabled = false));
        this.render();
      }
    };
    this.prompt.showModal();
    this.prompt.querySelector<HTMLElement>(defaultSelector)?.focus();
  }
  private nameForm(id?: string) {
    this.showPrompt(
      "<form><h2>" +
        (id ? "RENAME TRAINING PACK" : "NEW TRAINING PACK") +
        '</h2><label>PACK NAME<input id="training-pack-name" name="packName" required maxlength="40" autocomplete="off"></label><p role="alert" aria-live="polite"></p><footer><button type="button" class="back-button" data-nav-back>CANCEL</button><button type="submit" class="small-button">' +
        (id ? "SAVE" : "CREATE") +
        "</button></footer></form>",
      (form) => {
        const name = (form.elements.namedItem("packName") as HTMLInputElement)
          .value;
        if (id) this.library.rename(id, name);
        else this.library.create(name);
      },
      "#training-pack-name",
    );
    if (id) {
      const input = this.prompt.querySelector("input")!;
      input.value = this.library.get(id)?.name ?? "";
      input.select();
    }
  }
  private confirm(
    kind: "delete" | "publish" | "unpublish",
    pack: CustomTrainingPack,
  ) {
    const label = kind.toUpperCase(),
      note =
        kind === "delete"
          ? "This cannot be undone. Any published copy stays public until you explicitly unpublish it."
          : kind === "unpublish"
            ? "Remove this pack from Community Packs? Your local pack is kept."
            : "Upload this saved pack to Community Packs?";
    this.showPrompt(
      "<form><h2>" +
        label +
        " TRAINING PACK?</h2><p>" +
        note +
        '</p><p role="alert" aria-live="polite"></p><footer><button type="button" id="pack-confirm-cancel" class="back-button" data-nav-back>CANCEL</button><button type="submit" class="small-button">' +
        label +
        "</button></footer></form>",
      async () => {
        if (kind === "delete") this.library.delete(pack.id);
        else if (kind === "unpublish") {
          await this.actions.cloud.unpublish(pack);
          this.library.markUnpublished(pack.id);
        } else {
          const current = this.library.get(pack.id)!;
          const cloud = await this.actions.cloud.publish(
            current,
            this.actions.username(),
          );
          this.library.markPublished(pack.id, cloud, current.updatedAt);
          this.message = "PUBLISHED SUCCESSFULLY";
        }
      },
      "#pack-confirm-cancel",
    );
  }
}
