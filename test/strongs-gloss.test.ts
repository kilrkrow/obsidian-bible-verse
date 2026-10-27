import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  chooseSense,
  formatInsertLine,
  glossMeaning,
  meaningChoice,
  meaningsOf,
  senseMeanings,
  GLOSS_MEANING_LABEL,
  LexiconEntry,
  LexiconSense,
  STRONGS_CREDIT,
} from "../src/strongs";

/**
 * An entry with no numbered meanings offers its gloss as the one meaning, so
 * it can be picked like "1" or "1a" in any other entry. G1383 "testing"
 * (James 1:3, "trying") is the case that was reported.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const lexicon = (n: string) =>
  (JSON.parse(readFileSync(join(HERE, "fixtures", "data", "lexicon", `${n}.json`), "utf8")) as { entry: LexiconEntry })
    .entry;
const sense = (n: string) => chooseSense(lexicon(n));

describe("single gloss — G1383 dokimion, \"testing\"", () => {
  it("has no numbered meanings in its definition", () => {
    expect(meaningsOf(sense("G1383")!.definition)).toEqual([]);
  });

  it("offers the gloss as the one meaning, labelled 1", () => {
    expect(senseMeanings(sense("G1383"))).toEqual([
      { label: "1", depth: 1, text: "testing", verseText: "testing", alternatives: ["testing"], selectable: true },
    ]);
    expect(GLOSS_MEANING_LABEL).toBe("1");
  });

  it("resolves a pick of it, which is what the verse shows and a bake writes", () => {
    expect(meaningChoice(sense("G1383"), "1")).toMatchObject({ alternative: null, verseText: "testing" });
    expect(meaningChoice(sense("G1383"), "1~1")).toMatchObject({ alternative: 1, verseText: "testing" });
    expect(meaningChoice(sense("G1383"), "2")).toBeNull();
    expect(meaningChoice(sense("G1383"), "1a")).toBeNull();
  });

  it("bolds the picked gloss in Insert below, as a numbered pick is bolded", () => {
    const word = { key: "3.0.15", verse: 3, english: "trying", number: "G1383" };
    const plain = formatInsertLine(word, sense("G1383"));
    expect(plain.startsWith('**trying** — G1383 *dokimion* "testing": ')).toBe(true);
    expect(plain.endsWith(`*(${STRONGS_CREDIT})*`)).toBe(true);
    expect(formatInsertLine(word, sense("G1383"), "1")).toBe(plain.replace('"testing"', '"**testing**"'));
    expect(formatInsertLine(word, sense("G1383"), "9")).toBe(plain);
  });
});

describe("single gloss — Hebrew, H0002 av, \"father\"", () => {
  it("offers the gloss as meaning 1", () => {
    expect(senseMeanings(sense("H0002")).map((m) => [m.label, m.text])).toEqual([["1", "father"]]);
    expect(meaningChoice(sense("H0002"), "1")!.verseText).toBe("father");
  });
});

describe("unnumbered gloss of several words — G1672 Hellēn, \"Greek, Gentile\"", () => {
  it("is one meaning whose words can be picked one by one", () => {
    const [m] = senseMeanings(sense("G1672"));
    expect(m).toMatchObject({ label: "1", text: "Greek, Gentile", alternatives: ["Greek", "Gentile"] });
    expect(meaningChoice(sense("G1672"), "1")!.verseText).toBe("Greek, Gentile");
    expect(meaningChoice(sense("G1672"), "1~2")!.verseText).toBe("Gentile");
    expect(meaningChoice(sense("G1672"), "1~3")).toBeNull();
  });
});

describe("numbered meanings — unchanged, the gloss is not added", () => {
  it.each([
    ["H1870", 8, "way, road, distance, journey, manner"],
    ["H7911", 7, "to forget, ignore, wither"],
    ["H0982", 6, "to trust"],
    ["G0026", 0, null],
  ])("%s keeps exactly its numbered meanings", (n, _count, first) => {
    const s = sense(n);
    expect(glossMeaning(s)).toBeNull();
    expect(senseMeanings(s)).toEqual(meaningsOf(s!.definition));
    expect(senseMeanings(s).length).toBeGreaterThan(0);
    if (first) expect(senseMeanings(s)[0].text).toBe(first);
  });

  it("still resolves numbered picks exactly as before", () => {
    expect(meaningChoice(sense("H1870"), "1b")!.verseText).toBe("journey");
    expect(meaningChoice(sense("H7911"), "1~2")!.verseText).toBe("ignore");
  });
});

describe("gloss meaning — edge cases", () => {
  const make = (s: LexiconSense): LexiconSense => s;

  it("is null with no gloss, or a blank one", () => {
    expect(glossMeaning(null)).toBeNull();
    expect(glossMeaning(make({ definition: "a note" }))).toBeNull();
    expect(glossMeaning(make({ gloss: "  ", definition: "a note" }))).toBeNull();
  });

  it("keeps the gloss as written, bar trailing punctuation", () => {
    expect(glossMeaning(make({ gloss: "(Mount) Sinai" }))!.text).toBe("(Mount) Sinai");
    expect(glossMeaning(make({ gloss: "to test." }))).toMatchObject({ text: "to test", verseText: "test" });
  });

  it("works with no definition at all", () => {
    expect(senseMeanings(make({ gloss: "testing" })).map((m) => m.label)).toEqual(["1"]);
  });

  it("stands aside when a definition line is already labelled 1", () => {
    // A bare stem heading, "1) (Qal)", is not a meaning but owns the label.
    expect(glossMeaning(make({ gloss: "to go", definition: "1) (Qal)" }))).toBeNull();
  });
});
