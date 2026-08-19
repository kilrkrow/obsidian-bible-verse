import { describe, it, expect } from "vitest";
import { cycleModifier, rewriteToken } from "../src/shift";
import { parseInlineSpec } from "../src/parser";

/** Walk the cycle from unset, returning each state in turn. */
function walk(inherited: boolean, steps = 4): (boolean | null)[] {
  const seen: (boolean | null)[] = [];
  let v: boolean | null = null;
  for (let i = 0; i < steps; i++) {
    v = cycleModifier(v, inherited);
    seen.push(v);
  }
  return seen;
}

describe("cycleModifier — three states on one button (#51)", () => {
  it("goes unset -> off -> on -> unset when the setting is on", () => {
    expect(walk(true)).toEqual([false, true, null, false]);
  });

  it("goes unset -> on -> off -> unset when the setting is off", () => {
    expect(walk(false)).toEqual([true, false, null, true]);
  });

  it("returns to unset after exactly three clicks either way", () => {
    expect(walk(true, 3)[2]).toBeNull();
    expect(walk(false, 3)[2]).toBeNull();
  });
});

describe("cycleModifier — the first click always changes the rendering", () => {
  // The point of the adaptive order: from unset, moving to the value already
  // inherited would rewrite the token without altering the verse, and the click
  // would look broken.
  for (const inherited of [true, false]) {
    it(`first click flips the effective value when settings are ${inherited ? "on" : "off"}`, () => {
      const next = cycleModifier(null, inherited);
      const effectiveBefore = inherited;
      const effectiveAfter = next ?? inherited;
      expect(effectiveAfter).toBe(!effectiveBefore);
    });

    it(`second click flips it back when settings are ${inherited ? "on" : "off"}`, () => {
      const first = cycleModifier(null, inherited);
      const second = cycleModifier(first, inherited);
      expect(second ?? inherited).toBe(inherited);
      expect(second).not.toBeNull();
    });

    it(`third click unpins without changing the rendering when settings are ${inherited ? "on" : "off"}`, () => {
      const third = cycleModifier(cycleModifier(cycleModifier(null, inherited), inherited), inherited);
      expect(third).toBeNull();
    });
  }
});

describe("rewriteToken — patching modifier flags", () => {
  it("adds an explicit flag to a bare reference", () => {
    expect(rewriteToken("{John 3:16}", { showVerseNumbers: false })).toBe("{John 3:16, no-v}");
  });

  it("adds a line-break flag", () => {
    expect(rewriteToken("{John 3:16}", { verseNewLine: false })).toBe("{John 3:16, no-nl}");
  });

  it("flips an existing flag", () => {
    expect(rewriteToken("{John 3:16, no-v}", { showVerseNumbers: true })).toBe("{John 3:16, v}");
  });

  it("removes a flag when set back to null", () => {
    expect(rewriteToken("{John 3:16, no-v}", { showVerseNumbers: null })).toBe("{John 3:16}");
  });

  it("leaves the reference and other modifiers untouched", () => {
    expect(rewriteToken("{John 3:16-20, KJV, sidebar, nl}", { showVerseNumbers: false }))
      .toBe("{John 3:16-20, KJV, sidebar, nl, no-v}");
  });

  it("keeps both flags when they are set independently", () => {
    const once = rewriteToken("{John 3:16}", { showVerseNumbers: false })!;
    expect(rewriteToken(once, { verseNewLine: true })).toBe("{John 3:16, nl, no-v}");
  });

  it("preserves the doubled brace form", () => {
    expect(rewriteToken("{{John 3:16}}", { showVerseNumbers: false })).toBe("{{John 3:16, no-v}}");
  });

  it("still rewrites the reference, as the shift path relies on", () => {
    const spec = parseInlineSpec("John 3:16, KJV")!;
    const moved = { ...spec.ref, endVerse: 20 };
    expect(rewriteToken("{John 3:16, KJV}", { ref: moved })).toBe("{John 3:16-20, KJV}");
  });

  it("refuses anything that is not a single well-formed token", () => {
    expect(rewriteToken("John 3:16", { showVerseNumbers: false })).toBeNull();
    expect(rewriteToken("{John 3:16} trailing", { showVerseNumbers: false })).toBeNull();
    expect(rewriteToken("{not a reference}", { showVerseNumbers: false })).toBeNull();
  });
});

describe("rewriteToken — a full cycle round-trips back to the original", () => {
  for (const [flag, inherited] of [
    ["showVerseNumbers", true],
    ["verseNewLine", true],
    ["showVerseNumbers", false],
  ] as const) {
    it(`${flag} returns to a bare token after three clicks (settings ${inherited ? "on" : "off"})`, () => {
      let token = "{John 3:16, KJV}";
      let value: boolean | null = null;
      for (let i = 0; i < 3; i++) {
        value = cycleModifier(value, inherited);
        token = rewriteToken(token, { [flag]: value })!;
      }
      expect(token).toBe("{John 3:16, KJV}");
    });
  }
});
