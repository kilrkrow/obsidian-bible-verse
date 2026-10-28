import { isStrongsLinkTarget } from "./strongs-link";

/**
 * Sentinel stored in `endVerse` for an "end of chapter" range ("John 3:16-eoc").
 * Resolved lazily at render time — `computeRequestedVerses` treats it as "every
 * verse from `startVerse` on", so the chapter data supplies the real bound and
 * no verse count is needed to display it.
 */
export const EOC_VERSE = 999;

/** Parsed Bible reference */
export interface BibleReference {
  book: string;
  chapter: number;
  startVerse: number | null;
  endVerse: number | null;
  /** Additional individual verses, e.g. "16-21,25" → additionalVerses = [25] */
  additionalVerses: number[];
  /** Raw input string for display */
  raw: string;
}

export type DisplayStyle = "sidebar" | "callout" | "blockquote" | "inline" | "native-callout";

/** Where the Strong's number in the popover links to (see strongs-link.ts). */
export type StrongsLinkTarget = "BibleHub" | "STEPBible" | "BlueLetter";

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
  /** Show release notes once after the plugin updates. */
  showWhatsNew: boolean;
  /** Plugin version the user last saw release notes for; "" until first recorded. */
  lastSeenVersion: string;
  /** Strong's popover: also offer single words from a lexicon meaning. */
  strongsWordPicks: boolean;
  /** Strong's popover: the site the number links to. */
  strongsLinkTarget: StrongsLinkTarget;
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
  showWhatsNew: true,
  lastSeenVersion: "",
  strongsWordPicks: false,
  strongsLinkTarget: "BibleHub",
};

/**
 * Settings from what data.json holds. Missing keys take their defaults (so a
 * data.json from before a setting existed gets its default), and every saved
 * key is kept as it is, including ones this version doesn't know, so saving
 * writes them back unchanged. Only a Strong's link target that isn't one of
 * the sites is replaced, with the default.
 */
export function settingsFromSaved(saved: unknown): BibleVerseSettings {
  const data = saved !== null && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  const settings = Object.assign({}, DEFAULT_SETTINGS, data) as BibleVerseSettings;
  if (!isStrongsLinkTarget(settings.strongsLinkTarget)) {
    settings.strongsLinkTarget = DEFAULT_SETTINGS.strongsLinkTarget;
  }
  return settings;
}

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
  /**
   * The translation as the reference label names it, when that differs from
   * `translation` — "KJV-Strong's" for a verse with Strong's words changed.
   * `translation` stays the real abbreviation, for links, caching and the
   * baked block header.
   */
  label?: string;
  /**
   * Verses in the source chapter, when the provider reports it. Undefined means
   * "unknown" — entries cached before this field existed, and providers that
   * never fetch a chapter (ESV, link-only translations). Callers must treat
   * undefined as "no upper bound known" rather than as zero.
   */
  numberOfVerses?: number;
}

/** Translation info */
export interface TranslationInfo {
  id: string;
  name: string;
  abbreviation: string;
  language: string;
}
