import { App, PluginSettingTab, Setting } from "obsidian";
import type BibleVersePlugin from "./main";
import { BibleWebsite, DisplayStyle } from "./types";
import { HELLOAO_TRANSLATIONS } from "./constants";

export class BibleVerseSettingTab extends PluginSettingTab {
  plugin: BibleVersePlugin;

  constructor(app: App, plugin: BibleVersePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Bible Verse Settings" });

    // Default Translation (dropdown from curated list)
    new Setting(containerEl)
      .setName("Default Translation")
      .setDesc("The Bible translation to use by default")
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
      .setName("Preferred Bible Website")
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
          })
      );

    // Display Style
    new Setting(containerEl)
      .setName("Display Style")
      .setDesc("How verses are visually presented")
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
      .setName("Sidebar Top Padding")
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
      .setName("Persist Verse Text in Notes")
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
      .setDesc("Display verse numbers in the rendered text.")
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
      .setName("New line per verse")
      .setDesc("Start each verse on a new line (only if verse numbers are enabled).")
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
  }
}
