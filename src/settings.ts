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
  }
}
