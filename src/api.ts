import { requestUrl } from "obsidian";
import { BibleReference, CachedVerse, TranslationInfo } from "./types";
import { USFM_CODES } from "./constants";
import { VerseCache } from "./cache";
import { formatReference } from "./parser";

const BASE_URL = "https://api.scripture.api.bible/v1";

/**
 * Client for the API.Bible service.
 * Handles fetching verse text with caching and copyright attribution.
 */
export class BibleApi {
  private apiKey: string;
  private cache: VerseCache;

  constructor(apiKey: string, cache: VerseCache) {
    this.apiKey = apiKey;
    this.cache = cache;
  }

  setApiKey(key: string): void {
    this.apiKey = key;
  }

  /**
   * Build an API.Bible passage ID from a parsed reference.
   * Format: {USFM}.{chapter}.{verse}-{USFM}.{chapter}.{endVerse}
   */
  buildPassageId(ref: BibleReference): string {
    const usfm = USFM_CODES[ref.book];
    if (!usfm) throw new Error(`Unknown book: ${ref.book}`);

    // Whole chapter
    if (ref.startVerse === null) {
      return `${usfm}.${ref.chapter}`;
    }

    // Multi-chapter range
    if (ref.endChapter !== null && ref.endVerse !== null) {
      return `${usfm}.${ref.chapter}.${ref.startVerse}-${usfm}.${ref.endChapter}.${ref.endVerse}`;
    }

    // Single verse
    if (ref.endVerse === null && ref.additionalVerses.length === 0) {
      return `${usfm}.${ref.chapter}.${ref.startVerse}`;
    }

    // Verse range
    if (ref.endVerse !== null) {
      return `${usfm}.${ref.chapter}.${ref.startVerse}-${usfm}.${ref.chapter}.${ref.endVerse}`;
    }

    // Single verse (with additional verses — fetch the full range)
    const allVerses = [ref.startVerse, ...ref.additionalVerses];
    const max = Math.max(...allVerses);
    return `${usfm}.${ref.chapter}.${ref.startVerse}-${usfm}.${ref.chapter}.${max}`;
  }

  /**
   * Fetch a passage from API.Bible.
   * Returns cached version if available.
   */
  async getPassage(
    ref: BibleReference,
    bibleId: string,
    translationAbbr: string
  ): Promise<CachedVerse> {
    const refStr = formatReference(ref);

    // Check cache first
    const cached = this.cache.get(translationAbbr, refStr);
    if (cached) return cached;

    if (!this.apiKey) {
      throw new Error(
        "API key not configured. Go to Settings → Bible Verse to add your API.Bible key."
      );
    }

    const passageId = this.buildPassageId(ref);
    const url = `${BASE_URL}/bibles/${bibleId}/passages/${passageId}?content-type=text&include-notes=false&include-titles=false&include-chapter-numbers=false&include-verse-numbers=true&include-verse-spans=false`;

    const response = await requestUrl({
      url,
      headers: { "api-key": this.apiKey },
    });

    if (response.status !== 200) {
      throw new Error(`API.Bible returned status ${response.status}`);
    }

    const data = response.json.data;
    const text = (data.content as string).trim();
    const copyright = (data.copyright as string) || "";

    const entry: CachedVerse = {
      reference: refStr,
      translation: translationAbbr,
      bibleId,
      text,
      copyright,
      fetchedAt: Date.now(),
    };

    await this.cache.set(entry);
    return entry;
  }

  /**
   * Fetch the list of available Bible translations.
   */
  async getTranslations(): Promise<TranslationInfo[]> {
    if (!this.apiKey) return [];

    const response = await requestUrl({
      url: `${BASE_URL}/bibles`,
      headers: { "api-key": this.apiKey },
    });

    if (response.status !== 200) return [];

    const bibles = response.json.data as Array<{
      id: string;
      name: string;
      abbreviation: string;
      language: { id: string; name: string };
    }>;

    return bibles
      .filter((b) => b.language.id === "eng")
      .map((b) => ({
        id: b.id,
        name: b.name,
        abbreviation: b.abbreviation?.toUpperCase() || b.id,
        language: b.language.name,
      }));
  }
}
