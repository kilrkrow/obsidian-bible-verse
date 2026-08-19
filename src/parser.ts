import { BibleReference, DisplayStyle, EOC_VERSE } from "./types";
import { BOOK_ALIASES } from "./constants";

/**
 * Regex to match Bible references.
 * Handles numbered books (1 Corinthians), multi-word names (Song of Solomon),
 * chapters, verses, ranges, and comma-separated additional verses.
 *
 * Groups:
 *   1: Book name (e.g., "1 Corinthians", "John", "Song of Solomon")
 *   2: Chapter number
 *   3: Start verse (optional — absent means whole chapter)
 *   4: End chapter for multi-chapter range (optional, e.g., "-4" in "3:16-4:3")
 *   5: End verse (optional)
 *   6: Additional comma-separated verses (optional, e.g., ",25,30")
 */
const REF_REGEX =
  /^(\d?\s?[A-Za-z]+(?:\s+(?:of\s+)?[A-Za-z]+)*)\s+(\d+)(?::(\d+)(?:-(\d+):(\d+)|-(eoc|\d+|-))?((?:,\s*\d+)*))?$/i;

/**
 * Source pattern for an inline reference token, shared by every consumer
 * (Live Preview, the Reading-view postprocessor, and the baker) so they always
 * agree on where a token starts and ends.
 *
 * A doubled pair — {{John 3:16}} — is matched as a single token so the outer
 * braces are consumed too. Typing "{" twice with auto-pair on produces "{{}}",
 * and matching only the inner pair left stray braces rendered around the verse
 * (#41). Unbalanced braces keep the old behaviour: "{{ref}" matches "{ref}".
 *
 * Groups: 1 = content of a doubled token, 2 = content of a single one.
 */
export const INLINE_TOKEN_SOURCE =
  "\\{\\{([A-Za-z0-9][^}\\n]*)\\}\\}|\\{([A-Za-z0-9][^}\\n]*)\\}";

/**
 * A fresh global matcher for inline tokens. Always build a new one per scan —
 * a shared /g regex carries `lastIndex` between calls.
 */
export function inlineTokenRegex(): RegExp {
  return new RegExp(INLINE_TOKEN_SOURCE, "g");
}

/** The content inside a token matched by `inlineTokenRegex`, at either depth. */
export function inlineTokenContent(match: RegExpMatchArray): string {
  return match[1] ?? match[2];
}

/**
 * Normalize a book name to its canonical form using the alias table.
 */
export function normalizeBookName(raw: string): string | null {
  const key = raw.trim().toLowerCase();
  return BOOK_ALIASES[key] ?? null;
}

/**
 * Parse a Bible reference string into structured data.
 *
 * Supported formats:
 *   - "John 3:16"
 *   - "1 Corinthians 13:4-7"
 *   - "John 3:16-21,25"
 *   - "Psalm 23" (whole chapter)
 *   - "John 3:16-4:3" (multi-chapter)
 *   - "John 3:16-eoc" or "John 3:16-" (Issue #17)
 */
export function parseReference(input: string): BibleReference | null {
  const trimmed = input.trim();
  const match = trimmed.match(REF_REGEX);
  if (!match) return null;

  const rawBook = match[1];
  const chapter = parseInt(match[2], 10);

  const book = normalizeBookName(rawBook);
  if (!book) return null;

  // Whole chapter (no verse specified)
  if (match[3] === undefined) {
    return {
      book,
      chapter,
      startVerse: null,
      endVerse: null,
      additionalVerses: [],
      endChapter: null,
      raw: trimmed,
    };
  }

  const startVerse = parseInt(match[3], 10);

  // Multi-chapter range: "John 3:16-4:3". Rejected rather than returned (#52).
  //
  // The fetch layer serves one chapter at a time and its requested-verse set is
  // a flat list of verse numbers with no chapter dimension, so a span could
  // never be assembled — it failed at fetch with "No verses found" after
  // looking perfectly valid. Failing here instead reports the real problem at
  // the point the user typed it, and keeps the suggester from offering a form
  // that cannot work.
  if (match[4] !== undefined && match[5] !== undefined) {
    return null;
  }

  // Simple range: "John 3:16-21" or "John 3:16-eoc"
  let endVerse: number | null = null;
  if (match[6] !== undefined) {
    const val = match[6].toLowerCase();
    if (val === "eoc" || val === "-") {
      endVerse = EOC_VERSE;
    } else {
      endVerse = parseInt(val, 10);
    }
  }

  // Additional verses: ",25,30"
  const additionalVerses: number[] = [];
  if (match[7]) {
    const parts = match[7].split(",").filter((s) => s.trim().length > 0);
    for (const part of parts) {
      const v = parseInt(part.trim(), 10);
      if (!isNaN(v)) additionalVerses.push(v);
    }
  }

  return {
    book,
    chapter,
    startVerse,
    endVerse,
    additionalVerses,
    endChapter: null,
    raw: trimmed,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline spec parser — handles {ref}, {ref, TRANS}, {ref, TRANS1, TRANS2},
// plus an optional display-style override token anywhere in the trailing
// comma-separated list, e.g. {John 3:16, sidebar} or {John 3:16, KJV, sidebar}.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parsed result for a {…} inline token.
 *
 * translations:
 *   []         → use the plugin's default translation
 *   [T]        → display using translation T
 *   [T1, T2]   → render a side-by-side comparison of T1 and T2
 *
 * styleOverride:
 *   null       → use the plugin's default display style from settings
 *   DisplayStyle → override the style for this token only
 */
export interface InlineSpec {
  ref: BibleReference;
  translations: string[];
  styleOverride: DisplayStyle | null;
  verseNewLine: boolean | null;
  showVerseNumbers: boolean | null;
  paragraphBreaks: boolean | null;
  /** `bake` token: force a one-way bake of this reference on render. */
  bake: boolean;
  /** For the native-callout style: bake the callout collapsed (`nco-`). */
  calloutCollapsed: boolean;
}

/** A translation code is word-chars only and must start with a letter. */
const TRANS_CODE_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

/** The complete set of display-style names recognized inline. */
export const KNOWN_STYLES: readonly DisplayStyle[] = [
  "sidebar",
  "callout",
  "blockquote",
  "inline",
  "native-callout",
];

function isKnownStyle(token: string): token is DisplayStyle {
  return (KNOWN_STYLES as readonly string[]).includes(token.toLowerCase());
}

/**
 * Classify the closing-brace situation for the text to the right of the cursor
 * inside a {…} token (used by autocomplete insertion, #36):
 *   "immediate" — the very next char is `}` (typical auto-pair; replace & skip)
 *   "later"     — a `}` occurs before any `{`, so the token is already closed
 *                 further right (mid-token edit; do NOT add another brace)
 *   "none"      — no closing brace for this token; one must be appended
 */
export function closingBraceState(restOfLine: string): "immediate" | "later" | "none" {
  if (restOfLine.startsWith("}")) return "immediate";
  const close = restOfLine.indexOf("}");
  if (close === -1) return "none";
  const open = restOfLine.indexOf("{");
  return open === -1 || close < open ? "later" : "none";
}

/**
 * Merge an accepted suggestion with the leftover token text to its right
 * (mid-token edits, #36). The remainder's comma-separated parts are appended
 * to the suggestion, skipping empties and parts the suggestion already
 * contains — so "…, inline, no-nl" + remainder "KJV" becomes
 * "…, inline, no-nl, KJV", and an already-present "KJV" is not duplicated.
 */
export function mergeTokenRemainder(value: string, remainder: string): string {
  const valueParts = new Set(value.split(",").map((p) => p.trim().toLowerCase()));
  const keep = remainder
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !valueParts.has(p.toLowerCase()));
  return keep.length > 0 ? `${value}, ${keep.join(", ")}` : value;
}

/**
 * Parse the content inside {…} brackets into a structured spec.
 *
 * Supported formats (examples):
 *   "John 3:16"                      → { ref, translations: [], styleOverride: null }
 *   "John 3:16, KJV"                 → { ref, translations: ["KJV"] }
 *   "John 3:16, nl, no-v"            → { ref, verseNewLine: true, showVerseNumbers: false }
 *   "John 3:16, KJV, sidebar"        → { ref, translations: ["KJV"], styleOverride: "sidebar" }
 *
 * Returns null if the content cannot be parsed as a valid reference.
 */
export function parseInlineSpec(content: string): InlineSpec | null {
  const trimmed = content.trim();

  // 1. Try the entire string as a plain reference first
  const simpleRef = parseReference(trimmed);
  if (simpleRef) {
    return {
      ref: simpleRef,
      translations: [],
      styleOverride: null,
      verseNewLine: null,
      showVerseNumbers: null,
      paragraphBreaks: null,
      bake: false,
      calloutCollapsed: false,
    };
  }

  // 2. Split by comma and peel off trailing modifier tokens
  const parts = trimmed.split(",").map((p) => p.trim());
  if (parts.length < 2) return null;

  const translations: string[] = [];
  let styleOverride: DisplayStyle | null = null;
  let verseNewLine: boolean | null = null;
  let showVerseNumbers: boolean | null = null;
  let paragraphBreaks: boolean | null = null;
  let bake = false;
  let calloutCollapsed = false;
  let cut = parts.length;

  while (cut > 1) {
    const tok = parts[cut - 1];
    const low = tok.toLowerCase();

    // `bake` — force a one-way bake into a ```bible code block.
    if (low === "bake") {
      bake = true;
      cut--;
      continue;
    }

    // Native callout style, incl. `nco` alias and optional +/- fold marker.
    const ncMatch = low.match(/^(?:native-callout|nco)([+-])?$/);
    if (ncMatch) {
      if (styleOverride !== null) break;
      styleOverride = "native-callout";
      calloutCollapsed = ncMatch[1] === "-";
      cut--;
      continue;
    }

    // Check for formatting flags
    if (low === "nl") {
      if (verseNewLine === null) verseNewLine = true;
      cut--;
      continue;
    }
    if (low === "no-nl") {
      if (verseNewLine === null) verseNewLine = false;
      cut--;
      continue;
    }
    if (low === "v") {
      if (showVerseNumbers === null) showVerseNumbers = true;
      cut--;
      continue;
    }
    if (low === "no-v") {
      if (showVerseNumbers === null) showVerseNumbers = false;
      cut--;
      continue;
    }
    if (low === "para") {
      if (paragraphBreaks === null) paragraphBreaks = true;
      cut--;
      continue;
    }
    if (low === "no-para") {
      if (paragraphBreaks === null) paragraphBreaks = false;
      cut--;
      continue;
    }

    if (isKnownStyle(tok)) {
      if (styleOverride !== null) break;
      styleOverride = low as DisplayStyle;
      cut--;
      continue;
    }

    if (TRANS_CODE_RE.test(tok)) {
      if (translations.length >= 2) break;
      translations.unshift(tok.toUpperCase());
      cut--;
      continue;
    }

    break;
  }

  // If we didn't strip anything, this isn't a modifier-carrying spec.
  if (cut === parts.length) return null;

  const refStr = parts.slice(0, cut).join(",");
  const ref = parseReference(refStr);
  if (!ref) return null;

  return { ref, translations, styleOverride, verseNewLine, showVerseNumbers, paragraphBreaks, bake, calloutCollapsed };
}

/**
 * Render an InlineSpec back to the text inside a {…} token — the inverse of
 * `parseInlineSpec`, so a spec can be edited and written back without losing
 * the translations, style, or formatting flags the user typed (#49).
 *
 * Returns the token *content* only. Callers re-wrap it in the brace form they
 * found, so a doubled `{{…}}` token stays doubled.
 *
 * Modifiers are emitted in the documented order — translations, style, flags,
 * then `bake`. `parseInlineSpec` peels from the right and accepts these in any
 * order, but matching the documented form keeps round-tripped text looking like
 * hand-written text.
 */
export function formatInlineSpec(spec: InlineSpec): string {
  const parts: string[] = [formatReference(spec.ref)];

  // Translations are upper-cased on parse, so they round-trip as-is.
  for (const t of spec.translations) parts.push(t);

  if (spec.styleOverride === "native-callout") {
    // The fold marker is only meaningful on this style; "-" bakes collapsed and
    // a bare name is expanded, matching how parseInlineSpec reads it back.
    parts.push(spec.calloutCollapsed ? "native-callout-" : "native-callout");
  } else if (spec.styleOverride !== null) {
    parts.push(spec.styleOverride);
  }

  if (spec.verseNewLine !== null) parts.push(spec.verseNewLine ? "nl" : "no-nl");
  if (spec.showVerseNumbers !== null) parts.push(spec.showVerseNumbers ? "v" : "no-v");
  if (spec.paragraphBreaks !== null) parts.push(spec.paragraphBreaks ? "para" : "no-para");

  if (spec.bake) parts.push("bake");

  return parts.join(", ");
}

/**
 * Build a human-readable reference string from parsed data.
 */
export function formatReference(ref: BibleReference): string {
  let s = `${ref.book} ${ref.chapter}`;
  if (ref.startVerse !== null) {
    s += `:${ref.startVerse}`;
    if (ref.endChapter !== null && ref.endVerse !== null) {
      s += `-${ref.endChapter}:${ref.endVerse}`;
    } else if (ref.endVerse === EOC_VERSE) {
      s += "-eoc";
    } else if (ref.endVerse !== null) {
      s += `-${ref.endVerse}`;
    }
    if (ref.additionalVerses.length > 0) {
      s += "," + ref.additionalVerses.join(",");
    }
  }
  return s;
}
