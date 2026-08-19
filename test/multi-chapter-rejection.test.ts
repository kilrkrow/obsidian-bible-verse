import { describe, it, expect } from "vitest";
import { parseReference, parseInlineSpec } from "../src/parser";

/**
 * Multi-chapter references used to parse into a valid-looking BibleReference
 * carrying an endChapter, then always fail at fetch time with "No verses
 * found" — the fetch layer serves one chapter at a time and its requested-verse
 * set has no chapter dimension. They are rejected at parse instead (#52), so
 * the error names the real problem where the user typed it.
 */
describe("parseReference — multi-chapter ranges are rejected (#52)", () => {
  it("rejects a chapter span", () => {
    expect(parseReference("John 3:16-4:3")).toBeNull();
  });

  it("rejects a span on a numbered book", () => {
    expect(parseReference("1 John 3:16-4:3")).toBeNull();
  });

  it("rejects a span on a multi-word book", () => {
    expect(parseReference("Song of Solomon 2:1-3:2")).toBeNull();
  });

  it("rejects a span even when the chapters are adjacent", () => {
    expect(parseReference("Genesis 1:31-2:1")).toBeNull();
  });
});

describe("parseReference — everything else still parses", () => {
  const stillValid: [string, Partial<Record<string, unknown>>][] = [
    ["John 3:16", { chapter: 3, startVerse: 16, endVerse: null }],
    ["John 3:16-21", { chapter: 3, startVerse: 16, endVerse: 21 }],
    ["John 3", { chapter: 3, startVerse: null }],
    ["1 Corinthians 13:4-7", { chapter: 13, startVerse: 4, endVerse: 7 }],
  ];

  for (const [input, expected] of stillValid) {
    it(`accepts "${input}"`, () => {
      const ref = parseReference(input);
      expect(ref).not.toBeNull();
      for (const [k, v] of Object.entries(expected)) {
        expect(ref![k as keyof typeof ref]).toBe(v);
      }
    });
  }

  it("accepts an eoc range", () => {
    expect(parseReference("John 3:16-eoc")).not.toBeNull();
  });

  it("accepts a range with additional verses", () => {
    const ref = parseReference("John 3:16-21,25");
    expect(ref).not.toBeNull();
    expect(ref!.additionalVerses).toEqual([25]);
  });

  it("never produces an endChapter any more", () => {
    for (const input of ["John 3:16", "John 3:16-21", "John 3", "John 3:16-eoc", "John 3:16-21,25"]) {
      expect(parseReference(input)!.endChapter).toBeNull();
    }
  });
});

describe("parseInlineSpec — rejects multi-chapter tokens too", () => {
  it("rejects a bare multi-chapter token", () => {
    expect(parseInlineSpec("John 3:16-4:3")).toBeNull();
  });

  it("rejects one carrying modifiers", () => {
    expect(parseInlineSpec("John 3:16-4:3, KJV")).toBeNull();
    expect(parseInlineSpec("John 3:16-4:3, KJV, sidebar")).toBeNull();
  });
});
