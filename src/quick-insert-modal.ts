import { App, Modal, Setting } from "obsidian";
import { parseReference, formatReference } from "./parser";

export class QuickInsertModal extends Modal {
  private onSubmit: (reference: string, openInBrowser: boolean) => void;

  constructor(app: App, onSubmit: (reference: string, openInBrowser: boolean) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Insert Bible Reference" });

    let inputValue = "";
    let openInBrowser = false;
    const statusEl = contentEl.createDiv({ cls: "bible-verse-quick-status" });

    const inputEl = contentEl.createEl("input", {
      type: "text",
      placeholder: "Type a reference... (e.g., John 3:16)",
      cls: "bible-verse-quick-input",
    });
    inputEl.style.width = "100%";
    inputEl.style.padding = "8px";
    inputEl.style.fontSize = "1.1em";
    inputEl.focus();

    inputEl.addEventListener("input", () => {
      inputValue = inputEl.value;
      const ref = parseReference(inputValue);
      if (ref) {
        statusEl.setText("✓ " + formatReference(ref));
        statusEl.style.color = "var(--text-success, green)";
        inputEl.style.borderColor = "var(--text-success, green)";
      } else if (inputValue.length > 0) {
        statusEl.setText("Invalid reference");
        statusEl.style.color = "var(--text-error, red)";
        inputEl.style.borderColor = "var(--text-error, red)";
      } else {
        statusEl.setText("");
        inputEl.style.borderColor = "";
      }
    });

    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const ref = parseReference(inputValue);
        if (ref) {
          this.onSubmit(formatReference(ref), openInBrowser);
          this.close();
        }
      }
    });

    new Setting(contentEl)
      .setName("Also open on Bible site")
      .addToggle((toggle) => toggle.onChange((val) => { openInBrowser = val; }));
  }

  onClose() {
    this.contentEl.empty();
  }
}
