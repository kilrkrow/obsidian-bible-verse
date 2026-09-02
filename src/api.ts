import { requestUrl } from "obsidian";
import { BibleReference, CachedVerse } from "./types";
import { USFM_CODES } from "./constants";
import { VerseCache } from "./cache";
import { formatReference } from "./parser";
import { assembleChapterText, computeRequestedVerses } from "./format";

const BASE_URL = "https://bible.helloao.org/api";

/** Shape of the HelloAO chapter endpoint response we rely on. */
interface HelloAoChapterResponse {
  chapter: { content: unknown[] };
  translation?: { licenseUrl?: string };
  numberOfVerses?: number;
}

/**
 * Client for the HelloAO Bible API.
 * Fetches whole chapters and extracts specific verses client-side.
 * No API key required.
 */
/**
 * How many chapter payloads to keep in memory. The verse cache is keyed by
 * reference string, so nudging a range one verse at a time (#49) misses it on
 * every step and would otherwise re-download the same chapter for each nudge.
 * A handful of chapters covers a note being actively edited.
 */
const CHAPTER_MEMO_LIMIT = 8;

export class BibleApi {
  private cache: VerseCache;

  /**
   * In-flight and recently fetched chapter payloads, keyed by
   * translation/book/chapter. Promises rather than values, so concurrent
   * requests for the same chapter share one network round trip instead of
   * racing — which is what a burst of verse-shift clicks produces.
   *
   * Process-lifetime only; the durable cache remains VerseCache on disk.
   */
  private chapters: Map<string, Promise<HelloAoChapterResponse>> = new Map();

  constructor(cache: VerseCache) {
    this.cache = cache;
  }

  /** Fetch a chapter payload, reusing an in-flight or memoised request. */
  private async getChapter(
    translationId: string,
    usfm: string,
    chapter: number
  ): Promise<HelloAoChapterResponse> {
    const key = `${translationId}/${usfm}/${chapter}`;

    const memo = this.chapters.get(key);
    if (memo) return memo;

    const pending = (async () => {
      const response = await requestUrl({
        url: `${BASE_URL}/${translationId}/${usfm}/${chapter}.json`,
      });
      if (response.status !== 200) {
        throw new Error(`HelloAO API returned status ${response.status}`);
      }
      return response.json as HelloAoChapterResponse;
    })();

    // A failed fetch must not be memoised, or one blip would stick for the rest
    // of the session.
    pending.catch(() => this.chapters.delete(key));

    this.chapters.set(key, pending);
    if (this.chapters.size > CHAPTER_MEMO_LIMIT) {
      const oldest = this.chapters.keys().next();
      if (!oldest.done) this.chapters.delete(oldest.value);
    }

    return pending;
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

    const data = await this.getChapter(translationId, usfm, ref.chapter);
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
      numberOfVerses: typeof data.numberOfVerses === "number" ? data.numberOfVerses : undefined,
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
