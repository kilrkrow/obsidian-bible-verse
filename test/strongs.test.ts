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
  definitionLines,
  formatMeaningsModifier,
  isAdapted,
  choiceLabel,
  meaningChoice,
  meaningFor,
  meaningVerseText,
  parseChoiceLabel,
  splitAlternatives,
  meaningsOf,
  parseMeaningsModifier,
  setWordDisplay,
  wordDisplayOf,
  HelloAoWordsResponse,
  LexiconEntry,
  WordDisplayState,
  STRONGS_CREDIT,
} from "../src/strongs";
import { assembleChapterText, computeRequestedVerses } from "../src/format";
import { formatInlineSpec, parseInlineSpec, parseReference } from "../src/parser";
import { insertLineAfter, locateToken, rewriteToken } from "../src/shift";
import { DEFAULT_SETTINGS } from "../src/types";

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

describe("meanings — numbered senses in a definition", () => {
  it("reads the Hebrew numbering, as in H1870 for \"ways\" in Proverbs 3:6", () => {
    const meanings = meaningsOf(chooseSense(lexicon("H1870"))!.definition);
    expect(meanings.map((m) => [m.label, m.depth, m.text])).toEqual([
      ["1", 1, "way, road, distance, journey, manner"],
      ["1a", 2, "road, way, path"],
      ["1b", 2, "journey"],
      ["1c", 2, "direction"],
      ["1d", 2, "manner, habit, way"],
      ["1e", 2, "of course of life (fig.)"],
      ["1f", 2, "of moral character (fig.)"],
    ]);
  });

  it("keeps the unnumbered lead-in as plain text", () => {
    const lines = definitionLines(chooseSense(lexicon("H1870"))!.definition);
    expect(lines[0]).toEqual({ text: ": conduct/lifestyle", meaning: null });
  });

  it("offers verb stems as headings, not as meanings, and drops source tags", () => {
    const lines = definitionLines(chooseSense(lexicon("H0982"))!.definition).filter((l) => l.meaning);
    const qal = lines.find((l) => l.meaning!.label === "1a")!;
    expect(qal.text).toBe("1a) (Qal)");
    expect(qal.meaning!.selectable).toBe(false);
    expect(meaningsOf(chooseSense(lexicon("H0982"))!.definition).map((m) => m.label)).toEqual([
      "1", "1a1", "1a2", "1a3", "1a4", "1b1", "2",
    ]);
    expect(meaningFor(chooseSense(lexicon("H0982")), "2")!.text).toBe("to feel safe, be careless");
    expect(meaningFor(chooseSense(lexicon("H0982")), "1a3")!.depth).toBe(3);
  });

  it("reads the Greek numbering and trims the verse citations", () => {
    const meanings = meaningsOf(chooseSense(lexicon("G0026"))!.definition);
    expect(meanings.slice(0, 5).map((m) => [m.label, m.text])).toEqual([
      ["1", "Of men's love"],
      ["1a", "to one another"],
      ["1b", "to God"],
      ["2", "Of divine love"],
      ["2a", "God's love: to men"],
    ]);
  });

  it("labels Greek meanings under a roman numeral with it", () => {
    const def = "__I. Of speech.\n\n__1. a word: Mat.8:8\n\n__(a) a saying, Luk.1:29\n\n__II. Of reason.";
    expect(meaningsOf(def).map((m) => [m.label, m.depth, m.text])).toEqual([
      ["I", 1, "Of speech"],
      ["I.1", 2, "a word"],
      ["I.1a", 3, "a saying"],
      ["II", 1, "Of reason"],
    ]);
  });

  it("finds nothing in a definition with no numbering", () => {
    expect(meaningsOf("goodness, kindness, faithfulness")).toEqual([]);
    expect(meaningsOf(undefined)).toEqual([]);
    expect(meaningFor(null, "1")).toBeNull();
  });
});

describe("meanings — what a word shows", () => {
  const empty: WordDisplayState = { transliterate: [], meanings: {} };

  it("shows one thing per word, clearing the other choice", () => {
    let state = setWordDisplay(empty, "6.0.10", { kind: "transliteration" });
    expect(wordDisplayOf(state, "6.0.10")).toEqual({ kind: "transliteration" });

    state = setWordDisplay(state, "6.0.10", { kind: "meaning", label: "1b" });
    expect(state).toEqual({ transliterate: [], meanings: { "6.0.10": "1b" } });
    expect(isAdapted(state)).toBe(true);

    state = setWordDisplay(state, "6.0.10", { kind: "english" });
    expect(state).toEqual(empty);
    expect(isAdapted(state)).toBe(false);
  });

  it("prefers the meaning when a hand-edited token lists a word in both", () => {
    const state = { transliterate: ["5.0.15"], meanings: { "5.0.15": "1" } };
    expect(wordDisplayOf(state, "5.0.15")).toEqual({ kind: "meaning", label: "1" });
  });

  it("finds the Proverbs 3:6 \"ways\" word it applies to", () => {
    const ref = parseReference("Proverbs 3:6")!;
    const ways = buildStrongsPassage(PRO_3.chapter.content, PRO_3_WORDS, ref, PLAIN)!.words.find((w) => w.english === "ways")!;
    expect(ways.number).toBe("H1870");
    expect(meaningFor(chooseSense(lexicon(ways.number)), "1b")!.text).toBe("journey");
  });

  it("drops the leading infinitive \"to\" from what the verse shows, and only that", () => {
    expect(meaningVerseText("to cease to care")).toBe("cease to care");
    expect(meaningVerseText("to guard, watch, watch over, keep")).toBe("guard, watch, watch over, keep");
    expect(meaningVerseText("To trust")).toBe("trust");
    expect(meaningVerseText("toward the sea")).toBe("toward the sea");
    expect(meaningVerseText("to")).toBe("to");
    expect(meaningVerseText("journey")).toBe("journey");
  });

  it("keeps the lexicon's own wording for the popover and Insert below", () => {
    const m = meaningFor(chooseSense(lexicon("H0982")), "1a1")!;
    expect(m.text).toBe("to trust, trust in");
    expect(m.verseText).toBe("trust, trust in");
    const word = { key: "5.0.2", verse: 5, english: "Trust", number: "H0982" };
    expect(formatInsertLine(word, chooseSense(lexicon("H0982")), "1a1")).toContain(" **1a1) to trust, trust in** ");
  });
});

describe("meanings — the mn: token modifier", () => {
  it("parses key=label pairs next to the other modifiers", () => {
    const spec = parseInlineSpec("Proverbs 3:5-6, strongs, tr:5.0.15, mn:6.0.10=1b+5.0.35=1")!;
    expect(spec.transliterate).toEqual(["5.0.15"]);
    expect(spec.meanings).toEqual({ "5.0.35": "1", "6.0.10": "1b" });
    expect(Object.keys(spec.meanings)).toEqual(["5.0.35", "6.0.10"]);
  });

  it("accepts Greek labels with a roman numeral", () => {
    expect(parseMeaningsModifier("mn:1.0.4=I.2b")).toEqual({ "1.0.4": "I.2b" });
  });

  it("round-trips so a reload keeps the chosen meaning", () => {
    const spec = parseInlineSpec("Proverbs 3:6, strongs, mn:6.0.10=1b")!;
    expect(formatInlineSpec(spec)).toBe("Proverbs 3:6, strongs, mn:6.0.10=1b");
    expect(parseInlineSpec(formatInlineSpec(spec))).toEqual(spec);
  });

  it("is written and cleared through rewriteToken", () => {
    const on = rewriteToken("{Proverbs 3:6}", { strongs: true, meanings: { "6.0.10": "1b" } });
    expect(on).toBe("{Proverbs 3:6, strongs, mn:6.0.10=1b}");
    expect(rewriteToken(on!, { strongs: false, transliterate: [], meanings: {} })).toBe("{Proverbs 3:6}");
  });

  it("keeps the layer on from a meaning alone", () => {
    expect(strongsActive(parseInlineSpec("Proverbs 3:6, mn:6.0.10=1b")!)).toBe(true);
  });

  it("leaves earlier tokens, including #71's tr:, unchanged", () => {
    expect(parseInlineSpec("John 3:16, KJV, nl")!.meanings).toEqual({});
    const tr = parseInlineSpec("Proverbs 3:5, strongs, tr:5.0.15")!;
    expect(tr.meanings).toEqual({});
    expect(formatInlineSpec(tr)).toBe("Proverbs 3:5, strongs, tr:5.0.15");
  });

  it("refuses a malformed list", () => {
    expect(parseMeaningsModifier("mn:")).toBeNull();
    expect(parseMeaningsModifier("mn:6.0.10")).toBeNull();
    expect(parseMeaningsModifier("mn:6.0.10=1b=2")).toBeNull();
    expect(parseMeaningsModifier("mn:6.0=1b")).toBeNull();
    expect(parseMeaningsModifier("mn:6.0.10=(Qal)")).toBeNull();
    expect(formatMeaningsModifier({})).toBeNull();
  });
});

describe("meanings — Insert below", () => {
  const sense = chooseSense(lexicon("H1870"));
  const word = { key: "6.0.10", verse: 6, english: "ways", number: "H1870" };
  const full =
    ": conduct/lifestyle 1) way, road, distance, journey, manner 1a) road, way, path 1b) journey " +
    "1c) direction 1d) manner, habit, way 1e) of course of life (fig.) 1f) of moral character (fig.)";

  it("always writes the whole entry, since inserting is for study", () => {
    expect(formatInsertLine(word, sense)).toBe(`**ways** — H1870 *de.rekh* "way: conduct": ${full} *(${STRONGS_CREDIT})*`);
  });

  it("bolds the meaning chosen in the verse within the whole entry", () => {
    expect(formatInsertLine(word, sense, "1b")).toBe(
      `**ways** — H1870 *de.rekh* "way: conduct": ${full.replace("1b) journey", "**1b) journey**")} *(${STRONGS_CREDIT})*`
    );
    expect(formatInsertLine(word, sense, "9z")).toBe(formatInsertLine(word, sense));
  });

  it("leaves no Greek \"__\" markers for markdown to read as emphasis", () => {
    const line = formatInsertLine({ key: "1.0.0", verse: 1, english: "love", number: "G0026" }, chooseSense(lexicon("G0026")));
    expect(line).not.toContain("__");
    expect(line).toContain("1. Of men's love: (a) to one another, Jhn.13:35;");
  });
});

describe("word picks — one word from a meaning", () => {
  const forget = () => chooseSense(lexicon("H7911"));

  it("splits a meaning into its alternatives, in the lexicon's wording", () => {
    const m = meaningFor(forget(), "1")!;
    expect(m.text).toBe("to forget, ignore, wither");
    expect(m.alternatives).toEqual(["to forget", "ignore", "wither"]);
    expect(meaningFor(forget(), "1a2")!.alternatives).toEqual(["to cease to care"]);
  });

  it("does not split on commas inside brackets", () => {
    expect(splitAlternatives('a word (λόγος, ῥῆμα), a saying')).toEqual(["a word (λόγος, ῥῆμα)", "a saying"]);
    expect(splitAlternatives("one [two, three], four")).toEqual(["one [two, three]", "four"]);
    expect(splitAlternatives("journey")).toEqual(["journey"]);
  });

  it("resolves a whole line or one alternative, as the verse shows it", () => {
    expect(meaningChoice(forget(), "1")).toMatchObject({ alternative: null, verseText: "forget, ignore, wither" });
    expect(meaningChoice(forget(), "1~1")).toMatchObject({ alternative: 1, verseText: "forget" });
    expect(meaningChoice(forget(), "1~2")).toMatchObject({ alternative: 2, verseText: "ignore" });
    expect(meaningChoice(forget(), "1~2")!.meaning.label).toBe("1");
  });

  it("refuses an alternative that is not there", () => {
    expect(meaningChoice(forget(), "1~4")).toBeNull();
    expect(meaningChoice(forget(), "1~0")).toBeNull();
    expect(meaningChoice(forget(), "9~1")).toBeNull();
  });

  it("reads verb stems before a meaning as tags, not as the meaning", () => {
    expect(meaningChoice(forget(), "1b")!.verseText).toBe("be forgotten");
  });

  it("builds and splits choice labels", () => {
    expect(choiceLabel("1", null)).toBe("1");
    expect(choiceLabel("1", 2)).toBe("1~2");
    expect(parseChoiceLabel("1~2")).toEqual({ line: "1", alternative: 2 });
    expect(parseChoiceLabel("I.2b")).toEqual({ line: "I.2b", alternative: null });
    expect(parseChoiceLabel("I.2b~3")).toEqual({ line: "I.2b", alternative: 3 });
  });

  it("stores a word pick in mn: and reads it back", () => {
    const spec = parseInlineSpec("Proverbs 3:1, strongs, mn:1.0.8=1~2")!;
    expect(spec.meanings).toEqual({ "1.0.8": "1~2" });
    expect(formatInlineSpec(spec)).toBe("Proverbs 3:1, strongs, mn:1.0.8=1~2");
    expect(parseMeaningsModifier("mn:1.0.8=I.2b~3")).toEqual({ "1.0.8": "I.2b~3" });
    expect(parseMeaningsModifier("mn:1.0.8=1~")).toBeNull();
    expect(parseMeaningsModifier("mn:1.0.8=1~x")).toBeNull();
  });

  it("bolds the whole line a word was picked from in Insert below", () => {
    const word = { key: "1.0.8", verse: 1, english: "forget", number: "H7911" };
    const line = formatInsertLine(word, forget(), "1~2");
    expect(line).toContain(": **1) to forget, ignore, wither** 1a) (Qal) 1a1) to forget");
    expect(line).toContain("Aramaic equivalent");
    expect(line.endsWith(`*(${STRONGS_CREDIT})*`)).toBe(true);
  });
});

describe("word picks — setting", () => {
  it("is off by default", () => {
    expect(DEFAULT_SETTINGS.strongsWordPicks).toBe(false);
  });
});
