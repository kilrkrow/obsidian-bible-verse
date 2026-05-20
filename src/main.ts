import { MarkdownPostProcessorContext, MarkdownRenderChild, MarkdownView, Notice, Plugin, TFile } from "obsidian";
import { EditorView } from "@codemirror/view";
import { BibleVerseSettings, DEFAULT_SETTINGS, BibleReference, CachedVerse, DisplayStyle } from "./types";
import { parseReference, parseInlineSpec, formatReference, InlineSpec } from "./parser";
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
import { generateLink, generateSearchUrl } from "./linker";
import { QuickInsertModal } from "./quick-insert-modal";
import { BibleReferenceSuggest } from "./suggest";
import { buildViewPlugin } from "./view-plugin";
import { HELLOAO_ABBREV, HELLOAO_TRANSLATIONS } from "./constants";
import { verseFetchedEffect } from "./effects";

export default class BibleVersePlugin extends Plugin {
  settings: BibleVerseSettings = DEFAULT_SETTINGS;
  api: BibleApi = null!;
  cache: VerseCache = null!;
  baker: Baker = null!;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.updateStyles();

    this.cache = new VerseCache(this);
    await this.cache.load();

    this.api = new BibleApi(this.cache);
    this.baker = new Baker(this.app);

    // Register the inline postprocessor for {ref} syntax
    this.registerMarkdownPostProcessor(this.inlinePostProcessor.bind(this));

    // Register the IntelliSense suggester for {ref} syntax
    this.registerEditorSuggest(new BibleReferenceSuggest(this.app, this));

    // Register the CM6 ViewPlugin for Live Preview inline rendering
    this.registerEditorExtension(buildViewPlugin(this));

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
        const newContent = await this.baker.bakeFile(
          content,
          this.settings.bakeInline,
          (ref, id, abbr, nl, vn) => this.fetchVerse(ref, id, abbr, nl, vn)
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
        const newContent = await this.baker.bakeFile(
          content,
          this.settings.bakeInline,
          (ref, id, abbr, nl, vn) => this.fetchVerse(ref, id, abbr, nl, vn)
        );
        editor.setValue(newContent);
        new Notice("Bible verses refreshed.");
      },
    });

    this.addCommand({
      id: "refresh-vault",
      name: "Refresh all baked verses in vault",
      callback: async () => {
        const count = await this.baker.processVault(
          "bake",
          this.settings.bakeInline,
          (ref, id, abbr, nl, vn) => this.fetchVerse(ref, id, abbr, nl, vn)
        );
        new Notice(`Refreshed baked verses in ${count} files.`);
      },
    });

    this.addCommand({
      id: "bake-vault",
      name: "Bake all existing verses across vault",
      callback: async () => {
        const count = await this.baker.processVault(
          "bake",
          this.settings.bakeInline,
          (ref, id, abbr, nl, vn) => this.fetchVerse(ref, id, abbr, nl, vn)
        );
        new Notice(`Baked verses in ${count} files.`);
      },
    });

    this.addCommand({
      id: "strip-vault",
      name: "Strip baked text from all notes",
      callback: async () => {
        const count = await this.baker.processVault("strip", false);
        new Notice(`Stripped baked text from ${count} files.`);
      },
    });

    this.addCommand({
      id: "clear-cache",
      name: "Clear verse cache",
      callback: async () => {
        await this.cache.clear();
        new Notice("Bible verse cache cleared.");
      },
    });

    this.addCommand({
      id: "quick-insert",
      name: "Quick insert reference",
      callback: () => {
        const modal = new QuickInsertModal(this.app, (refStr, openInBrowser) => {
          const editor = this.app.workspace.activeEditor?.editor;
          if (editor) {
            // refStr is already wrapped as "{John 3:16}" by the modal
            editor.replaceSelection(refStr);
          }
          if (openInBrowser) {
            // Strip braces to parse the reference for the browser link
            const inner = refStr.replace(/^\{|\}$/g, "");
            const ref = parseReference(inner);
            if (ref) {
              const abbr = this.getTranslationAbbr();
              const url = generateLink(ref, abbr, this.settings.preferredWebsite);
              window.open(url, "_blank");
            }
          }
        });
        modal.open();
      },
    });

    this.addCommand({
      id: "search-selection",
      name: "Search Bible for selected text",
      editorCallback: (editor) => {
        const selection = editor.getSelection();
        if (!selection || selection.trim().length === 0) {
          new Notice("No text selected.");
          return;
        }
        navigator.clipboard.writeText(selection.trim());
        new Notice("Copied to clipboard. Opening search...");
        const abbr = this.getTranslationAbbr();
        const url = generateSearchUrl(selection.trim(), abbr, this.settings.preferredWebsite);
        window.open(url, "_blank");
      },
    });

    this.addCommand({
      id: "open-reference",
      name: "Open reference at cursor on Bible site",
      editorCallback: (editor) => {
        const cursor = editor.getCursor();
        const line = editor.getLine(cursor.line);
        const regex = /\{([A-Za-z0-9][^}\n]*)\}/g;
        let match;
        while ((match = regex.exec(line)) !== null) {
          const start = match.index;
          const end = start + match[0].length;
          if (cursor.ch >= start && cursor.ch <= end) {
            // Support {ref}, {ref, TRANS}, and {ref, TRANS1, TRANS2}
            const spec = parseInlineSpec(match[1].trim());
            if (spec) {
              const abbr = spec.translations.length >= 1
                ? this.getTranslationAbbr(this.resolveTranslationId(spec.translations[0]))
                : this.getTranslationAbbr();
              const url = generateLink(spec.ref, abbr, this.settings.preferredWebsite);
              window.open(url, "_blank");
              return;
            }
          }
        }
        new Notice("No Bible reference found at cursor.");
      },
    });
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  updateStyles(): void {
    document.body.style.setProperty(
      "--bible-verse-sidebar-top-padding",
      `${this.settings.sidebarTopPadding}em`
    );
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
   * Public helper to check if a translation is link-only.
   */
  public isTranslationLinkOnly(idOrAbbr: string): boolean {
    const t = HELLOAO_TRANSLATIONS.find(
      (t) => t.id === idOrAbbr || t.abbreviation.toUpperCase() === idOrAbbr.toUpperCase()
    );
    return t?.isLinkOnly ?? false;
  }

  /**
   * Fetch a verse using the current settings.
   * If network fetch fails, attempts to find a baked block in the active file as a fallback.
   */
  private async fetchVerse(
    ref: BibleReference,
    translationId?: string,
    translationAbbr?: string,
    verseNewLineOverride?: boolean,
    showVerseNumbersOverride?: boolean,
    paragraphBreaksOverride?: boolean
  ): Promise<CachedVerse | null> {
    try {
      const id = translationId ?? this.settings.defaultTranslation;
      const abbr = translationAbbr ?? this.getTranslationAbbr(id);
      const vnL = verseNewLineOverride ?? this.settings.verseNewLine;
      const sVN = showVerseNumbersOverride ?? this.settings.showVerseNumbers;
      const pb = paragraphBreaksOverride ?? this.settings.paragraphBreaks;

      return await this.api.getPassage(ref, id, abbr, {
        showVerseNumbers: sVN,
        verseNewLine: vnL,
        paragraphBreaks: pb,
      });
    } catch (e) {
      console.error("Bible Verse: fetchVerse failed", e);
      return null;
    }
  }

  /**
   * Inline markdown postprocessor: finds {ref} in rendered text and replaces them.
   */
  private async inlinePostProcessor(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
  ): Promise<void> {
    const INLINE_REGEX = /\{([A-Za-z0-9][^}\n]*)\}/g;

    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodesToProcess: { node: Text; matches: RegExpMatchArray[] }[] = [];

    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const text = node.textContent || "";
      const matches = [...text.matchAll(INLINE_REGEX)];
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
        if (matchIndex > lastIndex) {
          frag.appendChild(document.createTextNode(text.slice(lastIndex, matchIndex)));
        }

        const rawContent = match[1].trim();
        const spec = parseInlineSpec(rawContent);

        if (spec) {
          const { ref, translations } = spec;
          const span = document.createElement("span");
          span.className = "bible-verse-container";

          if (translations.length >= 2) {
            this.renderInlineComparison(span, ref, translations, spec.paragraphBreaks ?? undefined);
          } else if (translations.length === 1 && this.isTranslationLinkOnly(translations[0])) {
            renderLink(span, ref, translations[0].toUpperCase(), this.settings.preferredWebsite);
          } else {
            const translationId = translations.length === 1
              ? this.resolveTranslationId(translations[0])
              : this.settings.defaultTranslation;
            const abbr = translations.length === 1
              ? this.getTranslationAbbr(translationId)
              : this.getTranslationAbbr();

            const style = spec.styleOverride ?? this.settings.displayStyle;
            const vnL = spec.verseNewLine ?? this.settings.verseNewLine;
            const sVN = spec.showVerseNumbers ?? this.settings.showVerseNumbers;
            const pb = spec.paragraphBreaks ?? this.settings.paragraphBreaks;

            const cached = this.cache.get(abbr, formatReference(ref), vnL, sVN, pb);
            if (cached) {
              await renderVerse(span, ref, cached, style, this.settings.preferredWebsite, this.settings.showAttribution, this.app, this, pb);
            } else {
              renderLink(span, ref, abbr, this.settings.preferredWebsite);
              this.fetchAndRenderWithTranslation(span, ref, translationId, abbr, style, vnL, sVN, pb);
            }
          }

          frag.appendChild(span);

          if (this.settings.persistVerseText && translations.length === 0) {
            this.handleBake(ctx, match[0], spec);
          }
        } else {
          frag.appendChild(document.createTextNode(match[0]));
        }

        lastIndex = matchIndex + match[0].length;
      }

      if (lastIndex < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex)));
      }

      node.parentNode?.replaceChild(frag, node);
    }
  }

  private async fetchAndRenderWithTranslation(
    container: HTMLElement,
    ref: BibleReference,
    translationId: string,
    translationAbbr: string,
    style?: DisplayStyle,
    verseNewLineOverride?: boolean,
    showVerseNumbersOverride?: boolean,
    paragraphBreaksOverride?: boolean
  ): Promise<void> {
    try {
      const vnL = verseNewLineOverride ?? this.settings.verseNewLine;
      const sVN = showVerseNumbersOverride ?? this.settings.showVerseNumbers;
      const pb = paragraphBreaksOverride ?? this.settings.paragraphBreaks;

      const verse = await this.api.getPassage(ref, translationId, translationAbbr, {
        showVerseNumbers: sVN,
        verseNewLine: vnL,
        paragraphBreaks: pb,
      });
      container.empty();
      await renderVerse(
        container,
        ref,
        verse,
        style ?? this.settings.displayStyle,
        this.settings.preferredWebsite,
        this.settings.showAttribution,
        this.app,
        this,
        pb
      );
    } catch (e) {
      console.error("Bible Verse: Failed to fetch verse", e);
    }
  }

  private async renderInlineComparison(
    container: HTMLElement,
    ref: BibleReference,
    translations: string[],
    paragraphBreaksOverride?: boolean
  ): Promise<void> {
    const pb = paragraphBreaksOverride ?? this.settings.paragraphBreaks;
    const verses = [];
    for (const trans of translations) {
      const id = this.resolveTranslationId(trans);
      const abbr = this.getTranslationAbbr(id);
      try {
        const verse = await this.api.getPassage(ref, id, abbr, {
          showVerseNumbers: this.settings.showVerseNumbers,
          verseNewLine: this.settings.verseNewLine,
          paragraphBreaks: pb,
        });
        verses.push(verse);
      } catch (e) {
        console.error(`Bible Verse: Failed to fetch ${trans}`, e);
      }
    }
    if (verses.length > 0) {
      await renderComparison(container, ref, verses, this.settings.preferredWebsite, this.settings.showAttribution, this.app, this);
    } else {
      renderError(container, `Could not fetch translations for ${formatReference(ref)}.`);
    }
  }

  private async handleBake(
    ctx: MarkdownPostProcessorContext,
    refMarker: string,
    spec: InlineSpec
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!(file instanceof TFile)) return;

    if (!this.settings.bakeInline) return;

    const { ref, translations, verseNewLine, showVerseNumbers } = spec;
    const transId = translations.length === 1 ? this.resolveTranslationId(translations[0]) : undefined;
    const transAbbr = transId ? this.getTranslationAbbr(transId) : undefined;

    const pb = spec.paragraphBreaks ?? this.settings.paragraphBreaks;
    const verse = await this.fetchVerse(ref, transId, transAbbr, verseNewLine ?? undefined, showVerseNumbers ?? undefined, pb);
    if (!verse) return;

    await this.app.vault.process(file, (content) => {
      return this.baker.bakeVerse(content, refMarker, verse, "inline");
    });
  }

  private async codeBlockProcessor(
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
  ): Promise<void> {
    el.empty();
    ctx.addChild(new MarkdownRenderChild(el));

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

    const config: Record<string, string> = {};
    let cachedText: string | null = null;
    let headerLinesCount = lines.length;

    const sepIdx = lines.indexOf("---");
    if (sepIdx > 0) {
      headerLinesCount = sepIdx;
      cachedText = lines.slice(sepIdx + 1).join("\n").trim();
    }

    for (let i = 1; i < headerLinesCount; i++) {
      const line = lines[i].trim();
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) {
        const key = line.substring(0, colonIdx).trim().toLowerCase();
        const value = line.substring(colonIdx + 1).trim();
        config[key] = value;
      }
    }

    const vnL = config["newline"] !== undefined
      ? config["newline"].toLowerCase() === "true"
      : this.settings.verseNewLine;
    const sVN = config["numbers"] !== undefined || config["verse-numbers"] !== undefined
      ? (config["numbers"] ?? config["verse-numbers"]).toLowerCase() === "true"
      : this.settings.showVerseNumbers;
    const pb = config["sections"] !== undefined
      ? config["sections"].toLowerCase() === "true"
      : this.settings.paragraphBreaks;

    if (config["compare"]) {
      const translations = config["compare"].split(",").map((s) => s.trim());
      await this.renderComparisonBlock(el, ref, translations, vnL, sVN, pb);
      return;
    }

    const translationId = config["translation"]
      ? this.resolveTranslationId(config["translation"])
      : this.settings.defaultTranslation;
    const translationAbbr = config["translation"]
      ? this.getTranslationAbbr(this.resolveTranslationId(config["translation"]))
      : this.getTranslationAbbr();

    const styleOverride = this.resolveStyleKey(config["style"]);

    try {
      let verse: CachedVerse;
      if (cachedText) {
        verse = {
          reference: formatReference(ref),
          translation: translationAbbr,
          bibleId: translationId,
          text: cachedText,
          copyright: "",
          fetchedAt: Date.now(),
        };
      } else {
        verse = await this.api.getPassage(ref, translationId, translationAbbr, {
          showVerseNumbers: sVN,
          verseNewLine: vnL,
          paragraphBreaks: pb,
        });
      }

      await renderVerse(
        el,
        ref,
        verse,
        styleOverride ?? this.settings.displayStyle,
        this.settings.preferredWebsite,
        this.settings.showAttribution,
        this.app,
        this,
        pb
      );
    } catch (e) {
      renderError(el, `Failed to fetch ${formatReference(ref)}: ${(e as Error).message}`);
    }
  }

  private resolveStyleKey(raw: string | undefined): DisplayStyle | null {
    if (!raw) return null;
    const lower = raw.trim().toLowerCase();
    if (lower === "sidebar" || lower === "callout" || lower === "blockquote" || lower === "inline") {
      return lower;
    }
    return null;
  }

  private async renderComparisonBlock(
    el: HTMLElement,
    ref: BibleReference,
    translations: string[],
    verseNewLineOverride?: boolean,
    showVerseNumbersOverride?: boolean,
    paragraphBreaksOverride?: boolean
  ): Promise<void> {
    const verses: CachedVerse[] = [];
    const vnL = verseNewLineOverride ?? this.settings.verseNewLine;
    const sVN = showVerseNumbersOverride ?? this.settings.showVerseNumbers;
    const pb = paragraphBreaksOverride ?? this.settings.paragraphBreaks;

    for (const trans of translations) {
      const id = this.resolveTranslationId(trans);
      const abbr = this.getTranslationAbbr(id);
      try {
        const verse = await this.api.getPassage(ref, id, abbr, {
          showVerseNumbers: sVN,
          verseNewLine: vnL,
          paragraphBreaks: pb,
        });
        verses.push(verse);
      } catch (e) {
        console.error(`Bible Verse: Failed to fetch ${trans}`, e);
      }
    }

    if (verses.length > 0) {
      await renderComparison(el, ref, verses, this.settings.preferredWebsite, this.settings.showAttribution, this.app, this);
    } else {
      renderError(el, "Failed to fetch any translations for comparison.");
    }
  }

  getTranslationAbbrPublic(translationId?: string): string {
    return this.getTranslationAbbr(translationId);
  }

  resolveTranslationIdPublic(abbr: string): string {
    return this.resolveTranslationId(abbr);
  }

  generateLinkPublic(ref: BibleReference, translationAbbr: string): string {
    return generateLink(ref, translationAbbr, this.settings.preferredWebsite);
  }

  onunload(): void {
    document.body.style.removeProperty("--bible-verse-sidebar-top-padding");
  }

  /**
   * Force a refresh of all Live Preview widgets in all open editors.
   */
  refreshLivePreview(): void {
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView) {
        const cm = (leaf.view as unknown as { editor?: { cm?: EditorView } }).editor?.cm;
        if (cm && cm.dispatch) {
          cm.dispatch({ effects: verseFetchedEffect.of(undefined) });
        }
      }
    });
  }

  private resolveTranslationId(abbr: string): string {
    const upper = abbr.toUpperCase();
    const match = HELLOAO_TRANSLATIONS.find(
      (t) => t.abbreviation.toUpperCase() === upper
    );
    if (match) return match.id;
    return abbr;
  }
}
