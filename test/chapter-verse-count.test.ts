import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

function loadChapter(id: string, usfm: string, chapter: number): Record<string, unknown> {
  const raw = readFileSync(join(HERE, "fixtures", "data", `${id}_${usfm}_${chapter}.json`), "utf8");
  return JSON.parse(raw);
}

/**
 * `numberOfVerses` is the upper bound the verse-shift controls clamp against
 * (#49). It has to come off the same chapter payload the plugin already
 * fetches, so pin the field's presence and location against real fixtures.
 */
describe("HelloAO chapter payload — numberOfVerses", () => {
  it("is a top-level number on the chapter response", () => {
    const data = loadChapter("BSB", "JHN", 3);
    expect(typeof data.numberOfVerses).toBe("number");
    expect(data.numberOfVerses).toBe(36);
  });

  it("reports counts that differ between translations of the same chapter", () => {
    // Psalm 23 is 6 verses in most translations but 10 in Douay-Rheims, which
    // counts the superscription — so the bound is genuinely per-translation and
    // cannot be hardcoded per book/chapter.
    expect(loadChapter("BSB", "PSA", 23).numberOfVerses).toBe(6);
    expect(loadChapter("eng_dra", "PSA", 23).numberOfVerses).toBe(10);
  });

  it("is present across every captured translation", () => {
    const translations = [
      "eng_kjv", "BSB", "eng_asv", "eng_web", "eng_net", "eng_dby", "eng_dra",
      "eng_rv5", "eng_ylt", "eng_bbe", "eng_fbv", "eng_lsv", "eng_msb", "eng_gnv", "eng_ojb",
    ];
    for (const id of translations) {
      const data = loadChapter(id, "JHN", 3);
      expect(typeof data.numberOfVerses, `${id} JHN 3`).toBe("number");
    }
  });
});
