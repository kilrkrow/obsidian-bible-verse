import { describe, it, expect } from "vitest";
import { parseReference } from "../src/parser";
import { makeLinkOnlyVerse, isLinkOnlyVerse, sameCachedVerses } from "../src/comparison";
import { generateLink } from "../src/linker";
import type { CachedVerse } from "../src/types";

/**
 * Comparisons that mix full-text and link-only translations (#76 follow-up).
 * Reading view and Live Preview both build columns via loadComparisonVerses
 * and draw them with renderComparison; these tests cover the shared helpers
 * and the column-resolution rules both paths use.
 */

const ref = parseReference("Romans 8:28")!;

function textVerse(translation: string, text: string): CachedVerse {
  return {
    reference: "Romans 8:28",
    translation,
    bibleId: translation === "KJV" ? "eng_kjv" : translation,
    text,
    copyright: "",
    fetchedAt: Date.now(),
  };
}

describe("makeLinkOnlyVerse / sameCachedVerses", () => {
  it("marks a link-only sentinel", () => {
    const v = makeLinkOnlyVerse(ref, "NIV", "NIV");
    expect(isLinkOnlyVerse(v)).toBe(true);
    expect(v.text).toBe("");
    expect(v.translation).toBe("NIV");
    expect(v.reference).toBe("Romans 8:28");
  });

  it("compares link-only columns by translation, text columns by identity", () => {
    const kjv = textVerse("KJV", "And we know...");
    const niv = makeLinkOnlyVerse(ref, "NIV", "NIV");
    expect(sameCachedVerses([kjv, niv], [kjv, makeLinkOnlyVerse(ref, "NIV", "NIV")])).toBe(true);
    expect(sameCachedVerses([kjv, niv], [kjv, makeLinkOnlyVerse(ref, "NLT", "NLT")])).toBe(false);
    expect(sameCachedVerses([kjv], [textVerse("KJV", "And we know...")])).toBe(false);
  });
});

describe("link target for a comparison link-only column", () => {
  it("matches the URL a single link-only ref would use", () => {
    const href = generateLink(ref, "NIV", "BibleGateway");
    expect(href).toBe(
      "https://www.biblegateway.com/passage/?search=Romans+8%3A28&version=NIV"
    );
  });
});

describe("comparison column resolution (shared by Reading and Live Preview)", () => {
  /**
   * Mirrors BibleVersePlugin.loadComparisonVerses without spinning up Obsidian:
   * link-only codes become sentinels; text codes are fetched; fetch failures drop.
   */
  async function resolveColumns(
    translations: string[],
    linkOnly: Set<string>,
    fetchText: (abbr: string) => Promise<CachedVerse>
  ): Promise<CachedVerse[]> {
    const out: CachedVerse[] = [];
    for (const trans of translations) {
      const abbr = trans.toUpperCase();
      if (linkOnly.has(abbr)) {
        out.push(makeLinkOnlyVerse(ref, abbr, abbr));
        continue;
      }
      try {
        out.push(await fetchText(abbr));
      } catch {
        /* skip failed text fetch */
      }
    }
    return out;
  }

  const linkOnly = new Set(["NIV", "NLT", "NKJV", "NASB", "AMP", "CSB"]);

  it("full + full keeps both text columns", async () => {
    const cols = await resolveColumns(["KJV", "WEB"], linkOnly, async (abbr) =>
      textVerse(abbr, `${abbr} text`)
    );
    expect(cols.map((c) => c.translation)).toEqual(["KJV", "WEB"]);
    expect(cols.every((c) => !isLinkOnlyVerse(c))).toBe(true);
  });

  it("full + link-only keeps the text column and a NIV sentinel", async () => {
    const cols = await resolveColumns(["KJV", "NIV"], linkOnly, async (abbr) =>
      textVerse(abbr, `${abbr} text`)
    );
    expect(cols).toHaveLength(2);
    expect(isLinkOnlyVerse(cols[0])).toBe(false);
    expect(cols[0].text).toContain("KJV");
    expect(isLinkOnlyVerse(cols[1])).toBe(true);
    expect(cols[1].translation).toBe("NIV");
    expect(generateLink(ref, cols[1].translation, "BibleGateway")).toContain("version=NIV");
  });

  it("link-only + link-only keeps a sentinel for every translation", async () => {
    const cols = await resolveColumns(["NIV", "NLT"], linkOnly, async () => {
      throw new Error("should not fetch");
    });
    expect(cols).toHaveLength(2);
    expect(cols.every(isLinkOnlyVerse)).toBe(true);
    expect(cols.map((c) => c.translation)).toEqual(["NIV", "NLT"]);
  });
});