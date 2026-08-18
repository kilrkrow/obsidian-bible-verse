import { describe, it, expect } from "vitest";
import { findTokenAtCursor } from "../src/shift";

/** Locate the token under the caret marked by "|" in the fixture. */
function at(lineWithCaret: string) {
  const ch = lineWithCaret.indexOf("|");
  if (ch === -1) throw new Error("fixture needs a | caret marker");
  return findTokenAtCursor(lineWithCaret.replace("|", ""), ch);
}

describe("findTokenAtCursor", () => {
  it("finds a token the caret sits inside", () => {
    expect(at("see {John |3:16} today")?.token).toBe("{John 3:16}");
  });

  it("counts the opening brace as inside", () => {
    expect(at("see |{John 3:16} today")?.token).toBe("{John 3:16}");
  });

  it("counts the closing brace as inside", () => {
    expect(at("see {John 3:16}| today")?.token).toBe("{John 3:16}");
  });

  it("returns the token's bounds", () => {
    const found = at("see {John |3:16} today");
    expect(found).not.toBeNull();
    expect("see {John 3:16} today".slice(found!.start, found!.end)).toBe("{John 3:16}");
  });

  it("returns null when the caret is outside any token", () => {
    expect(at("see {John 3:16} to|day")).toBeNull();
  });

  it("returns null on a line with no token", () => {
    expect(at("just some |prose")).toBeNull();
  });

  it("picks the token the caret is in when a line has several", () => {
    expect(at("{John 3:16} and {Romans |8:28}")?.token).toBe("{Romans 8:28}");
    expect(at("{John |3:16} and {Romans 8:28}")?.token).toBe("{John 3:16}");
  });

  it("keeps modifiers in the returned token", () => {
    expect(at("{John 3:16, KJV, |sidebar}")?.token).toBe("{John 3:16, KJV, sidebar}");
  });

  it("handles a doubled token as one unit", () => {
    expect(at("{{John |3:16}}")?.token).toBe("{{John 3:16}}");
  });

  it("ignores an escaped token, which is literal text", () => {
    // A real backslash in the line: "\{John 3:16}" as the user typed it (#28).
    expect(at(String.raw`\{John |3:16}`)).toBeNull();
  });
});
