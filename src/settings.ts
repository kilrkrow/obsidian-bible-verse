import { App, PluginSettingTab, Setting } from "obsidian";
import type BibleVersePlugin from "./main";
import { BibleWebsite, DisplayStyle } from "./types";
import { HELLOAO_TRANSLATIONS } from "./constants";
import { addFeedbackSetting } from "./feedback";

function df(text: string, ...examples: string[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  frag.appendChild(document.createTextNode(text));
  for (const ex of examples) {
    frag.appendChild(document.createTextNode(" "));
    const code = document.createElement("code");
    code.textContent = ex;
    frag.appendChild(code);
  }
  return frag;
}

export class BibleVerseSettingTab extends PluginSettingTab {
  plugin: BibleVersePlugin;

  constructor(app: App, plugin: BibleVersePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Default Translation (dropdown from curated list)
    new Setting(containerEl)
      .setName("Default translation")
      .setDesc(df("The Bible translation to use by default. Override per-reference:", "{Romans 8:28, KJV}"))
      .addDropdown((dropdown) => {
        for (const t of HELLOAO_TRANSLATIONS) {
          dropdown.addOption(t.id, t.name);
        }
        dropdown
          .setValue(this.plugin.settings.defaultTranslation)
          .onChange(async (value) => {
            this.plugin.settings.defaultTranslation = value;
            await this.plugin.saveSettings();
          });
      });

    // Preferred Website
    new Setting(containerEl)
      .setName("Preferred Bible website")
      .setDesc("Which website to link verse references to")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("BibleHub", "BibleHub")
          .addOption("BibleGateway", "BibleGateway")
          .addOption("BlueLetter", "Blue Letter Bible")
          .addOption("BibleCom", "Bible.com")
          .setValue(this.plugin.settings.preferredWebsite)
          .onChange(async (value) => {
            this.plugin.settings.preferredWebsite = value as BibleWebsite;
            await this.plugin.saveSettings();
            this.plugin.refreshLivePreview();
          })
      );

    // Display Style
    new Setting(containerEl)
      .setName("Display style")
      .setDesc(df("How verses are visually presented. Override per-reference:", "{Romans 8:28, callout}", "{Romans 8:28, sidebar}", "{Romans 8:28, inline}"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("sidebar", "Sidebar")
          .addOption("callout", "Callout")
          .addOption("blockquote", "Blockquote")
          .addOption("inline", "Inline")
          .setValue(this.plugin.settings.displayStyle)
          .onChange(async (value) => {
            this.plugin.settings.displayStyle = value as DisplayStyle;
            await this.plugin.saveSettings();
          })
      );

    // Sidebar Top Padding
    new Setting(containerEl)
      .setName("Sidebar top padding")
      .setDesc("Adjust the top spacing for the Sidebar style (in ems)")
      .addSlider((slider) =>
        slider
          .setLimits(0, 2, 0.1)
          .setValue(this.plugin.settings.sidebarTopPadding)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.sidebarTopPadding = value;
            await this.plugin.saveSettings();
            this.plugin.updateStyles();
          })
      );

    // Persist Verse Text
    new Setting(containerEl)
      .setName("Persist verse text in notes")
      .setDesc(
        "When enabled, fetched verse text is automatically written into note source (bake mode)"
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.persistVerseText)
          .onChange(async (value) => {
            this.plugin.settings.persistVerseText = value;
            await this.plugin.saveSettings();
          })
      );
    new Setting(containerEl)
      .setName("Show verse numbers")
      .setDesc(df("Display verse numbers in the rendered text. Override per-reference:", "{Romans 8:28-30, v}", "{Romans 8:28-30, no-v}"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showVerseNumbers)
          .onChange(async (value) => {
            this.plugin.settings.showVerseNumbers = value;
            await this.plugin.saveSettings();
            this.display(); // Refresh to update dependency states
          })
      );

    new Setting(containerEl)
      .setName("Show attribution")
      .setDesc("Display license and copyright links below verses.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showAttribution)
          .onChange(async (value) => {
            this.plugin.settings.showAttribution = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("New line per verse")
      .setDesc(df("Start each verse on a new line. Override per-reference:", "{Romans 8:28-30, nl}", "{Romans 8:28-30, no-nl}"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.verseNewLine)
          .setDisabled(!this.plugin.settings.showVerseNumbers)
          .onChange(async (value) => {
            this.plugin.settings.verseNewLine = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Bake inline references")
      .setDesc("If enabled, baking a note will convert {ref} into a bible code block. If disabled, only code blocks are baked.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.bakeInline)
          .onChange(async (value) => {
            this.plugin.settings.bakeInline = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Reading sections")
      .setDesc(df("Group verses by natural paragraph breaks. Override per-reference:", "{Luke 19, para}", "{Luke 19, no-para}"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.paragraphBreaks)
          .onChange(async (value) => {
            this.plugin.settings.paragraphBreaks = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("IntelliSense helper mode")
      .setDesc("When a reference is complete, show a menu of all available modifiers (style, formatting, reading sections).")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.helperMode)
          .onChange(async (value) => {
            this.plugin.settings.helperMode = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("Syntax reference").setHeading();
    const details = containerEl.createEl("details", { cls: "bible-verse-settings-ref" });
    details.createEl("summary", { text: "Show token syntax" });
    const refTable = details.createEl("table");
    const rows: [string, string][] = [
      ["{Romans 8:28}", "Single verse"],
      ["{Romans 8:28-30}", "Verse range"],
      ["{Romans 8:28,30,38}", "Non-consecutive verses"],
      ["{Romans 8}", "Whole chapter"],
      ["{Romans 8:26-eoc}", "Verse to end of chapter"],
      ["{Romans 8:28, KJV}", "Translation override"],
      ["{Romans 8:28, KJV | NIV}", "Side-by-side comparison"],
      ["{Romans 8:28, callout}", "Style: callout / sidebar / blockquote / inline"],
      ["{Romans 8:28-30, v} / {…, no-v}", "Verse numbers on / off"],
      ["{Romans 8:28-30, nl} / {…, no-nl}", "New line per verse on / off"],
      ["{Romans 8, para} / {…, no-para}", "Reading sections on / off"],
    ];
    for (const [token, desc] of rows) {
      const tr = refTable.createEl("tr");
      tr.createEl("td").createEl("code", { text: token });
      tr.createEl("td", { text: desc });
    }

    new Setting(containerEl).setName("Data source and licensing").setHeading();
    const info = containerEl.createDiv({ cls: "bible-verse-settings-info" });
    info.createEl("p", {
      text: "Bible data is provided by the HelloAO Bible API. Most translations are Public Domain or have open licenses (Creative Commons).",
    });
    const list = info.createEl("ul");
    list.createEl("li").createEl("a", {
      text: "HelloAO Bible API",
      href: "https://bible.helloao.org/",
    });
    list.createEl("li").createEl("a", {
      text: "Translation License Info",
      href: "https://bible.helloao.org/api/available_translations.json",
    });
    info.createEl("p", {
      text: "Note: Some translations may require attribution if you publish your notes. Check individual license terms if sharing content publicly.",
      cls: "bible-verse-settings-note",
    });

    new Setting(containerEl).setName("Feedback").setHeading();
    addFeedbackSetting(containerEl, this.plugin.manifest.version);
  }
}
