import { describe, it, expect } from "vitest";
import { formatCodeBlockBake } from "../src/baker";
import type { CachedVerse } from "../src/types";

function verse(partial: Partial<CachedVerse>): CachedVerse {
  return {
    reference: "John 3:16",
    translation: "KJV",
    bibleId: "eng_kjv",
    text: "For God so loved the world...",
    copyright: "",
    fetchedAt: 0,
    ...partial,
  };
}

describe("formatCodeBlockBake", () => {
  it("without opts, emits the legacy block format (back-compat)", () => {
    expect(formatCodeBlockBake(verse({}))).toBe(
      "```bible\nJohn 3:16\ntranslation: KJV\n\n---\nFor God so loved the world...\n```"
    );
  });

  it("freezes newline/numbers flags into the header (#37)", () => {
    const v = verse({
      reference: "Luke 24:1-2",
      translation: "ESV",
      text: "1. But on the first day of the week...\n2. And they found the stone rolled away...",
    });
    const block = formatCodeBlockBake(v, { verseNewLine: true, showVerseNumbers: true });
    const header = block.split("\n---\n")[0];
    expect(header).toContain("newline: true");
    expect(header).toContain("numbers: true");
    // Baked text keeps its per-verse newlines below the separator.
    expect(block.split("\n---\n")[1]).toContain("...\n2. ");
  });

  it("freezes explicit false values too", () => {
    const header = formatCodeBlockBake(verse({}), { verseNewLine: false, showVerseNumbers: false }).split("\n---\n")[0];
    expect(header).toContain("newline: false");
    expect(header).toContain("numbers: false");
  });

  it("emits style only when provided", () => {
    expect(formatCodeBlockBake(verse({}), { verseNewLine: true, showVerseNumbers: true, style: "callout" })).toContain("style: callout");
    expect(formatCodeBlockBake(verse({}), { verseNewLine: true, showVerseNumbers: true })).not.toContain("style:");
  });

  it("omits flags that are undefined", () => {
    const header = formatCodeBlockBake(verse({}), { showVerseNumbers: true }).split("\n---\n")[0];
    expect(header).not.toContain("newline:");
    expect(header).toContain("numbers: true");
  });
});
