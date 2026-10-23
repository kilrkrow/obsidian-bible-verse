import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Baker, formatCalloutBake, formatCodeBlockBake } from "../src/baker";
import {
  adaptedText,
  buildStrongsPassage,
  formatStrongsHeader,
  parseStrongsHeader,
  strongsTranslationLabel,
  HelloAoWordsResponse,
  STRONGS_CREDIT,
  WordDisplayState,
} from "../src/strongs";
import { parseReference } from "../src/parser";
import type { App } from "obsidian";
import type { BibleReference, CachedVerse } from "../src/types";

/**
 * Baking a Strong's verse must write what the screen shows (#69 follow-up):
 * `{Proverbs 3:5, strongs, tr:5.0.15, bake}` used to bake the plain King James
 * text, silently dropping every transliteration and meaning the user picked.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, "fixtures", "data");
const PRO_3 = JSON.parse(readFileSync(join(DATA, "eng_kjv_PRO_3.json"), "utf8")) as { chapter: { content: unknown[] } };
const PRO_3_WORDS = JSON.parse(readFileSync(join(DATA, "eng_kjv_PRO_3.words.json"), "utf8")) as HelloAoWordsResponse;
const PLAIN = { showVerseNumbers: false, verseNewLine: false, paragraphBreaks: false };

function passage(refStr: string) {
  return buildStrongsPassage(PRO_3.chapter.content, PRO_3_WORDS, parseReference(refStr)!, PLAIN)!;
}

function verse(partial: Partial<CachedVerse> = {}): CachedVerse {
  return {
    reference: "Proverbs 3:5",
    translation: "KJV",
    bibleId: "eng_kjv",
    text: "Trust in the LORD with all thine heart; and lean not unto thine own understanding.",
    copyright: "",
    fetchedAt: 0,
    ...partial,
  };
}

describe("adaptedText — the verse as the screen shows it", () => {
  it("writes a transliteration in italics and a meaning in corner brackets", () => {
    const state: WordDisplayState = { transliterate: ["5.0.15"], meanings: { "5.0.35": "1" } };
    const text = adaptedText(
      passage("Proverbs 3:5"),
      state,
      new Map([["5.0.15", "ye.ho.vah"]]),
      new Map([["5.0.35", "inner man, mind, will, heart, understanding"]])
    );
    expect(text).toBe(
      "Trust in the *ye.ho.vah* with all thine ⌜inner man, mind, will, heart, understanding⌝; and lean not unto thine own understanding."
    );
  });

  it("keeps the English for unchanged words, and for a change whose text is missing", () => {
    const state: WordDisplayState = { transliterate: ["5.0.15"], meanings: {} };
    expect(adaptedText(passage("Proverbs 3:5"), state, new Map(), new Map())).toBe(
      "Trust in the LORD with all thine heart; and lean not unto thine own understanding."
    );
  });

  it("works across verse numbers and a range", () => {
    const settings = { ...PLAIN, showVerseNumbers: true };
    const p = buildStrongsPassage(PRO_3.chapter.content, PRO_3_WORDS, parseReference("Proverbs 3:5-6")!, settings)!;
    const text = adaptedText(p, { transliterate: [], meanings: { "6.0.11": "1b" } }, new Map(), new Map([["6.0.11", "journey"]]));
    expect(text).toContain("5. Trust in the LORD");
    expect(text).toContain("6. In all thy ⌜journey⌝ acknowledge him");
  });
});

describe("the KJV-Strong's label", () => {
  it("names the translation as adapted", () => {
    expect(strongsTranslationLabel("KJV")).toBe("KJV-Strong's");
  });
});

describe("strongs: header — choices that survive a refresh", () => {
  it("round-trips transliterations and meanings, keeping label case", () => {
    const state: WordDisplayState = { transliterate: ["5.0.15"], meanings: { "6.0.11": "1b", "1.0.4": "I.2b~3" } };
    const header = formatStrongsHeader(state)!;
    expect(header).toBe("tr:5.0.15 mn:1.0.4=I.2b~3+6.0.11=1b");
    expect(parseStrongsHeader(header)).toEqual({
      transliterate: ["5.0.15"],
      meanings: { "1.0.4": "I.2b~3", "6.0.11": "1b" },
    });
  });

  it("records nothing when no word is changed", () => {
    expect(formatStrongsHeader({ transliterate: [], meanings: {} })).toBeNull();
    expect(parseStrongsHeader("")).toBeNull();
    expect(parseStrongsHeader("on")).toBeNull();
  });

  it("is written into a baked code block, with the lexicon credit for readers without the plugin", () => {
    expect(formatCodeBlockBake(verse(), { strongs: "tr:5.0.15" })).toBe(
      "```bible\nProverbs 3:5\ntranslation: KJV\nstrongs: tr:5.0.15\nlexicon: " + STRONGS_CREDIT +
        "\n\n---\n" + verse().text + "\n```"
    );
    expect(formatCodeBlockBake(verse())).not.toContain("strongs:");
    expect(formatCodeBlockBake(verse())).not.toContain("lexicon:");
  });

  it("keeps the real translation in the header, so a refresh fetches from it", () => {
    const block = formatCodeBlockBake(verse({ label: "KJV-Strong's" }), { strongs: "tr:5.0.15" });
    expect(block).toContain("\ntranslation: KJV\n");
  });

  it("labels a native-callout bake KJV-Strong's and credits the lexicon", () => {
    const adapted = verse({
      text: "Trust in the *ye.ho.vah*",
      label: "KJV-Strong's",
      copyright: STRONGS_CREDIT,
      requireAttribution: true,
    });
    expect(formatCalloutBake(adapted, "quote", false, "https://example.org")).toBe(
      "> [!quote]+ [Proverbs 3:5 (KJV-Strong's)](https://example.org)\n> Trust in the *ye.ho.vah*\n>\n> " + STRONGS_CREDIT
    );
  });

  it("leaves an ordinary callout bake labelled with its translation", () => {
    expect(formatCalloutBake(verse(), "quote", false, "u").startsWith("> [!quote]+ [Proverbs 3:5 (KJV)](u)")).toBe(true);
  });
});

describe("Baker — passing the choices through", () => {
  const baker = new Baker({} as App);

  it("reads the choices from an inline token", () => {
    const [ref] = baker.extractReferences("Note {Proverbs 3:5, strongs, tr:5.0.15, mn:5.0.35=1} end", true);
    expect(ref.words).toEqual({ transliterate: ["5.0.15"], meanings: { "5.0.35": "1" } });
  });

  it("reads no choices from a token that changes no word", () => {
    expect(baker.extractReferences("{Proverbs 3:5, strongs}", true)[0].words).toBeNull();
    expect(baker.extractReferences("{John 3:16}", true)[0].words).toBeNull();
  });

  it("reads the choices from a baked block's header, as written", () => {
    const block = "```bible\nProverbs 3:5\ntranslation: KJV\nstrongs: mn:5.0.35=I.2b\n\n---\nold text\n```";
    const [ref] = baker.extractReferences(block, false);
    expect(ref.words).toEqual({ transliterate: [], meanings: { "5.0.35": "I.2b" } });
  });

  it("bakes an inline Strong's token with its choices, and records them", async () => {
    const seen: (WordDisplayState | undefined)[] = [];
    const fetch = async (_ref: BibleReference, _t?: string, _a?: string, _nl?: boolean, _vn?: boolean, words?: WordDisplayState) => {
      seen.push(words);
      return verse({ text: "Trust in the *ye.ho.vah* with all thine heart" });
    };
    const out = await baker.bakeFile("{Proverbs 3:5, strongs, tr:5.0.15}", true, fetch);
    expect(seen).toEqual([{ transliterate: ["5.0.15"], meanings: {} }]);
    expect(out).toContain("strongs: tr:5.0.15");
    expect(out).toContain("Trust in the *ye.ho.vah* with all thine heart");
  });

  it("re-applies a block's recorded choices on refresh", async () => {
    const seen: (WordDisplayState | undefined)[] = [];
    const fetch = async (_ref: BibleReference, _t?: string, _a?: string, _nl?: boolean, _vn?: boolean, words?: WordDisplayState) => {
      seen.push(words);
      return verse({ text: "fresh adapted text" });
    };
    const stripped = baker.stripBakedText(
      "```bible\nProverbs 3:5\ntranslation: KJV\nstrongs: tr:5.0.15\n\n---\nold text\n```"
    );
    const out = await baker.bakeFile(stripped, false, fetch);
    expect(seen).toEqual([{ transliterate: ["5.0.15"], meanings: {} }]);
    expect(out).toBe("```bible\nProverbs 3:5\ntranslation: KJV\nstrongs: tr:5.0.15\n\n---\nfresh adapted text\n```");
  });

  it("passes no choices for an ordinary verse", async () => {
    const seen: (WordDisplayState | undefined)[] = [];
    const fetch = async (_ref: BibleReference, _t?: string, _a?: string, _nl?: boolean, _vn?: boolean, words?: WordDisplayState) => {
      seen.push(words);
      return verse({ reference: "John 3:16", text: "For God so loved the world" });
    };
    const out = await baker.bakeFile("{John 3:16}", true, fetch);
    expect(seen).toEqual([undefined]);
    expect(out).not.toContain("strongs:");
  });
});
