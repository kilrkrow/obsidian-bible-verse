import { MarkdownPostProcessorContext, MarkdownRenderChild, MarkdownView, Notice, Plugin, TFile } from "obsidian";
import { EditorView } from "@codemirror/view";
import { BibleVerseSettings, DEFAULT_SETTINGS, BibleReference, CachedVerse, DisplayStyle } from "./types";
import {
  parseReference,
  parseInlineSpec,
  formatReference,
  InlineSpec,
  INLINE_TOKEN_SOURCE,
  inlineTokenRegex,
  inlineTokenContent,
  referenceRejection,
} from "./parser";
import { BibleApi } from "./api";
import { VerseCache } from "./cache";
import { Baker } from "./baker";
import { BibleVerseSettingTab } from "./settings";
import {
  renderVerse,
  renderLink,
  renderBakePending,
  renderComparison,
  renderError,
} from "./renderer";
import { generateLink, generateSearchUrl } from "./linker";
import { QuickInsertModal } from "./quick-insert-modal";
import { BibleReferenceSuggest } from "./suggest";
import { buildViewPlugin } from "./view-plugin";
import {
  shiftReference,
  rewriteToken,
  rewriteTokenReference,
  findTokenAtCursor,
  locateToken,
  insertLineAfter,
  ShiftTarget,
  ShiftDelta,
} from "./shift";
import {
  adaptedText,
  chooseSense,
  formatInsertLine,
  formatStrongsHeader,
  isAdapted,
  meaningChoice,
  parseStrongsHeader,
  strongsActive,
  strongsTranslationLabel,
  STRONGS_CREDIT,
  transliterationFor,
  wordDisplayOf,
  StrongsWord,
  WordDisplayState,
} from "./strongs";
import { closeStrongsPopover, StrongsLayer, StrongsWriter } from "./strongs-dom";
import { HELLOAO_ABBREV, HELLOAO_TRANSLATIONS, TranslationDef, ESV_COPYRIGHT } from "./constants";
import { fetchEsvPassage, getEffectiveMode } from "./providers";
import { makeLinkOnlyVerse } from "./comparison";
import { verseFetchedEffect } from "./effects";
import { resolveShowVerseNumbers } from "./format";
import { bugReportUrl } from "./feedback";
import { decideWhatsNew } from "./whats-new";
import { releaseNotesSince, WhatsNewModal } from "./whats-new-modal";

/**
 * Label and credit for a verse whose wording the Strong's layer changed: the
 * reference reads "KJV-Strong's", and the lexicon credit is a required
 * attribution line (shown regardless of "Show attribution", as ESV's is).
 */
function strongsAttribution(verse: CachedVerse): Pick<CachedVerse, "label" | "copyright" | "requireAttribution"> {
  return {
    label: strongsTranslationLabel(verse.translation),
    copyright: verse.copyright ? `${verse.copyright} · ${STRONGS_CREDIT}` : STRONGS_CREDIT,
    requireAttribution: true,
  };
}

export default class BibleVersePlugin extends Plugin {
  settings: BibleVerseSettings = DEFAULT_SETTINGS;
  api: BibleApi = null!;
  cache: VerseCache = null!;
  baker: Baker = null!;
  /** Whether data.json existed at load; false on a fresh install. */
  private hadSavedData = false;

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

    // Release notes once after an update; wait for the workspace so the pop-up
    // doesn't compete with Obsidian's own startup.
    this.app.workspace.onLayoutReady(() => void this.maybeShowWhatsNew());

    // Commands
    this.addCommand({
      id: "bake-current-note",
      name: "Bake all verses in this note",
      editorCallback: async (editor) => {
        const content = editor.getValue();
        const newContent = await this.baker.bakeFile(
          content,
          this.settings.bakeInline,
          (ref, id, abbr, nl, vn, words) => this.fetchVerse(ref, id, abbr, nl, vn, undefined, words),
          { verseNewLine: this.settings.verseNewLine, showVerseNumbers: this.settings.showVerseNumbers }
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
          (ref, id, abbr, nl, vn, words) => this.fetchVerse(ref, id, abbr, nl, vn, undefined, words),
          { verseNewLine: this.settings.verseNewLine, showVerseNumbers: this.settings.showVerseNumbers }
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
          (ref, id, abbr, nl, vn, words) => this.fetchVerse(ref, id, abbr, nl, vn, undefined, words),
          { verseNewLine: this.settings.verseNewLine, showVerseNumbers: this.settings.showVerseNumbers }
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
          (ref, id, abbr, nl, vn, words) => this.fetchVerse(ref, id, abbr, nl, vn, undefined, words),
          { verseNewLine: this.settings.verseNewLine, showVerseNumbers: this.settings.showVerseNumbers }
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
      // Plain callback (always listed in the palette). Reads the editor selection
      // when editing, and falls back to the DOM selection so it also works in
      // Reading view.
      callback: () => {
        const editorSelection = this.app.workspace.activeEditor?.editor?.getSelection();
        const selection = (editorSelection || activeWindow.getSelection()?.toString() || "").trim();
        if (selection.length === 0) {
          new Notice("No text selected.");
          return;
        }
        void navigator.clipboard.writeText(selection);
        new Notice("Copied to clipboard. Opening search...");
        const abbr = this.getTranslationAbbr();
        const url = generateSearchUrl(selection, abbr, this.settings.preferredWebsite);
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

    this.addCommand({
      id: "report-bug",
      name: "Report a bug on GitHub",
      callback: () => window.open(bugReportUrl(this.manifest.version)),
    });

    this.addCommand({
      id: "show-whats-new",
      name: "Show what's new",
      callback: () => {
        const notes = releaseNotesSince(null, this.manifest.version);
        if (notes.length > 0) new WhatsNewModal(this.app, notes).open();
        else new Notice("No release notes for this version.");
      },
    });

    // Strong's layer (#69). No default hotkey.
    this.addCommand({
      id: "toggle-strongs",
      name: "Toggle Strong's on this verse",
      editorCallback: async (editor) => {
        const cursor = editor.getCursor();
        const found = findTokenAtCursor(editor.getLine(cursor.line), cursor.ch);
        if (!found) {
          new Notice("No Bible reference found at cursor.");
          return;
        }

        const spec = parseInlineSpec(found.token.replace(/^\{+|\}+$/g, "").trim());
        if (!spec) {
          new Notice("Could not read the reference at the cursor.");
          return;
        }

        const turningOn = !strongsActive(spec);
        if (turningOn) {
          const reason = await this.strongsUnavailable(spec);
          if (reason) {
            new Notice(reason);
            return;
          }
        }

        const replacement = rewriteToken(
          found.token,
          turningOn ? { strongs: true } : { strongs: false, transliterate: [], meanings: {} }
        );
        if (replacement === null) return;

        // The check above may have waited on the network; only write if the
        // token is still exactly where it was.
        if (editor.getLine(cursor.line).slice(found.start, found.end) !== found.token) return;

        editor.replaceRange(
          replacement,
          { line: cursor.line, ch: found.start },
          { line: cursor.line, ch: found.end }
        );
        new Notice(
          turningOn
            ? `Strong's on for ${formatReference(spec.ref)}. Hover a word to see its entry.`
            : `Strong's off for ${formatReference(spec.ref)}.`
        );
      },
    });

    // Verse-shift commands (#49). The widget's Alt-click covers the start verse
    // on desktop only, so these are the sole route to it on touch devices — and
    // the only one that works in Source mode, where no widget renders.
    this.addShiftCommand("end", 1, "shift-end-forward", "Extend passage by one verse");
    this.addShiftCommand("end", -1, "shift-end-back", "Shrink passage by one verse");
    this.addShiftCommand("start", 1, "shift-start-forward", "Move start verse forward");
    this.addShiftCommand("start", -1, "shift-start-back", "Move start verse back");
  }

  /** Register one verse-shift command operating on the token at the cursor. */
  private addShiftCommand(
    target: ShiftTarget,
    delta: ShiftDelta,
    id: string,
    name: string
  ): void {
    this.addCommand({
      id,
      name,
      editorCallback: (editor) => {
        const cursor = editor.getCursor();
        const found = findTokenAtCursor(editor.getLine(cursor.line), cursor.ch);
        if (!found) {
          new Notice("No Bible reference found at cursor.");
          return;
        }

        const spec = parseInlineSpec(found.token.replace(/^\{+|\}+$/g, "").trim());
        if (!spec) {
          new Notice("Could not read the reference at the cursor.");
          return;
        }

        const shifted = shiftReference(spec.ref, target, delta, this.lookupVerseCount(spec));
        if (!shifted) {
          new Notice("Cannot move that verse any further.");
          return;
        }

        const replacement = rewriteTokenReference(found.token, shifted);
        if (replacement === null) return;

        editor.replaceRange(
          replacement,
          { line: cursor.line, ch: found.start },
          { line: cursor.line, ch: found.end }
        );
      },
    });
  }

  /**
   * The chapter length for a spec's reference, if it happens to be cached.
   * Undefined means unknown, which shiftReference treats as "no upper bound" —
   * the command still works, it just cannot convert to eoc or clamp.
   */
  private lookupVerseCount(spec: InlineSpec): number | undefined {
    const id = spec.translations.length >= 1
      ? this.resolveTranslationId(spec.translations[0])
      : this.settings.defaultTranslation;
    const abbr = this.getTranslationAbbr(id);
    const cached = this.cache.get(
      abbr,
      formatReference(spec.ref),
      spec.verseNewLine ?? this.settings.verseNewLine,
      resolveShowVerseNumbers(spec.ref, spec.showVerseNumbers, this.settings.showVerseNumbers),
      spec.paragraphBreaks ?? this.settings.paragraphBreaks
    );
    return cached?.numberOfVerses;
  }

  /** The translation a single-translation token renders in. */
  private specTranslationId(spec: InlineSpec): string {
    return spec.translations.length >= 1
      ? this.resolveTranslationId(spec.translations[0])
      : this.settings.defaultTranslation;
  }

  /**
   * Why the Strong's layer can never apply to a token, or null if it might.
   * Decided without the network: comparisons, ESV and the link-only
   * translations are out. Whether a chapter actually has a words file is
   * `strongsUnavailable`'s job.
   */
  strongsBlocker(spec: InlineSpec): string | null {
    if (spec.translations.length >= 2) {
      return "Strong's works on one translation at a time, not a comparison.";
    }
    const id = this.specTranslationId(spec);
    const def = this.findTranslation(id);
    if (def && (def.provider !== "helloao" || def.mode !== "text")) {
      return `Strong's isn't available for ${def.abbreviation}.`;
    }
    return null;
  }

  /** `strongsBlocker`, plus whether the chapter has word alignment at all. */
  async strongsUnavailable(spec: InlineSpec): Promise<string | null> {
    const blocked = this.strongsBlocker(spec);
    if (blocked) return blocked;

    const id = this.specTranslationId(spec);
    const abbr = this.getTranslationAbbr(id);
    try {
      if (await this.api.hasWords(spec.ref, id)) return null;
    } catch (e) {
      console.error("Bible Verse: could not check for Strong's data", e);
      return "Could not check for Strong's data. Try again when you're online.";
    }
    return `No Strong's data for ${abbr} in ${spec.ref.book} ${spec.ref.chapter}.`;
  }

  /**
   * Render a verse with the Strong's layer into `container`, replacing what is
   * there. Resolves false, leaving `container` alone, when the chapter has no
   * words file — the caller keeps its plain render.
   */
  async renderStrongsVerse(
    container: HTMLElement,
    spec: InlineSpec,
    style: DisplayStyle,
    settings: { showVerseNumbers: boolean; verseNewLine: boolean; paragraphBreaks: boolean },
    writer: StrongsWriter
  ): Promise<boolean> {
    const id = this.specTranslationId(spec);
    const abbr = this.getTranslationAbbr(id);

    const passage = await this.api.getStrongsPassage(spec.ref, id, settings);
    if (!passage) return false;

    // The plain verse supplies everything but the text: label, licence, length.
    const plain = await this.fetchFromProvider(spec.ref, id, abbr, settings);

    // Look up the words already shown as a transliteration or a meaning before
    // drawing, so they render that way instead of flashing the English first.
    const state: WordDisplayState = { transliterate: spec.transliterate, meanings: spec.meanings };
    const { transliterations, meaningTexts } = await this.resolveWordTexts(passage.words, state);

    const layer: StrongsLayer = {
      words: passage.words,
      state,
      transliterations,
      meaningTexts,
      wordPicks: () => this.settings.strongsWordPicks,
      translation: plain.translation,
      lookup: (n) => this.api.getLexiconEntry(n),
      writer,
    };

    container.empty();
    await renderVerse(
      container,
      spec.ref,
      { ...plain, text: passage.text },
      style,
      this.settings.preferredWebsite,
      this.settings.showAttribution,
      this.app,
      this,
      settings.paragraphBreaks,
      settings.verseNewLine,
      layer
    );
    return true;
  }

  /**
   * The text each changed word shows: its transliteration, or the verse form of
   * its chosen meaning. Words whose lexicon entry cannot be read are left out,
   * and so keep their English.
   */
  private async resolveWordTexts(
    words: StrongsWord[],
    state: WordDisplayState
  ): Promise<{ transliterations: Map<string, string>; meaningTexts: Map<string, string> }> {
    const transliterations = new Map<string, string>();
    const meaningTexts = new Map<string, string>();
    await Promise.all(
      words.map(async (w) => {
        const display = wordDisplayOf(state, w.key);
        if (display.kind === "english") return;
        try {
          const entry = await this.api.getLexiconEntry(w.number);
          if (display.kind === "transliteration") {
            const t = transliterationFor(entry);
            if (t) transliterations.set(w.key, t);
          } else {
            const choice = meaningChoice(chooseSense(entry), display.label);
            if (choice) meaningTexts.set(w.key, choice.verseText);
          }
        } catch (e) {
          console.error("Bible Verse: lexicon lookup failed", e);
        }
      })
    );
    return { transliterations, meaningTexts };
  }

  /**
   * The verse as the Strong's layer shows it with these word choices, as plain
   * markdown for baking: transliterations in italics, meanings in ⌜ ⌝, labelled
   * "KJV-Strong's", with the lexicon credit as its required attribution line.
   * Null when the translation or chapter has no Strong's data, so the caller
   * bakes the plain verse.
   */
  private async adaptedVerse(
    ref: BibleReference,
    translationId: string,
    translationAbbr: string,
    settings: { showVerseNumbers: boolean; verseNewLine: boolean; paragraphBreaks: boolean },
    state: WordDisplayState
  ): Promise<CachedVerse | null> {
    const def = this.findTranslation(translationId);
    if (def && (def.provider !== "helloao" || def.mode !== "text")) return null;

    const passage = await this.api.getStrongsPassage(ref, translationId, settings);
    if (!passage) return null;
    const plain = await this.fetchFromProvider(ref, translationId, translationAbbr, settings);

    const { transliterations, meaningTexts } = await this.resolveWordTexts(passage.words, state);
    const changed = transliterations.size > 0 || meaningTexts.size > 0;
    if (!changed) return plain;
    return {
      ...plain,
      text: adaptedText(passage, state, transliterations, meaningTexts),
      ...strongsAttribution(plain),
    };
  }

  /**
   * Persist the layer's edits from Reading view by rewriting the note. The
   * token is found again in the source on every edit, within the section that
   * rendered it, and the remembered token text follows each rewrite.
   */
  private readingViewStrongsWriter(
    ctx: MarkdownPostProcessorContext,
    el: HTMLElement,
    token: string
  ): StrongsWriter {
    let current = token;
    const file = (): TFile | null => {
      const f = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
      return f instanceof TFile ? f : null;
    };
    const section = () => {
      const info = ctx.getSectionInfo(el);
      return info ? { lineStart: info.lineStart, lineEnd: info.lineEnd } : null;
    };
    const notFound = () => new Notice("Could not find this verse in the note to update it.");

    return {
      setWords: (state) => {
        const f = file();
        const next = rewriteToken(current, { strongs: true, transliterate: state.transliterate, meanings: state.meanings });
        if (!f || next === null || next === current) return;
        const prev = current;
        current = next;
        void this.app.vault.process(f, (content) => {
          const at = locateToken(content, prev, section());
          if (at === null) {
            notFound();
            return content;
          }
          return content.slice(0, at) + next + content.slice(at + prev.length);
        });
      },
      insertLineBelow: (word, sense, meaningLabel) => {
        const f = file();
        if (!f) return;
        const line = formatInsertLine(word, sense, meaningLabel);
        void this.app.vault.process(f, (content) => {
          const at = locateToken(content, current, section());
          if (at === null) {
            notFound();
            return content;
          }
          return insertLineAfter(content, at, line);
        });
      },
    };
  }

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as Partial<BibleVerseSettings> | null;
    this.hadSavedData = saved !== null && saved !== undefined;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
  }

  updateStyles(): void {
    activeDocument.body.style.setProperty(
      "--bible-verse-sidebar-top-padding",
      `${this.settings.sidebarTopPadding}em`
    );
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Open the "What's new" pop-up if this is the first start since an update. */
  private async maybeShowWhatsNew(): Promise<void> {
    try {
      const currentVersion = this.manifest.version;
      // Someone who never changed a setting has no data.json, but cached verses
      // still show they've used the plugin before. (The cache folder itself is
      // created on every load, so it's the entries that count.)
      const isExistingUser = this.hadSavedData || this.cache.size > 0;
      const decision = decideWhatsNew({
        enabled: this.settings.showWhatsNew,
        lastSeenVersion: this.settings.lastSeenVersion,
        currentVersion,
        isExistingUser,
      });
      if (decision.record) {
        this.settings.lastSeenVersion = currentVersion;
        await this.saveSettings();
      }
      if (!decision.show) return;
      const notes = releaseNotesSince(decision.since, currentVersion);
      if (notes.length > 0) new WhatsNewModal(this.app, notes).open();
    } catch (e) {
      console.error("Bible Verse: could not show release notes", e);
    }
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
   * Find a translation definition by ID or abbreviation.
   */
  public findTranslation(idOrAbbr: string): TranslationDef | undefined {
    return HELLOAO_TRANSLATIONS.find(
      (t) => t.id === idOrAbbr || t.abbreviation.toUpperCase() === idOrAbbr.toUpperCase()
    );
  }

  /**
   * Public helper to check if a translation is effectively link-only
   * (either inherently, or because no API key is configured).
   */
  public isTranslationLinkOnly(idOrAbbr: string): boolean {
    const t = this.findTranslation(idOrAbbr);
    if (!t) return false;
    return getEffectiveMode(t, this.settings.esvApiKey) === "linkOnly";
  }

  /**
   * Build one CachedVerse per comparison translation. Link-only translations
   * (and ESV without a key) become link placeholders instead of a fetch that
   * would throw; text translations are fetched as usual. A failed text fetch
   * is skipped so the other columns can still render.
   */
  public async loadComparisonVerses(
    ref: BibleReference,
    translations: string[],
    settings: { showVerseNumbers: boolean; verseNewLine: boolean; paragraphBreaks: boolean }
  ): Promise<CachedVerse[]> {
    const verses: CachedVerse[] = [];
    for (const trans of translations) {
      const id = this.resolveTranslationId(trans);
      const abbr = this.getTranslationAbbr(id);
      if (this.isTranslationLinkOnly(trans) || this.isTranslationLinkOnly(id)) {
        verses.push(makeLinkOnlyVerse(ref, abbr, id));
        continue;
      }
      try {
        verses.push(await this.fetchFromProvider(ref, id, abbr, settings));
      } catch (e) {
        console.error(`Bible Verse: Failed to fetch ${trans}`, e);
      }
    }
    return verses;
  }

  /**
   * Fetch a verse using the current settings, routing to the correct provider.
   */
  private async fetchVerse(
    ref: BibleReference,
    translationId?: string,
    translationAbbr?: string,
    verseNewLineOverride?: boolean,
    showVerseNumbersOverride?: boolean,
    paragraphBreaksOverride?: boolean,
    words?: WordDisplayState
  ): Promise<CachedVerse | null> {
    try {
      const id = translationId ?? this.settings.defaultTranslation;
      const abbr = translationAbbr ?? this.getTranslationAbbr(id);
      const vnL = verseNewLineOverride ?? this.settings.verseNewLine;
      const sVN = resolveShowVerseNumbers(ref, showVerseNumbersOverride, this.settings.showVerseNumbers);
      const pb = paragraphBreaksOverride ?? this.settings.paragraphBreaks;
      const passageSettings = { showVerseNumbers: sVN, verseNewLine: vnL, paragraphBreaks: pb };

      // A Strong's verse with words changed bakes as it reads on screen, not
      // as the plain translation.
      if (words && isAdapted(words)) {
        const adapted = await this.adaptedVerse(ref, id, abbr, passageSettings, words);
        if (adapted) return adapted;
      }

      return await this.fetchFromProvider(ref, id, abbr, passageSettings);
    } catch (e) {
      console.error("Bible Verse: fetchVerse failed", e);
      return null;
    }
  }

  /**
   * Route a passage fetch to the correct provider based on translation definition.
   */
  public async fetchFromProvider(
    ref: BibleReference,
    translationId: string,
    translationAbbr: string,
    settings: { showVerseNumbers: boolean; verseNewLine: boolean; paragraphBreaks: boolean }
  ): Promise<CachedVerse> {
    const def = this.findTranslation(translationId) ?? this.findTranslation(translationAbbr);

    if (def?.provider === "esv" && this.settings.esvApiKey) {
      const cached = this.cache.get(translationAbbr, formatReference(ref), settings.verseNewLine, settings.showVerseNumbers, settings.paragraphBreaks);
      if (cached) {
        // Re-stamp entries cached before attribution was enforced.
        cached.requireAttribution = true;
        cached.copyright = ESV_COPYRIGHT;
        return cached;
      }
      const result = await fetchEsvPassage(ref, this.settings.esvApiKey, settings);
      try { await this.cache.set(result, settings.verseNewLine, settings.showVerseNumbers, settings.paragraphBreaks); } catch { /* ignore */ }
      return result;
    }

    return await this.api.getPassage(ref, translationId, translationAbbr, settings);
  }

  /**
   * Inline markdown postprocessor: finds {ref} in rendered text and replaces them.
   */
  private async inlinePostProcessor(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
  ): Promise<void> {
    // Markdown escaping consumes "\{" before rendering, so in the DOM an
    // escaped token is indistinguishable from a live one. Read the section
    // source and budget how many instances of each token string were escaped;
    // that many matches are left as literal text below (#28).
    const escapedBudget = new Map<string, number>();
    const sectionInfo = ctx.getSectionInfo(el);
    if (sectionInfo) {
      const sectionSource = sectionInfo.text
        .split("\n")
        .slice(sectionInfo.lineStart, sectionInfo.lineEnd + 1)
        .join("\n");
      const escapedRe = new RegExp(`\\\\(?:${INLINE_TOKEN_SOURCE})`, "g");
      let escMatch: RegExpExecArray | null;
      while ((escMatch = escapedRe.exec(sectionSource)) !== null) {
        // Key on the token itself, minus the leading backslash the renderer ate.
        const token = escMatch[0].slice(1);
        escapedBudget.set(token, (escapedBudget.get(token) ?? 0) + 1);
      }
    }

    const walker = activeDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodesToProcess: { node: Text; matches: RegExpMatchArray[] }[] = [];

    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const text = node.textContent || "";
      const matches = [...text.matchAll(inlineTokenRegex())];
      if (matches.length > 0) {
        nodesToProcess.push({ node, matches });
      }
    }

    for (const { node, matches } of nodesToProcess) {
      const text = node.textContent || "";
      const frag = createFragment();
      let lastIndex = 0;

      for (const match of matches) {
        const matchIndex = match.index!;
        if (matchIndex > lastIndex) {
          frag.appendText(text.slice(lastIndex, matchIndex));
        }

        // Escaped in the source (\{...}) — keep it as literal text (#28)
        const escapesLeft = escapedBudget.get(match[0]) ?? 0;
        if (escapesLeft > 0) {
          escapedBudget.set(match[0], escapesLeft - 1);
          frag.appendText(match[0]);
          lastIndex = matchIndex + match[0].length;
          continue;
        }

        const rawContent = inlineTokenContent(match).trim();
        const spec = parseInlineSpec(rawContent);

        if (spec) {
          const { ref, translations } = spec;
          const span = createSpan({ cls: "bible-verse-container" });

          const effectiveStyle = spec.styleOverride ?? this.settings.displayStyle;
          // `bake` token or the native-callout style trigger a one-way bake.
          const wantsBake = spec.bake || effectiveStyle === "native-callout";

          if (wantsBake && translations.length >= 2) {
            // Baking a side-by-side comparison isn't supported — render it live.
            new Notice("Bible Verse: baking isn't supported for multi-translation comparisons.");
            void this.renderInlineComparison(span, ref, translations, spec.paragraphBreaks ?? undefined, spec.showVerseNumbers);
            frag.appendChild(span);
          } else if (wantsBake) {
            // Show a placeholder now; the bake rewrites the note on Reading-view render.
            renderBakePending(span, ref);
            frag.appendChild(span);
            void this.handleBake(ctx, match[0], spec, effectiveStyle === "native-callout" ? "callout" : "codeblock");
          } else if (translations.length >= 2) {
            void this.renderInlineComparison(span, ref, translations, spec.paragraphBreaks ?? undefined, spec.showVerseNumbers);
            frag.appendChild(span);
          } else if (translations.length === 1 && this.isTranslationLinkOnly(translations[0])) {
            renderLink(span, ref, translations[0].toUpperCase(), this.settings.preferredWebsite);
            frag.appendChild(span);
          } else {
            const translationId = translations.length === 1
              ? this.resolveTranslationId(translations[0])
              : this.settings.defaultTranslation;
            const abbr = translations.length === 1
              ? this.getTranslationAbbr(translationId)
              : this.getTranslationAbbr();

            const style = effectiveStyle;
            const vnL = spec.verseNewLine ?? this.settings.verseNewLine;
            const sVN = resolveShowVerseNumbers(ref, spec.showVerseNumbers, this.settings.showVerseNumbers);
            const pb = spec.paragraphBreaks ?? this.settings.paragraphBreaks;

            const cached = this.cache.get(abbr, formatReference(ref), vnL, sVN, pb);
            const withStrongs = strongsActive(spec) && this.strongsBlocker(spec) === null;
            if (cached) {
              await renderVerse(span, ref, cached, style, this.settings.preferredWebsite, this.settings.showAttribution, this.app, this, pb, vnL);
            } else {
              renderLink(span, ref, abbr, this.settings.preferredWebsite);
            }

            if (withStrongs) {
              // Plain first, then upgraded in place; a chapter with no words
              // file keeps (or fetches) the plain render.
              const writer = this.readingViewStrongsWriter(ctx, el, match[0]);
              void this.renderStrongsVerse(span, spec, style, { showVerseNumbers: sVN, verseNewLine: vnL, paragraphBreaks: pb }, writer)
                .then((ok) => {
                  if (!ok && !cached) void this.fetchAndRenderWithTranslation(span, ref, translationId, abbr, style, vnL, sVN, pb);
                })
                .catch((e) => console.error("Bible Verse: Strong's render failed", e));
            } else if (!cached) {
              void this.fetchAndRenderWithTranslation(span, ref, translationId, abbr, style, vnL, sVN, pb);
            }

            frag.appendChild(span);

            // A verse with the Strong's layer stays live: writing it into the
            // note is left to the explicit "Insert below" action.
            if (this.settings.persistVerseText && translations.length === 0 && !strongsActive(spec)) {
              void this.handleBake(ctx, match[0], spec);
            }
          }
        } else {
          // Same distinction as the Live Preview path: leave tokens that are
          // not ours, but explain the ones we deliberately refuse (#52).
          const rejection = referenceRejection(rawContent);
          if (rejection) {
            const span = createSpan({ cls: "bible-verse-container" });
            renderError(span, rejection);
            frag.appendChild(span);
          } else {
            frag.appendText(match[0]);
          }
        }

        lastIndex = matchIndex + match[0].length;
      }

      if (lastIndex < text.length) {
        frag.appendText(text.slice(lastIndex));
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
      const sVN = resolveShowVerseNumbers(ref, showVerseNumbersOverride, this.settings.showVerseNumbers);
      const pb = paragraphBreaksOverride ?? this.settings.paragraphBreaks;

      const verse = await this.fetchFromProvider(ref, translationId, translationAbbr, {
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
        pb,
        vnL
      );
    } catch (e) {
      console.error("Bible Verse: Failed to fetch verse", e);
    }
  }

  private async renderInlineComparison(
    container: HTMLElement,
    ref: BibleReference,
    translations: string[],
    paragraphBreaksOverride?: boolean,
    showVerseNumbersOverride?: boolean | null
  ): Promise<void> {
    const pb = paragraphBreaksOverride ?? this.settings.paragraphBreaks;
    const sVN = resolveShowVerseNumbers(ref, showVerseNumbersOverride, this.settings.showVerseNumbers);
    const verses = await this.loadComparisonVerses(ref, translations, {
      showVerseNumbers: sVN,
      verseNewLine: this.settings.verseNewLine,
      paragraphBreaks: pb,
    });
    if (verses.length > 0) {
      await renderComparison(container, ref, verses, this.settings.preferredWebsite, this.settings.showAttribution, this.app, this);
    } else {
      renderError(container, `Could not fetch translations for ${formatReference(ref)}.`);
    }
  }

  private async handleBake(
    ctx: MarkdownPostProcessorContext,
    refMarker: string,
    spec: InlineSpec,
    format: "codeblock" | "callout" = "codeblock"
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!(file instanceof TFile)) return;

    // Forced bakes (the `bake` token / native-callout style) bypass the global
    // "Bake inline references" gate; the passive persist path still respects it.
    const forced = spec.bake || spec.styleOverride === "native-callout";
    if (!forced && !this.settings.bakeInline) return;

    const { ref, translations, verseNewLine, showVerseNumbers } = spec;
    const transId = translations.length === 1 ? this.resolveTranslationId(translations[0]) : undefined;
    const transAbbr = transId ? this.getTranslationAbbr(transId) : undefined;

    const pb = spec.paragraphBreaks ?? this.settings.paragraphBreaks;
    const words: WordDisplayState = { transliterate: spec.transliterate, meanings: spec.meanings };
    const verse = await this.fetchVerse(ref, transId, transAbbr, verseNewLine ?? undefined, showVerseNumbers ?? undefined, pb, words);
    if (!verse) return;

    const opts = format === "callout"
      ? {
          format: "callout" as const,
          calloutType: this.settings.nativeCalloutType,
          collapsed: spec.calloutCollapsed,
          url: generateLink(ref, verse.translation, this.settings.preferredWebsite),
        }
      : {
          // Freeze the effective formatting flags into the block header so the
          // baked block renders as fetched, independent of global settings (#37).
          format: "codeblock" as const,
          verseNewLine: verseNewLine ?? this.settings.verseNewLine,
          showVerseNumbers: resolveShowVerseNumbers(ref, showVerseNumbers, this.settings.showVerseNumbers),
          style: spec.styleOverride && spec.styleOverride !== "native-callout"
            ? spec.styleOverride
            : undefined,
          strongs: formatStrongsHeader(words) ?? undefined,
        };

    await this.app.vault.process(file, (content) => {
      return this.baker.bakeVerse(content, refMarker, verse, "inline", opts);
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
      renderError(el, referenceRejection(refStr) ?? `Could not parse reference: "${refStr}"`);
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
    const numbersKey = config["numbers"] ?? config["verse-numbers"];
    const sVN = resolveShowVerseNumbers(
      ref,
      numbersKey !== undefined ? numbersKey.toLowerCase() === "true" : null,
      this.settings.showVerseNumbers
    );
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
      let verse: CachedVerse | null = null;
      const words = config["strongs"] ? parseStrongsHeader(config["strongs"]) : null;
      if (cachedText) {
        verse = {
          reference: formatReference(ref),
          translation: translationAbbr,
          bibleId: translationId,
          text: cachedText,
          copyright: "",
          fetchedAt: Date.now(),
        };
        // Baked with Strong's word choices: label and credit it as adapted.
        if (words) verse = { ...verse, ...strongsAttribution(verse) };
      } else {
        const settings = { showVerseNumbers: sVN, verseNewLine: vnL, paragraphBreaks: pb };
        // A baked Strong's verse whose text was stripped: rebuild it with the
        // word choices its header recorded, as a refresh would.
        if (words) verse = await this.adaptedVerse(ref, translationId, translationAbbr, settings, words);
        verse ??= await this.fetchFromProvider(ref, translationId, translationAbbr, settings);
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
        pb,
        vnL
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
    const vnL = verseNewLineOverride ?? this.settings.verseNewLine;
    const sVN = resolveShowVerseNumbers(ref, showVerseNumbersOverride, this.settings.showVerseNumbers);
    const pb = paragraphBreaksOverride ?? this.settings.paragraphBreaks;
    const verses = await this.loadComparisonVerses(ref, translations, {
      showVerseNumbers: sVN,
      verseNewLine: vnL,
      paragraphBreaks: pb,
    });

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
    closeStrongsPopover();
    activeDocument.body.style.removeProperty("--bible-verse-sidebar-top-padding");
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
