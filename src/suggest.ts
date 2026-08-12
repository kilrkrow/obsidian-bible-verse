import {
  App,
  Editor,
  EditorPosition,
  EditorSuggest,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
  TFile,
  setIcon,
} from "obsidian";
import type BibleVersePlugin from "./main";
import { BOOK_ALIASES, USFM_CODES, HELLOAO_TRANSLATIONS } from "./constants";
import { parseReference, formatReference, KNOWN_STYLES, parseInlineSpec, closingBraceState, mergeTokenRemainder } from "./parser";

interface BibleSuggestion {
  value: string;
  label?: string;
  /** True for book-name suggestions (insertion keeps the cursor inside the
   * braces so the user can continue typing chapter:verse). Explicit flag —
   * inferring from digits misclassifies numbered books like "1 Kings" (#23). */
  isBook?: boolean;
}

/**
 * Provides IntelliSense for Bible references inside {curly braces}.
 *
 * Triggers when the cursor is inside an unclosed { ... } block.
 *
 * Behaviour:
 *   - Typing {J        → suggests book names starting with "J"
 *   - Typing {1co      → suggests "1 Corinthians" (via alias lookup)
 *   - Typing {John 3:16 → confirms the reference; in helper mode shows all
 *     available modifiers (style, format flags, reading sections) as a menu
 *     (pressing Enter closes the braces and moves the cursor past })
 */
export class BibleReferenceSuggest extends EditorSuggest<BibleSuggestion> {
  private plugin: BibleVersePlugin;

  // Canonical book list in canonical order (Genesis → Revelation)
  private readonly books: string[] = Object.keys(USFM_CODES);

  constructor(app: App, plugin: BibleVersePlugin) {
    super(app);
    this.plugin = plugin;
    // Limit the popup to a sensible height
    this.limit = 10;
  }

  /**
   * Decide whether to show suggestions for the current cursor position.
   * Returns null if the cursor is not inside an unclosed {…} block.
   */
  onTrigger(
    cursor: EditorPosition,
    editor: Editor,
    _file: TFile
  ): EditorSuggestTriggerInfo | null {
    const line = editor.getLine(cursor.line);
    const beforeCursor = line.substring(0, cursor.ch);

    // Find the nearest unclosed { before the cursor
    const openBrace = beforeCursor.lastIndexOf("{");
    if (openBrace === -1) return null;

    // Escaped token (\{...) — the user wants literal braces; stay quiet (#28)
    if (openBrace > 0 && line[openBrace - 1] === "\\") return null;

    // If there is a } between { and cursor, the brace is already closed
    const afterOpen = beforeCursor.substring(openBrace + 1);
    if (afterOpen.includes("}")) return null;

    // Need at least one character typed after { to start suggesting
    if (afterOpen.length === 0) return null;

    return {
      start: { line: cursor.line, ch: openBrace + 1 },
      end: cursor,
      query: afterOpen,
    };
  }

  /**
   * Return matching suggestions for the current query.
   *
   * If the query already parses as a valid Bible reference, returns it as a
   * confirm suggestion. In helper mode, also returns the full modifier menu.
   * Otherwise, returns matching book names.
   */
  getSuggestions(context: EditorSuggestContext): BibleSuggestion[] {
    const query = context.query.trim();
    if (query.length === 0) return [];

    // If the query contains a digit it might already be a complete reference
    if (/\d/.test(query)) {
      // Check for translation/style modifiers after a comma
      if (query.includes(",")) {
        const parts = query.split(",");
        const modPart = parts[parts.length - 1].trim().toLowerCase();
        const prefix = parts.slice(0, -1).join(",").trim();

        const spec = parseInlineSpec(prefix);
        if (spec) {
          const suggestions: string[] = [];

          // Suggest translations (up to 2 allowed)
          if (spec.translations.length < 2) {
            for (const trans of HELLOAO_TRANSLATIONS) {
              if (trans.abbreviation.toLowerCase().startsWith(modPart)) {
                suggestions.push(`${prefix}, ${trans.abbreviation}`);
              }
            }
          }

          // Suggest styles (only if not already specified)
          if (spec.styleOverride === null) {
            for (const style of KNOWN_STYLES) {
              if (style.toLowerCase().startsWith(modPart)) {
                suggestions.push(`${prefix}, ${style}`);
              }
            }
            // `nco` is a short alias for the native-callout style.
            if ("nco".startsWith(modPart)) {
              suggestions.push(`${prefix}, nco`);
            }
          }

          // Suggest formatting flags
          const flags = ["nl", "no-nl", "v", "no-v", "para", "no-para", "bake"];
          for (const flag of flags) {
            if (flag.startsWith(modPart)) {
              suggestions.push(`${prefix}, ${flag}`);
            }
          }

          if (suggestions.length > 0) {
            return suggestions.slice(0, this.limit).map(s => ({ value: s }));
          }
        }
      }

      const ref = parseReference(query);
      if (ref) {
        const refStr = formatReference(ref);
        if (this.plugin.settings.helperMode) {
          return [
            { value: refStr, label: "Confirm" },
            { value: `${refStr}, callout`, label: "Callout" },
            { value: `${refStr}, sidebar`, label: "Sidebar" },
            { value: `${refStr}, blockquote`, label: "Blockquote" },
            { value: `${refStr}, inline`, label: "Inline" },
            { value: `${refStr}, native-callout`, label: "Native callout (bakes into note)" },
            { value: `${refStr}, bake`, label: "Bake into note" },
            { value: `${refStr}, nl`, label: "New line per verse" },
            { value: `${refStr}, no-nl`, label: "Single paragraph" },
            { value: `${refStr}, no-v`, label: "Hide verse numbers" },
            { value: `${refStr}, v`, label: "Show verse numbers" },
            { value: `${refStr}, para`, label: "Reading sections" },
          ];
        }
        return [{ value: refStr }];
      }
    }

    const typed = query.toLowerCase();
    const results: string[] = [];
    const seen = new Set<string>();

    // 1. Canonical names that start with the typed text (highest priority)
    for (const book of this.books) {
      if (book.toLowerCase().startsWith(typed)) {
        results.push(book);
        seen.add(book);
      }
    }

    // 2. Alias matches → resolve to canonical name
    for (const [alias, canonical] of Object.entries(BOOK_ALIASES)) {
      if (!seen.has(canonical) && alias.startsWith(typed)) {
        results.push(canonical);
        seen.add(canonical);
      }
    }

    // 3. Partial / contains matches (lower priority)
    if (results.length < 5) {
      for (const book of this.books) {
        if (!seen.has(book) && book.toLowerCase().includes(typed)) {
          results.push(book);
          seen.add(book);
        }
      }
    }

    return results.slice(0, this.limit).map(book => ({ value: book, isBook: true }));
  }

  /** Render a single suggestion row in the dropdown. */
  renderSuggestion(item: BibleSuggestion, el: HTMLElement): void {
    // Helper-mode suggestion: show value with optional modifier highlight + right-side label
    if (item.label !== undefined) {
      if (item.value.includes(",")) {
        const commaIdx = item.value.lastIndexOf(",");
        const ref = item.value.substring(0, commaIdx);
        const mod = item.value.substring(commaIdx + 1).trim();
        el.createSpan({ cls: "bible-suggest-prefix", text: ref + ", " });
        el.createSpan({ cls: "bible-suggest-modifier", text: mod });
      } else {
        el.createSpan({ cls: "bible-suggest-text", text: item.value });
      }
      el.createSpan({ cls: "bible-suggest-label", text: item.label });
      return;
    }

    // Modifier suggestion (user typed a comma themselves)
    if (item.value.includes(",")) {
      const iconEl = el.createSpan({ cls: "bible-suggest-icon" });
      setIcon(iconEl, "sliders-horizontal");

      const parts = item.value.split(",");
      const modifier = parts[parts.length - 1].trim();
      const prefix = parts.slice(0, -1).join(",").trim();

      const span = el.createSpan({ cls: "bible-suggest-text" });
      span.createSpan({ text: prefix + ", ", cls: "bible-suggest-prefix" });
      span.createSpan({ text: modifier, cls: "bible-suggest-modifier" });

      const trans = HELLOAO_TRANSLATIONS.find(t => t.abbreviation.toUpperCase() === modifier.toUpperCase());
      if (trans) {
        const isLinkOnly = this.plugin.isTranslationLinkOnly(trans.abbreviation);
        const suffix = isLinkOnly ? " (link only)" : trans.mode === "apiKeyText" ? " (API key)" : "";
        el.createSpan({ cls: "bible-suggest-name", text: ` — ${trans.name}${suffix}` });
      }
    } else {
      // Book name suggestion
      const iconEl = el.createSpan({ cls: "bible-suggest-icon" });
      setIcon(iconEl, "book-open");
      el.createSpan({ cls: "bible-suggest-text", text: item.value });
    }
  }

  /**
   * Insert the selected suggestion into the editor.
   *
   * - Complete reference (has a digit): replaces the typed content and closes
   *   the braces, moving the cursor past the }.
   * - Book name only: replaces the typed content with "Book " so the user can
   *   continue typing the chapter and verse.
   */
  selectSuggestion(item: BibleSuggestion, _evt: MouseEvent | KeyboardEvent): void {
    const value = item.value;
    const { context } = this;
    if (!context) return;

    const editor = context.editor;
    const line = editor.getLine(context.start.line);

    // Classify the closing brace to the right of the cursor (#36): immediate
    // (auto-pair), later on the line (mid-token edit), or absent.
    const rest = line.slice(context.end.ch);
    const braceState = closingBraceState(rest);

    // A doubled token — {{ref}} — needs both braces closed and skipped past,
    // or the accepted suggestion strands one (#41). Never skip more closing
    // braces than are actually there.
    const openDepth = context.start.ch >= 2 && line[context.start.ch - 2] === "{" ? 2 : 1;
    const closeRun = /^\}*/.exec(rest)![0].length;
    const skipPast = braceState === "immediate" ? Math.min(openDepth, closeRun) : openDepth;
    const closeBraces = "}".repeat(openDepth);

    // Book suggestions are flagged explicitly — testing the value for digits
    // misclassifies numbered books ("1 Kings") as complete references (#23).
    const isCompleteRef = !item.isBook && /\d/.test(value);

    if (isCompleteRef) {
      // Insert the formatted reference; handle the closing brace
      if (braceState === "immediate") {
        // Auto-paired } is already there — just replace content, skip past it
        editor.replaceRange(value, context.start, context.end);
        editor.setCursor({
          line: context.start.line,
          ch: context.start.ch + value.length + skipPast, // land after the }
        });
      } else if (braceState === "later") {
        // The token is already closed further right (mid-token edit). Accept
        // the suggestion, then re-attach the leftover token text (e.g. "KJV")
        // comma-joined — never dropping it and never duplicating parts the
        // suggestion already contains (#36).
        const closeCh = context.end.ch + rest.indexOf("}");
        const remainder = line.slice(context.end.ch, closeCh);
        const merged = mergeTokenRemainder(value, remainder);
        const closersHere = /^\}*/.exec(line.slice(closeCh))![0].length;
        editor.replaceRange(merged, context.start, { line: context.start.line, ch: closeCh });
        editor.setCursor({
          line: context.start.line,
          // land after the } — past both of them in a {{…}} token
          ch: context.start.ch + merged.length + Math.min(openDepth, closersHere),
        });
      } else {
        // No closing brace yet — add one to match the opening depth
        editor.replaceRange(value + closeBraces, context.start, context.end);
        editor.setCursor({
          line: context.start.line,
          ch: context.start.ch + value.length + openDepth,
        });
      }
    } else {
      // Book name only — append a space so the user types chapter:verse next
      editor.replaceRange(value + " ", context.start, context.end);
      editor.setCursor({
        line: context.start.line,
        ch: context.start.ch + value.length + 1,
      });
    }
  }
}
