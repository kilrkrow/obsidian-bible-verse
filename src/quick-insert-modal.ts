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
    this.titleEl.setText("Insert Bible Reference");

    let inputValue = "";
    let openInBrowser = false;
    const statusEl = contentEl.createDiv({ cls: "bible-verse-quick-status" });

    const inputEl = contentEl.createEl("input", {
      type: "text",
      placeholder: "Type a reference... (e.g., John 3:16)",
      cls: "bible-verse-quick-input",
    });
    inputEl.focus();

    inputEl.addEventListener("input", () => {
      inputValue = inputEl.value;
      const ref = parseReference(inputValue);
      if (ref) {
        statusEl.setText(formatReference(ref));
        statusEl.classList.remove("is-invalid");
        statusEl.classList.add("is-valid");
        inputEl.classList.remove("is-invalid");
        inputEl.classList.add("is-valid");
      } else if (inputValue.length > 0) {
        statusEl.setText("Invalid reference");
        statusEl.classList.remove("is-valid");
        statusEl.classList.add("is-invalid");
        inputEl.classList.remove("is-valid");
        inputEl.classList.add("is-invalid");
      } else {
        statusEl.setText("");
        statusEl.classList.remove("is-valid", "is-invalid");
        inputEl.classList.remove("is-valid", "is-invalid");
      }
    });

    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const ref = parseReference(inputValue);
        if (ref) {
          // Wrap in curly braces so it matches the {ref} inline syntax
          this.onSubmit(`{${formatReference(ref)}}`, openInBrowser);
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
