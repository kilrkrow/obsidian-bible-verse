import { describe, it, expect } from "vitest";
import { parseInlineSpec, formatInlineSpec } from "../src/parser";

/** Parse a token's content and render it straight back out. */
function roundTrip(content: string): string {
  const spec = parseInlineSpec(content);
  if (!spec) throw new Error(`unparseable fixture: ${content}`);
  return formatInlineSpec(spec);
}

/**
 * The verse-shift controls rewrite a token in place (#49), so anything the user
 * typed alongside the reference has to survive the trip.
 */
describe("formatInlineSpec — round-trips", () => {
  const cases = [
    "John 3:16",
    "John 3:16-21",
    "John 3:16-eoc",
    "John 3",
    "John 3:16-21,25",
    "1 Corinthians 13:4-7",
    "Song of Solomon 2:1-3",
    "John 3:16, KJV",
    "John 3:16, KJV, ESV",
    "John 3:16, sidebar",
    "John 3:16, KJV, sidebar",
    "John 3:16, blockquote",
    "John 3:16, inline",
    "John 3:16, callout",
    "John 3:16, nl",
    "John 3:16, no-nl",
    "John 3:16, v",
    "John 3:16, no-v",
    "John 3:16, para",
    "John 3:16, no-para",
    "John 3:16, bake",
    "John 3:16, KJV, bake",
    "John 3:16, native-callout",
    "John 3:16, nco",
    "John 3:16, KJV, nl, no-v",
    "John 3:16-21, ESV, sidebar, nl, no-v, para",
  ];

  for (const input of cases) {
    it(`is stable for "${input}"`, () => {
      const once = roundTrip(input);
      expect(roundTrip(once)).toBe(once);
    });
  }
});

describe("formatInlineSpec — multi-chapter is no longer parseable (#52)", () => {
  it("rejects a multi-chapter token outright", () => {
    expect(parseInlineSpec("John 3:16-4:3")).toBeNull();
    expect(parseInlineSpec("John 3:16-4:3, KJV")).toBeNull();
  });
});

describe("formatInlineSpec — preserves meaning", () => {
  it("keeps the translation", () => {
    expect(roundTrip("John 3:16, KJV")).toBe("John 3:16, KJV");
  });

  it("keeps both translations of a comparison, in order", () => {
    expect(roundTrip("John 3:16, KJV, ESV")).toBe("John 3:16, KJV, ESV");
  });

  it("upper-cases translations the way the parser does", () => {
    expect(roundTrip("John 3:16, kjv")).toBe("John 3:16, KJV");
  });

  it("keeps translation and style together", () => {
    expect(roundTrip("John 3:16, KJV, sidebar")).toBe("John 3:16, KJV, sidebar");
  });

  it("keeps formatting flags", () => {
    expect(roundTrip("John 3:16, nl, no-v")).toBe("John 3:16, nl, no-v");
  });

  it("keeps the bake token", () => {
    expect(roundTrip("John 3:16, bake")).toBe("John 3:16, bake");
  });

  it("normalises the nco alias to its full name", () => {
    expect(roundTrip("John 3:16, nco")).toBe("John 3:16, native-callout");
  });

  it("preserves a collapsed native callout", () => {
    expect(roundTrip("John 3:16, nco-")).toBe("John 3:16, native-callout-");
    expect(parseInlineSpec(roundTrip("John 3:16, nco-"))!.calloutCollapsed).toBe(true);
  });

  it("treats an expanded native callout as expanded", () => {
    expect(parseInlineSpec(roundTrip("John 3:16, nco+"))!.calloutCollapsed).toBe(false);
  });

  it("emits a bare reference with no modifiers", () => {
    expect(roundTrip("John 3:16")).toBe("John 3:16");
  });

  it("keeps an eoc range intact alongside modifiers", () => {
    expect(roundTrip("John 3:16-eoc, KJV, sidebar")).toBe("John 3:16-eoc, KJV, sidebar");
  });

  it("keeps a comma-bearing reference intact alongside modifiers", () => {
    // The reference itself contains a comma, so the parser's comma split has to
    // be re-joined correctly on the way back out.
    expect(roundTrip("John 3:16-21,25, KJV")).toBe("John 3:16-21,25, KJV");
  });
});

describe("formatInlineSpec — output stays parseable", () => {
  it("produces text parseInlineSpec accepts, with equal fields", () => {
    const input = "John 3:16-21, ESV, sidebar, nl, no-v, para";
    const spec = parseInlineSpec(input)!;
    const reparsed = parseInlineSpec(formatInlineSpec(spec))!;

    expect(reparsed.translations).toEqual(spec.translations);
    expect(reparsed.styleOverride).toBe(spec.styleOverride);
    expect(reparsed.verseNewLine).toBe(spec.verseNewLine);
    expect(reparsed.showVerseNumbers).toBe(spec.showVerseNumbers);
    expect(reparsed.paragraphBreaks).toBe(spec.paragraphBreaks);
    expect(reparsed.bake).toBe(spec.bake);
    expect(reparsed.calloutCollapsed).toBe(spec.calloutCollapsed);
    expect(reparsed.ref.book).toBe(spec.ref.book);
    expect(reparsed.ref.chapter).toBe(spec.ref.chapter);
    expect(reparsed.ref.startVerse).toBe(spec.ref.startVerse);
    expect(reparsed.ref.endVerse).toBe(spec.ref.endVerse);
  });
});
