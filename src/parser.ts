import { BibleReference } from "./types";
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
  /^(\d?\s?[A-Za-z]+(?:\s+(?:of\s+)?[A-Za-z]+)*)\s+(\d+)(?::(\d+)(?:-(\d+):(\d+)|-(\d+))?((?:,\s*\d+)*))?$/;

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

  // Multi-chapter range: "John 3:16-4:3"
  if (match[4] !== undefined && match[5] !== undefined) {
    const endChapter = parseInt(match[4], 10);
    const endVerse = parseInt(match[5], 10);
    return {
      book,
      chapter,
      startVerse,
      endVerse,
      additionalVerses: [],
      endChapter,
      raw: trimmed,
    };
  }

  // Simple range: "John 3:16-21"
  const endVerse = match[6] !== undefined ? parseInt(match[6], 10) : null;

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
// Inline spec parser — handles {ref}, {ref, TRANS}, {ref, TRANS1, TRANS2}
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parsed result for a {…} inline token.
 *
 * translations:
 *   []         → use the plugin's default translation
 *   [T]        → display using translation T
 *   [T1, T2]   → render a side-by-side comparison of T1 and T2
 */
export interface InlineSpec {
  ref: BibleReference;
  translations: string[];
}

/** A translation code is word-chars only and must start with a letter. */
const TRANS_CODE_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * Parse the content inside {…} brackets into a structured spec.
 *
 * Supported formats (examples):
 *   "John 3:16"              → { ref, translations: [] }
 *   "John 3:16, KJV"         → { ref, translations: ["KJV"] }
 *   "John 3:16, KJV, DARBY"  → { ref, translations: ["KJV", "DARBY"] }
 *   "John 3:16,17, KJV"      → { ref(John 3:16-17), translations: ["KJV"] }
 *
 * Returns null if the content cannot be parsed as a valid reference.
 */
export function parseInlineSpec(content: string): InlineSpec | null {
  const trimmed = content.trim();

  // 1. Try the entire string as a plain reference first (handles additional
  //    verse lists like "John 3:16,17" without mis-reading "17" as a trans).
  const simpleRef = parseReference(trimmed);
  if (simpleRef) {
    return { ref: simpleRef, translations: [] };
  }

  // 2. Split by comma and try stripping trailing translation code(s).
  const parts = trimmed.split(",").map((p) => p.trim());
  if (parts.length < 2) return null;

  const last = parts[parts.length - 1];

  // 2a. {ref, TRANS}
  if (TRANS_CODE_RE.test(last)) {
    const refStr = parts.slice(0, -1).join(",");
    const ref = parseReference(refStr);
    if (ref) return { ref, translations: [last.toUpperCase()] };
  }

  // 2b. {ref, TRANS1, TRANS2}
  if (parts.length >= 3) {
    const secondLast = parts[parts.length - 2];
    if (TRANS_CODE_RE.test(secondLast) && TRANS_CODE_RE.test(last)) {
      const refStr = parts.slice(0, -2).join(",");
      const ref = parseReference(refStr);
      if (ref) {
        return { ref, translations: [secondLast.toUpperCase(), last.toUpperCase()] };
      }
    }
  }

  return null;
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
    } else if (ref.endVerse !== null) {
      s += `-${ref.endVerse}`;
    }
    if (ref.additionalVerses.length > 0) {
      s += "," + ref.additionalVerses.join(",");
    }
  }
  return s;
}
