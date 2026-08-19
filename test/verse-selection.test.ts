import { describe, it, expect } from "vitest";
import { parseReference } from "../src/parser";
import { computeRequestedVerses } from "../src/format";

/** The set of verses a reference asks for, as a sorted array. */
function selected(input: string): number[] | null {
  const ref = parseReference(input);
  if (!ref) throw new Error(`unparseable fixture: ${input}`);
  const set = computeRequestedVerses(ref);
  return set === null ? null : [...set].sort((a, b) => a - b);
}

describe("computeRequestedVerses — ranges plus additional verses (#53)", () => {
  it("keeps extras alongside a range", () => {
    // Regression: the range branch returned before additionalVerses were added,
    // so 25 was dropped while the reference still displayed "John 3:16-21,25".
    expect(selected("John 3:16-21,25")).toEqual([16, 17, 18, 19, 20, 21, 25]);
  });

  it("keeps several extras", () => {
    expect(selected("John 3:16-18,25,30")).toEqual([16, 17, 18, 25, 30]);
  });

  it("keeps extras that fall inside the range without duplicating", () => {
    expect(selected("John 3:16-21,18")).toEqual([16, 17, 18, 19, 20, 21]);
  });

  it("keeps extras below the range", () => {
    expect(selected("John 3:16-18,2")).toEqual([2, 16, 17, 18]);
  });

  it("still handles extras without a range", () => {
    expect(selected("John 3:16,25")).toEqual([16, 25]);
  });

  it("still handles a plain range", () => {
    expect(selected("John 3:16-18")).toEqual([16, 17, 18]);
  });

  it("still handles a bare verse", () => {
    expect(selected("John 3:16")).toEqual([16]);
  });
});

describe("computeRequestedVerses — whole chapter and end-of-chapter", () => {
  it("returns null for a whole chapter, meaning every verse", () => {
    expect(selected("John 3")).toBeNull();
  });

  it("returns null for an eoc range, bounded by startVerse at assembly", () => {
    expect(selected("John 3:16-eoc")).toBeNull();
  });
});
