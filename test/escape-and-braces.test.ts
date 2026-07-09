import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { closingBraceState, mergeTokenRemainder } from "../src/parser";
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
});
