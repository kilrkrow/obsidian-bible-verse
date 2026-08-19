import { describe, it, expect } from "vitest";
import { referenceRejection, parseReference, parseInlineSpec } from "../src/parser";

/**
 * Rejecting multi-chapter references at parse (#52) made them fail silently on
 * the inline path: parseInlineSpec returns null, and both the Live Preview
 * decoration builder and the Reading-view postprocessor leave unrecognised
 * tokens as plain text. referenceRejection restores the distinction between
 * "not a reference" and "a reference we refuse", so the latter can say so.
 */
describe("referenceRejection — explains a refused reference", () => {
  it("names multi-chapter references", () => {
    const why = referenceRejection("John 1:10-2:10");
    expect(why).not.toBeNull();
    expect(why).toContain("Multi-chapter");
    expect(why).toContain("John 1:10-2:10");
  });

  it("works on a numbered book", () => {
    expect(referenceRejection("1 John 3:16-4:3")).toContain("Multi-chapter");
  });

  it("works on a multi-word book", () => {
    expect(referenceRejection("Song of Solomon 2:1-3:2")).toContain("Multi-chapter");
  });

  it("reads the reference out of a token carrying modifiers", () => {
    expect(referenceRejection("John 1:10-2:10, KJV")).toContain("Multi-chapter");
    expect(referenceRejection("John 1:10-2:10, KJV, sidebar")).toContain("Multi-chapter");
    expect(referenceRejection("John 1:10-2:10, nl, no-v")).toContain("Multi-chapter");
  });

  it("quotes only the reference, not the modifiers", () => {
    expect(referenceRejection("John 1:10-2:10, KJV")).toContain('"John 1:10-2:10"');
  });
});

describe("referenceRejection — stays silent for anything else", () => {
  const notOurs = [
    "John 3:16",
    "John 3:16-21",
    "John 3",
    "John 3:16-eoc",
    "John 3:16-21,25",
    "John 3:16, KJV, sidebar",
    "1 Corinthians 13:4-7",
  ];

  for (const input of notOurs) {
    it(`says nothing about a valid reference: "${input}"`, () => {
      expect(referenceRejection(input)).toBeNull();
    });
  }

  const arbitrary = [
    "some random braces",
    "TODO: buy milk",
    "",
    "x",
    "1:2-3:4",
    "Notabook 1:1-2:2",
    "{nested}",
  ];

  for (const input of arbitrary) {
    it(`leaves non-references alone: "${input}"`, () => {
      expect(referenceRejection(input)).toBeNull();
    });
  }
});

describe("referenceRejection — pairs with the parser", () => {
  it("explains exactly the input parseReference refuses", () => {
    expect(parseReference("John 1:10-2:10")).toBeNull();
    expect(referenceRejection("John 1:10-2:10")).not.toBeNull();
  });

  it("explains exactly the input parseInlineSpec refuses", () => {
    expect(parseInlineSpec("John 1:10-2:10, KJV")).toBeNull();
    expect(referenceRejection("John 1:10-2:10, KJV")).not.toBeNull();
  });

  it("stays quiet where the parser succeeds, so nothing is double-reported", () => {
    for (const input of ["John 3:16", "John 3:16-21,25", "John 3"]) {
      expect(parseReference(input)).not.toBeNull();
      expect(referenceRejection(input)).toBeNull();
    }
  });

  it("is quiet for gibberish, which must stay literal text rather than error", () => {
    // The safety valve: the plugin must not claim every {…} in a note.
    expect(parseInlineSpec("just some prose")).toBeNull();
    expect(referenceRejection("just some prose")).toBeNull();
  });
});
