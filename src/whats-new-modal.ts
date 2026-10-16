import { App, Component, MarkdownRenderer, Modal, Setting } from "obsidian";
import CHANGELOG from "../CHANGELOG.md";
import { discussionsUrl } from "./feedback";
import { parseChangelog, notesSince, ReleaseNote } from "./whats-new";

const CHANGELOG_URL = "https://github.com/kilrkrow/obsidian-bible-verse/blob/main/CHANGELOG.md";

/** Releases the pop-up would show; empty when the changelog has nothing for them. */
export function releaseNotesSince(since: string | null, current: string): ReleaseNote[] {
  return notesSince(parseChangelog(CHANGELOG), since, current);
}

/** The "What's new" pop-up: release notes since the last version the user saw. */
export class WhatsNewModal extends Modal {
  private notes: ReleaseNote[];
  private component = new Component();

  constructor(app: App, notes: ReleaseNote[]) {
    super(app);
    this.notes = notes;
  }

  onOpen(): void {
    const { contentEl } = this;
    this.modalEl.addClass("bible-verse-whats-new");
    this.titleEl.setText("What's new in Bible Verse");
    this.component.load();

    const body = contentEl.createDiv({ cls: "bible-verse-whats-new-body" });
    for (const note of this.notes) {
      const section = body.createDiv({ cls: "bible-verse-whats-new-release" });
      const heading = section.createEl("h2", { text: note.version });
      if (note.date) heading.createSpan({ cls: "bible-verse-whats-new-date", text: note.date });
      void MarkdownRenderer.render(this.app, note.body, section.createDiv(), "", this.component);
    }

    contentEl.createEl("p", {
      cls: "bible-verse-settings-note",
      text: "This appears once after each update. You can turn it off in Settings → Bible Verse.",
    });

    new Setting(contentEl)
      .setName("Questions and ideas")
      .setDesc("Ask about a change, or tell us what you'd like next.")
      .addButton((btn) => btn.setButtonText("Open Discussions").onClick(() => window.open(discussionsUrl())))
      .addButton((btn) => btn.setButtonText("Full changelog").onClick(() => window.open(CHANGELOG_URL)))
      .addButton((btn) => btn.setButtonText("Close").setCta().onClick(() => this.close()));
  }

  onClose(): void {
    this.component.unload();
    this.contentEl.empty();
  }
}
