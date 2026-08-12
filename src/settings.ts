import { App, PluginSettingTab, Setting } from "obsidian";
import type BibleVersePlugin from "./main";
import { BibleWebsite, DisplayStyle } from "./types";
import { HELLOAO_TRANSLATIONS } from "./constants";
import { addFeedbackSetting } from "./feedback";

function df(text: string, ...examples: string[]): DocumentFragment {
  const frag = createFragment();
  frag.appendText(text);
  for (const ex of examples) {
    frag.appendText(" ");
    frag.appendChild(createEl("code", { text: ex }));
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
          .addOption("native-callout", "Native callout (bakes into note)")
          .setValue(this.plugin.settings.displayStyle)
          .onChange(async (value) => {
            this.plugin.settings.displayStyle = value as DisplayStyle;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("p", {
      cls: "bible-verse-settings-note",
      text:
        "“Bake” means writing a verse’s text permanently into your note as ordinary Markdown, so it reads without the plugin. The {…, bake} token bakes to a code block; the “Native callout” style (or {…, native-callout} / {…, nco}) bakes to a real, collapsible Obsidian callout. Baking is one-way — the plugin stops tracking it afterward. Note: choosing “Native callout” as your default here will auto-bake every scripture reference you add.",
    });

    // Native Callout Type
    new Setting(containerEl)
      .setName("Native callout type")
      .setDesc(df("Callout type used when baking as a native callout — match a type your theme or icon pack styles.", "quote", "bible"))
      .addText((text) =>
        text
          .setPlaceholder("quote")
          .setValue(this.plugin.settings.nativeCalloutType)
          .onChange(async (value) => {
            this.plugin.settings.nativeCalloutType = value.trim() || "quote";
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

    new Setting(containerEl).setName("Commercial translations").setHeading();

    const apiDesc = containerEl.createDiv({ cls: "bible-verse-settings-info" });
    apiDesc.createEl("p", {
      text: "Enter an ESV API key to unlock inline ESV text. ESV attribution is always shown, as required by Crossway's license. Other commercial translations (NIV, NKJV, NLT, AMP, CSB, NASB) render as links only.",
    });

    new Setting(containerEl)
      .setName("ESV API key")
      .setDesc(
        df("Unlocks English Standard Version inline text.", "Get a free key at api.esv.org")
      )
      .addText((text) =>
        text
          .setPlaceholder("Enter your ESV API key")
          .setValue(this.plugin.settings.esvApiKey)
          .onChange(async (value) => {
            this.plugin.settings.esvApiKey = value.trim();
            await this.plugin.saveSettings();
            this.plugin.refreshLivePreview();
          })
      )
      .then((setting) => {
        const input = setting.controlEl.querySelector("input");
        if (input) input.type = "password";
      });

    new Setting(containerEl).setName("Data source and licensing").setHeading();
    const info = containerEl.createDiv({ cls: "bible-verse-settings-info" });
    info.createEl("p", {
      text: "Free translations are provided by the HelloAO Bible API. ESV text is fetched from the ESV API using your own key.",
    });
    const list = info.createEl("ul");
    list.createEl("li").createEl("a", {
      text: "HelloAO Bible API",
      href: "https://bible.helloao.org/",
    });
    list.createEl("li").createEl("a", {
      text: "ESV API (free key)",
      href: "https://api.esv.org/",
    });
    info.createEl("p", {
      text: "Note: Some translations may require attribution if you publish your notes. Check individual license terms if sharing content publicly.",
      cls: "bible-verse-settings-note",
    });

    new Setting(containerEl).setName("Feedback").setHeading();
    addFeedbackSetting(containerEl, this.plugin.manifest.version);
  }
}
