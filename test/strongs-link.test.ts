import { describe, it, expect } from "vitest";
import {
  bibleHubUrl,
  blueLetterBibleUrl,
  isStrongsLinkTarget,
  STRONGS_LINK_TARGETS,
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

describe("strongsConcordanceUrl — STEPBible", () => {
  it("uses the shown sense's id for STEPBible's sense letter", () => {
    expect(strongsConcordanceUrl("H0430", "H0430G", "STEPBible")).toBe(STEP + "H0430G");
    expect(strongsConcordanceUrl("H1254", "H1254A", "STEPBible")).toBe(STEP + "H1254A");
    expect(strongsConcordanceUrl("H3068", "H3068G", "STEPBible")).toBe(STEP + "H3068G");
    expect(strongsConcordanceUrl("G2424", "G2424G", "STEPBible")).toBe(STEP + "G2424G");
  });

  it("links a single-sense number as it is, padded", () => {
    expect(strongsConcordanceUrl("G4678", "G4678", "STEPBible")).toBe(STEP + "G4678");
    expect(strongsConcordanceUrl("G0026", "G0026", "STEPBible")).toBe(STEP + "G0026");
    expect(strongsConcordanceUrl("G26", "G0026", "STEPBible")).toBe(STEP + "G0026");
    expect(strongsConcordanceUrl("H982", "H0982", "STEPBible")).toBe(STEP + "H0982");
  });

  it("matches the sense to the number whatever the padding or case", () => {
    expect(strongsConcordanceUrl("H430", "h0430g", "STEPBible")).toBe(STEP + "H0430G");
    expect(strongsConcordanceUrl("h0430", "H430G", "STEPBible")).toBe(STEP + "H0430G");
  });

  it("keeps a number's own sense letter", () => {
    expect(strongsConcordanceUrl("H1254a", null, "STEPBible")).toBe(STEP + "H1254A");
    expect(strongsConcordanceUrl("H1254a", "H1254B", "STEPBible")).toBe(STEP + "H1254A");
  });

  it("ignores a sense id for another number", () => {
    expect(strongsConcordanceUrl("H0430", "H0431G", "STEPBible")).toBe(BLB + "h430/kjv/wlc/0-1/");
    expect(strongsConcordanceUrl("H0430", "G0430", "STEPBible")).toBe(BLB + "h430/kjv/wlc/0-1/");
  });

  it("goes to Blue Letter Bible with no sense to go on", () => {
    expect(strongsConcordanceUrl("H0430", null, "STEPBible")).toBe(BLB + "h430/kjv/wlc/0-1/");
    expect(strongsConcordanceUrl("H0430", null, "STEPBible")).toBe(BLB + "h430/kjv/wlc/0-1/");
    expect(strongsConcordanceUrl("H0430", "", "STEPBible")).toBe(BLB + "h430/kjv/wlc/0-1/");
    expect(strongsConcordanceUrl("H0430", "nonsense", "STEPBible")).toBe(BLB + "h430/kjv/wlc/0-1/");
    expect(strongsConcordanceUrl("G4678", null, "STEPBible")).toBe(BLB + "g4678/kjv/tr/0-1/");
  });

  it("is null for something that isn't a Strong's number", () => {
    expect(strongsConcordanceUrl("", null, "STEPBible")).toBeNull();
    expect(strongsConcordanceUrl("4678", "G4678", "STEPBible")).toBeNull();
    expect(strongsConcordanceUrl("G0", null, "STEPBible")).toBeNull();
    expect(strongsConcordanceUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("strongsConcordanceTitle", () => {
  it("names the number as the popover shows it", () => {
    expect(strongsConcordanceTitle("G4678")).toBe("See all uses of G4678");
    expect(strongsConcordanceTitle("H0430")).toBe("See all uses of H0430");
  });
});

const BH = "https://biblehub.com/";

describe("Bible Hub form", () => {
  it.each([
    ["G4678", "greek/4678.htm"],
    ["G04678", "greek/4678.htm"],
    ["g4678", "greek/4678.htm"],
    ["G0026", "greek/26.htm"],
    ["G26", "greek/26.htm"],
    ["G0001", "greek/1.htm"],
    ["H0430", "hebrew/430.htm"],
    ["H430", "hebrew/430.htm"],
    ["H0430G", "hebrew/430.htm"],
    ["H1254A", "hebrew/1254.htm"],
    ["H1254a", "hebrew/1254.htm"],
    ["H0001", "hebrew/1.htm"],
  ])("%s is %s: unpadded, no sense letter", (raw, path) => {
    expect(bibleHubUrl(parseStrongsNumber(raw)!)).toBe(BH + path);
  });

  it("covers G1-G5624 and H1-H8674, the numbers Bible Hub has pages for", () => {
    expect(bibleHubUrl(parseStrongsNumber("G1")!)).toBe(BH + "greek/1.htm");
    expect(bibleHubUrl(parseStrongsNumber("G5624")!)).toBe(BH + "greek/5624.htm");
    expect(bibleHubUrl(parseStrongsNumber("G5625")!)).toBeNull();
    expect(bibleHubUrl(parseStrongsNumber("G9999")!)).toBeNull();
    expect(bibleHubUrl(parseStrongsNumber("H1")!)).toBe(BH + "hebrew/1.htm");
    expect(bibleHubUrl(parseStrongsNumber("H8674")!)).toBe(BH + "hebrew/8674.htm");
    expect(bibleHubUrl(parseStrongsNumber("H8675")!)).toBeNull();
    expect(bibleHubUrl(parseStrongsNumber("H9001")!)).toBeNull();
  });
});

describe("strongsConcordanceUrl — Bible Hub", () => {
  it("links the root number, whatever the sense", () => {
    expect(strongsConcordanceUrl("G4678", "G4678", "BibleHub")).toBe(BH + "greek/4678.htm");
    expect(strongsConcordanceUrl("H0430", "H0430G", "BibleHub")).toBe(BH + "hebrew/430.htm");
    expect(strongsConcordanceUrl("H1254a", "H1254B", "BibleHub")).toBe(BH + "hebrew/1254.htm");
    expect(strongsConcordanceUrl("H1254A", null, "BibleHub")).toBe(BH + "hebrew/1254.htm");
    expect(strongsConcordanceUrl("G0026", null, "BibleHub")).toBe(BH + "greek/26.htm");
  });

  it("range edges: G5624 and H8674 go to Bible Hub, G5625 and H8675 to STEPBible", () => {
    expect(strongsConcordanceUrl("G5624", "G5624", "BibleHub")).toBe(BH + "greek/5624.htm");
    expect(strongsConcordanceUrl("G5625", "G5625", "BibleHub")).toBe(STEP + "G5625");
    expect(strongsConcordanceUrl("H8674", "H8674", "BibleHub")).toBe(BH + "hebrew/8674.htm");
    expect(strongsConcordanceUrl("H8675", "H8675", "BibleHub")).toBe(STEP + "H8675");
  });

  it("falls back to the STEPBible link, sense letter and all, outside Bible Hub's range", () => {
    expect(strongsConcordanceUrl("H9001", "H9001G", "BibleHub")).toBe(STEP + "H9001G");
    expect(strongsConcordanceUrl("G6000a", null, "BibleHub")).toBe(STEP + "G6000A");
    // With no sense to go on, exactly what the STEPBible setting would link.
    expect(strongsConcordanceUrl("G6000", null, "BibleHub")).toBe(strongsConcordanceUrl("G6000", null, "STEPBible"));
  });

  it("is null for something that isn't a Strong's number", () => {
    expect(strongsConcordanceUrl("", null, "BibleHub")).toBeNull();
    expect(strongsConcordanceUrl("4678", "G4678", "BibleHub")).toBeNull();
    expect(strongsConcordanceUrl("G0", null, "BibleHub")).toBeNull();
  });
});

describe("strongsConcordanceUrl — Blue Letter Bible", () => {
  it("always links Blue Letter Bible's concordance: unpadded, no sense letter", () => {
    expect(strongsConcordanceUrl("G4678", "G4678", "BlueLetter")).toBe(BLB + "g4678/kjv/tr/0-1/");
    expect(strongsConcordanceUrl("G0026", null, "BlueLetter")).toBe(BLB + "g26/kjv/tr/0-1/");
    expect(strongsConcordanceUrl("H0430", "H0430G", "BlueLetter")).toBe(BLB + "h430/kjv/wlc/0-1/");
    expect(strongsConcordanceUrl("H1254A", null, "BlueLetter")).toBe(BLB + "h1254/kjv/wlc/0-1/");
    expect(strongsConcordanceUrl("H1254a", "H1254A", "BlueLetter")).toBe(BLB + "h1254/kjv/wlc/0-1/");
    expect(strongsConcordanceUrl("X1", null, "BlueLetter")).toBeNull();
  });
});

describe("strongsConcordanceUrl — an unknown target", () => {
  it("is treated as the default, Bible Hub", () => {
    expect(strongsConcordanceUrl("G4678", null, "Nope" as never)).toBe(BH + "greek/4678.htm");
  });
});

describe("link targets", () => {
  it("are Bible Hub, STEPBible and Blue Letter Bible, in that order", () => {
    expect(STRONGS_LINK_TARGETS).toEqual(["BibleHub", "STEPBible", "BlueLetter"]);
  });

  it("recognises only those", () => {
    for (const t of STRONGS_LINK_TARGETS) expect(isStrongsLinkTarget(t)).toBe(true);
    for (const t of ["", "biblehub", "STEP", null, undefined, 3, {}]) expect(isStrongsLinkTarget(t)).toBe(false);
  });
});
