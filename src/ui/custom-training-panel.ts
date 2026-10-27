import type { CustomTrainingLibrary } from "../game/custom-training";
import type { CustomTrainingPack } from "../../shared/custom-training";
import {
  publicationStatus,
  validatePlayablePack,
} from "../../shared/custom-training";
import {
  trainingCloudError,
  type CommunityEntry,
  type TrainingCloud,
} from "../network/firebase-training";
import { reveal } from "./motion";
const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
export class CustomTrainingPanel {
  readonly dialog = document.createElement("dialog");
  readonly prompt = document.createElement("dialog");
  route: { view: "list" | "community" | "editor"; packId?: string } = {
    view: "list",
  };
  private entries: CommunityEntry[] = [];
  private cursor: unknown = null;
  private community: "idle" | "loading" | "ready" | "error" = "idle";
  private communityError = "";
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
    if (community) this.renderCommunity(content);
    else this.renderLibrary(content);
    if (community && this.community !== "loading") {
      if (this.cursor)
        content.append(
          this.button("LOAD MORE", () => {
            void this.loadCommunity(true);
          }),
        );
      const refresh = this.button(
        this.community === "error" ? "RETRY" : "REFRESH",
        () => {
          void this.loadCommunity(false);
        },
      );
      refresh.id = "community-refresh";
      content.append(refresh);
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
  private empty(parent: HTMLElement, title: string, text: string) {
    const empty = document.createElement("div");
    empty.className = "training-pack-empty";
    const h = document.createElement("h3"),
      p = document.createElement("p");
    h.textContent = title;
    p.textContent = text;
    empty.append(h, p);
    parent.append(empty);
  }
  private row(
    parent: HTMLElement,
    pack: CustomTrainingPack,
    status: string,
    highlight: boolean,
  ) {
    const row = document.createElement("article");
    row.className = "training-pack-row";
    row.dataset.packId = pack.id;
    const detail = document.createElement("div"),
      name = document.createElement("h3"),
      info = document.createElement("p");
    name.textContent = pack.name;
    info.textContent = status;
    if (highlight) info.className = "pack-published";
    detail.append(name, info);
    const buttons = document.createElement("div");
    buttons.className = "training-pack-actions";
    row.append(detail, buttons);
    parent.append(row);
    return buttons;
  }
  private renderLibrary(content: HTMLElement) {
    let packs: CustomTrainingPack[];
    try {
      packs = this.library.list();
    } catch (e) {
      this.message = trainingCloudError(e);
      return;
    }
    if (!packs.length)
      this.empty(
        content,
        "NO CUSTOM TRAINING PACKS YET",
        "Create your first pack to get started.",
      );
    for (const pack of packs) {
      const state = publicationStatus(pack);
      const buttons = this.row(
        content,
        pack,
        pack.shots.length + " SHOTS / " + state,
        state !== "DRAFT",
      );
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
      buttons.append(
        play,
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
      );
      if (pack.publishedDocumentId)
        buttons.append(
          this.button("UNPUBLISH", () => this.confirm("unpublish", pack)),
        );
      buttons.append(this.button("DELETE", () => this.confirm("delete", pack)));
    }
  }
  private renderCommunity(content: HTMLElement) {
    if (!this.entries.length) {
      if (this.community === "error")
        this.empty(content, "ERROR LOADING PACKS", this.communityError);
      else if (this.community === "ready")
        this.empty(
          content,
          "NO PUBLISHED PACKS",
          "Packs published by players will appear here.",
        );
      else this.empty(content, "LOADING...", "Fetching published packs.");
      return;
    }
    for (const { pack, owned } of this.entries) {
      const buttons = this.row(
        content,
        pack,
        [
          pack.authorName,
          pack.shots.length + " SHOTS",
          new Date(pack.updatedAt).toLocaleDateString(),
          ...(owned ? ["OWNED"] : []),
        ].join(" / "),
        owned,
      );
      // Read-only here, even for the owner: editing happens from MY TRAINING PACKS.
      buttons.append(
        this.button("PLAY", () => {
          void this.playCommunity(pack);
        }),
      );
    }
  }
  private async playCommunity(listed: CustomTrainingPack) {
    if (this.busy || !listed.publishedDocumentId) return;
    this.busy = true;
    this.message = "DOWNLOADING...";
    this.render();
    try {
      // Fetch the latest version and validate it again; remote data is never played unchecked.
      const pack = await this.actions.cloud.download(
        listed.publishedDocumentId,
      );
      this.busy = false;
      this.message = "";
      this.dialog.close();
      this.actions.play(pack);
    } catch (e) {
      this.busy = false;
      this.message = trainingCloudError(e);
      this.render();
    }
  }
  private async loadCommunity(more: boolean) {
    if (this.busy) return;
    this.busy = true;
    if (!more) {
      this.entries = [];
      this.cursor = null;
    }
    this.community = "loading";
    this.message = "LOADING...";
    this.render();
    try {
      const page = await this.actions.cloud.browse(more ? this.cursor : null);
      this.entries = more ? [...this.entries, ...page.entries] : page.entries;
      this.cursor = page.cursor;
      this.community = "ready";
      this.message = page.skipped ? "Some invalid packs were omitted." : "";
    } catch (e) {
      console.error("[Octane Arena] Community packs failed to load", e);
      this.community = "error";
      this.communityError = trainingCloudError(e);
      this.message = this.entries.length ? "ERROR LOADING PACKS" : "";
    } finally {
      this.busy = false;
      this.render();
    }
  }
  private showPrompt(
    markup: string,
    action: (form: HTMLFormElement, choice: string) => void | Promise<void>,
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
      const choice = (event.submitter as HTMLButtonElement | null)?.value ?? "";
      this.busy = true;
      form
        .querySelectorAll<HTMLButtonElement>("button")
        .forEach((b) => (b.disabled = true));
      try {
        await action(form, choice);
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
    const published = !!pack.publishedDocumentId;
    const title =
      kind === "publish" && published
        ? "UPDATE PUBLISHED PACK?"
        : kind.toUpperCase() + " TRAINING PACK?";
    const note =
      kind === "delete"
        ? published
          ? "This pack is still published. Deleting only the local copy keeps it public in Community Packs."
          : "This cannot be undone."
        : kind === "unpublish"
          ? "Remove this pack from Community Packs? Your local pack is kept and stays editable."
          : published
            ? "Upload your saved changes to the published pack? Only enabled shots are published."
            : "Upload this saved pack to Community Packs? Only enabled shots are published.";
    // A published pack can't be deleted silently: the player chooses whether the public copy goes too.
    const choices: [string, string][] =
      kind === "delete" && published
        ? [
            ["local", "DELETE LOCAL COPY"],
            ["both", "UNPUBLISH AND DELETE"],
          ]
        : [
            [
              kind,
              kind === "publish" && published ? "UPDATE" : kind.toUpperCase(),
            ],
          ];
    this.showPrompt(
      "<form><h2>" +
        escapeHtml(title) +
        "</h2><p>" +
        escapeHtml(note) +
        '</p><p role="alert" aria-live="polite"></p><footer><button type="button" id="pack-confirm-cancel" class="back-button" data-nav-back>CANCEL</button>' +
        choices
          .map(
            ([value, label]) =>
              '<button type="submit" class="small-button" value="' +
              value +
              '">' +
              label +
              "</button>",
          )
          .join("") +
        "</footer></form>",
      async (_form, choice) => {
        if (kind === "delete") {
          if (choice === "both") {
            await this.actions.cloud.unpublish(pack);
            this.library.markUnpublished(pack.id);
          }
          this.library.delete(pack.id);
          this.message =
            choice === "both" ? "PACK UNPUBLISHED AND DELETED" : "";
        } else if (kind === "unpublish") {
          await this.actions.cloud.unpublish(pack);
          this.library.markUnpublished(pack.id);
          this.message = "PACK UNPUBLISHED";
        } else {
          const current = this.library.get(pack.id)!;
          try {
            const cloud = await this.actions.cloud.publish(
              current,
              this.actions.username(),
            );
            this.library.markPublished(pack.id, cloud, current.updatedAt);
          } catch (e) {
            // Nothing local is marked published on failure.
            throw new Error(
              "PUBLISH FAILED: " +
                trainingCloudError(e) +
                " Your local pack is still saved.",
            );
          }
          this.message = published
            ? "PUBLISHED PACK UPDATED"
            : "PUBLISHED SUCCESSFULLY";
        }
      },
      "#pack-confirm-cancel",
    );
  }
}
