import { App, PluginSettingTab, Setting } from "obsidian";
import type { SettingDefinitionItem } from "obsidian";
import type BibleVersePlugin from "./main";
import { BibleVerseSettings, BibleWebsite, DisplayStyle } from "./types";
import { HELLOAO_TRANSLATIONS } from "./constants";
import { addFeedbackSetting, configureFeedbackSetting } from "./feedback";

function df(text: string, ...examples: string[]): DocumentFragment {
  const frag = createFragment();
  frag.appendText(text);
  for (const ex of examples) {
    frag.appendText(" ");
    frag.appendChild(createEl("code", { text: ex }));
  }
  return frag;
}

// ── Shared content ──────────────────────────────────────────────────────────
// Both render paths (declarative getSettingDefinitions for Obsidian 1.13+, and
// the legacy display() below it) read the labels, options and copy from here,
// so the two can't drift apart.

const WEBSITE_OPTIONS: Record<BibleWebsite, string> = {
  BibleHub: "BibleHub",
  BibleGateway: "BibleGateway",
  BlueLetter: "Blue Letter Bible",
  BibleCom: "Bible.com",
};

const DISPLAY_STYLE_OPTIONS: Record<DisplayStyle, string> = {
  sidebar: "Sidebar",
  callout: "Callout",
  blockquote: "Blockquote",
  inline: "Inline",
  "native-callout": "Native callout (bakes into note)",
};

function translationOptions(): Record<string, string> {
  return Object.fromEntries(HELLOAO_TRANSLATIONS.map((t) => [t.id, t.name]));
}

const SIDEBAR_PADDING_LIMITS = { min: 0, max: 2, step: 0.1 };

const BAKE_NOTE =
  "“Bake” means writing a verse’s text permanently into your note as ordinary Markdown, so it reads without the plugin. The {…, bake} token bakes to a code block; the “Native callout” style (or {…, native-callout} / {…, nco}) bakes to a real, collapsible Obsidian callout. Baking is one-way — the plugin stops tracking it afterward. Note: choosing “Native callout” as your default here will auto-bake every scripture reference you add.";

const COMMERCIAL_NOTE =
  "Enter an ESV API key to unlock inline ESV text. ESV attribution is always shown, as required by Crossway's license. Other commercial translations (NIV, NKJV, NLT, AMP, CSB, NASB) render as links only.";

const DATA_SOURCE_NOTE =
  "Free translations are provided by the HelloAO Bible API. ESV text is fetched from the ESV API using your own key.";

const LICENSING_NOTE =
  "Note: Some translations may require attribution if you publish your notes. Check individual license terms if sharing content publicly.";

const SYNTAX_ROWS: [string, string][] = [
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

/** The collapsible token-syntax table. */
function buildSyntaxReference(containerEl: HTMLElement): void {
  const details = containerEl.createEl("details", { cls: "bible-verse-settings-ref" });
  details.createEl("summary", { text: "Show token syntax" });
  const refTable = details.createEl("table");
  for (const [token, desc] of SYNTAX_ROWS) {
    const tr = refTable.createEl("tr");
    tr.createEl("td").createEl("code", { text: token });
    tr.createEl("td", { text: desc });
  }
}

/** Data-source blurb, provider links, and the attribution note. */
function buildLicensingInfo(containerEl: HTMLElement): void {
  const info = containerEl.createDiv({ cls: "bible-verse-settings-info" });
  info.createEl("p", { text: DATA_SOURCE_NOTE });
  const list = info.createEl("ul");
  list.createEl("li").createEl("a", {
    text: "HelloAO Bible API",
    href: "https://bible.helloao.org/",
  });
  list.createEl("li").createEl("a", {
    text: "ESV API (free key)",
    href: "https://api.esv.org/",
  });
  info.createEl("p", { text: LICENSING_NOTE, cls: "bible-verse-settings-note" });
}

/** Mask the ESV key: it's a credential, not ordinary text. */
function maskInput(setting: Setting): void {
  const input = setting.controlEl.querySelector("input");
  if (input) input.type = "password";
}

type SettingKey = keyof BibleVerseSettings;

export class BibleVerseSettingTab extends PluginSettingTab {
  plugin: BibleVersePlugin;

  constructor(app: App, plugin: BibleVersePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * Declarative settings, used by Obsidian 1.13.0+. Returning a non-empty array
   * means `display()` below is never called on those versions — it stays only as
   * the fallback for older Obsidian, which is why manifest.minAppVersion can
   * remain 1.4.0.
   *
   * Everything here is indexed for the settings search, including the rows that
   * render custom markup: search reads `name`/`desc`/`aliases`, not the DOM.
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    const items: SettingDefinitionItem<SettingKey>[] = [
      {
        name: "Default translation",
        desc: df("The Bible translation to use by default. Override per-reference:", "{Romans 8:28, KJV}"),
        control: { type: "dropdown", key: "defaultTranslation", options: translationOptions() },
      },
      {
        name: "Preferred Bible website",
        desc: "Which website to link verse references to",
        control: { type: "dropdown", key: "preferredWebsite", options: WEBSITE_OPTIONS },
      },
      {
        name: "Display style",
        desc: df("How verses are visually presented. Override per-reference:", "{Romans 8:28, callout}", "{Romans 8:28, sidebar}", "{Romans 8:28, inline}"),
        control: { type: "dropdown", key: "displayStyle", options: DISPLAY_STYLE_OPTIONS },
      },
      {
        name: "About baking",
        desc: BAKE_NOTE,
        aliases: ["bake", "native callout", "persist"],
      },
      {
        name: "Native callout type",
        desc: df("Callout type used when baking as a native callout — match a type your theme or icon pack styles.", "quote", "bible"),
        control: { type: "text", key: "nativeCalloutType", placeholder: "quote" },
      },
      {
        name: "Sidebar top padding",
        desc: "Adjust the top spacing for the Sidebar style (in ems)",
        control: { type: "slider", key: "sidebarTopPadding", ...SIDEBAR_PADDING_LIMITS },
      },
      {
        name: "Persist verse text in notes",
        desc: "When enabled, fetched verse text is automatically written into note source (bake mode)",
        control: { type: "toggle", key: "persistVerseText" },
      },
      {
        name: "Show verse numbers",
        desc: df("Display verse numbers in the rendered text. Override per-reference:", "{Romans 8:28-30, v}", "{Romans 8:28-30, no-v}"),
        control: { type: "toggle", key: "showVerseNumbers" },
      },
      {
        name: "Show attribution",
        desc: "Display license and copyright links below verses.",
        control: { type: "toggle", key: "showAttribution" },
      },
      {
        name: "New line per verse",
        desc: df("Start each verse on a new line. Override per-reference:", "{Romans 8:28-30, nl}", "{Romans 8:28-30, no-nl}"),
        // Only meaningful when verse numbers are shown; setControlValue calls
        // refreshDomState() when that toggle changes so this re-evaluates.
        control: {
          type: "toggle",
          key: "verseNewLine",
          disabled: () => !this.plugin.settings.showVerseNumbers,
        },
      },
      {
        name: "Bake inline references",
        desc: "If enabled, baking a note will convert {ref} into a bible code block. If disabled, only code blocks are baked.",
        control: { type: "toggle", key: "bakeInline" },
      },
      {
        name: "Reading sections",
        desc: df("Group verses by natural paragraph breaks. Override per-reference:", "{Luke 19, para}", "{Luke 19, no-para}"),
        control: { type: "toggle", key: "paragraphBreaks" },
      },
      {
        name: "IntelliSense helper mode",
        desc: "When a reference is complete, show a menu of all available modifiers (style, formatting, reading sections).",
        control: { type: "toggle", key: "helperMode" },
      },
      {
        type: "group",
        heading: "Syntax reference",
        items: [
          {
            name: "Token syntax",
            desc: "Every token form the plugin understands.",
            // Make the tokens themselves findable from the settings search.
            aliases: SYNTAX_ROWS.map(([token]) => token),
            render: (setting) => {
              setting.settingEl.empty();
              buildSyntaxReference(setting.settingEl);
            },
          },
        ],
      },
      {
        type: "group",
        heading: "Commercial translations",
        items: [
          {
            name: "About commercial translations",
            desc: COMMERCIAL_NOTE,
            aliases: ["ESV", "NIV", "NKJV", "NLT", "AMP", "CSB", "NASB"],
          },
          {
            name: "ESV API key",
            desc: df("Unlocks English Standard Version inline text.", "Get a free key at api.esv.org"),
            // A `text` control would store the key in the clear; render it by
            // hand so the input can be masked, as display() does.
            render: (setting) => {
              setting.addText((text) =>
                text
                  .setPlaceholder("Enter your ESV API key")
                  .setValue(this.plugin.settings.esvApiKey)
                  .onChange(async (value) => {
                    this.plugin.settings.esvApiKey = value.trim();
                    await this.plugin.saveSettings();
                    this.plugin.refreshLivePreview();
                  })
              );
              maskInput(setting);
            },
          },
        ],
      },
      {
        type: "group",
        heading: "Data source and licensing",
        items: [
          {
            name: "Data sources",
            desc: DATA_SOURCE_NOTE,
            aliases: ["HelloAO", "ESV API", "license", "attribution"],
            render: (setting) => {
              setting.settingEl.empty();
              buildLicensingInfo(setting.settingEl);
            },
          },
        ],
      },
      {
        type: "group",
        heading: "Feedback",
        items: [
          {
            name: "Send feedback",
            desc: "Report a bug (version info pre-filled) or suggest an idea on GitHub.",
            render: (setting) => configureFeedbackSetting(setting, this.plugin.manifest.version),
          },
        ],
      },
    ];

    return items;
  }

  /** Reads the value behind a `control` definition's `key`. */
  getControlValue(key: string): unknown {
    return this.plugin.settings[key as SettingKey];
  }

  /**
   * Persists a `control` definition's new value, applying the same
   * normalization and side effects the display() handlers below do.
   */
  async setControlValue(key: string, value: unknown): Promise<void> {
    // The control key is only known as a string here; the definitions above are
    // typed against SettingKey, which is what keeps the two in step.
    const settings = this.plugin.settings as unknown as Record<string, unknown>;
    settings[key] =
      key === "nativeCalloutType" ? String(value).trim() || "quote" : value;
    await this.plugin.saveSettings();

    switch (key) {
      case "preferredWebsite":
        this.plugin.refreshLivePreview();
        break;
      case "sidebarTopPadding":
        this.plugin.updateStyles();
        break;
    }
    // Toggling "show verse numbers" changes whether "new line per verse" is
    // disabled. Pushing that to the DOM immediately needs refreshDomState(),
    // which is 1.13.0-only — and obsidianmd/no-unsupported-api may not be
    // suppressed while minAppVersion is 1.4.0. The predicate is re-evaluated on
    // every render regardless, so the row corrects itself the next time the tab
    // is drawn. Call refreshDomState() here once minAppVersion reaches 1.13.0.
  }

  /**
   * Fallback for Obsidian older than 1.13.0. Never called on 1.13.0+, where
   * getSettingDefinitions() above renders the tab instead. Delete this, and
   * renderLegacy() below, once manifest.minAppVersion reaches 1.13.0.
   */
  display(): void {
    this.renderLegacy();
  }

  /**
   * The pre-1.13 tab body. Separate from display() so the "show verse numbers"
   * handler can re-render without calling display(), which is deprecated.
   */
  private renderLegacy(): void {
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
      .addDropdown((dropdown) => {
        for (const [value, label] of Object.entries(WEBSITE_OPTIONS)) {
          dropdown.addOption(value, label);
        }
        dropdown
          .setValue(this.plugin.settings.preferredWebsite)
          .onChange(async (value) => {
            this.plugin.settings.preferredWebsite = value as BibleWebsite;
            await this.plugin.saveSettings();
            this.plugin.refreshLivePreview();
          });
      });

    // Display Style
    new Setting(containerEl)
      .setName("Display style")
      .setDesc(df("How verses are visually presented. Override per-reference:", "{Romans 8:28, callout}", "{Romans 8:28, sidebar}", "{Romans 8:28, inline}"))
      .addDropdown((dropdown) => {
        for (const [value, label] of Object.entries(DISPLAY_STYLE_OPTIONS)) {
          dropdown.addOption(value, label);
        }
        dropdown
          .setValue(this.plugin.settings.displayStyle)
          .onChange(async (value) => {
            this.plugin.settings.displayStyle = value as DisplayStyle;
            await this.plugin.saveSettings();
          });
      });

    containerEl.createEl("p", {
      cls: "bible-verse-settings-note",
      text: BAKE_NOTE,
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
          .setLimits(SIDEBAR_PADDING_LIMITS.min, SIDEBAR_PADDING_LIMITS.max, SIDEBAR_PADDING_LIMITS.step)
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
            this.renderLegacy(); // Refresh to update dependency states
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
    buildSyntaxReference(containerEl);

    new Setting(containerEl).setName("Commercial translations").setHeading();

    const apiDesc = containerEl.createDiv({ cls: "bible-verse-settings-info" });
    apiDesc.createEl("p", { text: COMMERCIAL_NOTE });

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
      .then(maskInput);

    new Setting(containerEl).setName("Data source and licensing").setHeading();
    buildLicensingInfo(containerEl);

    new Setting(containerEl).setName("Feedback").setHeading();
    addFeedbackSetting(containerEl, this.plugin.manifest.version);
  }
}
