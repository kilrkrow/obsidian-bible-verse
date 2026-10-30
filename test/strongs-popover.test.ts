// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { closeStrongsPopover, decorateStrongs, StrongsLayer } from "../src/strongs-dom";
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

describe("popover — the gloss beside numbered meanings", () => {
  it.each(["H1870", "G0026", "G4124"])("%s lists its gloss first, unnumbered, then its numbered rows", async (n) => {
    const pop = await hover(verse(n, "word").span);
    const sense = chooseSense(lexicon(n))!;
    expect(pop.querySelector(".bible-verse-strongs-gloss")).toBeNull();
    const [first, ...rest] = rows(pop);
    expect(first.classList.contains("is-gloss")).toBe(true);
    expect(first.querySelector(".bible-verse-strongs-meaning-label")!.textContent).toBe("");
    expect(first.querySelector(".bible-verse-strongs-meaning-text")!.textContent).toBe(sense.gloss!.replace(/[\s,;:.]+$/, ""));
    const labels = rest.map((r) => r.querySelector(".bible-verse-strongs-meaning-label")!.textContent);
    expect(labels).toEqual(meaningsOf(sense.definition).map((m) => m.label));
  });

  it("G4124 shows \"greediness\" in the verse when its gloss row is picked", async () => {
    const v = verse("G4124", "covetousness");
    const pop = await hover(v.span);
    rows(pop)[0].click();
    await settle();
    expect(v.span.textContent).toBe("greediness");
    expect(v.calls.setWords.at(-1)).toEqual({ transliterate: [], meanings: { "3.0.15": "gloss" } });
  });

  it.each(["H0982", "H7911"])("%s keeps its gloss heading, since a numbered meaning reads the same", async (n) => {
    const pop = await hover(verse(n, "word").span);
    const sense = chooseSense(lexicon(n))!;
    expect(pop.querySelector(".bible-verse-strongs-gloss")!.textContent).toBe(sense.gloss);
    const labels = rows(pop).map((r) => r.querySelector(".bible-verse-strongs-meaning-label")!.textContent);
    expect(labels).toEqual(meaningsOf(sense.definition).map((m) => m.label));
  });
});
