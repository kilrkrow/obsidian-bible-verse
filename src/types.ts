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

export type DisplayStyle = "sidebar" | "callout" | "blockquote" | "inline" | "native-callout";

export type BibleWebsite = "BibleHub" | "BibleGateway" | "BlueLetter" | "BibleCom";

export interface BibleVerseSettings {
  defaultTranslation: string;
  preferredWebsite: BibleWebsite;
  displayStyle: DisplayStyle;
  persistVerseText: boolean;
  sidebarTopPadding: number;
  showVerseNumbers: boolean;
  verseNewLine: boolean;
  showAttribution: boolean;
  bakeInline: boolean;
  paragraphBreaks: boolean;
  helperMode: boolean;
  esvApiKey: string;
  /** Callout type used when baking as a native callout (e.g. "quote", "bible"). */
  nativeCalloutType: string;
}

export const DEFAULT_SETTINGS: BibleVerseSettings = {
  defaultTranslation: "eng_kjv",
  preferredWebsite: "BibleGateway",
  displayStyle: "callout",
  persistVerseText: false,
  sidebarTopPadding: 0.5,
  showVerseNumbers: true,
  verseNewLine: false,
  showAttribution: false,
  bakeInline: false,
  paragraphBreaks: false,
  helperMode: true,
  esvApiKey: "",
  nativeCalloutType: "quote",
};

/** Cached verse entry */
export interface CachedVerse {
  reference: string;
  translation: string;
  bibleId: string;
  text: string;
  copyright: string;
  fetchedAt: number;
  /** When true, the copyright line must be shown regardless of the "Show attribution" toggle. */
  requireAttribution?: boolean;
}

/** Translation info */
export interface TranslationInfo {
  id: string;
  name: string;
  abbreviation: string;
  language: string;
}
