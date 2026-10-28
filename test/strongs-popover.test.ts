// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { closeStrongsPopover, decorateStrongs, StrongsLayer } from "../src/strongs-dom";
import type { StrongsLinkTarget } from "../src/types";
import { chooseSense, meaningsOf, LexiconEntry, LexiconSense, StrongsWord, WordDisplayState } from "../src/strongs";

/**
 * The Strong's popover in a DOM: an entry with no numbered meanings shows its
 * gloss as a meaning row that is picked, styled and inserted exactly like a
 * numbered one, and an entry with numbered meanings shows them as before.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const lexicon = (n: string) =>
  (JSON.parse(readFileSync(join(HERE, "fixtures", "data", "lexicon", `${n}.json`), "utf8")) as { entry: LexiconEntry })
    .entry;

// Obsidian's DOM helpers, which it adds to every element at runtime.
beforeAll(() => {
  type Opts = { cls?: string; text?: string; attr?: Record<string, string>; href?: string };
  const P = HTMLElement.prototype as unknown as Record<string, unknown>;
  function make(this: HTMLElement | null, tag: string, o?: Opts): HTMLElement {
    const el = document.createElement(tag);
    if (o?.cls) el.className = o.cls;
    if (o?.text !== undefined) el.textContent = o.text;
    if (o?.href) el.setAttribute("href", o.href);
    for (const [k, v] of Object.entries(o?.attr ?? {})) el.setAttribute(k, v);
    this?.appendChild(el);
    return el;
  }
  P.createEl = function (this: HTMLElement, tag: string, o?: Opts) { return make.call(this, tag, o); };
  P.createDiv = function (this: HTMLElement, o?: Opts) { return make.call(this, "div", o); };
  P.createSpan = function (this: HTMLElement, o?: Opts) { return make.call(this, "span", o); };
  P.empty = function (this: HTMLElement) { this.replaceChildren(); };
  P.setText = function (this: HTMLElement, t: string) { this.textContent = t; };
  P.appendText = function (this: HTMLElement, t: string) { this.append(t); };
  P.addClass = function (this: HTMLElement, c: string) { this.classList.add(c); };
  P.toggleClass = function (this: HTMLElement, c: string, on: boolean) { this.classList.toggle(c, on); };
  P.setAttr = function (this: HTMLElement, k: string, v: string) { this.setAttribute(k, v); };
  P.setCssProps = function (this: HTMLElement, props: Record<string, string>) {
    for (const [k, v] of Object.entries(props)) this.style.setProperty(k, v);
  };
  (globalThis as unknown as { createDiv: (o?: Opts) => HTMLElement }).createDiv = (o) => make.call(null, "div", o);
});

afterEach(() => {
  closeStrongsPopover();
  document.body.replaceChildren();
});

const marked = (i: number, text: string) => "\uE000" + String.fromCharCode(0xe100 + i) + text + "\uE001";

/** A verse with one tagged word, decorated, plus what the writer was asked to do. */
function verse(number: string, english: string) {
  const word: StrongsWord = { key: "3.0.15", verse: 3, english, number };
  const calls = { setWords: [] as WordDisplayState[], insert: [] as (string | null)[] };
  const layer: StrongsLayer = {
    words: [word],
    state: { transliterate: [], meanings: {} },
    transliterations: new Map(),
    meaningTexts: new Map(),
    wordPicks: () => false,
    linkTarget: () => "STEPBible" as StrongsLinkTarget,
    translation: "KJV",
    lookup: async () => lexicon(number),
    writer: {
      setWords: (s) => calls.setWords.push(s),
      insertLineBelow: (_w: StrongsWord, _s: LexiconSense | null, label: string | null) => calls.insert.push(label),
    },
  };
  const root = document.createElement("div");
  root.className = "bible-verse";
  root.innerHTML = `<span class="bible-verse-ref">James 1:3 (KJV)</span><div class="body">the ${marked(0, english)} of your faith</div>`;
  document.body.appendChild(root);
  decorateStrongs(root.querySelector<HTMLElement>(".body")!, layer);
  const span = root.querySelector<HTMLElement>(".bible-verse-strongs-word")!;
  return { word, layer, calls, root, span };
}

const settle = () => new Promise((r) => setTimeout(r, 30));

async function hover(span: HTMLElement): Promise<HTMLElement> {
  span.dispatchEvent(new Event("mouseenter"));
  await new Promise((r) => setTimeout(r, 200));
  await settle();
  return document.querySelector<HTMLElement>(".bible-verse-strongs-popover")!;
}

const rows = (pop: HTMLElement) => Array.from(pop.querySelectorAll<HTMLElement>(".bible-verse-strongs-meaning"));
const button = (pop: HTMLElement, text: string) =>
  Array.from(pop.querySelectorAll("button")).find((b) => b.textContent === text)!;

describe("popover — G1383 \"testing\", a single unnumbered gloss", () => {
  it("shows the gloss as a meaning row, not a static label", async () => {
    const { span } = verse("G1383", "trying");
    const pop = await hover(span);
    expect(pop.querySelector(".bible-verse-strongs-gloss")).toBeNull();
    const [row, ...rest] = rows(pop);
    expect(rest).toEqual([]);
    expect(row.querySelector(".bible-verse-strongs-meaning-label")!.textContent).toBe("1");
    expect(row.querySelector(".bible-verse-strongs-meaning-text")!.textContent).toBe("testing");
    expect(row.getAttribute("role")).toBe("button");
    expect(row.getAttribute("tabindex")).toBe("0");
    expect(row.getAttribute("aria-pressed")).toBe("false");
    expect(pop.querySelector(".bible-verse-strongs-hint")!.textContent).toBe("Pick a meaning to show it in the verse.");
    // The lexicon text and the credit are still there, below the row.
    expect(pop.querySelector(".bible-verse-strongs-definition")!.textContent).toContain("variant form of");
    expect(pop.querySelector(".bible-verse-strongs-credit")!.textContent).toBe(
      "STEPBible lexicon, CC BY 4.0, STEPBible.org / Tyndale House"
    );
    expect(button(pop, "Show as dokimion")).toBeTruthy();
    expect(button(pop, "Insert below")).toBeTruthy();
  });

  it("picks it like a numbered meaning: the verse, the token, the selected row, Insert below", async () => {
    const { span, calls, root } = verse("G1383", "trying");
    let pop = await hover(span);
    rows(pop)[0].click();
    await settle();

    expect(span.textContent).toBe("testing");
    expect(span.classList.contains("is-meaning")).toBe(true);
    expect(calls.setWords).toEqual([{ transliterate: [], meanings: { "3.0.15": "1" } }]);
    expect(root.querySelector(".bible-verse-ref")!.textContent).toBe("James 1:3 (KJV-Strong's)");

    pop = document.querySelector<HTMLElement>(".bible-verse-strongs-popover")!;
    const row = rows(pop)[0];
    expect(row.classList.contains("is-selected")).toBe(true);
    expect(row.getAttribute("aria-pressed")).toBe("true");
    expect(button(pop, 'Show "trying"')).toBeTruthy();

    button(pop, "Insert below").click();
    expect(calls.insert).toEqual(["1"]);
  });

  it("answers Enter as a numbered row does, and a second pick puts the English back", async () => {
    const { span, calls } = verse("G1383", "trying");
    let pop = await hover(span);
    rows(pop)[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    expect(span.textContent).toBe("testing");

    pop = document.querySelector<HTMLElement>(".bible-verse-strongs-popover")!;
    rows(pop)[0].click();
    await settle();
    expect(span.textContent).toBe("trying");
    expect(calls.setWords.at(-1)).toEqual({ transliterate: [], meanings: {} });
  });

  it("then Show as dokimion swaps the meaning for the transliteration", async () => {
    const { span, calls } = verse("G1383", "trying");
    let pop = await hover(span);
    rows(pop)[0].click();
    await settle();
    pop = document.querySelector<HTMLElement>(".bible-verse-strongs-popover")!;
    button(pop, "Show as dokimion").click();
    await settle();
    expect(span.textContent).toBe("dokimion");
    expect(calls.setWords.at(-1)).toEqual({ transliterate: ["3.0.15"], meanings: {} });
  });
});

describe("popover — Hebrew single gloss and an unnumbered gloss of two words", () => {
  it("H0002 \"father\" is one row", async () => {
    const pop = await hover(verse("H0002", "father").span);
    expect(rows(pop).map((r) => r.textContent)).toEqual(["1father"]);
  });

  it("G1672 \"Greek, Gentile\" is one row whose words are picks with word picks on", async () => {
    const v = verse("G1672", "Greeks");
    v.layer.wordPicks = () => true;
    const pop = await hover(v.span);
    expect(rows(pop).length).toBe(1);
    const alts = Array.from(pop.querySelectorAll<HTMLElement>(".bible-verse-strongs-alt")).map((a) => a.textContent);
    expect(alts).toEqual(["Greek", "Gentile"]);
    pop.querySelectorAll<HTMLElement>(".bible-verse-strongs-alt")[1].click();
    await settle();
    expect(v.span.textContent).toBe("Gentile");
    expect(v.calls.setWords.at(-1)).toEqual({ transliterate: [], meanings: { "3.0.15": "1~2" } });
  });
});

describe("popover — numbered meanings are unchanged", () => {
  it.each(["H1870", "H7911", "H0982", "G0026"])("%s keeps its gloss heading and only its numbered rows", async (n) => {
    const pop = await hover(verse(n, "word").span);
    const sense = chooseSense(lexicon(n))!;
    expect(pop.querySelector(".bible-verse-strongs-gloss")!.textContent).toBe(sense.gloss);
    const labels = rows(pop).map((r) => r.querySelector(".bible-verse-strongs-meaning-label")!.textContent);
    expect(labels).toEqual(meaningsOf(sense.definition).map((m) => m.label));
  });
});

describe("popover — the Strong's number links to every verse using it", () => {
  const numberLink = (pop: HTMLElement) => pop.querySelector<HTMLAnchorElement>(".bible-verse-strongs-head a")!;

  it.each([
    ["G1383", "https://www.stepbible.org/?q=strong=G1383"],
    ["G0026", "https://www.stepbible.org/?q=strong=G0026"],
    ["H0982", "https://www.stepbible.org/?q=strong=H0982"],
    ["H1870", "https://www.stepbible.org/?q=strong=H1870G"],
    ["H3068", "https://www.stepbible.org/?q=strong=H3068G"],
  ])("%s links to %s", async (n, url) => {
    const pop = await hover(verse(n, "word").span);
    const a = numberLink(pop);
    expect(a.textContent).toBe(n);
    expect(a.classList.contains("bible-verse-strongs-number")).toBe(true);
    expect(a.getAttribute("href")).toBe(url);
    expect(a.getAttribute("title")).toBe(`See all uses of ${n}`);
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener");
    // Only the number is a link; the rest of the header is plain text.
    expect(pop.querySelectorAll(".bible-verse-strongs-head a").length).toBe(1);
  });

  it("goes to Blue Letter Bible when there is no lexicon entry", async () => {
    const v = verse("H0430", "God");
    v.layer.lookup = async () => null;
    const a = numberLink(await hover(v.span));
    expect(a.getAttribute("href")).toBe("https://www.blueletterbible.org/lexicon/h430/kjv/wlc/0-1/");
    expect(a.textContent).toBe("H0430");
  });

  it("stays plain text for a number it can't read", async () => {
    const v = verse("X12", "word");
    v.layer.lookup = async () => null;
    const pop = await hover(v.span);
    expect(pop.querySelector(".bible-verse-strongs-head a")).toBeNull();
    expect(pop.querySelector(".bible-verse-strongs-number")!.textContent).toBe("X12");
  });

  it("a click stops at the link: the popover stays, the word and the note are untouched", async () => {
    const { span, calls } = verse("G1383", "trying");
    const pop = await hover(span);
    let reachedBody = false;
    const onBody = () => (reachedBody = true);
    document.body.addEventListener("click", onBody);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    numberLink(pop).dispatchEvent(click);
    document.body.removeEventListener("click", onBody);
    await settle();
    // Not cancelled: the browser (Obsidian) follows the link as it does the credit.
    expect(click.defaultPrevented).toBe(false);
    expect(reachedBody).toBe(false);
    expect(document.querySelector(".bible-verse-strongs-popover")).toBe(pop);
    expect(pop.isConnected).toBe(true);
    expect(span.textContent).toBe("trying");
    expect(calls.setWords).toEqual([]);
    expect(calls.insert).toEqual([]);
    // The meaning row and buttons still work afterwards.
    rows(pop)[0].click();
    await settle();
    expect(span.textContent).toBe("testing");
    expect(button(document.querySelector<HTMLElement>(".bible-verse-strongs-popover")!, 'Show "trying"')).toBeTruthy();
  });
});

describe("popover — the number link follows the \"Strong's number link\" setting", () => {
  const href = (pop: HTMLElement) => pop.querySelector<HTMLAnchorElement>(".bible-verse-strongs-head a")!.getAttribute("href");

  it.each([
    ["BibleHub", "G1383", "https://biblehub.com/greek/1383.htm"],
    ["BibleHub", "H1870", "https://biblehub.com/hebrew/1870.htm"],
    ["BibleHub", "G0026", "https://biblehub.com/greek/26.htm"],
    ["STEPBible", "H1870", "https://www.stepbible.org/?q=strong=H1870G"],
    ["BlueLetter", "H1870", "https://www.blueletterbible.org/lexicon/h1870/kjv/wlc/0-1/"],
    ["BlueLetter", "G0026", "https://www.blueletterbible.org/lexicon/g26/kjv/tr/0-1/"],
  ] as [StrongsLinkTarget, string, string][])("%s: %s links to %s", async (target, n, url) => {
    const v = verse(n, "word");
    v.layer.linkTarget = () => target;
    const pop = await hover(v.span);
    expect(href(pop)).toBe(url);
    expect(pop.querySelector(".bible-verse-strongs-head a")!.getAttribute("title")).toBe(`See all uses of ${n}`);
  });

  it("reads the setting each time the popover opens", async () => {
    let target: StrongsLinkTarget = "BibleHub";
    const v = verse("G1383", "trying");
    v.layer.linkTarget = () => target;
    expect(href(await hover(v.span))).toBe("https://biblehub.com/greek/1383.htm");
    closeStrongsPopover();
    target = "BlueLetter";
    expect(href(await hover(v.span))).toBe("https://www.blueletterbible.org/lexicon/g1383/kjv/tr/0-1/");
    closeStrongsPopover();
    target = "STEPBible";
    expect(href(await hover(v.span))).toBe("https://www.stepbible.org/?q=strong=G1383");
  });
});
