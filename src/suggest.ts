import {
  App,
  Editor,
  EditorPosition,
  EditorSuggest,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
  TFile,
} from "obsidian";
import type BibleVersePlugin from "./main";
import { BOOK_ALIASES, USFM_CODES } from "./constants";
import { parseReference, formatReference } from "./parser";

/**
 * Provides IntelliSense for Bible references inside {curly braces}.
 *
 * Triggers when the cursor is inside an unclosed { ... } block.
 *
 * Behaviour:
 *   - Typing {J        → suggests book names starting with "J"
 *   - Typing {1co      → suggests "1 Corinthians" (via alias lookup)
 *   - Typing {John 3:16 → suggests the completed reference "John 3:16"
 *     (pressing Enter closes the braces and moves the cursor past })
 */
export class BibleReferenceSuggest extends EditorSuggest<string> {
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
   * single "confirm" suggestion so the user can press Enter to close the block.
   * Otherwise, returns matching book names.
   */
  getSuggestions(context: EditorSuggestContext): string[] {
    const query = context.query.trim();
    if (query.length === 0) return [];

    // If the query contains a digit it might already be a complete reference
    if (/\d/.test(query)) {
      const ref = parseReference(query);
      if (ref) {
        return [formatReference(ref)];
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

    return results.slice(0, this.limit);
  }

  /** Render a single suggestion row in the dropdown. */
  renderSuggestion(value: string, el: HTMLElement): void {
    el.createEl("span", { cls: "bible-suggest-icon", text: "📖 " });
    el.createEl("span", { cls: "bible-suggest-text", text: value });
  }

  /**
   * Insert the selected suggestion into the editor.
   *
   * - Complete reference (has a digit): replaces the typed content and closes
   *   the braces, moving the cursor past the }.
   * - Book name only: replaces the typed content with "Book " so the user can
   *   continue typing the chapter and verse.
   */
  selectSuggestion(value: string, _evt: MouseEvent | KeyboardEvent): void {
    const { context } = this;
    if (!context) return;

    const editor = context.editor;
    const line = editor.getLine(context.start.line);

    // Check whether there is already a closing } immediately after the cursor
    const charAfterEnd = line[context.end.ch];
    const hasClosingBrace = charAfterEnd === "}";

    const isCompleteRef = /\d/.test(value);

    if (isCompleteRef) {
      // Insert the formatted reference; handle the closing brace
      if (hasClosingBrace) {
        // Auto-paired } is already there — just replace content, skip past }
        editor.replaceRange(value, context.start, context.end);
        editor.setCursor({
          line: context.start.line,
          ch: context.start.ch + value.length + 1, // +1 to land after the }
        });
      } else {
        // No closing brace yet — add one
        editor.replaceRange(value + "}", context.start, context.end);
        editor.setCursor({
          line: context.start.line,
          ch: context.start.ch + value.length + 1,
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
