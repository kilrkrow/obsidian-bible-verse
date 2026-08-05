import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import {
  closingBraceState,
  mergeTokenRemainder,
  inlineTokenRegex,
  inlineTokenContent,
} from "../src/parser";
import { Baker } from "../src/baker";

describe("closingBraceState (#36)", () => {
  it("immediate: auto-paired brace right after cursor", () => {
    expect(closingBraceState("}")).toBe("immediate");
    expect(closingBraceState("} and more text")).toBe("immediate");
  });

  it("later: token already closed further right (mid-token edit)", () => {
    // The #36 repro: cursor mid-token with ` KJV}` still ahead
    expect(closingBraceState(" KJV}")).toBe("later");
    expect(closingBraceState(", no-v} trailing")).toBe("later");
  });

  it("later only applies to the same token — a new { first means none", () => {
    expect(closingBraceState(" text {John 3:16}")).toBe("none");
  });

  it("none: no closing brace on the line", () => {
    expect(closingBraceState("")).toBe("none");
    expect(closingBraceState(" plain text")).toBe("none");
  });
});

describe("mergeTokenRemainder (#36)", () => {
  it("re-attaches the leftover token text, comma-joined (the repro)", () => {
    // {1 Kings 1:1, inline, no|KJV} — accept "…, no-nl" with "KJV" remaining
    expect(mergeTokenRemainder("1 Kings 1:1, inline, no-nl", "KJV")).toBe(
      "1 Kings 1:1, inline, no-nl, KJV"
    );
  });

  it("trims whitespace and leading commas in the remainder", () => {
    expect(mergeTokenRemainder("John 3:16, nl", " KJV")).toBe("John 3:16, nl, KJV");
    expect(mergeTokenRemainder("John 3:16, nl", ", KJV")).toBe("John 3:16, nl, KJV");
  });

  it("does not duplicate parts the suggestion already contains", () => {
    // The KJVKJV case: suggestion already ends with KJV, remainder is KJV
    expect(mergeTokenRemainder("1 Kings 1:1, inline, no-nl, KJV", "KJV")).toBe(
      "1 Kings 1:1, inline, no-nl, KJV"
    );
  });

  it("keeps multiple leftover parts", () => {
    expect(mergeTokenRemainder("John 3:16, no-v", "KJV, callout")).toBe(
      "John 3:16, no-v, KJV, callout"
    );
  });

  it("empty/whitespace remainder leaves the value untouched", () => {
    expect(mergeTokenRemainder("John 3:16, nl", "")).toBe("John 3:16, nl");
    expect(mergeTokenRemainder("John 3:16, nl", "  ")).toBe("John 3:16, nl");
  });
});

describe("inlineTokenRegex handles doubled braces (#41)", () => {
  const scan = (s: string) =>
    [...s.matchAll(inlineTokenRegex())].map((m) => ({
      raw: m[0],
      content: inlineTokenContent(m),
    }));

  it("consumes both braces of a doubled token, leaving nothing stray", () => {
    // The repro: {{…}} matched only the inner pair, so { and } rendered as text
    expect(scan("{{Judges 4:17-24,no-v, no-nl, esv}}")).toEqual([
      { raw: "{{Judges 4:17-24,no-v, no-nl, esv}}", content: "Judges 4:17-24,no-v, no-nl, esv" },
    ]);
  });

  it("still matches a single-brace token", () => {
    expect(scan("see {John 3:16} here")).toEqual([
      { raw: "{John 3:16}", content: "John 3:16" },
    ]);
  });

  it("handles both depths in one line", () => {
    expect(scan("{{Psalm 23}} and {John 3:16}").map((m) => m.raw)).toEqual([
      "{{Psalm 23}}",
      "{John 3:16}",
    ]);
  });

  it("unbalanced braces keep the old inner match", () => {
    expect(scan("{{John 3:16}").map((m) => m.raw)).toEqual(["{John 3:16}"]);
    expect(scan("{John 3:16}}").map((m) => m.raw)).toEqual(["{John 3:16}"]);
  });

  it("does not match across a closing brace", () => {
    expect(scan("{not a ref} {also} text")).toHaveLength(2);
    expect(scan("{ leading space}")).toHaveLength(0);
  });
});

describe("extractReferences ignores escaped tokens (#28)", () => {
  const baker = new Baker(null as unknown as App);

  it("skips \\{...} but keeps normal {...}", () => {
    const content = "Literal: \\{John 3:16} and live: {John 3:17}";
    const refs = baker.extractReferences(content, true);
    expect(refs).toHaveLength(1);
    expect(refs[0].raw).toBe("{John 3:17}");
  });

  it("extracts nothing when the only token is escaped", () => {
    expect(baker.extractReferences("\\{Psalm 23}", true)).toHaveLength(0);
  });

  it("bakes a doubled token whole, braces included (#41)", () => {
    const refs = baker.extractReferences("{{John 3:17, KJV}}", true);
    expect(refs).toHaveLength(1);
    expect(refs[0].raw).toBe("{{John 3:17, KJV}}");
    expect(refs[0].translations).toEqual(["KJV"]);
  });

  it("skips an escaped doubled token", () => {
    expect(baker.extractReferences("\\{{Psalm 23}}", true)).toHaveLength(0);
  });
});
