import { BibleReference } from "./types";
import { assembleChapterText, computeRequestedVerses, includesVerse } from "./format";

/**
 * Strong's layer for a live verse (#69): pure logic only.
 *
 * No `obsidian`, no network, no cache — the fetching lives in BibleApi and the
 * DOM in strongs-dom.ts, so word alignment, marking and the token modifier are
 * unit-testable against captured HelloAO fixtures.
 *
 * Data comes from two HelloAO endpoints:
 *   - /api/{translation}/{book}/{chapter}.words.json — per verse, a list of
 *     annotations, each a character range into one item of that verse's
 *     `content` array plus the Strong's numbers for the word in that range.
 *     Only offered when the chapter JSON carries `thisChapterWordsLink`.
 *   - /api/d/stepbible-lexicon/lexicon/{number}.json — STEPBible's brief
 *     lexicon entry for one Strong's number.
 */

/** Required credit wherever lexicon data is shown or written into a note. */
export const STRONGS_CREDIT = "STEPBible lexicon, CC BY 4.0, STEPBible.org / Tyndale House";

/** Licence of the STEPBible lexicon data. */
export const STRONGS_LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/";

/** One word-alignment annotation from a `.words.json` payload. */
export interface WordAnnotation {
  /** Index into the verse's `content` array. */
  contentIndex: number;
  /** Character offsets into that content item; `text.slice(start, end)` is the word. */
  start: number;
  end: number;
  strongs: string[];
}

/** The part of a `.words.json` payload the layer reads. */
export interface HelloAoWordsResponse {
  verses: Record<string, WordAnnotation[]>;
}

/** One sense of a STEPBible lexicon entry. */
export interface LexiconSense {
  lemma?: string;
  transliteration?: string;
  gloss?: string;
  definition?: string;
}

/** The part of a lexicon response the layer reads (`response.entry`). */
export interface LexiconEntry {
  id: string;
  senses: LexiconSense[];
}

/** A tagged word in a rendered passage. */
export interface StrongsWord {
  /** Stable identity within the chapter, as stored in the token: see wordKey. */
  key: string;
  verse: number;
  /** The English word exactly as the translation has it. */
  english: string;
  /** The first Strong's number on the word, e.g. "H3068". */
  number: string;
}

/** Display text with word markers, plus the words those markers refer to. */
export interface StrongsPassage {
  text: string;
  words: StrongsWord[];
}

/**
 * The words link a chapter payload advertises, or null when the translation
 * has no word alignment for it. Absence is the signal to leave a verse alone.
 */
export function wordsLinkFor(chapter: unknown): string | null {
  if (typeof chapter !== "object" || chapter === null) return null;
  const link = (chapter as { thisChapterWordsLink?: unknown }).thisChapterWordsLink;
  return typeof link === "string" && link.length > 0 ? link : null;
}

/**
 * A word's identity: verse, content index and start offset, dot-separated
 * ("5.0.15"). Offsets are what the alignment itself is keyed on, so the key
 * survives display changes (verse numbers, line breaks) that move the word on
 * screen without changing the source text.
 */
export function wordKey(verse: number, contentIndex: number, start: number): string {
  return `${verse}.${contentIndex}.${start}`;
}

const WORD_KEY_RE = /^\d+\.\d+\.\d+$/;

/** The text of one content item, for strings and `{ text }` objects alike. */
function contentText(item: unknown): string | null {
  if (typeof item === "string") return item;
  if (typeof item === "object" && item !== null) {
    const text = (item as { text?: unknown }).text;
    if (typeof text === "string") return text;
  }
  return null;
}

/**
 * The English word an annotation covers, or null when its offsets do not fit
 * the content they point into (a mismatched or stale words file).
 */
export function sliceWord(content: unknown[], annotation: WordAnnotation): string | null {
  const text = contentText(content[annotation.contentIndex]);
  if (text === null) return null;
  const { start, end } = annotation;
  if (!(start >= 0 && end > start && end <= text.length)) return null;
  const word = text.slice(start, end);
  return word.trim().length > 0 ? word : null;
}

// ── Word markers ────────────────────────────────────────────────────────────
// Tagged words are wrapped in private-use characters before the passage is
// assembled and rendered as markdown. They survive both untouched — they are
// not whitespace, not markdown syntax, and not in any translation's text — so
// once the body is in the DOM each marked run can be swapped for a hoverable
// span, whatever verse numbers, line breaks or paragraphs the render added.
//
//   U+E000  index  word  U+E001     index = U+E100 + position in `words`

const MARK_OPEN = "";
const MARK_CLOSE = "";
const INDEX_BASE = 0xe100;
const INDEX_MAX = 0xf8ff - INDEX_BASE;

const MARKED_RE = /([-])([^]*)/g;
const STRAY_MARKS_RE = /[-]/g;

/**
 * Copy a chapter's content with every tagged word in the included verses
 * wrapped in a marker, and list those words in reading order. Words with no
 * Strong's number stay plain; a word with several numbers keeps the first.
 */
export function markChapterContent(
  chapterContent: unknown[],
  words: HelloAoWordsResponse,
  requestedVerses: Set<number> | null,
  startVerse: number | null
): { content: unknown[]; words: StrongsWord[] } {
  const found: StrongsWord[] = [];

  const content = chapterContent.map((item) => {
    if (typeof item !== "object" || item === null) return item;
    const verseItem = item as { type?: unknown; number?: unknown; content?: unknown };
    if (verseItem.type !== "verse" || typeof verseItem.number !== "number") return item;
    if (!Array.isArray(verseItem.content)) return item;
    if (!includesVerse(requestedVerses, startVerse, verseItem.number)) return item;

    const verse = verseItem.number;
    const verseContent = verseItem.content as unknown[];
    const annotations = (words.verses[String(verse)] ?? [])
      .filter((a) => Array.isArray(a.strongs) && a.strongs.length > 0)
      .slice()
      .sort((a, b) => a.contentIndex - b.contentIndex || a.start - b.start);

    // Per content item, the ranges to wrap, in order and non-overlapping.
    const byItem = new Map<number, { start: number; end: number; index: number }[]>();
    for (const a of annotations) {
      const english = sliceWord(verseContent, a);
      if (english === null) continue;
      const ranges = byItem.get(a.contentIndex) ?? [];
      const last = ranges[ranges.length - 1];
      if (last && a.start < last.end) continue;
      if (found.length > INDEX_MAX) break;

      ranges.push({ start: a.start, end: a.end, index: found.length });
      byItem.set(a.contentIndex, ranges);
      found.push({ key: wordKey(verse, a.contentIndex, a.start), verse, english, number: a.strongs[0] });
    }
    if (byItem.size === 0) return item;

    const marked = verseContent.map((part, i) => {
      const ranges = byItem.get(i);
      const text = contentText(part);
      if (!ranges || text === null) return part;
      let out = "";
      let at = 0;
      for (const r of ranges) {
        out += text.slice(at, r.start);
        out += MARK_OPEN + String.fromCharCode(INDEX_BASE + r.index) + text.slice(r.start, r.end) + MARK_CLOSE;
        at = r.end;
      }
      out += text.slice(at);
      return typeof part === "string" ? out : { ...(part as object), text: out };
    });

    return { ...verseItem, content: marked };
  });

  return { content, words: found };
}

/**
 * Assemble a passage with word markers, using the same assembly as the plain
 * verse so layout matches exactly. Null when no verses matched.
 */
export function buildStrongsPassage(
  chapterContent: unknown[],
  words: HelloAoWordsResponse,
  ref: BibleReference,
  settings: { showVerseNumbers: boolean; verseNewLine: boolean; paragraphBreaks: boolean }
): StrongsPassage | null {
  const requested = computeRequestedVerses(ref);
  const marked = markChapterContent(chapterContent, words, requested, ref.startVerse);
  const text = assembleChapterText(marked.content, requested, ref.startVerse, settings);
  return text ? { text, words: marked.words } : null;
}

/** A run of rendered text: plain, or a tagged word by its index in `words`. */
export type MarkedSegment = string | { index: number; text: string };

/** Split marked text into plain runs and tagged words. Stray markers are dropped. */
export function splitMarkedText(text: string): MarkedSegment[] {
  const out: MarkedSegment[] = [];
  let at = 0;
  for (const m of text.matchAll(MARKED_RE)) {
    const i = m.index ?? 0;
    if (i > at) out.push(text.slice(at, i).replace(STRAY_MARKS_RE, ""));
    out.push({ index: m[1].charCodeAt(0) - INDEX_BASE, text: m[2] });
    at = i + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at).replace(STRAY_MARKS_RE, ""));
  return out.filter((s) => typeof s !== "string" || s.length > 0);
}

/** Whether a string carries any word markers. */
export function hasMarkers(text: string): boolean {
  return text.includes(MARK_OPEN);
}

/** Text with every marker removed, i.e. the plain verse. */
export function stripMarkers(text: string): string {
  return text.replace(STRAY_MARKS_RE, "");
}

// ── Lexicon ─────────────────────────────────────────────────────────────────

/**
 * The sense to show for an entry: the first one that has a transliteration,
 * else the first. Its fields are shown as the API returns them — H3068 is
 * "ye.ho.vah" / "LORD", never a substituted "Yahweh".
 */
export function chooseSense(entry: LexiconEntry | null | undefined): LexiconSense | null {
  const senses = entry?.senses ?? [];
  return senses.find((s) => typeof s.transliteration === "string" && s.transliteration.trim() !== "")
    ?? senses[0]
    ?? null;
}

/** The transliteration a clicked word is shown as, or null if the entry has none. */
export function transliterationFor(entry: LexiconEntry | null | undefined): string | null {
  const t = chooseSense(entry)?.transliteration?.trim();
  return t ? t : null;
}

/** A sense's definition flattened onto one line. */
export function oneLineDefinition(definition: string | undefined): string {
  return (definition ?? "").replace(/\s*\n+\s*/g, " ").trim();
}

/**
 * The markdown line "Insert below" adds after the token: the English word, its
 * number, transliteration, gloss and first-sense definition, with the credit.
 */
export function formatInsertLine(word: StrongsWord, sense: LexiconSense | null): string {
  const parts = [`**${word.english}**`, "—", word.number];
  const translit = sense?.transliteration?.trim();
  if (translit) parts.push(`*${translit}*`);
  const gloss = sense?.gloss?.trim();
  let line = parts.join(" ");
  if (gloss) line += ` "${gloss}"`;
  const definition = oneLineDefinition(sense?.definition);
  if (definition) line += `: ${definition}`;
  return `${line} *(${STRONGS_CREDIT})*`;
}

// ── Token modifier ──────────────────────────────────────────────────────────
// `strongs` turns the layer on. `tr:` lists the words shown as their
// transliteration, joined with "+": {Proverbs 3:5, strongs, tr:5.0.15+5.0.35}.
// Both are new modifiers, so tokens written by earlier versions parse exactly
// as before.

export const STRONGS_MODIFIER = "strongs";
const TR_PREFIX = "tr:";

/** The word keys in a `tr:` modifier, or null when `token` is not one. */
export function parseTransliterateModifier(token: string): string[] | null {
  if (!token.toLowerCase().startsWith(TR_PREFIX)) return null;
  const keys = token.slice(TR_PREFIX.length).split("+").map((k) => k.trim());
  if (keys.length === 0 || !keys.every((k) => WORD_KEY_RE.test(k))) return null;
  return sortKeys(keys);
}

/** The `tr:` modifier for a set of word keys, or null when there are none. */
export function formatTransliterateModifier(keys: string[]): string | null {
  return keys.length > 0 ? TR_PREFIX + sortKeys(keys).join("+") : null;
}

/** Add `key` if absent, remove it if present. */
export function toggleKey(keys: string[], key: string): string[] {
  return keys.includes(key) ? keys.filter((k) => k !== key) : sortKeys([...keys, key]);
}

/** Keys deduplicated and in reading order. */
function sortKeys(keys: string[]): string[] {
  const num = (k: string) => k.split(".").map((n) => parseInt(n, 10));
  return [...new Set(keys)].sort((a, b) => {
    const [x, y] = [num(a), num(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  });
}

/** Whether a token asks for the layer: `strongs`, or any transliterated word. */
export function strongsActive(spec: { strongs: boolean; transliterate: string[] }): boolean {
  return spec.strongs || spec.transliterate.length > 0;
}
