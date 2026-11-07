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
 * Bake placement when the token is the first thing on a lazily continued (or
 * only partly prefixed) line, where the paragraph's lookback stops, and after
 * list markers followed by 5+ columns of whitespace. Results are parsed with
 * a CommonMark parser and the fence's container chain, open/close lines and
 * surviving prose are asserted.
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

const lines = (s: string) => s.split("\n");
const fenceLine = (out: string) => lines(out)[FENCE_OK(out).startLine];

describe("token first on a lazy or partly prefixed line", () => {
  it("> A then {ref} tail: opening fence, body, close and tail all stay in the quote", () => {
    const out = viaBakeVerse("> A\n{John 3:16} tail\n\nafter\n\n- rest");
    expect(fenceLine(out)).toBe("> ```bible");
    expect(shape(out)).toEqual([
      ["Paragraph", "A", "Blockquote"],
      ["FencedCode", "```bible", "Blockquote"],
      ["Paragraph", "tail", "Blockquote"],
      ["Paragraph", "after", ""],
      ["Paragraph", "rest", "BulletList/ListItem"],
    ]);
  });

  it("- item then {ref} tail: block and tail stay in the item, next item survives", () => {
    const out = viaBakeVerse("- item\n{John 3:16} tail\n- next");
    expect(fenceLine(out)).toBe("  ```bible");
    expect(shape(out)).toEqual([
      ["Paragraph", "item", "BulletList/ListItem"],
      ["FencedCode", "```bible", "BulletList/ListItem"],
      ["Paragraph", "tail", "BulletList/ListItem"],
      ["Paragraph", "next", "BulletList/ListItem"],
    ]);
  });

  it("- > A then {ref} tail: nested quote in a list item, both markers inferred", () => {
    const out = viaBakeVerse("- > A\n{John 3:16} tail\n- next");
    expect(fenceLine(out)).toBe("  > ```bible");
    expect(shape(out)).toEqual([
      ["Paragraph", "A", "BulletList/ListItem/Blockquote"],
      ["FencedCode", "```bible", "BulletList/ListItem/Blockquote"],
      ["Paragraph", "tail", "BulletList/ListItem/Blockquote"],
      ["Paragraph", "next", "BulletList/ListItem"],
    ]);
  });

  it("token alone on a lazy line: whole block in the quote, rest of the note intact", () => {
    const out = viaBakeVerse("> A\n{John 3:16}\n\n# Next\n\nafter");
    expect(fenceLine(out)).toBe("> ```bible");
    expect(shape(out)).toEqual([
      ["Paragraph", "A", "Blockquote"],
      ["FencedCode", "```bible", "Blockquote"],
      ["Paragraph", "after", ""],
    ]);
    expect(out.endsWith("\n\n# Next\n\nafter")).toBe(true);
  });
});

describe("partly explicit nested prefixes", () => {
  it("> > A then > {ref}: the opening line gets both quote levels", () => {
    const out = viaBakeVerse("> > A\n> {John 3:16}\n\nafter");
    expect(fenceLine(out)).toBe("> > ```bible");
    expect(shape(out)).toEqual([
      ["Paragraph", "A", "Blockquote/Blockquote"],
      ["FencedCode", "```bible", "Blockquote/Blockquote"],
      ["Paragraph", "after", ""],
    ]);
  });

  it("> > A then > {ref} tail: tail stays at the inner level", () => {
    const out = viaBakeVerse("> > A\n> {John 3:16} tail\n\nafter");
    expect(shape(out)).toEqual([
      ["Paragraph", "A", "Blockquote/Blockquote"],
      ["FencedCode", "```bible", "Blockquote/Blockquote"],
      ["Paragraph", "tail", "Blockquote/Blockquote"],
      ["Paragraph", "after", ""],
    ]);
  });

  it("- > A then indent-only {ref}: the missing > is added on the opening line", () => {
    const out = viaBakeVerse("- > A\n  {John 3:16} tail\n- next");
    expect(fenceLine(out)).toBe("  > ```bible");
    expect(shape(out)).toEqual([
      ["Paragraph", "A", "BulletList/ListItem/Blockquote"],
      ["FencedCode", "```bible", "BulletList/ListItem/Blockquote"],
      ["Paragraph", "tail", "BulletList/ListItem/Blockquote"],
      ["Paragraph", "next", "BulletList/ListItem"],
    ]);
  });

  it("native callout on a lazy line: the callout is nested in the quote and the tail survives", () => {
    const out = viaHelper("> A\n{John 3:16} tail\n\nafter", formatCalloutBake(V16, "quote", false, ""));
    expect(lines(out)[1].startsWith("> > ")).toBe(true);
    const b = blocks(out);
    expect(b[0]).toMatchObject({ kind: "Paragraph", text: "A", in: "Blockquote" });
    expect(b.some((x) => x.in === "Blockquote/Blockquote")).toBe(true);
    expect(b.slice(-2)).toMatchObject([
      { kind: "Paragraph", text: "tail", in: "Blockquote" },
      { kind: "Paragraph", text: "after", in: "" },
    ]);
  });
});

describe("lookback stops at structural boundaries", () => {
  it("a heading inside the quote: the next line is not lazy", () => {
    const out = viaBakeVerse("> # H\n{John 3:16} tail");
    expect(fenceLine(out)).toBe("```bible");
    expect(shape(out)).toEqual([
      ["FencedCode", "```bible", ""],
      ["Paragraph", "tail", ""],
    ]);
  });

  it("a closing fence inside the quote: the next line is not lazy", () => {
    const out = viaBakeVerse("> ```\n> code\n> ```\n{John 3:16} tail");
    expect(lines(out)[3]).toBe("```bible");
    expect(blocks(out)[0]).toMatchObject({ kind: "FencedCode", in: "Blockquote" });
    expect(shape(out).slice(-2)).toEqual([
      ["FencedCode", "```bible", ""],
      ["Paragraph", "tail", ""],
    ]);
  });

  it("a thematic break inside the quote: the next line is not lazy", () => {
    const out = viaBakeVerse("> ***\n{John 3:16} tail");
    expect(fenceLine(out)).toBe("```bible");
    expect(shape(out)).toEqual([
      ["FencedCode", "```bible", ""],
      ["Paragraph", "tail", ""],
    ]);
  });

  it("a new list item: lookback stops there and does not reach the quote above", () => {
    const out = viaBakeVerse("> q\n\n- a\n- b\n{John 3:16} tail");
    expect(fenceLine(out)).toBe("  ```bible");
    expect(shape(out)).toEqual([
      ["Paragraph", "q", "Blockquote"],
      ["Paragraph", "a", "BulletList/ListItem"],
      ["Paragraph", "b", "BulletList/ListItem"],
      ["FencedCode", "```bible", "BulletList/ListItem"],
      ["Paragraph", "tail", "BulletList/ListItem"],
    ]);
  });
});

describe("list markers followed by 5+ columns of whitespace", () => {
  it("-<6 spaces>{ref} tail: fence opens at the content column, inside the item", () => {
    const out = viaBakeVerse("-      {John 3:16} tail\n- next");
    expect(lines(out)[0]).toBe("- ```bible");
    expect(lines(out)[1]).toBe("  John 3:16");
    expect(shape(out)).toEqual([
      ["FencedCode", "```bible", "BulletList/ListItem"],
      ["Paragraph", "tail", "BulletList/ListItem"],
      ["Paragraph", "next", "BulletList/ListItem"],
    ]);
  });

  it("1.<6 spaces>{ref}: ordered marker, content column 3", () => {
    const out = viaBakeVerse("1.      {John 3:16}\n2. two");
    expect(lines(out)[0]).toBe("1. ```bible");
    expect(lines(out)[1]).toBe("   John 3:16");
    expect(shape(out)).toEqual([
      ["FencedCode", "```bible", "OrderedList/ListItem"],
      ["Paragraph", "two", "OrderedList/ListItem"],
    ]);
  });

  it("-<TAB><TAB>{ref}: two tabs count as 7 columns, same as spaces", () => {
    const out = viaBakeVerse("-\t\t{John 3:16}\n- next");
    expect(lines(out)[0]).toBe("- ```bible");
    expect(shape(out)).toEqual([
      ["FencedCode", "```bible", "BulletList/ListItem"],
      ["Paragraph", "next", "BulletList/ListItem"],
    ]);
  });

  it("prose before the token on a wide-marker line is kept as written; block at the content column", () => {
    const out = viaBakeVerse("-      A {John 3:16} B\n- next");
    expect(lines(out)[0]).toBe("-      A");
    expect(lines(out)[1]).toBe("  ```bible");
    expect(shape(out).slice(-3)).toEqual([
      ["FencedCode", "```bible", "BulletList/ListItem"],
      ["Paragraph", "B", "BulletList/ListItem"],
      ["Paragraph", "next", "BulletList/ListItem"],
    ]);
  });
});

describe("all callers agree", () => {
  it("bakeVerse, bakeFile and the Bake button give the same lazy-line result; one undo restores", async () => {
    const before = "> A\n{John 3:16} tail\n\nafter";
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
    expect(fenceLine(a)).toBe("> ```bible");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(before);
    el.remove(); view.destroy();
  });
});
