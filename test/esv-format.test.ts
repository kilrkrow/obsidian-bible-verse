import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatEsvPassageText } from "../src/format";

const HERE = dirname(fileURLToPath(import.meta.url));

function loadPassages(slug: string): string[] {
  return JSON.parse(readFileSync(join(HERE, "fixtures", "data", `esv_${slug}.json`), "utf8")).passages;
}

const SELECTIONS = [
  { label: "John 3:16 (single)",            slug: "john_3_16" },
  { label: "John 3:16-18 (range)",          slug: "john_3_16-18" },
  { label: "John 3:16,18 (non-contiguous)", slug: "john_3_16_18" },
  { label: "Psalm 23 (whole chapter)",      slug: "psalm_23" },
  { label: "Luke 19:27-30 (range)",         slug: "luke_19_27-30" },
];

// ESV has no "paragraph sections" concept, so only verse-numbers × new-line vary.
const COMBOS = [false, true].flatMap((v) =>
  [false, true].map((nl) => ({
    showVerseNumbers: v,
    verseNewLine: nl,
    label: `v=${v ? "on" : "off"} nl=${nl ? "on" : "off"}`,
  }))
);

describe("ESV formatting matrix", () => {
  it("ESV — all selections × format combos", () => {
    const blocks: string[] = ["=== ESV ==="];
    for (const sel of SELECTIONS) {
      blocks.push(`\n--- ${sel.label} ---`);
      const passages = loadPassages(sel.slug);
      for (const combo of COMBOS) {
        const text = formatEsvPassageText(passages, combo);
        blocks.push(`[${combo.label}]\n${text}`);
      }
    }
    expect(blocks.join("\n")).toMatchSnapshot();
  });
});
