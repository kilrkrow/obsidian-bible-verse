import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assembleChapterText,
  computeRequestedVerses,
  formatEsvPassageText,
  isSingleVerse,
  resolveShowVerseNumbers,
} from "../src/format";
import { parseInlineSpec, parseReference } from "../src/parser";
import { Baker } from "../src/baker";
import type { App } from "obsidian";
import type { BibleReference, CachedVerse } from "../src/types";

const HERE = dirname(fileURLToPath(import.meta.url));

function ref(s: string): BibleReference {
  const r = parseReference(s);
  if (!r) throw new Error(`unparseable fixture: ${s}`);
  return r;
}

describe("isSingleVerse — counted on the parsed verse list", () => {
  it.each([
    ["John 3:16", true],
    ["John 3:16-16", true],
    ["John 3:16,16", true],
    ["John 3:16-17", false],
    ["John 3:16,25", false],
    ["John 3:16-21,25", false],
    ["John 3:16-eoc", false],
    ["John 3", false],
  ])("%s → %s", (s, expected) => {
    expect(isSingleVerse(ref(s))).toBe(expected);
  });
});

// ── The override matrix ─────────────────────────────────────────────────────
// global ON/OFF × inline token none/v/no-v × ```bible `numbers:` unset/true/false
// × single verse / range / comma list / whole chapter. Each combination is fed
// through the real parsers (parseInlineSpec for the token, the Baker's block
// extractor for the `numbers:` key) and then the shared resolver.

const SHAPES = [
  { label: "single verse", ref: "John 3:16", single: true },
  { label: "range", ref: "John 3:16-17", single: false },
  { label: "comma list", ref: "John 3:16-21,25", single: false },
  { label: "whole chapter", ref: "John 3", single: false },
] as const;

const TOKENS = [
  { label: "none", suffix: "", value: null },
  { label: "v", suffix: ", v", value: true },
  { label: "no-v", suffix: ", no-v", value: false },
] as const;

const BLOCK_KEYS = [
  { label: "unset", line: "", value: null },
  { label: "true", line: "numbers: true\n", value: true },
  { label: "false", line: "numbers: false\n", value: false },
] as const;

/** The rule from the brief, written independently of the implementation. */
function expected(global: boolean, explicit: boolean | null, single: boolean): boolean {
  if (explicit !== null) return explicit;
  if (single) return false;
  return global;
}

const baker = new Baker({} as App);

describe("resolveShowVerseNumbers — override matrix", () => {
  for (const global of [true, false]) {
    for (const shape of SHAPES) {
      for (const token of TOKENS) {
        for (const key of BLOCK_KEYS) {
          const name = `global ${global ? "ON" : "OFF"} · token ${token.label} · numbers: ${key.label} · ${shape.label}`;
          it(name, () => {
            // Inline path: the token is the only explicit source.
            const spec = parseInlineSpec(`${shape.ref}${token.suffix}`);
            expect(spec).not.toBeNull();
            expect(spec!.showVerseNumbers).toBe(token.value);
            expect(resolveShowVerseNumbers(spec!.ref, spec!.showVerseNumbers, global))
              .toBe(expected(global, token.value, shape.single));

            // Code-block path: the `numbers:` key is the only explicit source.
            const block = "```bible\n" + shape.ref + "\ntranslation: KJV\n" + key.line + "```";
            const [extracted] = baker.extractReferences(block, false);
            expect(extracted.type).toBe("block");
            expect(extracted.showVerseNumbers).toBe(key.value);
            expect(resolveShowVerseNumbers(extracted.ref!, extracted.showVerseNumbers, global))
              .toBe(expected(global, key.value, shape.single));
          });
        }
      }
    }
  }

  it("treats undefined like null (no explicit choice)", () => {
    expect(resolveShowVerseNumbers(ref("John 3:16"), undefined, true)).toBe(false);
    expect(resolveShowVerseNumbers(ref("John 3:16-17"), undefined, true)).toBe(true);
    expect(resolveShowVerseNumbers(ref("John 3:16-17"), undefined, false)).toBe(false);
  });
});

// ── End to end on real text ─────────────────────────────────────────────────

function kjvJohn3(): unknown[] {
  return JSON.parse(
    readFileSync(join(HERE, "fixtures", "data", "eng_kjv_JHN_3.json"), "utf8")
  ).chapter.content;
}

function helloAoText(refStr: string, explicit: boolean | null, global: boolean): string {
  const r = ref(refStr);
  return assembleChapterText(kjvJohn3(), computeRequestedVerses(r), r.startVerse, {
    showVerseNumbers: resolveShowVerseNumbers(r, explicit, global),
    verseNewLine: false,
    paragraphBreaks: false,
  });
}

describe("HelloAO text follows the rule", () => {
  it("setting ON: {John 3:16} has no number", () => {
    expect(helloAoText("John 3:16", null, true)).toMatch(/^For God so loved/);
  });
  it("setting ON: {John 3:16, v} shows 16.", () => {
    expect(helloAoText("John 3:16", true, true)).toMatch(/^16\. \W?For God/);
  });
  it("setting ON: {John 3:16-17} shows 16. and 17.", () => {
    const t = helloAoText("John 3:16-17", null, true);
    expect(t).toMatch(/^16\. /);
    expect(t).toContain(" 17. ");
  });
  it("setting OFF: {John 3:16, v} shows 16.", () => {
    expect(helloAoText("John 3:16", true, false)).toMatch(/^16\. /);
  });
  it("setting OFF: {John 3:16} has no number", () => {
    expect(helloAoText("John 3:16", null, false)).not.toMatch(/\d+\. /);
  });
  it("no-v hides the number under either setting", () => {
    expect(helloAoText("John 3:16", false, true)).not.toMatch(/\d+\. /);
    expect(helloAoText("John 3:16", false, false)).not.toMatch(/\d+\. /);
  });
  it("a comma list keeps today's behaviour", () => {
    const t = helloAoText("John 3:16-21,25", null, true);
    expect(t).toMatch(/^16\. /);
    expect(t).toContain(" 25. ");
    expect(helloAoText("John 3:16-21,25", null, false)).not.toMatch(/\d+\. /);
  });
});

describe("ESV text follows the rule", () => {
  const passages = (slug: string): string[] =>
    JSON.parse(readFileSync(join(HERE, "fixtures", "data", `esv_${slug}.json`), "utf8")).passages;
  const esv = (slug: string, refStr: string, explicit: boolean | null, global: boolean): string =>
    formatEsvPassageText(passages(slug), {
      showVerseNumbers: resolveShowVerseNumbers(ref(refStr), explicit, global),
      verseNewLine: false,
    });

  it("single verse: no number by default, number with v, none with no-v", () => {
    expect(esv("john_3_16", "John 3:16", null, true)).toMatch(/^\W?For God/);
    expect(esv("john_3_16", "John 3:16", null, false)).toMatch(/^\W?For God/);
    expect(esv("john_3_16", "John 3:16", true, false)).toMatch(/^16\. \W?For God/);
    expect(esv("john_3_16", "John 3:16", false, true)).toMatch(/^\W?For God/);
  });
  it("range keeps today's behaviour", () => {
    expect(esv("john_3_16-18", "John 3:16-18", null, true)).toMatch(/^16\. .* 17\. .* 18\. /);
    expect(esv("john_3_16-18", "John 3:16-18", null, false)).not.toMatch(/\d+\. /);
  });
});

describe("bake commands freeze the resolved value", () => {
  const verse = (r: BibleReference): CachedVerse => ({
    reference: r.raw,
    translation: "KJV",
    bibleId: "eng_kjv",
    text: "…",
    copyright: "",
    fetchedAt: 0,
  });

  async function bakedHeader(note: string, globalOn: boolean): Promise<string> {
    const out = await baker.bakeFile(
      note,
      true,
      (r) => Promise.resolve(verse(r)),
      { verseNewLine: false, showVerseNumbers: globalOn }
    );
    return out.split("\n---\n")[0];
  }

  it("{John 3:16} with the setting ON bakes numbers: false", async () => {
    expect(await bakedHeader("{John 3:16}", true)).toContain("numbers: false");
  });
  it("{John 3:16, v} bakes numbers: true under either setting", async () => {
    expect(await bakedHeader("{John 3:16, v}", true)).toContain("numbers: true");
    expect(await bakedHeader("{John 3:16, v}", false)).toContain("numbers: true");
  });
  it("{John 3:16-17} still bakes the global value", async () => {
    expect(await bakedHeader("{John 3:16-17}", true)).toContain("numbers: true");
    expect(await bakedHeader("{John 3:16-17}", false)).toContain("numbers: false");
  });
});
