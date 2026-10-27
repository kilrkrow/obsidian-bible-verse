import { BibleReference, CachedVerse } from "./types";
import { formatReference } from "./parser";

/** A comparison column that opens the passage on the preferred Bible website. */
export function makeLinkOnlyVerse(
  ref: BibleReference,
  translationAbbr: string,
  bibleId: string
): CachedVerse {
  return {
    reference: formatReference(ref),
    translation: translationAbbr,
    bibleId,
    text: "",
    copyright: "",
    fetchedAt: Date.now(),
    linkOnly: true,
  };
}

export function isLinkOnlyVerse(verse: CachedVerse): boolean {
  return verse.linkOnly === true;
}

/**
 * Whether two cache snapshots for a Live Preview widget are the same column
 * for column. Link-only sentinels are compared by translation; text verses by
 * identity (the cache Map returns the same object).
 */
export function sameCachedVerses(a: CachedVerse[], b: CachedVerse[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => {
    const o = b[i];
    if (v.linkOnly || o.linkOnly) {
      return !!v.linkOnly && !!o.linkOnly && v.translation === o.translation;
    }
    return v === o;
  });
}