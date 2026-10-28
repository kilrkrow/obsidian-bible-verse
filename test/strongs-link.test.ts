import { describe, it, expect } from "vitest";
import {
  blueLetterBibleUrl,
  parseStrongsNumber,
  stepBibleSearchUrl,
  stepBibleStrongsId,
  strongsConcordanceTitle,
  strongsConcordanceUrl,
} from "../src/strongs-link";

/**
 * The link on the popover's Strong's number. STEPBible wants four digits and
 * an upper-case sense letter ("H0430G"); Blue Letter Bible, the fallback with
 * no sense to go on, wants a lower-case unpadded number and no letter ("h430").
 */

const STEP = "https://www.stepbible.org/?q=strong=";
const BLB = "https://www.blueletterbible.org/lexicon/";

describe("parseStrongsNumber", () => {
  it.each([
    ["G4678", { language: "G", value: 4678, sense: "" }],
    ["G04678", { language: "G", value: 4678, sense: "" }],
    ["g4678", { language: "G", value: 4678, sense: "" }],
    ["H430", { language: "H", value: 430, sense: "" }],
    ["H0430", { language: "H", value: 430, sense: "" }],
    ["h0430g", { language: "H", value: 430, sense: "G" }],
    ["H1254a", { language: "H", value: 1254, sense: "A" }],
    ["H1254A", { language: "H", value: 1254, sense: "A" }],
    ["G26", { language: "G", value: 26, sense: "" }],
    ["H1", { language: "H", value: 1, sense: "" }],
    ["  G1383 ", { language: "G", value: 1383, sense: "" }],
    ["H9999", { language: "H", value: 9999, sense: "" }],
  ])("reads %j", (raw, ref) => {
    expect(parseStrongsNumber(raw)).toEqual(ref);
  });

  it.each([
    "", "   ", "G", "H", "4678", "X4678", "GH4678", "G0", "H0000", "G10000", "G4678ab", "G46 78",
    "G-4678", "G4678.", "G４６７８", "H1254_a", "<G4678>",
  ])("rejects %j", (raw) => {
    expect(parseStrongsNumber(raw)).toBeNull();
  });

  it("rejects what isn't a string", () => {
    expect(parseStrongsNumber(null)).toBeNull();
    expect(parseStrongsNumber(undefined)).toBeNull();
    expect(parseStrongsNumber(4678 as unknown as string)).toBeNull();
  });
});

describe("STEPBible form", () => {
  it.each([
    ["G4678", "G4678"],
    ["G04678", "G4678"],
    ["G26", "G0026"],
    ["H430", "H0430"],
    ["H0430", "H0430"],
    ["h0430g", "H0430G"],
    ["H1254a", "H1254A"],
    ["H1", "H0001"],
  ])("%s is %s", (raw, id) => {
    expect(stepBibleStrongsId(parseStrongsNumber(raw)!)).toBe(id);
    expect(stepBibleSearchUrl(parseStrongsNumber(raw)!)).toBe(STEP + id);
  });
});

describe("Blue Letter Bible form", () => {
  it.each([
    ["G4678", "g4678/kjv/tr/0-1/"],
    ["G0026", "g26/kjv/tr/0-1/"],
    ["H0430", "h430/kjv/wlc/0-1/"],
    ["H430", "h430/kjv/wlc/0-1/"],
    ["H1254a", "h1254/kjv/wlc/0-1/"],
    ["H0001", "h1/kjv/wlc/0-1/"],
  ])("%s is %s", (raw, path) => {
    expect(blueLetterBibleUrl(parseStrongsNumber(raw)!)).toBe(BLB + path);
  });
});

describe("strongsConcordanceUrl", () => {
  it("uses the shown sense's id for STEPBible's sense letter", () => {
    expect(strongsConcordanceUrl("H0430", "H0430G")).toBe(STEP + "H0430G");
    expect(strongsConcordanceUrl("H1254", "H1254A")).toBe(STEP + "H1254A");
    expect(strongsConcordanceUrl("H3068", "H3068G")).toBe(STEP + "H3068G");
    expect(strongsConcordanceUrl("G2424", "G2424G")).toBe(STEP + "G2424G");
  });

  it("links a single-sense number as it is, padded", () => {
    expect(strongsConcordanceUrl("G4678", "G4678")).toBe(STEP + "G4678");
    expect(strongsConcordanceUrl("G0026", "G0026")).toBe(STEP + "G0026");
    expect(strongsConcordanceUrl("G26", "G0026")).toBe(STEP + "G0026");
    expect(strongsConcordanceUrl("H982", "H0982")).toBe(STEP + "H0982");
  });

  it("matches the sense to the number whatever the padding or case", () => {
    expect(strongsConcordanceUrl("H430", "h0430g")).toBe(STEP + "H0430G");
    expect(strongsConcordanceUrl("h0430", "H430G")).toBe(STEP + "H0430G");
  });

  it("keeps a number's own sense letter", () => {
    expect(strongsConcordanceUrl("H1254a")).toBe(STEP + "H1254A");
    expect(strongsConcordanceUrl("H1254a", "H1254B")).toBe(STEP + "H1254A");
  });

  it("ignores a sense id for another number", () => {
    expect(strongsConcordanceUrl("H0430", "H0431G")).toBe(BLB + "h430/kjv/wlc/0-1/");
    expect(strongsConcordanceUrl("H0430", "G0430")).toBe(BLB + "h430/kjv/wlc/0-1/");
  });

  it("goes to Blue Letter Bible with no sense to go on", () => {
    expect(strongsConcordanceUrl("H0430")).toBe(BLB + "h430/kjv/wlc/0-1/");
    expect(strongsConcordanceUrl("H0430", null)).toBe(BLB + "h430/kjv/wlc/0-1/");
    expect(strongsConcordanceUrl("H0430", "")).toBe(BLB + "h430/kjv/wlc/0-1/");
    expect(strongsConcordanceUrl("H0430", "nonsense")).toBe(BLB + "h430/kjv/wlc/0-1/");
    expect(strongsConcordanceUrl("G4678")).toBe(BLB + "g4678/kjv/tr/0-1/");
  });

  it("is null for something that isn't a Strong's number", () => {
    expect(strongsConcordanceUrl("")).toBeNull();
    expect(strongsConcordanceUrl("4678", "G4678")).toBeNull();
    expect(strongsConcordanceUrl("G0")).toBeNull();
    expect(strongsConcordanceUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("strongsConcordanceTitle", () => {
  it("names the number as the popover shows it", () => {
    expect(strongsConcordanceTitle("G4678")).toBe("See all uses of G4678");
    expect(strongsConcordanceTitle("H0430")).toBe("See all uses of H0430");
  });
});
