// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { EditorState, StateField } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import type { BibleReference, CachedVerse } from "../src/types";

/**
 * The Bake button driven through a real CodeMirror EditorView and the real
 * Live Preview view plugin (#84). Clicks go to the rendered buttons; nothing
 * calls widget internals. The regression this guards: a shift or toggle still
 * waiting on its settle timer, then an immediate Bake, used to flush the
 * shift first, which destroyed the widget and silently dropped the bake.
 */

const notices: string[] = [];
const livePreview = StateField.define<boolean>({ create: () => true, update: (v) => v });

vi.mock("obsidian", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Notice: class {
      constructor(message: string) {
        notices.push(message);
      }
    },
    setIcon: () => undefined,
    editorLivePreviewField: livePreview,
    MarkdownRenderer: {
      render: async (_app: unknown, md: string, el: HTMLElement) => {
        el.append(md);
      },
    },
    Component: class {},
  };
});

// Imported after the mock so the plugin sees the stubbed `obsidian`.
const { buildViewPlugin } = await import("../src/view-plugin");
const { formatCodeBlockBake } = await import("../src/baker");
const { formatReference } = await import("../src/parser");

beforeAll(() => {
  type Opts = { cls?: string; text?: string; attr?: Record<string, string>; href?: string };
  function make(this: Node | null, tag: string, o?: Opts): HTMLElement {
    const el = document.createElement(tag);
    if (o?.cls) el.className = o.cls;
    if (o?.text !== undefined) el.textContent = o.text;
    if (o?.href) el.setAttribute("href", o.href);
    for (const [k, v] of Object.entries(o?.attr ?? {})) el.setAttribute(k, v);
    this?.appendChild(el);
    return el;
  }
  const N = Node.prototype as unknown as Record<string, unknown>;
  N.createEl = function (this: Node, tag: string, o?: Opts) { return make.call(this, tag, o); };
  N.createDiv = function (this: Node, o?: Opts) { return make.call(this, "div", o); };
  N.createSpan = function (this: Node, o?: Opts) { return make.call(this, "span", o); };
  const P = HTMLElement.prototype as unknown as Record<string, unknown>;
  P.empty = function (this: HTMLElement) { this.replaceChildren(); };
  P.addClass = function (this: HTMLElement, c: string) { this.classList.add(c); };
  P.removeClass = function (this: HTMLElement, c: string) { this.classList.remove(c); };
  P.toggleClass = function (this: HTMLElement, c: string, on: boolean) { this.classList.toggle(c, on); };
  P.setAttr = function (this: HTMLElement, k: string, v: string) { this.setAttribute(k, v); };
  const g = globalThis as unknown as Record<string, unknown>;
  g.createSpan = (o?: Opts) => make.call(null, "span", o);
  g.createDiv = (o?: Opts) => make.call(null, "div", o);
  g.createEl = (tag: string, o?: Opts) => make.call(null, tag, o);
  g.activeDocument = document;
  if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0);
  }
});

afterEach(() => {
  notices.length = 0;
  document.body.replaceChildren();
});

const settings = {
  verseNewLine: false,
  showVerseNumbers: false,
  paragraphBreaks: false,
  displayStyle: "callout",
  defaultTranslation: "eng_kjv",
  preferredWebsite: "biblegateway",
  showAttribution: false,
  nativeCalloutType: "quote",
  bakeInline: false,
};

function verseFor(ref: BibleReference, vn = false): CachedVerse {
  const reference = formatReference(ref);
  return {
    reference,
    translation: "KJV",
    bibleId: "eng_kjv",
    text: `${vn ? "16. " : ""}text of ${reference}`,
    copyright: "",
    fetchedAt: 0,
    numberOfVerses: 36,
  };
}

type BakeCall = { ref: string; nl?: boolean; vn?: boolean };

/**
 * A plugin stand-in: a memoized cache (widgets compare cached verses by
 * identity) and a bake fetch whose outcome each test scripts.
 */
function fakePlugin(bake: (call: BakeCall) => Promise<CachedVerse | null>) {
  const memo = new Map<string, CachedVerse>();
  const calls: BakeCall[] = [];
  const plugin = {
    settings,
    app: {},
    cache: {
      get: (_abbr: string, label: string, _nl: boolean, vn: boolean) => {
        const key = `${label}|${vn}`;
        return memo.get(key) ?? null;
      },
    },
    isTranslationLinkOnly: () => false,
    resolveTranslationIdPublic: (t: string) => t,
    getTranslationAbbrPublic: () => "KJV",
    generateLinkPublic: () => "https://example.org",
    findTranslation: () => undefined,
    strongsBlocker: () => "not here",
    fetchFromProvider: async () => {
      throw new Error("prefetch not needed");
    },
    fetchVerseForBake: async (
      ref: BibleReference,
      _id?: string,
      _abbr?: string,
      nl?: boolean,
      vn?: boolean
    ) => {
      const call = { ref: formatReference(ref), nl, vn };
      calls.push(call);
      return bake(call);
    },
  };
  /** Seed the cache so a token renders with its strip straight away. */
  const seed = (refLabel: string, ref: BibleReference) => memo.set(`${refLabel}|false`, verseFor(ref));
  return { plugin, calls, seed };
}

function ref(start: number, end: number | null = null): BibleReference {
  return { book: "John", chapter: 3, startVerse: start, endVerse: end, additionalVerses: [], raw: "" };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

async function mount(doc: string, plugin: unknown) {
  const changes: string[] = [];
  const view = new EditorView({
    state: EditorState.create({
      doc,
      // Cursor away from the token so the decoration renders.
      selection: { anchor: doc.length },
      extensions: [
        livePreview,
        history(),
        buildViewPlugin(plugin as never),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) changes.push(u.state.doc.toString());
        }),
      ],
    }),
    parent: document.body,
  });
  await settle();
  return { view, changes };
}

function button(view: EditorView, selector: string): HTMLButtonElement {
  const btn = view.contentDOM.querySelector<HTMLButtonElement>(selector);
  if (!btn) throw new Error(`no ${selector} in the rendered widget`);
  return btn;
}

const BEFORE = "Read {John 3:16} today.";
/** The token's line once baked: prose kept on its own lines around the fence. */
const baked = (block: string) => `Read\n${block}\ntoday.`;
const plus = ".bible-verse-shift-btn[data-delta='1']";
const numbers = ".bible-verse-toggle-btn[data-flag='showVerseNumbers']";
const bakeBtn = ".bible-verse-bake-btn";

describe("Bake through the real Live Preview widget (#84)", () => {
  it("shift then immediate Bake: bakes the shifted range, exactly once, one undo step", async () => {
    const { plugin, calls, seed } = fakePlugin(async (c) => verseFor(c.ref === "John 3:16-17" ? ref(16, 17) : ref(16)));
    seed("John 3:16", ref(16));
    const { view, changes } = await mount(BEFORE, plugin);

    button(view, plus).click(); // pending, settle timer not yet fired
    button(view, bakeBtn).click(); // immediately
    await settle();

    const expected = baked(formatCodeBlockBake(verseFor(ref(16, 17)), { verseNewLine: false, showVerseNumbers: false }));
    expect(calls.map((c) => c.ref)).toEqual(["John 3:16-17"]);
    expect(view.state.doc.toString()).toBe(expected);
    expect(changes).toEqual([expected]); // one transaction; the shift was never written separately
    expect(view.contentDOM.querySelector(bakeBtn)).toBeNull(); // gone with the live token

    // Wait past the settle window: nothing fires late against the note.
    await new Promise((r) => setTimeout(r, 300));
    expect(changes).toHaveLength(1);

    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(BEFORE);
    view.destroy();
  });

  it("toggle then immediate Bake: the baked header freezes the toggled flag", async () => {
    const { plugin, calls, seed } = fakePlugin(async () => verseFor(ref(16), true));
    seed("John 3:16", ref(16));
    const { view, changes } = await mount(BEFORE, plugin);

    button(view, numbers).click(); // inherited off -> pinned on, still pending
    button(view, bakeBtn).click();
    await settle();

    expect(calls).toEqual([{ ref: "John 3:16", nl: false, vn: true }]);
    const expected = baked(formatCodeBlockBake(verseFor(ref(16), true), { verseNewLine: false, showVerseNumbers: true }));
    expect(view.state.doc.toString()).toBe(expected);
    expect(changes).toHaveLength(1);
    expect(view.state.doc.toString()).toContain("numbers: true");
    view.destroy();
  });

  it("double-click Bake fetches once and inserts once", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { plugin, calls, seed } = fakePlugin(async () => { await gate; return verseFor(ref(16)); });
    seed("John 3:16", ref(16));
    const { view, changes } = await mount(BEFORE, plugin);

    const btn = button(view, bakeBtn);
    btn.click();
    btn.click();
    release();
    await settle();

    expect(calls).toHaveLength(1);
    expect(changes).toHaveLength(1);
    expect(view.state.doc.toString().match(/```bible/g)).toHaveLength(1);
    view.destroy();
  });

  it("failed bake after a shift keeps the shift, leaves a live token, and Bake retries", async () => {
    let fail = true;
    const { plugin, calls, seed } = fakePlugin(async (c) => (fail ? null : verseFor(c.ref === "John 3:16-17" ? ref(16, 17) : ref(16))));
    seed("John 3:16", ref(16));
    seed("John 3:16-17", ref(16, 17));
    const { view, changes } = await mount(BEFORE, plugin);

    button(view, plus).click();
    button(view, bakeBtn).click();
    await settle();

    expect(notices.some((n) => n.includes("unchanged"))).toBe(true);
    // The shift the bake had absorbed is written as an ordinary edit.
    expect(view.state.doc.toString()).toBe("Read {John 3:16-17} today.");
    expect(changes).toHaveLength(1);

    fail = false;
    button(view, bakeBtn).click(); // the rebuilt widget's Bake
    await settle();

    expect(calls.map((c) => c.ref)).toEqual(["John 3:16-17", "John 3:16-17"]);
    expect(view.state.doc.toString()).toBe(
      baked(formatCodeBlockBake(verseFor(ref(16, 17)), { verseNewLine: false, showVerseNumbers: false }))
    );
    expect(changes).toHaveLength(2);
    view.destroy();
  });

  it("a plain failed bake leaves the note untouched and Bake usable", async () => {
    let fail = true;
    const { plugin, seed } = fakePlugin(async () => (fail ? null : verseFor(ref(16))));
    seed("John 3:16", ref(16));
    const { view, changes } = await mount(BEFORE, plugin);

    button(view, bakeBtn).click();
    await settle();
    expect(view.state.doc.toString()).toBe(BEFORE);
    expect(changes).toHaveLength(0);
    const btn = button(view, bakeBtn);
    expect(btn.disabled).toBe(false);

    fail = false;
    btn.click();
    await settle();
    expect(view.state.doc.toString()).toContain("```bible");
    view.destroy();
  });

  it("controls clicked while a bake is in flight are frozen and do not cancel it", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { plugin, calls, seed } = fakePlugin(async () => { await gate; return verseFor(ref(16)); });
    seed("John 3:16", ref(16));
    const { view, changes } = await mount(BEFORE, plugin);

    button(view, bakeBtn).click();
    button(view, plus).click(); // ignored while baking
    await new Promise((r) => setTimeout(r, 300)); // past the settle window
    expect(changes).toHaveLength(0);
    release();
    await settle();

    expect(calls.map((c) => c.ref)).toEqual(["John 3:16"]);
    expect(changes).toHaveLength(1);
    expect(view.state.doc.toString()).toContain("John 3:16\ntranslation: KJV");
    view.destroy();
  });

  it("a widget destroyed for another reason mid-fetch never writes", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { plugin, seed } = fakePlugin(async () => { await gate; return verseFor(ref(16)); });
    seed("John 3:16", ref(16));
    seed("John 3:18", ref(18));
    const { view, changes } = await mount(BEFORE, plugin);

    button(view, bakeBtn).click();
    // The user edits the token by hand: the old widget is destroyed.
    const at = BEFORE.indexOf("16");
    view.dispatch({ changes: { from: at, to: at + 2, insert: "18" } });
    release();
    await settle();

    expect(view.state.doc.toString()).toBe("Read {John 3:18} today.");
    expect(changes).toHaveLength(1);
    view.destroy();
  });
});
