// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parser } from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import { Baker, formatCalloutBake, formatCodeBlockBake, placeBakedBlock } from "../src/baker";
import { InlineBakeJob } from "../src/inline-bake";
import { parseInlineSpec } from "../src/parser";
import type { App } from "obsidian";
import type { CachedVerse } from "../src/types";

/**
 * Bake placement in nested containers, lazy continuations, tab-separated list
 * markers and CRLF notes. Results are parsed with a CommonMark parser and the
 * fence's container chain, open/close lines and surviving prose are asserted.
 */

const v = (reference: string, text: string): CachedVerse => ({
  reference, translation: "KJV", bibleId: "eng_kjv", text, copyright: "", fetchedAt: 0,
});
const V16 = v("John 3:16", "For God so loved the world");
const V17 = v("John 3:17", "For God sent not his Son");
const opts = { verseNewLine: false, showVerseNumbers: false };
const FENCE16 = formatCodeBlockBake(V16, opts);
const byRef: Record<string, CachedVerse> = { "John 3:16": V16, "John 3:17": V17 };
const T = "{John 3:16}";
const baker = new Baker({} as App);
const viaBakeVerse = (content: string, raw = T, verse = V16) => baker.bakeVerse(content, raw, verse, "inline", { format: "codeblock", ...opts });
const viaBakeFile = (content: string) => baker.bakeFile(content, true, async (ref) => byRef[`${ref.book} ${ref.chapter}:${ref.startVerse}`] ?? null, opts);
const viaHelper = (content: string, block: string, raw = T) => { const at = content.indexOf(raw); const c = placeBakedBlock(content, at, at + raw.length, block); return content.slice(0, c.from) + c.insert + content.slice(c.to); };

interface Block { kind: string; in: string; text: string; startLine: number; endLine: number }
function blocks(md: string): Block[] {
  const src = md.replace(/\r\n/g, "\n");
  const tree = parser.parse(src);
  const lineOf = (pos: number) => src.slice(0, pos).split("\n").length - 1;
  const containers = new Set(["Blockquote", "BulletList", "OrderedList", "ListItem"]);
  const out: Block[] = [];
  tree.iterate({
    enter: (n) => {
      if (n.name !== "Paragraph" && n.name !== "FencedCode") return;
      const chain: string[] = [];
      for (let p: SyntaxNode | null = n.node.parent; p; p = p.parent) if (containers.has(p.name)) chain.unshift(p.name);
      const text = src.slice(n.from, n.to).split("\n").map((l) => l.replace(/^[\s>]*/, "").trim()).join("\n");
      out.push({ kind: n.name, in: chain.join("/"), text, startLine: lineOf(n.from), endLine: lineOf(n.to) });
      return false;
    },
  });
  return out;
}
const shape = (md: string) => blocks(md).map((b) => [b.kind, b.text.split("\n")[0], b.in]);
const FENCE_OK = (md: string) => {
  const b = blocks(md).find((x) => x.kind === "FencedCode");
  expect(b).toBeDefined();
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  expect(lines[b!.startLine]).toMatch(/```bible$/);
  expect(lines[b!.endLine]).toMatch(/```$/);
  expect(b!.text).toBe(FENCE16);
  return b!;
};
const noMixedEndings = (s: string) => {
  const lf = (s.match(/\n/g) || []).length;
  const crlf = (s.match(/\r\n/g) || []).length;
  expect([lf, crlf]).toEqual([lf, lf]);
  expect(/\r(?!\n)/.test(s)).toBe(false);
};

describe("nested containers", () => {
  it("- > A {ref} B: fence and both prose parts stay in the quote inside the list item", () => {
    const out = viaBakeVerse("- > A {John 3:16} B\n- next");
    expect(shape(out)).toEqual([
      ["Paragraph", "A", "BulletList/ListItem/Blockquote"],
      ["FencedCode", "```bible", "BulletList/ListItem/Blockquote"],
      ["Paragraph", "B", "BulletList/ListItem/Blockquote"],
      ["Paragraph", "next", "BulletList/ListItem"],
    ]);
    const f = FENCE_OK(out);
    expect(out.split("\n")[f.startLine]).toBe("  > ```bible");
  });

  it("- - {ref}: fence opens on the marker line inside the inner list item", () => {
    const out = viaBakeVerse("- - {John 3:16}\n- next");
    expect(out.split("\n")[0]).toBe("- - ```bible");
    expect(out.split("\n")[1]).toBe("    John 3:16");
    expect(shape(out)).toEqual([
      ["FencedCode", "```bible", "BulletList/ListItem/BulletList/ListItem"],
      ["Paragraph", "next", "BulletList/ListItem"],
    ]);
    FENCE_OK(out);
  });

  it("> - {ref} tail: fence and tail stay in the list item inside the quote", () => {
    const out = viaBakeVerse("> - {John 3:16} tail\n\nafter");
    expect(shape(out)).toEqual([
      ["FencedCode", "```bible", "Blockquote/BulletList/ListItem"],
      ["Paragraph", "tail", "Blockquote/BulletList/ListItem"],
      ["Paragraph", "after", ""],
    ]);
    FENCE_OK(out);
  });

  it("1. > A {ref} B: quote inside an ordered item keeps both markers", () => {
    const out = viaBakeVerse("1. > A {John 3:16} B\n2. two");
    expect(shape(out)).toEqual([
      ["Paragraph", "A", "OrderedList/ListItem/Blockquote"],
      ["FencedCode", "```bible", "OrderedList/ListItem/Blockquote"],
      ["Paragraph", "B", "OrderedList/ListItem/Blockquote"],
      ["Paragraph", "two", "OrderedList/ListItem"],
    ]);
    expect(out.split("\n")[1]).toBe("   > ```bible");
  });

  it("> > A {ref} B: nested quotes keep both levels", () => {
    const out = viaBakeVerse("> > A {John 3:16} B");
    expect(shape(out)).toEqual([
      ["Paragraph", "A", "Blockquote/Blockquote"],
      ["FencedCode", "```bible", "Blockquote/Blockquote"],
      ["Paragraph", "B", "Blockquote/Blockquote"],
    ]);
  });

  it("native callout inside a list item quote stays nested and does not swallow the suffix", () => {
    const out = viaHelper("- > A {John 3:16} B", formatCalloutBake(V16, "quote", false, ""));
    const b = blocks(out);
    expect(b[0]).toMatchObject({ kind: "Paragraph", text: "A", in: "BulletList/ListItem/Blockquote" });
    expect(b.some((x) => x.in === "BulletList/ListItem/Blockquote/Blockquote")).toBe(true);
    expect(b[b.length - 1]).toMatchObject({ kind: "Paragraph", text: "B", in: "BulletList/ListItem/Blockquote" });
  });
});

describe("tab-separated list markers", () => {
  it("-<TAB>A {ref} B: content column 4, fence inside the item", () => {
    const out = viaBakeVerse("-\tA {John 3:16} B\n-\tnext");
    expect(out.split("\n")[1]).toBe("    ```bible");
    expect(shape(out)).toEqual([
      ["Paragraph", "A", "BulletList/ListItem"],
      ["FencedCode", "```bible", "BulletList/ListItem"],
      ["Paragraph", "B", "BulletList/ListItem"],
      ["Paragraph", "next", "BulletList/ListItem"],
    ]);
  });

  it("10.<TAB>{ref} tail: tab after a wide ordered marker", () => {
    const out = viaBakeVerse("10.\t{John 3:16} tail");
    expect(shape(out)).toEqual([
      ["FencedCode", "```bible", "OrderedList/ListItem"],
      ["Paragraph", "tail", "OrderedList/ListItem"],
    ]);
    expect(out.split("\n").slice(1).filter((l) => l !== "").every((l) => l.startsWith("    "))).toBe(true);
  });
});

describe("lazy continuation", () => {
  it("quote paragraph continued without >: block and suffix stay in the quote", () => {
    const out = viaBakeVerse("> A\nB {John 3:16} C\n\nafter");
    expect(shape(out)).toEqual([
      ["Paragraph", "A", "Blockquote"],
      ["FencedCode", "```bible", "Blockquote"],
      ["Paragraph", "C", "Blockquote"],
      ["Paragraph", "after", ""],
    ]);
    expect(blocks(out)[0].text).toBe("A\nB");
  });

  it("list item paragraph continued at column 0: block and suffix stay in the item", () => {
    const out = viaBakeVerse("- item\ncontinued {John 3:16} tail\n- next");
    expect(shape(out)).toEqual([
      ["Paragraph", "item", "BulletList/ListItem"],
      ["FencedCode", "```bible", "BulletList/ListItem"],
      ["Paragraph", "tail", "BulletList/ListItem"],
      ["Paragraph", "next", "BulletList/ListItem"],
    ]);
  });

  it("inner quote continued at the outer level: block stays at the inner level", () => {
    const out = viaBakeVerse("> > A\n> B {John 3:16} C");
    expect(shape(out)).toEqual([
      ["Paragraph", "A", "Blockquote/Blockquote"],
      ["FencedCode", "```bible", "Blockquote/Blockquote"],
      ["Paragraph", "C", "Blockquote/Blockquote"],
    ]);
  });

  it("a blank line ends the quote: the next paragraph is not treated as lazy", () => {
    const out = viaBakeVerse("> A\n\nB {John 3:16} C");
    expect(shape(out)).toEqual([
      ["Paragraph", "A", "Blockquote"],
      ["Paragraph", "B", ""],
      ["FencedCode", "```bible", ""],
      ["Paragraph", "C", ""],
    ]);
  });
});

describe("CRLF notes", () => {
  const crlf = (s: string) => s.replace(/\n/g, "\r\n");

  it("standalone token: exact in-place replacement in CRLF, no extra line", () => {
    const out = viaBakeVerse("{John 3:16}\r\nnext");
    expect(out).toBe(`${crlf(FENCE16)}\r\nnext`);
    noMixedEndings(out);
  });

  it("mid-line with a suffix: CRLF throughout, suffix kept", () => {
    const out = viaBakeVerse("x\r\n\r\nA {John 3:16} B\r\nnext");
    noMixedEndings(out);
    expect(out.split("\r\n")).toContain("B");
    expect(shape(out)).toEqual([
      ["Paragraph", "x", ""],
      ["Paragraph", "A", ""],
      ["FencedCode", "```bible", ""],
      ["Paragraph", "B", ""],
    ]);
    expect(blocks(out)[3].text).toBe("B\nnext");
  });

  it("several tokens on one line through the vault bake: CRLF throughout", async () => {
    const out = await viaBakeFile("A {John 3:16} and {John 3:17} B\r\nz");
    noMixedEndings(out);
    expect(shape(out).map((x) => x.slice(0, 2))).toEqual([
      ["Paragraph", "A"], ["FencedCode", "```bible"], ["Paragraph", "and"], ["FencedCode", "```bible"], ["Paragraph", "B"],
    ]);
  });

  it("token on a last line without newline follows the document's CRLF", () => {
    const out = viaBakeVerse("x\r\n\r\nA {John 3:16} B");
    noMixedEndings(out);
    expect(out.endsWith("\r\nB")).toBe(true);
  });

  it("native callout standalone in CRLF: no extra blank line, CRLF throughout", () => {
    const callout = formatCalloutBake(V16, "quote", false, "");
    const out = viaHelper("{John 3:16}\r\n\r\nnext", callout);
    expect(out).toBe(`${crlf(callout)}\r\n\r\nnext`);
    noMixedEndings(out);
  });
});

describe("all callers agree", () => {
  it("bakeVerse, bakeFile and the Bake button give the same nested result; one undo restores", async () => {
    const before = "- > A {John 3:16} B\n- next";
    const a = viaBakeVerse(before);
    const b = await viaBakeFile(before);
    const view = new EditorView({ state: EditorState.create({ doc: before, extensions: [history()] }), parent: document.body });
    const source = { state: view.state, posAtDOM: () => before.indexOf(T) } as unknown as EditorView;
    const el = document.createElement("span"); document.body.append(el);
    const spec = parseInlineSpec("John 3:16, no-nl, no-v");
    const r = await new InlineBakeJob(() => undefined).run(source, el, T, spec!, { verseNewLine: false, showVerseNumbers: false, nativeCalloutType: "quote" }, () => "", async () => V16);
    view.dispatch(r.change!);
    expect(b).toBe(a);
    expect(view.state.doc.toString()).toBe(a);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(before);
    el.remove(); view.destroy();
  });
});
