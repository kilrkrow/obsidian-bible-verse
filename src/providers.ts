import { requestUrl } from "obsidian";
import { BibleReference, CachedVerse } from "./types";
import { TranslationDef, ESV_COPYRIGHT } from "./constants";
import { formatReference } from "./parser";
import { buildEsvParams, formatEsvPassageText } from "./format";

export interface PassageSettings {
  showVerseNumbers: boolean;
  verseNewLine: boolean;
  paragraphBreaks: boolean;
}

/** Shape of the ESV passage-text endpoint response we rely on. */
interface EsvPassageResponse {
  passages?: string[];
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

  const params = buildEsvParams(refStr);

  const response = await requestUrl({
    url: `https://api.esv.org/v3/passage/text/?${params}`,
    headers: { Authorization: `Token ${apiKey}` },
  });

  if (response.status !== 200) {
    throw new Error(`ESV API returned status ${response.status}`);
  }

  const data = response.json as EsvPassageResponse;
  const passages = data.passages;
  if (!passages || passages.length === 0) {
    throw new Error(`No passages returned for ${refStr}`);
  }

  const text = formatEsvPassageText(passages, settings);

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
