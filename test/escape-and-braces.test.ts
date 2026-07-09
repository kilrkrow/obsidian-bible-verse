import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { closingBraceState } from "../src/parser";
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
