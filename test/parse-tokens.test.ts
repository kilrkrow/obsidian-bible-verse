import { describe, it, expect } from "vitest";
import { parseInlineSpec } from "../src/parser";

describe("parseInlineSpec — bake & native-callout tokens", () => {
  it("plain reference has bake=false, calloutCollapsed=false", () => {
    const s = parseInlineSpec("John 3:16")!;
    expect(s.bake).toBe(false);
    expect(s.calloutCollapsed).toBe(false);
    expect(s.styleOverride).toBeNull();
  });

  it("`bake` token sets bake=true", () => {
    const s = parseInlineSpec("John 3:16, bake")!;
    expect(s.bake).toBe(true);
    expect(s.styleOverride).toBeNull();
  });

  it("`native-callout` sets the style, expanded by default", () => {
    const s = parseInlineSpec("John 3:16, native-callout")!;
    expect(s.styleOverride).toBe("native-callout");
    expect(s.calloutCollapsed).toBe(false);
  });

  it("`nco` is an alias for native-callout", () => {
    expect(parseInlineSpec("John 3:16, nco")!.styleOverride).toBe("native-callout");
  });

  it("`nco-` / `native-callout-` bake collapsed", () => {
    expect(parseInlineSpec("John 3:16, nco-")!.calloutCollapsed).toBe(true);
    expect(parseInlineSpec("John 3:16, native-callout-")!.calloutCollapsed).toBe(true);
  });

  it("`nco+` is explicitly expanded", () => {
    const s = parseInlineSpec("John 3:16, nco+")!;
    expect(s.styleOverride).toBe("native-callout");
    expect(s.calloutCollapsed).toBe(false);
  });

  it("combines with a translation", () => {
    const s = parseInlineSpec("John 3:16, ESV, nco-")!;
    expect(s.translations).toEqual(["ESV"]);
    expect(s.styleOverride).toBe("native-callout");
    expect(s.calloutCollapsed).toBe(true);
  });

  it("combines `bake` with a translation", () => {
    const s = parseInlineSpec("John 3:16, KJV, bake")!;
    expect(s.translations).toEqual(["KJV"]);
    expect(s.bake).toBe(true);
  });
});
