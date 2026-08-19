import { describe, it, expect } from "vitest";
import { shiftReference, ShiftTarget, ShiftDelta } from "../src/shift";
import { parseReference, formatReference } from "../src/parser";

/** Shift a reference written as text and read the result back as text. */
function shift(
  input: string,
  target: ShiftTarget,
  delta: ShiftDelta,
  numberOfVerses?: number
): string | null {
  const ref = parseReference(input);
  if (!ref) throw new Error(`unparseable fixture: ${input}`);
  const out = shiftReference(ref, target, delta, numberOfVerses);
  return out === null ? null : formatReference(out);
}

// John 3 is 36 verses in every captured translation.
const JOHN_3 = 36;

describe("shiftReference — end verse", () => {
  it("extends a range", () => {
    expect(shift("John 3:16-20", "end", 1, JOHN_3)).toBe("John 3:16-21");
  });

  it("shrinks a range", () => {
    expect(shift("John 3:16-20", "end", -1, JOHN_3)).toBe("John 3:16-19");
  });

  it("grows a bare verse into a range", () => {
    expect(shift("John 3:16", "end", 1, JOHN_3)).toBe("John 3:16-17");
  });

  it("cannot shrink a bare verse", () => {
    expect(shift("John 3:16", "end", -1, JOHN_3)).toBeNull();
  });

  it("collapses a two-verse range back to a bare verse", () => {
    expect(shift("John 3:16-17", "end", -1, JOHN_3)).toBe("John 3:16");
  });
});

describe("shiftReference — the eoc ladder (#49)", () => {
  it("steps up to the last verse numerically", () => {
    expect(shift("John 3:16-35", "end", 1, JOHN_3)).toBe("John 3:16-36");
  });

  it("converts to eoc when extending past the last verse", () => {
    expect(shift("John 3:16-36", "end", 1, JOHN_3)).toBe("John 3:16-eoc");
  });

  it("cannot extend beyond eoc", () => {
    expect(shift("John 3:16-eoc", "end", 1, JOHN_3)).toBeNull();
  });

  it("shrinks off eoc back to the last verse", () => {
    expect(shift("John 3:16-eoc", "end", -1, JOHN_3)).toBe("John 3:16-36");
  });

  it("is reversible with no skipped states", () => {
    const up = shift("John 3:16-36", "end", 1, JOHN_3)!;
    expect(up).toBe("John 3:16-eoc");
    expect(shift(up, "end", -1, JOHN_3)).toBe("John 3:16-36");
  });

  it("promotes a bare last verse straight to eoc", () => {
    expect(shift("John 3:36", "end", 1, JOHN_3)).toBe("John 3:36-eoc");
  });

  it("shrinks a single-verse eoc range back to a bare verse rather than dead-ending", () => {
    expect(shift("John 3:36-eoc", "end", -1, JOHN_3)).toBe("John 3:36");
  });
});

describe("shiftReference — start verse", () => {
  it("moves the start forward", () => {
    expect(shift("John 3:16-20", "start", 1, JOHN_3)).toBe("John 3:17-20");
  });

  it("moves the start backward", () => {
    expect(shift("John 3:16-20", "start", -1, JOHN_3)).toBe("John 3:15-20");
  });

  it("moves a bare verse", () => {
    expect(shift("John 3:16", "start", 1, JOHN_3)).toBe("John 3:17");
    expect(shift("John 3:16", "start", -1, JOHN_3)).toBe("John 3:15");
  });

  it("floors at verse 1", () => {
    expect(shift("John 3:1-5", "start", -1, JOHN_3)).toBeNull();
    expect(shift("John 3:1", "start", -1, JOHN_3)).toBeNull();
  });

  it("cannot pass the end verse", () => {
    expect(shift("John 3:20-20", "start", 1, JOHN_3)).toBeNull();
  });

  it("collapses onto the end verse as a bare verse", () => {
    expect(shift("John 3:19-20", "start", 1, JOHN_3)).toBe("John 3:20");
  });

  it("moves freely inside an eoc range", () => {
    expect(shift("John 3:16-eoc", "start", 1, JOHN_3)).toBe("John 3:17-eoc");
    expect(shift("John 3:16-eoc", "start", -1, JOHN_3)).toBe("John 3:15-eoc");
  });

  it("stops at the last verse of an eoc range", () => {
    expect(shift("John 3:36-eoc", "start", 1, JOHN_3)).toBeNull();
  });

  it("respects the chapter bound on a bare verse", () => {
    expect(shift("John 3:36", "start", 1, JOHN_3)).toBeNull();
  });
});

describe("shiftReference — unknown verse count", () => {
  it("allows extending past the end, leaving the error to the renderer", () => {
    expect(shift("John 3:16-36", "end", 1)).toBe("John 3:16-37");
    expect(shift("John 3:99", "start", 1)).toBe("John 3:100");
  });

  it("never converts to eoc, since the end is unknown", () => {
    expect(shift("John 3:16-500", "end", 1)).toBe("John 3:16-501");
  });

  it("cannot shrink off an existing eoc range", () => {
    expect(shift("John 3:16-eoc", "end", -1)).toBeNull();
  });

  it("still floors the start at verse 1", () => {
    expect(shift("John 3:1-5", "start", -1)).toBeNull();
  });

  it("treats a nonsensical count as unknown rather than pinning to verse 1", () => {
    expect(shift("John 3:16-20", "end", 1, 0)).toBe("John 3:16-21");
    expect(shift("John 3:16-20", "end", 1, -5)).toBe("John 3:16-21");
  });
});

describe("shiftReference — shapes it refuses", () => {
  it("refuses whole-chapter references", () => {
    expect(shift("John 3", "end", 1, JOHN_3)).toBeNull();
    expect(shift("John 3", "start", 1, JOHN_3)).toBeNull();
  });

  it("refuses multi-chapter ranges", () => {
    // The parser rejects this shape outright now (#52), so it cannot arrive via
    // text. The guard stays because endChapter is still on the type, and a
    // reference built in code could carry one.
    expect(parseReference("John 3:16-4:3")).toBeNull();

    const spanning = { ...parseReference("John 3:16-20")!, endChapter: 4 };
    expect(shiftReference(spanning, "end", 1, JOHN_3)).toBeNull();
    expect(shiftReference(spanning, "start", 1, JOHN_3)).toBeNull();
  });

  it("refuses discontinuous references", () => {
    expect(shift("John 3:16-21,25", "end", 1, JOHN_3)).toBeNull();
    expect(shift("John 3:16-21,25", "start", 1, JOHN_3)).toBeNull();
  });
});

describe("shiftReference — purity", () => {
  it("does not mutate its input", () => {
    const ref = parseReference("John 3:16-20")!;
    const snapshot = JSON.stringify(ref);
    shiftReference(ref, "end", 1, JOHN_3);
    shiftReference(ref, "start", -1, JOHN_3);
    expect(JSON.stringify(ref)).toBe(snapshot);
  });

  it("preserves the book and chapter", () => {
    expect(shift("1 Corinthians 13:4-7", "end", 1, 13)).toBe("1 Corinthians 13:4-8");
    expect(shift("Song of Solomon 2:1-3", "start", 1, 17)).toBe("Song of Solomon 2:2-3");
  });

  it("produces output that parses back to an equivalent reference", () => {
    const out = shift("John 3:16-20", "end", 1, JOHN_3)!;
    const reparsed = parseReference(out)!;
    expect(reparsed.startVerse).toBe(16);
    expect(reparsed.endVerse).toBe(21);
  });
});
