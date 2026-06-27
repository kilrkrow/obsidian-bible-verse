import { requestUrl } from "obsidian";
import { BibleReference, CachedVerse } from "./types";
import { TranslationDef, ESV_COPYRIGHT } from "./constants";
import { formatReference } from "./parser";

export interface PassageSettings {
  showVerseNumbers: boolean;
  verseNewLine: boolean;
  paragraphBreaks: boolean;
}

/**
 * Fetch a passage from the ESV API (api.esv.org).
 * Requires a user-supplied API key.
 */
export async function fetchEsvPassage(
  ref: BibleReference,
  apiKey: string,
  settings: PassageSettings
): Promise<CachedVerse> {
  const refStr = formatReference(ref);

  const params = new URLSearchParams({
    q: refStr,
    "include-headings": "false",
    "include-footnotes": "false",
    "include-verse-numbers": String(settings.showVerseNumbers),
    "include-short-copyright": "true",
    "include-passage-references": "false",
    "indent-paragraphs": "0",
    "indent-poetry": "false",
    "indent-declares": "0",
    "indent-psalm-doxology": "0",
  });

  const response = await requestUrl({
    url: `https://api.esv.org/v3/passage/text/?${params}`,
    headers: { Authorization: `Token ${apiKey}` },
  });

  if (response.status !== 200) {
    throw new Error(`ESV API returned status ${response.status}`);
  }

  const data = response.json;
  const passages: string[] = data.passages;
  if (!passages || passages.length === 0) {
    throw new Error(`No passages returned for ${refStr}`);
  }

  let text = passages.join("\n\n").trim();

  if (settings.showVerseNumbers) {
    text = text.replace(/\[(\d+)\]\s*/g, "$1. ");
  }

  if (settings.verseNewLine && settings.showVerseNumbers) {
    text = text.replace(/(\S)\s+(\d+\.\s)/g, "$1\n$2");
  }

  text = text.replace(/\n{3,}/g, "\n\n").trim();

  return {
    reference: refStr,
    translation: "ESV",
    bibleId: "ESV",
    text,
    copyright: ESV_COPYRIGHT,
    requireAttribution: true,
    fetchedAt: Date.now(),
  };
}

/**
 * Determine the effective mode for a translation given current API key state.
 * If an apiKeyText translation has no key configured, it degrades to linkOnly.
 */
export function getEffectiveMode(
  def: TranslationDef,
  esvApiKey: string
): "text" | "linkOnly" {
  if (def.mode === "text") return "text";
  if (def.mode === "linkOnly") return "linkOnly";

  if (def.provider === "esv" && esvApiKey) return "text";

  return "linkOnly";
}
