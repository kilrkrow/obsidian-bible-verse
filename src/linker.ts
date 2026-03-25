import { BibleReference, BibleWebsite } from "./types";
import {
  BIBLEHUB_SLUGS,
  BLB_CODES,
  USFM_CODES,
  BIBLE_COM_TRANSLATION_IDS,
} from "./constants";

/**
 * Generate a URL to the user's preferred Bible website for a given reference.
 */
export function generateLink(
  ref: BibleReference,
  translation: string,
  website: BibleWebsite
): string {
  switch (website) {
    case "BibleHub":
      return bibleHubUrl(ref, translation);
    case "BibleGateway":
      return bibleGatewayUrl(ref, translation);
    case "BlueLetter":
      return blueLetterUrl(ref, translation);
    case "BibleCom":
      return bibleComUrl(ref, translation);
  }
}

/**
 * Generate a search URL on the user's preferred Bible website for a free-text query.
 */
export function generateSearchUrl(
  query: string,
  translation: string,
  website: BibleWebsite
): string {
  const encoded = encodeURIComponent(query);
  switch (website) {
    case "BibleHub":
      return `https://biblehub.com/search.php?q=${encoded}`;
    case "BibleGateway":
      return `https://www.biblegateway.com/quicksearch/?search=${encoded}&version=${translation}`;
    case "BlueLetter":
      return `https://www.blueletterbible.org/search/search.cfm?Criteria=${encoded}&t=${translation.toLowerCase()}`;
    case "BibleCom":
      return `https://www.bible.com/search/bible?query=${encoded}`;
  }
}

function bibleHubUrl(ref: BibleReference, translation: string): string {
  const slug = BIBLEHUB_SLUGS[ref.book] || ref.book.toLowerCase().replace(/\s+/g, "_");
  const trans = translation.toLowerCase();
  const verse = ref.startVerse ?? 1;
  return `https://biblehub.com/${trans}/${slug}/${ref.chapter}-${verse}.htm`;
}

function bibleGatewayUrl(ref: BibleReference, translation: string): string {
  let search = ref.book + "+" + ref.chapter;
  if (ref.startVerse !== null) {
    search += "%3A" + ref.startVerse;
    if (ref.endChapter !== null && ref.endVerse !== null) {
      search += `-${ref.endChapter}%3A${ref.endVerse}`;
    } else if (ref.endVerse !== null) {
      search += `-${ref.endVerse}`;
    }
    if (ref.additionalVerses.length > 0) {
      search += "%2C" + ref.additionalVerses.join("%2C");
    }
  }
  search = search.replace(/\s+/g, "+");
  return `https://www.biblegateway.com/passage/?search=${search}&version=${translation}`;
}

function blueLetterUrl(ref: BibleReference, translation: string): string {
  const code = BLB_CODES[ref.book] || ref.book.substring(0, 3).toLowerCase();
  const trans = translation.toLowerCase();
  const verse = ref.startVerse ?? 1;
  return `https://www.blueletterbible.org/${trans}/${code}/${ref.chapter}/${verse}/`;
}

function bibleComUrl(ref: BibleReference, translation: string): string {
  const usfm = USFM_CODES[ref.book] || ref.book.substring(0, 3).toUpperCase();
  const transId = BIBLE_COM_TRANSLATION_IDS[translation.toUpperCase()] || 1;
  const verse = ref.startVerse ?? 1;
  return `https://www.bible.com/bible/${transId}/${usfm}.${ref.chapter}.${verse}`;
}
