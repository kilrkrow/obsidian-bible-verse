import { requestUrl } from "obsidian";
import { BibleReference, CachedVerse } from "./types";
import { USFM_CODES } from "./constants";
import { VerseCache } from "./cache";
import { formatReference } from "./parser";

const BASE_URL = "https://bible.helloao.org/api";

/**
 * Client for the HelloAO Bible API.
 * Fetches whole chapters and extracts specific verses client-side.
 * No API key required.
 */
export class BibleApi {
  private cache: VerseCache;

  constructor(cache: VerseCache) {
    this.cache = cache;
  }

  /**
   * Extract text from a HelloAO verse content array.
   * Content items can be plain strings or objects with a `text` property
   * (e.g. wordsOfJesus markers, footnotes). We extract only text content.
   */
  private extractVerseText(content: unknown[]): string {
    const parts: string[] = [];
    for (const item of content) {
      if (typeof item === "string") {
        parts.push(item);
      } else if (typeof item === "object" && item !== null) {
        const obj = item as Record<string, unknown>;
        if ("text" in obj) {
          let text = obj.text as string;
          if (obj.poem) {
            const indent = "\u00A0".repeat(Number(obj.poem) * 2);
            // Only add newline if we already have text in this verse
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
   * Returns a Set of verse numbers to include.
   */
  private getRequestedVerses(ref: BibleReference): Set<number> | null {
    // Whole chapter — return null to indicate "all verses"
    if (ref.startVerse === null) return null;

    // Special marker for "End of Chapter" (Issue #17)
    if (ref.endVerse === 999) return null;

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
   * Fetch a passage from HelloAO Bible API.
   * Fetches the whole chapter and extracts the requested verses client-side.
   * Returns cached version if available.
   */
  async getPassage(
    ref: BibleReference,
    translationId: string,
    translationAbbr: string,
    settings: {
      showVerseNumbers: boolean;
      verseNewLine: boolean;
      paragraphBreaks: boolean;
    }
  ): Promise<CachedVerse> {
    const refStr = formatReference(ref);

    // Check cache first
    const cached = this.cache.get(translationAbbr, refStr, settings.verseNewLine, settings.showVerseNumbers, settings.paragraphBreaks);
    if (cached) return cached;

    const usfm = USFM_CODES[ref.book];
    if (!usfm) throw new Error(`Unknown book: ${ref.book}`);

    // For multi-chapter ranges, only fetch the starting chapter
    // (HelloAO serves one chapter at a time)
    const url = `${BASE_URL}/${translationId}/${usfm}/${ref.chapter}.json`;

    const response = await requestUrl({ url });

    if (response.status !== 200) {
      throw new Error(`HelloAO API returned status ${response.status}`);
    }

    const data = response.json;
    const chapterContent: unknown[] = data.chapter.content;
    const requestedVerses = this.getRequestedVerses(ref);

    // Collect verses into paragraphs. Each paragraph is an array of verse strings.
    // A new paragraph begins when the API emits a "paragraph" or "stanza_break" marker.
    const paragraphs: string[][] = [[]];

    for (const item of chapterContent) {
      if (typeof item !== "object" || item === null) continue;
      const obj = item as Record<string, unknown>;

      if (obj.type === "verse") {
        const verseItem = item as { type: string; number: number; content: unknown[] };
        const isIncluded = requestedVerses === null
          ? (ref.startVerse === null || verseItem.number >= ref.startVerse)
          : requestedVerses.has(verseItem.number);

        if (isIncluded) {
          let text = this.extractVerseText(verseItem.content);
          if (text) {
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

    if (filledParagraphs.length === 0) {
      throw new Error(`No verses found for ${refStr} in ${translationAbbr}`);
    }

    const verseSep = settings.verseNewLine ? "\n" : " ";
    const paragraphSep = settings.paragraphBreaks ? "\n\n" : " ";
    const text = (settings.paragraphBreaks && filledParagraphs.length > 1
      ? filledParagraphs.map(p => p.join(verseSep)).join("\n\n")
      : filledParagraphs.flat().join(verseSep)
    )
    // ¶ is a KJV typographic paragraph marker embedded in verse text —
    // convert to a paragraph break when reading sections are on, strip otherwise
    .replace(/¶\s*/g, paragraphSep)
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

    // Build copyright from license URL
    const licenseUrl: string | undefined = data.translation?.licenseUrl;
    const copyright = licenseUrl ? `License: ${licenseUrl}` : "";

    const entry: CachedVerse = {
      reference: refStr,
      translation: translationAbbr,
      bibleId: translationId,
      text,
      copyright,
      fetchedAt: Date.now(),
    };

    // Cache write failure should never prevent verse display
    try {
      await this.cache.set(entry, settings.verseNewLine, settings.showVerseNumbers, settings.paragraphBreaks);
    } catch (e) {
      console.warn("Bible Verse: Failed to cache verse", e);
    }
    return entry;
  }
}
