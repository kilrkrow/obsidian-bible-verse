import { describe, it, expect } from "vitest";
import { shiftReference, rewriteTokenReference } from "../src/shift";
import { parseReference } from "../src/parser";

const JOHN_3 = 36;

/**
 * Shift the reference inside a token and render the whole token back out.
 *
 * `numberOfVerses` takes null — not undefined — for "chapter length unknown".
 * Passing undefined explicitly would fire the default parameter and silently
 * test the bounded path instead.
 */
function bump(
  token: string,
  target: "start" | "end",
  delta: -1 | 1,
  numberOfVerses: number | null = JOHN_3
): string | null {
  const inner = token.replace(/^\{+|\}+$/g, "");
  const ref = parseReference(inner.split(",")[0].trim());
  if (!ref) throw new Error(`unparseable fixture: ${token}`);
  const shifted = shiftReference(ref, target, delta, numberOfVerses ?? undefined);
  if (!shifted) return null;
  return rewriteTokenReference(token, shifted);
}

describe("rewriteTokenReference — writes back to the note", () => {
  it("shifts a plain token", () => {
    expect(bump("{John 3:16-20}", "end", 1)).toBe("{John 3:16-21}");
  });

  it("keeps a translation", () => {
    expect(bump("{John 3:16-20, KJV}", "end", 1)).toBe("{John 3:16-21, KJV}");
  });

  it("keeps a translation and a style", () => {
    expect(bump("{John 3:16-20, KJV, sidebar}", "end", 1)).toBe("{John 3:16-21, KJV, sidebar}");
  });

  it("keeps formatting flags", () => {
    expect(bump("{John 3:16-20, nl, no-v}", "end", -1)).toBe("{John 3:16-19, nl, no-v}");
  });

  it("keeps a two-translation comparison", () => {
    expect(bump("{John 3:16, KJV, ESV}", "end", 1)).toBe("{John 3:16-17, KJV, ESV}");
  });

  it("moves the start verse", () => {
    expect(bump("{John 3:16-20, KJV}", "start", 1)).toBe("{John 3:17-20, KJV}");
  });

  it("writes eoc when extending past the last verse", () => {
    expect(bump("{John 3:16-36, KJV}", "end", 1)).toBe("{John 3:16-eoc, KJV}");
  });

  it("comes back off eoc to the last verse", () => {
    expect(bump("{John 3:16-eoc, KJV}", "end", -1)).toBe("{John 3:16-36, KJV}");
  });

  it("collapses a range down to a bare verse", () => {
    expect(bump("{John 3:16-17, KJV}", "end", -1)).toBe("{John 3:16, KJV}");
  });
});

describe("rewriteTokenReference — brace form", () => {
  it("keeps a doubled token doubled", () => {
    expect(bump("{{John 3:16-20}}", "end", 1)).toBe("{{John 3:16-21}}");
  });

  it("keeps a doubled token doubled with modifiers", () => {
    expect(bump("{{John 3:16-20, KJV, sidebar}}", "end", 1)).toBe("{{John 3:16-21, KJV, sidebar}}");
  });

  it("keeps a single token single", () => {
    expect(bump("{John 3:16-20}", "end", 1)).toBe("{John 3:16-21}");
  });
});

describe("rewriteTokenReference — refuses to write", () => {
  const shifted = shiftReference(parseReference("John 3:16-20")!, "end", 1, JOHN_3)!;

  it("rejects text that is not a token", () => {
    expect(rewriteTokenReference("John 3:16-20", shifted)).toBeNull();
  });

  it("rejects an unclosed token", () => {
    expect(rewriteTokenReference("{John 3:16-20", shifted)).toBeNull();
  });

  it("rejects a token with trailing text outside the braces", () => {
    // Anchored at both ends, so a partial match cannot cause a partial write.
    expect(rewriteTokenReference("{John 3:16-20} and more", shifted)).toBeNull();
  });

  it("rejects a token whose contents are not a reference", () => {
    expect(rewriteTokenReference("{not a reference at all}", shifted)).toBeNull();
  });

  it("rejects an empty token", () => {
    expect(rewriteTokenReference("{}", shifted)).toBeNull();
  });
});

describe("rewriteTokenReference — unknown verse count", () => {
  it("extends past the end without converting to eoc", () => {
    expect(bump("{John 3:16-36, ESV}", "end", 1, null)).toBe("{John 3:16-37, ESV}");
  });
});
