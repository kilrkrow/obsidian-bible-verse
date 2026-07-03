import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assembleChapterText, computeRequestedVerses } from "../src/format";
import type { BibleReference } from "../src/types";

const HERE = dirname(fileURLToPath(import.meta.url));

// The 15 free HelloAO translations, matching the fixtures captured by capture.mjs.
const TRANSLATIONS = [
  "eng_kjv", "BSB", "eng_asv", "eng_web", "eng_net", "eng_dby", "eng_dra",
  "eng_rv5", "eng_ylt", "eng_bbe", "eng_fbv", "eng_lsv", "eng_msb", "eng_gnv", "eng_ojb",
];

function loadChapter(id: string, usfm: string, chapter: number): unknown[] {
  const raw = readFileSync(join(HERE, "fixtures", "data", `${id}_${usfm}_${chapter}.json`), "utf8");
  return JSON.parse(raw).chapter.content;
}

function ref(partial: Partial<BibleReference> & { book: string; chapter: number }): BibleReference {
  return {
    startVerse: null,
    endVerse: null,
    additionalVerses: [],
    endChapter: null,
    raw: "",
    ...partial,
  };
}

// Selections chosen to exercise: single verse, contiguous range, non-contiguous,
// whole-chapter poetry (implicit line breaks), and a KJV ¶-paragraph passage.
const SELECTIONS = [
  { label: "John 3:16 (single)",           usfm: "JHN", chapter: 3, ref: ref({ book: "John", chapter: 3, startVerse: 16 }) },
  { label: "John 3:16-18 (range)",         usfm: "JHN", chapter: 3, ref: ref({ book: "John", chapter: 3, startVerse: 16, endVerse: 18 }) },
  { label: "John 3:16,18 (non-contiguous)", usfm: "JHN", chapter: 3, ref: ref({ book: "John", chapter: 3, startVerse: 16, additionalVerses: [18] }) },
  { label: "Psalm 23 (whole chapter)",     usfm: "PSA", chapter: 23, ref: ref({ book: "Psalms", chapter: 23 }) },
  { label: "Luke 19:27-30 (para markers)", usfm: "LUK", chapter: 19, ref: ref({ book: "Luke", chapter: 19, startVerse: 27, endVerse: 30 }) },
];

// The full 2x2x2 formatting matrix.
const COMBOS = [false, true].flatMap((v) =>
  [false, true].flatMap((nl) =>
    [false, true].map((para) => ({
      showVerseNumbers: v,
      verseNewLine: nl,
      paragraphBreaks: para,
      label: `v=${v ? "on" : "off"} nl=${nl ? "on" : "off"} para=${para ? "on" : "off"}`,
    }))
  )
);

describe("verse formatting matrix", () => {
  for (const id of TRANSLATIONS) {
    it(`${id} — all selections × all format combos`, () => {
      const blocks: string[] = [`=== ${id} ===`];
      for (const sel of SELECTIONS) {
        const content = loadChapter(id, sel.usfm, sel.chapter);
        const requested = computeRequestedVerses(sel.ref);
        blocks.push(`\n--- ${sel.label} ---`);
        for (const combo of COMBOS) {
          const text = assembleChapterText(content, requested, sel.ref.startVerse, combo);
          blocks.push(`[${combo.label}]\n${text}`);
        }
      }
      expect(blocks.join("\n")).toMatchSnapshot();
    });
  }
});
