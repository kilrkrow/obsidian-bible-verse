/**
 * Where the Strong's number in the popover links to: a concordance page that
 * lists the verses using that number.
 *
 * The target is STEPBible's search (https://www.stepbible.org/?q=strong=G4678),
 * the same project the lexicon comes from. STEPBible searches by its own
 * "extended" Strong's numbers: always four digits ("G0026", not "G26"), and
 * a Hebrew or Greek number that it splits into several senses only matches
 * with the sense letter ("H0430G" for "God"; a bare "H0430" finds nothing).
 * The lexicon entry the popover shows carries that sense id, so the link
 * uses it.
 *
 * When there is no sense id to go on (the entry failed to load, or there is
 * none), STEPBible could come back empty, so the link goes to Blue Letter
 * Bible's lexicon page instead, which lists every KJV verse for a plain
 * number with no sense letter: https://www.blueletterbible.org/lexicon/h430/kjv/wlc/0-1/.
 */

/** A parsed Strong's number. */
export interface StrongsRef {
  /** "G" for Greek, "H" for Hebrew. */
  language: "G" | "H";
  /** The number itself, without padding: 430 for "H0430". */
  value: number;
  /** STEPBible's sense letter, upper case ("A" in "H1254a"), or "". */
  sense: string;
}

/** Highest number either lexicon uses, with room for STEPBible's additions. */
const MAX_NUMBER = 9999;

/**
 * Read a Strong's number such as "G4678", "g04678", "H430", "H0430" or
 * "H1254a". Returns null for anything else: no G/H prefix, no digits, zero,
 * more than four significant digits, or more than one trailing letter.
 */
export function parseStrongsNumber(raw: string | null | undefined): StrongsRef | null {
  if (typeof raw !== "string") return null;
  const m = /^([GH])0*(\d{1,4})([A-Z])?$/i.exec(raw.trim());
  if (!m) return null;
  const value = Number(m[2]);
  if (!Number.isInteger(value) || value < 1 || value > MAX_NUMBER) return null;
  return {
    language: m[1].toUpperCase() as "G" | "H",
    value,
    sense: (m[3] ?? "").toUpperCase(),
  };
}

/** STEPBible's form of a number: four digits and an upper-case sense letter, "H0430G". */
export function stepBibleStrongsId(ref: StrongsRef): string {
  return `${ref.language}${String(ref.value).padStart(4, "0")}${ref.sense}`;
}

/** STEPBible search listing every verse with this number. */
export function stepBibleSearchUrl(ref: StrongsRef): string {
  return `https://www.stepbible.org/?q=strong=${stepBibleStrongsId(ref)}`;
}

/**
 * Blue Letter Bible's lexicon page, whose concordance lists the KJV verses.
 * It wants a lower-case, unpadded number ("h430") and no sense letter, and
 * the source text matching the testament: TR for Greek, WLC for Hebrew.
 */
export function blueLetterBibleUrl(ref: StrongsRef): string {
  const text = ref.language === "G" ? "tr" : "wlc";
  return `https://www.blueletterbible.org/lexicon/${ref.language.toLowerCase()}${ref.value}/kjv/${text}/0-1/`;
}

/**
 * The page listing every verse that uses a Strong's number, or null if
 * `number` is not one.
 *
 * `senseId` is the id of the lexicon sense the popover shows ("H0430G"). It
 * supplies STEPBible's sense letter when `number` has none; a sense id for a
 * different number is ignored. A number that carries its own letter
 * ("H1254a") keeps it. With no letter and no sense id, the link goes to
 * Blue Letter Bible (see the top of this file).
 */
export function strongsConcordanceUrl(number: string, senseId?: string | null): string | null {
  const ref = parseStrongsNumber(number);
  if (!ref) return null;
  if (ref.sense) return stepBibleSearchUrl(ref);

  const sense = parseStrongsNumber(senseId);
  if (sense && sense.language === ref.language && sense.value === ref.value) {
    return stepBibleSearchUrl(sense);
  }
  return blueLetterBibleUrl(ref);
}

/** Tooltip for the number's link: "See all uses of G4678". */
export function strongsConcordanceTitle(number: string): string {
  return `See all uses of ${number.trim()}`;
}
