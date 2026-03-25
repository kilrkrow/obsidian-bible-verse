import { App, PluginSettingTab, Setting } from "obsidian";
import type BibleVersePlugin from "./main";
import { BibleWebsite, DisplayStyle } from "./types";

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

    // API Key
    new Setting(containerEl)
      .setName("API.Bible API Key")
      .setDesc(
        createFragment((el) => {
          el.appendText("Required. Get a free key at ");
          el.createEl("a", {
            text: "scripture.api.bible",
            href: "https://scripture.api.bible",
          });
        })
      )
      .addText((text) =>
        text
          .setPlaceholder("Enter your API key")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value;
            await this.plugin.saveSettings();
            this.plugin.api.setApiKey(value);
          })
      );

    // Default Translation
    new Setting(containerEl)
      .setName("Default Translation")
      .setDesc("The Bible translation to use by default (API.Bible ID)")
      .addText((text) =>
        text
          .setPlaceholder("de4e12af7f28f599-02")
          .setValue(this.plugin.settings.defaultTranslation)
          .onChange(async (value) => {
            this.plugin.settings.defaultTranslation = value;
            await this.plugin.saveSettings();
          })
      );

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
