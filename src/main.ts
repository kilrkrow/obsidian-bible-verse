import { MarkdownPostProcessorContext, Notice, Plugin } from "obsidian";
import { BibleVerseSettings, DEFAULT_SETTINGS, BibleReference, CachedVerse } from "./types";
import { parseReference, formatReference } from "./parser";
import { BibleApi } from "./api";
import { VerseCache } from "./cache";
import { Baker } from "./baker";
import { BibleVerseSettingTab } from "./settings";
import {
  renderVerse,
  renderLink,
  renderComparison,
  renderError,
} from "./renderer";
import { HELLOAO_ABBREV, HELLOAO_TRANSLATIONS } from "./constants";

export default class BibleVersePlugin extends Plugin {
  settings: BibleVerseSettings = DEFAULT_SETTINGS;
  api: BibleApi = null!;
  cache: VerseCache = null!;
  baker: Baker = null!;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.cache = new VerseCache(this);
    await this.cache.load();

    this.api = new BibleApi(this.cache);
    this.baker = new Baker(this.app);

    // Register the inline postprocessor for @[ref] syntax
    this.registerMarkdownPostProcessor(this.inlinePostProcessor.bind(this));

    // Register the ```bible code block processor
    this.registerMarkdownCodeBlockProcessor("bible", this.codeBlockProcessor.bind(this));

    // Settings tab
    this.addSettingTab(new BibleVerseSettingTab(this.app, this));

    // Commands
    this.addCommand({
      id: "bake-current-note",
      name: "Bake all verses in this note",
      editorCallback: async (editor) => {
        const content = editor.getValue();
        const newContent = await this.baker.bakeFile(content, (ref) =>
          this.fetchVerse(ref)
        );
        if (newContent !== content) {
          editor.setValue(newContent);
          new Notice("Bible verses baked into note.");
        } else {
          new Notice("No verses to bake.");
        }
      },
    });

    this.addCommand({
      id: "refresh-current-note",
      name: "Refresh baked verses in this note",
      editorCallback: async (editor) => {
        let content = editor.getValue();
        // Strip then re-bake
        content = this.baker.stripBakedText(content);
        const newContent = await this.baker.bakeFile(content, (ref) =>
          this.fetchVerse(ref)
        );
        editor.setValue(newContent);
        new Notice("Bible verses refreshed.");
      },
    });

    this.addCommand({
      id: "refresh-vault",
      name: "Refresh all baked verses in vault",
      callback: async () => {
        const count = await this.baker.processVault("bake", (ref) =>
          this.fetchVerse(ref)
        );
        new Notice(`Refreshed baked verses in ${count} files.`);
      },
    });

    this.addCommand({
      id: "bake-vault",
      name: "Bake all existing verses across vault",
      callback: async () => {
        const count = await this.baker.processVault("bake", (ref) =>
          this.fetchVerse(ref)
        );
        new Notice(`Baked verses in ${count} files.`);
      },
    });

    this.addCommand({
      id: "strip-vault",
      name: "Strip baked text from all notes",
      callback: async () => {
        const count = await this.baker.processVault("strip");
        new Notice(`Stripped baked text from ${count} files.`);
      },
    });
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /**
   * Get a short abbreviation for the current translation.
   * Looks up from the HELLOAO_ABBREV map, falls back to the ID itself.
   */
  private getTranslationAbbr(translationId?: string): string {
    const id = translationId ?? this.settings.defaultTranslation;
    return HELLOAO_ABBREV[id] ?? id;
  }

  /**
   * Fetch a verse using the current settings.
   */
  async fetchVerse(ref: BibleReference): Promise<CachedVerse | null> {
    try {
      return await this.api.getPassage(
        ref,
        this.settings.defaultTranslation,
        this.getTranslationAbbr()
      );
    } catch (e) {
      console.error("Bible Verse: Failed to fetch verse", e);
      return null;
    }
  }

  /**
   * Inline markdown postprocessor: finds @[ref] in rendered text and replaces them.
   */
  private async inlinePostProcessor(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
  ): Promise<void> {
    // Find text nodes containing @[...]
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodesToProcess: { node: Text; matches: RegExpMatchArray[] }[] = [];

    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const text = node.textContent || "";
      const matches = [...text.matchAll(/@\[([^\]]+)\]/g)];
      if (matches.length > 0) {
        nodesToProcess.push({ node, matches });
      }
    }

    for (const { node, matches } of nodesToProcess) {
      const text = node.textContent || "";
      const frag = document.createDocumentFragment();
      let lastIndex = 0;

      for (const match of matches) {
        const matchIndex = match.index!;
        // Add text before the match
        if (matchIndex > lastIndex) {
          frag.appendChild(document.createTextNode(text.slice(lastIndex, matchIndex)));
        }

        const refStr = match[1];
        const ref = parseReference(refStr);

        if (ref) {
          const span = document.createElement("span");
          span.className = "bible-verse-container";

          // Try cache first, then fetch
          const abbr = this.getTranslationAbbr();
          const cached = this.cache.get(abbr, formatReference(ref));
          if (cached) {
            renderVerse(
              span,
              ref,
              cached,
              this.settings.displayStyle,
              this.settings.preferredWebsite
            );
          } else {
            // Render a link placeholder, then fetch async
            renderLink(span, ref, abbr, this.settings.preferredWebsite);
            this.fetchAndRender(span, ref);
          }

          frag.appendChild(span);

          // Handle bake mode
          if (this.settings.persistVerseText) {
            this.handleBake(ctx, refStr, ref);
          }
        } else {
          // Not a valid reference, keep as text
          frag.appendChild(document.createTextNode(match[0]));
        }

        lastIndex = matchIndex + match[0].length;
      }

      // Add remaining text
      if (lastIndex < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex)));
      }

      node.parentNode?.replaceChild(frag, node);
    }
  }

  /**
   * Fetch a verse and update the rendered element.
   */
  private async fetchAndRender(container: HTMLElement, ref: BibleReference): Promise<void> {
    const verse = await this.fetchVerse(ref);
    if (verse) {
      container.empty();
      renderVerse(
        container,
        ref,
        verse,
        this.settings.displayStyle,
        this.settings.preferredWebsite
      );
    }
  }

  /**
   * Handle automatic baking when persistVerseText is on.
   */
  private async handleBake(
    ctx: MarkdownPostProcessorContext,
    rawRef: string,
    ref: BibleReference
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!file || !(file instanceof (await import("obsidian")).TFile)) return;

    const verse = await this.fetchVerse(ref);
    if (!verse) return;

    const content = await this.app.vault.read(file as any);
    const refMarker = `@[${rawRef}]`;
    if (this.baker.hasBakedBlock(content, refMarker)) return;

    const newContent = this.baker.bakeVerse(content, refMarker, verse);
    if (newContent !== content) {
      await this.app.vault.modify(file as any, newContent);
    }
  }

  /**
   * Code block processor for ```bible blocks.
   */
  private async codeBlockProcessor(
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
  ): Promise<void> {
    const lines = source.trim().split("\n");
    if (lines.length === 0) {
      renderError(el, "Empty bible code block.");
      return;
    }

    const refStr = lines[0].trim();
    const ref = parseReference(refStr);
    if (!ref) {
      renderError(el, `Could not parse reference: "${refStr}"`);
      return;
    }

    // Parse key:value config from remaining lines
    const config: Record<string, string> = {};
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) {
        const key = line.substring(0, colonIdx).trim().toLowerCase();
        const value = line.substring(colonIdx + 1).trim();
        config[key] = value;
      }
    }

    // Comparison mode
    if (config["compare"]) {
      const translations = config["compare"].split(",").map((s) => s.trim());
      await this.renderComparisonBlock(el, ref, translations);
      return;
    }

    // Single translation
    const translationId = config["translation"]
      ? this.resolveTranslationId(config["translation"])
      : this.settings.defaultTranslation;
    const translationAbbr = config["translation"]
      ? this.getTranslationAbbr(this.resolveTranslationId(config["translation"]))
      : this.getTranslationAbbr();

    try {
      const verse = await this.api.getPassage(ref, translationId, translationAbbr);
      renderVerse(el, ref, verse, this.settings.displayStyle, this.settings.preferredWebsite);
    } catch (e) {
      renderError(el, `Failed to fetch ${formatReference(ref)}: ${(e as Error).message}`);
    }
  }

  /**
   * Render a comparison block with multiple translations.
   */
  private async renderComparisonBlock(
    el: HTMLElement,
    ref: BibleReference,
    translations: string[]
  ): Promise<void> {
    const verses: CachedVerse[] = [];

    for (const trans of translations) {
      const id = this.resolveTranslationId(trans);
      const abbr = this.getTranslationAbbr(id);
      try {
        const verse = await this.api.getPassage(ref, id, abbr);
        verses.push(verse);
      } catch (e) {
        console.error(`Bible Verse: Failed to fetch ${trans}`, e);
      }
    }

    if (verses.length > 0) {
      renderComparison(el, ref, verses, this.settings.preferredWebsite);
    } else {
      renderError(el, "Failed to fetch any translations for comparison.");
    }
  }

  /**
   * Resolve a translation abbreviation to a HelloAO translation ID.
   * Searches the curated list by abbreviation, then by ID directly.
   */
  private resolveTranslationId(abbr: string): string {
    const upper = abbr.toUpperCase();
    // Match by abbreviation
    const match = HELLOAO_TRANSLATIONS.find(
      (t) => t.abbreviation.toUpperCase() === upper
    );
    if (match) return match.id;
    // Match by ID directly
    const byId = HELLOAO_TRANSLATIONS.find(
      (t) => t.id.toUpperCase() === upper
    );
    if (byId) return byId.id;
    // Fallback: assume it's a HelloAO ID already
    return abbr;
  }
}
