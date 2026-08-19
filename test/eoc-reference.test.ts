import { describe, it, expect } from "vitest";
import { parseReference, formatReference } from "../src/parser";
import { EOC_VERSE } from "../src/types";

describe("formatReference — end-of-chapter ranges (#49)", () => {
  it("round-trips an eoc range instead of leaking the sentinel", () => {
    const ref = parseReference("John 3:16-eoc")!;
    expect(ref.endVerse).toBe(EOC_VERSE);
    expect(formatReference(ref)).toBe("John 3:16-eoc");
  });

  it("survives a parse/format/parse cycle", () => {
    const once = formatReference(parseReference("John 3:16-eoc")!);
    const twice = formatReference(parseReference(once)!);
    expect(twice).toBe(once);
  });

  it("is case-insensitive on input and normalises to lowercase", () => {
    expect(formatReference(parseReference("John 3:16-EOC")!)).toBe("John 3:16-eoc");
  });

  it("leaves ordinary ranges untouched", () => {
    expect(formatReference(parseReference("John 3:16-21")!)).toBe("John 3:16-21");
  });

  it("leaves a bare verse untouched", () => {
    expect(formatReference(parseReference("John 3:16")!)).toBe("John 3:16");
  });

  it("leaves a whole-chapter reference untouched", () => {
    expect(formatReference(parseReference("John 3")!)).toBe("John 3");
  });

  it("no longer sees multi-chapter ranges, which the parser now rejects (#52)", () => {
    expect(parseReference("John 3:16-4:3")).toBeNull();
  });

  it("still emits additional verses alongside a range", () => {
    expect(formatReference(parseReference("John 3:16-21,25")!)).toBe("John 3:16-21,25");
  });
});
