import type { StrongsLinkTarget } from "./types";

/**
 * Where the Strong's number in the popover links to: a concordance page that
 * lists the verses using that number. The "Strong's number link" setting
 * picks the site.
 *
 * Bible Hub (the default): https://biblehub.com/greek/4678.htm. One page per
 * plain Strong's number, with its Englishman's Concordance of every verse.
 * It wants the bare integer: no padding ("greek/0026.htm" is a 404) and no
 * sense letter, so it covers every sense of the number. It has pages for
 * G1-G5624 and H1-H8674 only; a number outside that (STEPBible's additions)
 * links to STEPBible instead.
 *
 * STEPBible: https://www.stepbible.org/?q=strong=G4678. STEPBible searches by
 * its own "extended" Strong's numbers: always four digits ("G0026", not
 * "G26"), and a number it splits into several senses only matches with the
 * sense letter ("H0430G" for "God"; a bare "H0430" finds nothing). The lexicon
 * entry the popover shows carries that sense id, so the link uses it. With no
 * sense id to go on, STEPBible could come back empty, so the link goes to Blue
 * Letter Bible instead.
 *
 * Blue Letter Bible: https://www.blueletterbible.org/lexicon/h430/kjv/wlc/0-1/.
 * The lexicon page with its KJV concordance, for the plain number.
 */

/** The sites the number can link to, in the order the setting lists them. */
export const STRONGS_LINK_TARGETS: readonly StrongsLinkTarget[] = ["BibleHub", "STEPBible", "BlueLetter"];

/** Whether `value` is one of the link targets (for reading data.json). */
export function isStrongsLinkTarget(value: unknown): value is StrongsLinkTarget {
  return typeof value === "string" && (STRONGS_LINK_TARGETS as readonly string[]).includes(value);
}

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

/** Highest number Bible Hub has a page for, by language. */
const BIBLE_HUB_MAX = { G: 5624, H: 8674 } as const;

/**
 * Bible Hub's page for the number, with its Englishman's Concordance, or null
 * if Bible Hub has no page for it. Plain integer, sense letter dropped.
 */
export function bibleHubUrl(ref: StrongsRef): string | null {
  if (ref.value > BIBLE_HUB_MAX[ref.language]) return null;
  const lang = ref.language === "G" ? "greek" : "hebrew";
  return `https://biblehub.com/${lang}/${ref.value}.htm`;
}

/**
 * The STEPBible link: the number's own sense letter if it has one, else the
 * shown sense's (a sense id for a different number is ignored), else Blue
 * Letter Bible because a bare STEPBible number may find nothing.
 */
function stepBibleLink(ref: StrongsRef, senseId: string | null | undefined): string {
  if (ref.sense) return stepBibleSearchUrl(ref);
  const sense = parseStrongsNumber(senseId);
  if (sense && sense.language === ref.language && sense.value === ref.value) {
    return stepBibleSearchUrl(sense);
  }
  return blueLetterBibleUrl(ref);
}

/**
 * The page listing every verse that uses a Strong's number on the chosen
 * site, or null if `number` is not one.
 *
 * `senseId` is the id of the lexicon sense the popover shows ("H0430G"); only
 * STEPBible uses it (see the top of this file). An unknown `target` is
 * treated as the default, Bible Hub.
 */
export function strongsConcordanceUrl(
  number: string,
  senseId: string | null | undefined,
  target: StrongsLinkTarget
): string | null {
  const ref = parseStrongsNumber(number);
  if (!ref) return null;
  switch (target) {
    case "STEPBible":
      return stepBibleLink(ref, senseId);
    case "BlueLetter":
      return blueLetterBibleUrl(ref);
    default:
      return bibleHubUrl(ref) ?? stepBibleLink(ref, senseId);
  }
}

/** Tooltip for the number's link: "See all uses of G4678". */
export function strongsConcordanceTitle(number: string): string {
  return `See all uses of ${number.trim()}`;
}
