// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, redo, undo } from "@codemirror/commands";
import {
  bakeResult,
  BAKE_FAILED_NOTICE,
  BAKE_STALE_NOTICE,
  InlineBakeJob,
  COMPARISON_BAKE_NOTICE,
  locateInlineBake,
} from "../src/inline-bake";
import { formatCalloutBake, formatCodeBlockBake } from "../src/baker";
import { parseInlineSpec } from "../src/parser";
import { formatStrongsHeader } from "../src/strongs";
import type { CachedVerse } from "../src/types";

const settings = { verseNewLine: false, showVerseNumbers: true, nativeCalloutType: "bible" };
const verse: CachedVerse = {
  reference: "Proverbs 3:5",
  translation: "KJV",
  bibleId: "eng_kjv",
  text: "Trust in the LORD with all thine heart",
  copyright: "",
  fetchedAt: 0,
};

function spec(token: string) {
  const parsed = parseInlineSpec(token.slice(1, -1));
  if (!parsed) throw new Error("bad test token");
  return parsed;
}

describe("one-passage strip bake", () => {
  it("is byte-identical to formatCodeBlockBake, including frozen false flags (#37)", () => {
    const s = spec("{John 3:16, no-nl, no-v}");
    const v = { ...verse, reference: "John 3:16", text: "For God so loved the world..." };
    const opts = { verseNewLine: false, showVerseNumbers: false };
    expect(bakeResult(v, s, settings, "unused")).toBe(formatCodeBlockBake(v, opts));
  });

  it("resolves inherited flags exactly as the existing fetch/bake path does", () => {
    const s = spec("{John 3:16}");
    const v = { ...verse, reference: "John 3:16" };
    expect(bakeResult(v, s, settings, "unused")).toBe(formatCodeBlockBake(v, {
      verseNewLine: false,
      showVerseNumbers: false,
    }));
  });

  it("writes the established Strong's header and adapted attribution", () => {
    const s = spec("{Proverbs 3:5, strongs, tr:5.0.15, mn:5.0.35=1}");
    const words = { transliterate: ["5.0.15"], meanings: { "5.0.35": "1" } };
    expect(bakeResult(verse, s, settings, "unused")).toBe(formatCodeBlockBake(verse, {
      verseNewLine: false,
      showVerseNumbers: false,
      strongs: formatStrongsHeader(words)!,
    }));
  });

  it("is byte-identical to formatCalloutBake for a native-callout token", () => {
    const s = spec("{John 3:16, nco-}");
    const url = "https://example.org/passage";
    expect(bakeResult(verse, s, settings, url)).toBe(formatCalloutBake(verse, "bible", true, url));
  });

  it("refuses comparisons instead of losing the other translations", () => {
    expect(bakeResult(verse, spec("{John 3:16, KJV, NIV}"), settings, "unused")).toBeNull();
    expect(COMPARISON_BAKE_NOTICE).toContain("comparison");
    expect(BAKE_FAILED_NOTICE).toContain("unchanged");
  });

  it("locates only the exact widget token at the current offset", () => {
    const token = "{John 3:16}";
    const text = `Before ${token} after`;
    const from = text.indexOf(token);
    expect(locateInlineBake(text, from, token)).toEqual({ from, to: from + token.length });
    expect(locateInlineBake(text, from, "{John 3:17}")).toBeNull();
    expect(locateInlineBake(text, from + 1, token)).toBeNull();
    expect(locateInlineBake(text, from, "not a token")).toBeNull();
    expect(locateInlineBake(text, -1, token)).toBeNull();
  });

  it("uses one real CodeMirror change which undo restores exactly", () => {
    const token = "{John 3:16}";
    const before = `Before ${token} after`;
    const view = new EditorView({ doc: before, extensions: [history()], parent: document.body });
    const insert = bakeResult({ ...verse, reference: "John 3:16" }, spec(token), settings, "unused")!;
    const range = locateInlineBake(before, before.indexOf(token), token)!;
    view.dispatch({ changes: { ...range, insert }, userEvent: "input.paste" });
    expect(view.state.doc.toString()).toBe(before.replace(token, insert));
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(before);
    expect(redo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(before.replace(token, insert));
    view.destroy();
  });
});

describe("InlineBakeJob lifecycle", () => {
  function source(token = "{John 3:16}") {
    const state = EditorState.create({ doc: token });
    return { state, posAtDOM: () => 0 } as unknown as EditorView;
  }

  const noFetch = async () => verse;

  it("failure leaves the token untouched and allows a successful retry", async () => {
    const notices: string[] = [];
    const job = new InlineBakeJob((m) => notices.push(m));
    const el = document.createElement("span");
    document.body.append(el);
    let attempts = 0;
    const run = () => job.run(source(), el, "{John 3:16}", spec("{John 3:16}"), settings, () => "", async () => {
      attempts++;
      return attempts === 1 ? null : verse;
    });
    expect((await run()).outcome).toBe("failed");
    expect(notices).toEqual([BAKE_FAILED_NOTICE]);
    const retry = await run();
    expect(retry.outcome).toBe("written");
    expect(retry.change?.changes.insert).toBe(bakeResult(verse, spec("{John 3:16}"), settings, ""));
    expect(attempts).toBe(2);
    el.remove();
  });

  it("detach during the await cancels without a write", async () => {
    const job = new InlineBakeJob(() => undefined);
    const el = document.createElement("span");
    document.body.append(el);
    let resolve!: (v: CachedVerse) => void;
    const pending = job.run(source(), el, "{John 3:16}", spec("{John 3:16}"), settings, () => "", () => new Promise((r) => { resolve = r; }));
    el.remove();
    resolve(verse);
    expect((await pending).outcome).toBe("cancelled");
  });

  it("a destroyed job is still cancelled after a later run starts", async () => {
    const job = new InlineBakeJob(() => undefined);
    const el = document.createElement("span");
    document.body.append(el);
    let resolveFirst!: (v: CachedVerse) => void;
    const first = job.run(source(), el, "{John 3:16}", spec("{John 3:16}"), settings, () => "", () => new Promise((r) => { resolveFirst = r; }));
    job.destroy();
    const second = await job.run(source(), el, "{John 3:16}", spec("{John 3:16}"), settings, () => "", noFetch);
    expect(second.outcome).toBe("written");
    resolveFirst(verse);
    expect((await first).outcome).toBe("cancelled");
    el.remove();
  });

  it("a double-click shares one fetch and cannot double-insert", async () => {
    const job = new InlineBakeJob(() => undefined);
    const el = document.createElement("span");
    document.body.append(el);
    let resolve!: (v: CachedVerse) => void;
    let attempts = 0;
    const fetch = async () => {
      attempts++;
      return new Promise<CachedVerse>((r) => { resolve = r; });
    };
    const args = [source(), el, "{John 3:16}", spec("{John 3:16}"), settings, () => "", fetch] as const;
    const first = job.run(...args);
    const second = await job.run(...args);
    expect(second.outcome).toBe("cancelled");
    expect(job.busy).toBe(true);
    resolve(verse);
    expect((await first).outcome).toBe("written");
    expect(attempts).toBe(1);
    el.remove();
  });

  it("destroy while fetching cancels the write even if the fetch later resolves", async () => {
    const notices: string[] = [];
    const job = new InlineBakeJob((m) => notices.push(m));
    const el = document.createElement("span");
    document.body.append(el);
    let resolve!: (v: CachedVerse) => void;
    const pending = job.run(source(), el, "{John 3:16}", spec("{John 3:16}"), settings, () => "", () => new Promise((r) => { resolve = r; }));
    job.destroy();
    resolve(verse);
    expect((await pending).outcome).toBe("cancelled");
    expect(notices).toEqual([]);
    el.remove();
  });

  it("detached and stale tokens cannot rewrite surrounding text", async () => {
    const notices: string[] = [];
    const job = new InlineBakeJob((m) => notices.push(m));
    const detached = document.createElement("span");
    expect((await job.run(source(), detached, "{John 3:16}", spec("{John 3:16}"), settings, () => "", noFetch)).outcome).toBe("cancelled");
    const el = document.createElement("span");
    document.body.append(el);
    const stale = await job.run(source("{John 3:17}"), el, "{John 3:16}", spec("{John 3:16}"), settings, () => "", noFetch);
    expect(stale).toEqual({ outcome: "failed" });
    expect(notices).toEqual([BAKE_STALE_NOTICE]);
    el.remove();
  });

  it("comparison refusal emits a Notice before any fetch", async () => {
    const notices: string[] = [];
    const job = new InlineBakeJob((m) => notices.push(m));
    const el = document.createElement("span");
    document.body.append(el);
    let fetched = false;
    const result = await job.run(source(), el, "{John 3:16, KJV, NIV}", spec("{John 3:16, KJV, NIV}"), settings, () => "", async () => {
      fetched = true;
      return verse;
    });
    expect(result.outcome).toBe("comparison");
    expect(fetched).toBe(false);
    expect(notices).toEqual([COMPARISON_BAKE_NOTICE]);
    el.remove();
  });

  it("a thrown dispatch can be surfaced as a retryable failure by the caller", () => {
    // view-plugin's dispatch wrapper owns this final catch: if CodeMirror
    // synchronized DOM updates already removed the widget, the job returned a
    // valid change before removal and the wrapper reports it without a second
    // automatic dispatch. No post-catch retry is scheduled here.
    expect(BAKE_FAILED_NOTICE).toContain("try Bake again");
  });

  it("a rejected fetch is reported and may be retried", async () => {
    const notices: string[] = [];
    const job = new InlineBakeJob((m) => notices.push(m));
    const el = document.createElement("span");
    document.body.append(el);
    expect((await job.run(source(), el, "{John 3:16}", spec("{John 3:16}"), settings, () => "", async () => {
      throw new Error("offline");
    })).outcome).toBe("failed");
    expect(notices).toEqual([BAKE_FAILED_NOTICE]);
    el.remove();
  });
});
