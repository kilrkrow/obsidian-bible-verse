/** Parsed Bible reference */
export interface BibleReference {
  book: string;
  chapter: number;
  startVerse: number | null;
  endVerse: number | null;
  /** Additional individual verses, e.g. "16-21,25" → additionalVerses = [25] */
  additionalVerses: number[];
  /** For multi-chapter ranges like John 3:16-4:3 */
  endChapter: number | null;
  /** Raw input string for display */
  raw: string;
}

export type DisplayStyle = "sidebar" | "callout" | "blockquote" | "inline";

export type BibleWebsite = "BibleHub" | "BibleGateway" | "BlueLetter" | "BibleCom";

export interface BibleVerseSettings {
  apiKey: string;
  defaultTranslation: string;
  preferredWebsite: BibleWebsite;
  displayStyle: DisplayStyle;
  persistVerseText: boolean;
}

export const DEFAULT_SETTINGS: BibleVerseSettings = {
  apiKey: "",
  defaultTranslation: "de4e12af7f28f599-02", // KJV from API.Bible
  preferredWebsite: "BibleGateway",
  displayStyle: "callout",
  persistVerseText: false,
};

/** API.Bible response for a passage */
export interface ApiBiblePassage {
  id: string;
  orgId: string;
  bibleId: string;
  reference: string;
  content: string;
  copyright: string;
}

/** Cached verse entry */
export interface CachedVerse {
  reference: string;
  translation: string;
  bibleId: string;
  text: string;
  copyright: string;
  fetchedAt: number;
}

/** Translation info */
export interface TranslationInfo {
  id: string;
  name: string;
  abbreviation: string;
  language: string;
}
