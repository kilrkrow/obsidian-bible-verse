import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildStrongsPassage,
  chooseSense,
  formatInsertLine,
  formatTransliterateModifier,
  markChapterContent,
  parseTransliterateModifier,
  sliceWord,
  splitMarkedText,
  stripMarkers,
  strongsActive,
  toggleKey,
  transliterationFor,
  wordsLinkFor,
  HelloAoWordsResponse,
  LexiconEntry,
  STRONGS_CREDIT,
} from "../src/strongs";
import { assembleChapterText, computeRequestedVerses } from "../src/format";
import { formatInlineSpec, parseInlineSpec, parseReference } from "../src/parser";
import { insertLineAfter, locateToken, rewriteToken } from "../src/shift";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, "fixtures", "data");

function load<T>(...path: string[]): T {
  return JSON.parse(readFileSync(join(DATA, ...path), "utf8")) as T;
}

type Chapter = { chapter: { content: unknown[] } };
const PRO_3 = load<Chapter>("eng_kjv_PRO_3.json");
const PRO_3_WORDS = load<HelloAoWordsResponse>("eng_kjv_PRO_3.words.json");
const lexicon = (n: string) => load<{ entry: LexiconEntry }>("lexicon", `${n}.json`).entry;

function verseContent(chapter: Chapter, n: number): unknown[] {
  const v = chapter.chapter.content.find(
    (x) => (x as { type?: string; number?: number }).type === "verse" && (x as { number: number }).number === n
  ) as { content: unknown[] };
  return v.content;
}

const PLAIN = { showVerseNumbers: false, verseNewLine: false, paragraphBreaks: false };

describe("word alignment — offset slicing", () => {
  it("slices the English word out of its content item for Proverbs 3:5 KJV", () => {
    const content = verseContent(PRO_3, 5);
    const tagged = PRO_3_WORDS.verses["5"].map((a) => [sliceWord(content, a), a.strongs[0]]);
    expect(tagged).toEqual([
      ["Trust", "H0982"],
      ["LORD", "H3068"],
      ["heart", "H3820"],
      ["lean", "H8172"],
      ["understanding", "H0998"],
    ]);
  });

  it("indexes into the raw content, before the ¶ marker is stripped", () => {
    // "¶ Trust…" — Trust starts at offset 2, not 0.
    expect(PRO_3_WORDS.verses["5"][0]).toMatchObject({ contentIndex: 0, start: 2, end: 7 });
  });

  it("rejects offsets that do not fit the content", () => {
    const content = verseContent(PRO_3, 5);
    expect(sliceWord(content, { contentIndex: 0, start: 80, end: 500, strongs: ["H1"] })).toBeNull();
    expect(sliceWord(content, { contentIndex: 3, start: 0, end: 2, strongs: ["H1"] })).toBeNull();
    expect(sliceWord(content, { contentIndex: 0, start: 7, end: 7, strongs: ["H1"] })).toBeNull();
  });

  it("slices `{ text }` content items as well as strings", () => {
    const content = ["In the", { text: "beginning God", wordsOfJesus: true }];
    expect(sliceWord(content, { contentIndex: 1, start: 10, end: 13, strongs: ["H430"] })).toBe("God");
  });
});

describe("marked passage", () => {
  const ref = parseReference("Proverbs 3:5")!;

  it("renders the same words as the plain verse once the markers are removed", () => {
    const passage = buildStrongsPassage(PRO_3.chapter.content, PRO_3_WORDS, ref, PLAIN)!;
    const plain = assembleChapterText(PRO_3.chapter.content, computeRequestedVerses(ref), ref.startVerse, PLAIN);
    expect(stripMarkers(passage.text)).toBe(plain);
    expect(plain).toBe("Trust in the LORD with all thine heart; and lean not unto thine own understanding.");
  });

  it("lists the tagged words in reading order, keyed by verse, item and offset", () => {
    const { words } = buildStrongsPassage(PRO_3.chapter.content, PRO_3_WORDS, ref, PLAIN)!;
    expect(words.map((w) => [w.key, w.english, w.number])).toEqual([
      ["5.0.2", "Trust", "H0982"],
      ["5.0.15", "LORD", "H3068"],
      ["5.0.35", "heart", "H3820"],
      ["5.0.46", "lean", "H8172"],
      ["5.0.70", "understanding", "H0998"],
    ]);
  });

  it("leaves words with no number as plain text between the tagged ones", () => {
    const { text, words } = buildStrongsPassage(PRO_3.chapter.content, PRO_3_WORDS, ref, PLAIN)!;
    const segments = splitMarkedText(text);
    expect(segments).toEqual([
      { index: 0, text: "Trust" },
      " in the ",
      { index: 1, text: "LORD" },
      " with all thine ",
      { index: 2, text: "heart" },
      "; and ",
      { index: 3, text: "lean" },
      " not unto thine own ",
      { index: 4, text: "understanding" },
      ".",
    ]);
    expect(words).toHaveLength(5);
  });

  it("keeps markers intact through verse numbers and ranges", () => {
    const range = parseReference("Proverbs 3:5-6")!;
    const settings = { ...PLAIN, showVerseNumbers: true };
    const passage = buildStrongsPassage(PRO_3.chapter.content, PRO_3_WORDS, range, settings)!;
    const plain = assembleChapterText(PRO_3.chapter.content, computeRequestedVerses(range), range.startVerse, settings);
    expect(stripMarkers(passage.text)).toBe(plain);
    expect(passage.text.startsWith("5. ")).toBe(true);
    expect(passage.words.every((w) => w.verse === 5 || w.verse === 6)).toBe(true);
    expect(passage.words.some((w) => w.verse === 6)).toBe(true);
  });

  it("marks only the requested verses", () => {
    const { words } = markChapterContent(PRO_3.chapter.content, PRO_3_WORDS, new Set([5]), 5);
    expect(new Set(words.map((w) => w.verse))).toEqual(new Set([5]));
  });

  it("uses the first number when a word carries several", () => {
    const content = [{ type: "verse", number: 1, content: ["Holy word here"] }];
    const words: HelloAoWordsResponse = {
      verses: { "1": [{ contentIndex: 0, start: 0, end: 4, strongs: ["G0040", "G9999"] }] },
    };
    const marked = markChapterContent(content, words, null, null);
    expect(marked.words).toEqual([{ key: "1.0.0", verse: 1, english: "Holy", number: "G0040" }]);
  });
});

describe("translation with no words file", () => {
  it("is detected from the chapter payload", () => {
    expect(wordsLinkFor(PRO_3)).toBe("/api/eng_kjv/PRO/3.words.json");
    expect(wordsLinkFor(load("BSB_JHN_3.json"))).toBeNull();
    expect(wordsLinkFor(load("eng_web_JHN_3.json"))).toBeNull();
    expect(wordsLinkFor(null)).toBeNull();
  });
});

describe("lexicon — transliteration choice", () => {
  it("shows ye.ho.vah for H3068, as the API returns it", () => {
    const entry = lexicon("H3068");
    expect(transliterationFor(entry)).toBe("ye.ho.vah");
    expect(chooseSense(entry)!.gloss).toBe("LORD");
    expect(transliterationFor(entry)).not.toMatch(/yahweh/i);
  });

  it("takes the first sense, and its definition, for the Proverbs 3:5 words", () => {
    expect(
      ["H0982", "H3820", "H8172", "H0998"].map((n) => [transliterationFor(lexicon(n)), chooseSense(lexicon(n))!.gloss])
    ).toEqual([
      ["ba.tach", "to trust"],
      ["lev", "heart"],
      ["sha.an", "to lean"],
      ["bi.nah", "understanding"],
    ]);
    expect(chooseSense(lexicon("H3068"))!.definition).toMatch(/^Jehovah = "the existing One"/);
  });

  it("skips a sense with no transliteration, and returns null with none at all", () => {
    const entry: LexiconEntry = {
      id: "H1",
      senses: [{ gloss: "a" }, { transliteration: "ab", gloss: "b" }],
    };
    expect(transliterationFor(entry)).toBe("ab");
    expect(transliterationFor({ id: "H2", senses: [{ gloss: "x" }] })).toBeNull();
    expect(transliterationFor(null)).toBeNull();
  });
});

describe("Insert below", () => {
  it("writes the real gloss, number, transliteration and definition, with the credit", () => {
    const sense = chooseSense(lexicon("H3068"));
    const line = formatInsertLine({ key: "5.0.15", verse: 5, english: "LORD", number: "H3068" }, sense);
    expect(line.startsWith('**LORD** — H3068 *ye.ho.vah* "LORD": Jehovah = "the existing One" 1) the proper name')).toBe(true);
    expect(line).not.toContain("\n");
    expect(line.endsWith(`*(${STRONGS_CREDIT})*`)).toBe(true);
    expect(STRONGS_CREDIT).toBe("STEPBible lexicon, CC BY 4.0, STEPBible.org / Tyndale House");
  });
});

describe("token modifiers — strongs and tr:", () => {
  it("parses `strongs` rather than taking it for a translation code", () => {
    const spec = parseInlineSpec("Proverbs 3:5, strongs")!;
    expect(spec.strongs).toBe(true);
    expect(spec.translations).toEqual([]);
    expect(spec.transliterate).toEqual([]);
  });

  it("parses `tr:` word keys alongside the other modifiers", () => {
    const spec = parseInlineSpec("Proverbs 3:5, KJV, callout, strongs, tr:5.0.15+5.0.2")!;
    expect(spec.translations).toEqual(["KJV"]);
    expect(spec.styleOverride).toBe("callout");
    expect(spec.strongs).toBe(true);
    expect(spec.transliterate).toEqual(["5.0.2", "5.0.15"]);
    expect(strongsActive(spec)).toBe(true);
  });

  it("leaves tokens written before the layer existed exactly as they were", () => {
    for (const t of ["John 3:16", "John 3:16, KJV", "John 3:16, KJV, sidebar, nl, no-v", "John 3:16-21,25, KJV | WEB"]) {
      const spec = parseInlineSpec(t);
      if (!spec) continue;
      expect(spec.strongs).toBe(false);
      expect(spec.transliterate).toEqual([]);
      expect(strongsActive(spec)).toBe(false);
    }
    const spec = parseInlineSpec("John 3:16, KJV, sidebar, nl, no-v")!;
    expect(formatInlineSpec(spec)).toBe("John 3:16, KJV, sidebar, nl, no-v");
  });

  it("round-trips through formatInlineSpec so a reload keeps the substitution", () => {
    const spec = parseInlineSpec("Proverbs 3:5, strongs, tr:5.0.15")!;
    const text = formatInlineSpec(spec);
    expect(text).toBe("Proverbs 3:5, strongs, tr:5.0.15");
    expect(parseInlineSpec(text)).toEqual(spec);
  });

  it("is written and cleared through rewriteToken, keeping the brace form", () => {
    const on = rewriteToken("{{Proverbs 3:5, KJV}}", { strongs: true, transliterate: ["5.0.15"] });
    expect(on).toBe("{{Proverbs 3:5, KJV, strongs, tr:5.0.15}}");
    expect(rewriteToken(on!, { strongs: false, transliterate: [] })).toBe("{{Proverbs 3:5, KJV}}");
  });

  it("refuses a malformed key list", () => {
    expect(parseTransliterateModifier("tr:")).toBeNull();
    expect(parseTransliterateModifier("tr:5.0")).toBeNull();
    expect(parseTransliterateModifier("tr:5.0.15+x")).toBeNull();
    expect(parseTransliterateModifier("trust")).toBeNull();
  });

  it("toggles keys in reading order and drops the modifier when empty", () => {
    expect(toggleKey(["5.0.35"], "5.0.2")).toEqual(["5.0.2", "5.0.35"]);
    expect(toggleKey(["5.0.2", "5.0.35"], "5.0.2")).toEqual(["5.0.35"]);
    expect(formatTransliterateModifier([])).toBeNull();
    expect(formatTransliterateModifier(["6.0.3", "5.0.2"])).toBe("tr:5.0.2+6.0.3");
  });
});

describe("Reading-view edits — locating the token", () => {
  const note = "Intro {Proverbs 3:5, strongs}\n\nLater {Proverbs 3:5, strongs}\n";

  it("prefers the occurrence inside the rendered section", () => {
    expect(locateToken(note, "{Proverbs 3:5, strongs}", { lineStart: 2, lineEnd: 2 })).toBe(note.lastIndexOf("{"));
  });

  it("refuses an ambiguous token when the section is unknown", () => {
    expect(locateToken(note, "{Proverbs 3:5, strongs}", null)).toBeNull();
    expect(locateToken("a {John 1:1, strongs} b", "{John 1:1, strongs}", null)).toBe(2);
  });

  it("never matches an escaped token", () => {
    expect(locateToken("\\{John 1:1, strongs}", "{John 1:1, strongs}", null)).toBeNull();
  });

  it("inserts the line after the token's line, keeping CRLF notes CRLF", () => {
    expect(insertLineAfter("{t}\nnext", 0, "X")).toBe("{t}\nX\nnext");
    expect(insertLineAfter("{t}", 0, "X")).toBe("{t}\nX");
    expect(insertLineAfter("{t}\r\nnext", 0, "X")).toBe("{t}\r\nX\r\nnext");
  });
});
