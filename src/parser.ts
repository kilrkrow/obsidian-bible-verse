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
