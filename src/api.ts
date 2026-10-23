import { requestUrl } from "obsidian";
import { BibleReference, CachedVerse } from "./types";
import { USFM_CODES } from "./constants";
import { VerseCache } from "./cache";
import { formatReference } from "./parser";
import { assembleChapterText, computeRequestedVerses } from "./format";
import {
  buildStrongsPassage,
  wordsLinkFor,
  HelloAoWordsResponse,
  LexiconEntry,
  StrongsPassage,
} from "./strongs";

const BASE_URL = "https://bible.helloao.org/api";
const ORIGIN = "https://bible.helloao.org";

/** Shape of the HelloAO chapter endpoint response we rely on. */
interface HelloAoChapterResponse {
  chapter: { content: unknown[] };
  translation?: { licenseUrl?: string };
  numberOfVerses?: number;
  /** Present only when the translation has word alignment for this chapter. */
  thisChapterWordsLink?: string;
}

/**
 * How many chapter payloads to keep in memory. The verse cache is keyed by
 * reference string, so nudging a range one verse at a time (#49) misses it on
 * every step and would otherwise re-download the same chapter for each nudge.
 * A handful of chapters covers a note being actively edited. A chapter's word
 * alignment (#69) is memoised beside it and counts as a second payload.
 */
const CHAPTER_MEMO_LIMIT = 16;

/**
 * Lexicon entries are small and hovering over a long passage touches many of
 * them, so keep plenty. Process-lifetime only, like the chapter memo.
 */
const LEXICON_MEMO_LIMIT = 512;

/**
 * In-flight and recent requests by key. Promises rather than values, so
 * concurrent requests for the same payload share one round trip instead of
 * racing. Oldest entries are dropped first.
 */
class PromiseMemo<T> {
  private entries: Map<string, Promise<T>> = new Map();

  constructor(private readonly limit: number) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    const memo = this.entries.get(key);
    if (memo) return memo;

    const pending = load();
    // A failed fetch must not be memoised, or one blip would stick for the rest
    // of the session.
    pending.catch(() => this.entries.delete(key));

    this.entries.set(key, pending);
    if (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    return pending;
  }
}

/** GET a HelloAO JSON payload, failing on any non-200 status. */
async function fetchJson<T>(url: string): Promise<T> {
  const response = await requestUrl({ url });
  if (response.status !== 200) {
    throw new Error(`HelloAO API returned status ${response.status}`);
  }
  return response.json as T;
}

/**
 * Client for the HelloAO Bible API.
 * Fetches whole chapters and extracts specific verses client-side.
 * No API key required.
 */
export class BibleApi {
  private cache: VerseCache;

  /**
   * In-flight and recently fetched chapter payloads and their word alignment,
   * keyed by translation/book/chapter. Shared promises, so a burst of
   * verse-shift clicks costs one round trip.
   *
   * Process-lifetime only; the durable cache remains VerseCache on disk.
   */
  private chapters = new PromiseMemo<unknown>(CHAPTER_MEMO_LIMIT);

  /** STEPBible lexicon entries by Strong's number; null when there is none. */
  private lexicon = new PromiseMemo<LexiconEntry | null>(LEXICON_MEMO_LIMIT);

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
    return this.chapters.get(key, () =>
      fetchJson<HelloAoChapterResponse>(`${BASE_URL}/${translationId}/${usfm}/${chapter}.json`)
    ) as Promise<HelloAoChapterResponse>;
  }

  /** Fetch a chapter's word alignment from the link its chapter payload gave. */
  private getWords(
    translationId: string,
    usfm: string,
    chapter: number,
    link: string
  ): Promise<HelloAoWordsResponse> {
    const key = `${translationId}/${usfm}/${chapter}#words`;
    const url = link.startsWith("http") ? link : `${ORIGIN}${link}`;
    return this.chapters.get(key, () => fetchJson<HelloAoWordsResponse>(url)) as Promise<HelloAoWordsResponse>;
  }

  /**
   * Whether a translation has word alignment for the chapter a reference is in.
   * Nearly free once the verse has rendered, since the chapter is memoised.
   */
  async hasWords(ref: BibleReference, translationId: string): Promise<boolean> {
    const usfm = USFM_CODES[ref.book];
    if (!usfm) return false;
    return wordsLinkFor(await this.getChapter(translationId, usfm, ref.chapter)) !== null;
  }

  /**
   * The passage with its Strong's-tagged words marked (#69), or null when the
   * translation has no words file for this chapter. Never written to the verse
   * cache: the marked text exists only for the layer's own render.
   */
  async getStrongsPassage(
    ref: BibleReference,
    translationId: string,
    settings: {
      showVerseNumbers: boolean;
      verseNewLine: boolean;
      paragraphBreaks: boolean;
    }
  ): Promise<StrongsPassage | null> {
    const usfm = USFM_CODES[ref.book];
    if (!usfm) throw new Error(`Unknown book: ${ref.book}`);

    const data = await this.getChapter(translationId, usfm, ref.chapter);
    const link = wordsLinkFor(data);
    if (!link) return null;

    const words = await this.getWords(translationId, usfm, ref.chapter, link);
    return buildStrongsPassage(data.chapter.content, words, ref, settings);
  }

  /** The STEPBible lexicon entry for a Strong's number, or null if there is none. */
  getLexiconEntry(number: string): Promise<LexiconEntry | null> {
    return this.lexicon.get(number, async () => {
      const response = await requestUrl({
        url: `${BASE_URL}/d/stepbible-lexicon/lexicon/${encodeURIComponent(number)}.json`,
        throw: false,
      });
      // A number with no entry is an answer, not a failure, so it is memoised.
      if (response.status === 404) return null;
      if (response.status !== 200) {
        throw new Error(`HelloAO API returned status ${response.status}`);
      }
      const entry = (response.json as { entry?: LexiconEntry }).entry;
      return entry && Array.isArray(entry.senses) ? entry : null;
    });
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
