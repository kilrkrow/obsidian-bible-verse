import { requestUrl } from "obsidian";
import { BibleReference, CachedVerse } from "./types";
import { USFM_CODES } from "./constants";
import { VerseCache } from "./cache";
import { formatReference } from "./parser";
import { assembleChapterText, computeRequestedVerses } from "./format";

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
    const requestedVerses = computeRequestedVerses(ref);

    const text = assembleChapterText(chapterContent, requestedVerses, ref.startVerse, settings);

    if (!text) {
      throw new Error(`No verses found for ${refStr} in ${translationAbbr}`);
    }

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
