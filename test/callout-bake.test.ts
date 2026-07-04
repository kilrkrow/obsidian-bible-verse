import { describe, it, expect } from "vitest";
import { formatCalloutBake } from "../src/baker";
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

const URL = "https://www.biblegateway.com/passage/?search=John+3%3A16&version=KJV";

describe("formatCalloutBake", () => {
  it("single verse, expanded, linked title", () => {
    expect(formatCalloutBake(verse({}), "quote", false, URL)).toMatchInlineSnapshot(`
      "> [!quote]+ [John 3:16 (KJV)](https://www.biblegateway.com/passage/?search=John+3%3A16&version=KJV)
      > For God so loved the world..."
    `);
  });

  it("collapsed uses the '-' fold marker", () => {
    expect(formatCalloutBake(verse({}), "quote", true, URL).split("\n")[0]).toBe(
      "> [!quote]- [John 3:16 (KJV)](https://www.biblegateway.com/passage/?search=John+3%3A16&version=KJV)"
    );
  });

  it("custom callout type", () => {
    expect(formatCalloutBake(verse({}), "bible", false, URL).split("\n")[0]).toContain("[!bible]+");
  });

  it("multi-line text is quote-prefixed per line", () => {
    const v = verse({ reference: "John 3:16-17", text: "16. For God so loved...\n17. For God sent not..." });
    expect(formatCalloutBake(v, "quote", false, URL)).toBe(
      `> [!quote]+ [John 3:16-17 (KJV)](${URL})\n> 16. For God so loved...\n> 17. For God sent not...`
    );
  });

  it("blank lines (paragraph breaks) become bare '>'", () => {
    const v = verse({ text: "verse one\n\nverse two" });
    expect(formatCalloutBake(v, "quote", false, URL)).toBe(
      `> [!quote]+ [John 3:16 (KJV)](${URL})\n> verse one\n>\n> verse two`
    );
  });

  it("appends required attribution (e.g. ESV) as a trailing quote block", () => {
    const v = verse({
      reference: "John 11:35",
      translation: "ESV",
      text: "Jesus wept.",
      copyright: "The Holy Bible, ESV® ... © 2001 by Crossway.",
      requireAttribution: true,
    });
    expect(formatCalloutBake(v, "quote", false, URL)).toBe(
      `> [!quote]+ [John 11:35 (ESV)](${URL})\n> Jesus wept.\n>\n> The Holy Bible, ESV® ... © 2001 by Crossway.`
    );
  });

  it("omits attribution when not required", () => {
    const v = verse({ copyright: "License: https://example.com", requireAttribution: false });
    expect(formatCalloutBake(v, "quote", false, URL)).not.toContain("License:");
  });
});
