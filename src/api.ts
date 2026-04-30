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
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (typeof item === "object" && item !== null) {
          const obj = item as Record<string, unknown>;
          if ("text" in obj) {
            let text = obj.text as string;
            // Handle poetic indentation if present
            if (obj.poem) {
              const indent = "\u00A0".repeat(Number(obj.poem) * 2);
              text = "\n" + indent + text;
            }
            return text;
          }
          if (obj.lineBreak) return "\n";
        }
        return "";
      })
      .filter((s) => s.length > 0)
      .join(" ")
      .replace(/\s?\n\s?/g, "\n"); // Clean up spacing around manual line breaks
  }

  /**
   * Determine which verses from the chapter are needed for this reference.
   * Returns a Set of verse numbers to include.
   */
  private getRequestedVerses(ref: BibleReference): Set<number> | null {
    // Whole chapter — return null to indicate "all verses"
    if (ref.startVerse === null) return null;

    const verses = new Set<number>();

    if (ref.endVerse !== null && ref.endChapter === null) {
      // Simple range within one chapter: e.g. John 3:16-21
      for (let v = ref.startVerse; v <= ref.endVerse; v++) {
        verses.add(v);
      }
    } else if (ref.endVerse === null && ref.additionalVerses.length === 0) {
      // Single verse
      verses.add(ref.startVerse);
    } else {
      // Has additional verses or is a range
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
      showHeadings: boolean;
      verseNewLine: boolean;
    }
  ): Promise<CachedVerse> {
    const refStr = formatReference(ref);

    // Check cache first
    const cached = this.cache.get(translationAbbr, refStr);
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

    // Extract text from matching verses and structural elements
    const verseParts: string[] = [];

    for (const item of chapterContent) {
      if (typeof item !== "object" || item === null) continue;
      const obj = item as Record<string, unknown>;

      if (obj.type === "verse") {
        const verseItem = item as { type: string; number: number; content: unknown[] };
        if (requestedVerses === null || requestedVerses.has(verseItem.number)) {
          let text = this.extractVerseText(verseItem.content);
          if (text) {
            if (settings.showVerseNumbers) {
              text = `[${verseItem.number}] ${text}`;
            }
            verseParts.push(text);
          }
        }
      } else if (obj.type === "heading" && settings.showHeadings) {
        const headingItem = item as { content: string[] };
        const headingText = headingItem.content.join(" ").trim();
        if (headingText) {
          verseParts.push(`\n**${headingText}**\n`);
        }
      } else if (obj.type === "line_break") {
        verseParts.push("\n");
      }
    }

    if (verseParts.length === 0) {
      throw new Error(`No verses found for ${refStr} in ${translationAbbr}`);
    }

    const text = verseParts
      .join(settings.verseNewLine && settings.showVerseNumbers ? "\n" : " ")
      .replace(/\s?\n\s?/g, "\n")
      .replace(/\n{3,}/g, "\n\n") // Max double newline
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
      await this.cache.set(entry);
    } catch (e) {
      console.warn("Bible Verse: Failed to cache verse", e);
    }
    return entry;
  }
}
