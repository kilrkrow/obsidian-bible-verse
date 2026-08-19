import { BibleReference, EOC_VERSE } from "./types";

/**
 * Pure verse-formatting logic for HelloAO chapter content.
 *
 * This module has NO runtime dependencies (no `obsidian`, no network, no cache),
 * so it is the single source of truth for verse-number / new-line / paragraph
 * assembly and can be imported directly by unit tests.
 */

/**
 * Extract text from a HelloAO verse content array.
 * Content items can be plain strings or objects with a `text` property
 * (e.g. wordsOfJesus markers, footnotes). We extract only text content.
 */
export function extractVerseText(content: unknown[]): string {
  const parts: string[] = [];
  for (const item of content) {
    if (typeof item === "string") {
      parts.push(item);
    } else if (typeof item === "object" && item !== null) {
      const obj = item as Record<string, unknown>;
      if ("text" in obj) {
        let text = obj.text as string;
        if (obj.poem) {
          const indent = " ".repeat(Number(obj.poem) * 2);
          const prefix = parts.length > 0 ? "\n" : "";
          text = prefix + indent + text;
        }
        parts.push(text);
      } else if (obj.lineBreak || obj.type === "line_break") {
        parts.push("\n");
      }
    }
  }

  return parts
    .join(" ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();
}

/**
 * Determine which verses from the chapter are needed for this reference.
 * Returns a Set of verse numbers to include, or null for "all verses".
 */
export function computeRequestedVerses(ref: BibleReference): Set<number> | null {
  // Whole chapter — return null to indicate "all verses"
  if (ref.startVerse === null) return null;

  // Special marker for "End of Chapter" (Issue #17)
  if (ref.endVerse === EOC_VERSE) return null;

  const verses = new Set<number>();
  if (ref.endVerse !== null && ref.endChapter === null) {
    for (let v = ref.startVerse; v <= ref.endVerse; v++) {
      verses.add(v);
    }
  } else if (ref.endVerse === null && ref.additionalVerses.length === 0) {
    verses.add(ref.startVerse);
  } else {
    if (ref.endVerse !== null) {
      for (let v = ref.startVerse; v <= ref.endVerse; v++) {
        verses.add(v);
      }
    } else {
      verses.add(ref.startVerse);
    }
    for (const v of ref.additionalVerses) {
      verses.add(v);
    }
  }
  return verses;
}

/**
 * Assemble the display text for a chapter's content, given the requested verses
 * and formatting settings. Returns "" when no matching verses are found.
 */
export function assembleChapterText(
  chapterContent: unknown[],
  requestedVerses: Set<number> | null,
  startVerse: number | null,
  settings: {
    showVerseNumbers: boolean;
    verseNewLine: boolean;
    paragraphBreaks: boolean;
  }
): string {
  // Collect verses into paragraphs. Each paragraph is an array of verse strings.
  // A new paragraph begins when the API emits a "paragraph" or "stanza_break" marker.
  const paragraphs: string[][] = [[]];

  for (const item of chapterContent) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;

    if (obj.type === "verse") {
      const verseItem = item as { type: string; number: number; content: unknown[] };
      const isIncluded = requestedVerses === null
        ? (startVerse === null || verseItem.number >= startVerse)
        : requestedVerses.has(verseItem.number);

      if (isIncluded) {
        let text = extractVerseText(verseItem.content);
        if (text) {
          // KJV embeds ¶ at the start of verse text to mark paragraph boundaries.
          // Detect it here, before prepending the verse number, then strip it.
          if (text.startsWith("¶")) {
            text = text.replace(/^¶\s*/, "");
            if (paragraphs[paragraphs.length - 1].length > 0) {
              paragraphs.push([]);
            }
          }
          if (settings.showVerseNumbers) {
            text = `${verseItem.number}. ${text}`;
          }
          paragraphs[paragraphs.length - 1].push(text);
        }
      }
    } else if (obj.type === "paragraph" || obj.type === "stanza_break") {
      if (paragraphs[paragraphs.length - 1].length > 0) {
        paragraphs.push([]);
      }
    }
  }

  const filledParagraphs = paragraphs.filter(p => p.length > 0);
  if (filledParagraphs.length === 0) return "";

  const verseSep = settings.verseNewLine ? "\n" : " ";
  return (settings.paragraphBreaks && filledParagraphs.length > 1
    ? filledParagraphs.map(p => p.join(verseSep)).join("\n\n")
    : filledParagraphs.flat().join(verseSep)
  )
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── ESV API (api.esv.org) formatting ────────────────────────────────────────
// The ESV path is separate from HelloAO: verse numbers are a request param
// (returned as [n] markers) and the text is post-processed client-side.
// Note: the ESV API has no notion of our "paragraph sections" flag, so `para`
// does not affect ESV output.

/** Static ESV query params (everything except `q` and `include-verse-numbers`). */
export const ESV_TEXT_PARAMS: Record<string, string> = {
  "include-headings": "false",
  "include-footnotes": "false",
  "include-short-copyright": "false",
  "include-passage-references": "false",
  "indent-paragraphs": "0",
  "indent-poetry": "false",
  "indent-declares": "0",
  "indent-psalm-doxology": "0",
};

/**
 * Build the ESV passage-text query string.
 * We always request verse-number markers ("[n]") so the client has a reliable
 * verse-boundary signal for new-line handling; the markers are shown or hidden
 * later per the user's setting.
 */
export function buildEsvParams(query: string): URLSearchParams {
  return new URLSearchParams({
    q: query,
    ...ESV_TEXT_PARAMS,
    "include-verse-numbers": "true",
  });
}

/**
 * Post-process the ESV API's `passages` array into display text.
 *
 * The ESV API returns text with its own poetry / paragraph line breaks. We
 * collapse ALL whitespace to single spaces and re-segment on the "[n]" verse
 * markers, so `nl` / `no-nl` behave exactly like the HelloAO translations.
 * This is whitespace-only reformatting plus optional verse-number omission —
 * both permitted by the ESV API terms; the words themselves are never changed.
 * Canonical superscriptions (e.g. "A Psalm of David.") are preserved.
 *
 * Pure function — exported for testing.
 */
export function formatEsvPassageText(
  passages: string[],
  settings: { showVerseNumbers: boolean; verseNewLine: boolean }
): string {
  const text = passages.join(" ").replace(/\s+/g, " ").trim();

  const sep = settings.verseNewLine ? "\n" : " ";
  return text
    .replace(/\s*\[(\d+)\]\s*/g, (_m: string, n: string, offset: number) => {
      const prefix = offset === 0 ? "" : sep;
      return settings.showVerseNumbers ? `${prefix}${n}. ` : prefix;
    })
    .trim();
}
