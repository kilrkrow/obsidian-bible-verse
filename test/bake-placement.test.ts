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
 * Bake placement (#84 follow-up): a token with prose around it, several
 * tokens on one line, and tokens inside blockquotes, callouts and lists must
 * bake to valid Markdown. Every case parses the result with a CommonMark
 * parser and asserts block boundaries: the fence's open/close lines, which
 * container it sits in, and the surviving prose blocks.
 */

const v = (reference: string, text: string): CachedVerse => ({
  reference, translation: "KJV", bibleId: "eng_kjv", text, copyright: "", fetchedAt: 0,
});
const V16 = v("John 3:16", "For God so loved the world");
const V17 = v("John 3:17", "For God sent not his Son");
const opts = { verseNewLine: false, showVerseNumbers: false };
const FENCE16 = formatCodeBlockBake(V16, opts);
const FENCE17 = formatCodeBlockBake(V17, opts);
const byRef: Record<string, CachedVerse> = { "John 3:16": V16, "John 3:17": V17 };

/** One block of the parsed note: kind, container chain, and its text without quote marks. */
interface Block { kind: string; in: string[]; text: string; startLine: number; endLine: number }

function blocks(md: string): Block[] {
  const tree = parser.parse(md);
  const lineOf = (pos: number) => md.slice(0, pos).split("\n").length - 1;
  const out: Block[] = [];
  const containers = new Set(["Blockquote", "BulletList", "OrderedList", "ListItem", "Document"]);
  const leaf = new Set(["Paragraph", "FencedCode", "ATXHeading1", "ATXHeading2"]);
  const chain = (n: SyntaxNode) => { const c: string[] = []; for (let p = n.parent; p; p = p.parent) if (containers.has(p.name) && p.name !== "Document") c.unshift(p.name); return c; };
  tree.iterate({
    enter: (n) => {
      if (!leaf.has(n.name)) return;
      const raw = md.slice(n.from, n.to);
      const text = raw.split("\n").map((l) => l.replace(/^(\s*>\s?)+/, "").trim()).join("\n");
      out.push({ kind: n.name, in: chain(n.node), text, startLine: lineOf(n.from), endLine: lineOf(n.to) });
      return false;
    },
  });
  return out;
}

function placeVia(content: string, raw: string, block: string): string {
  const at = content.indexOf(raw);
  const c = placeBakedBlock(content, at, at + raw.length, block);
  return content.slice(0, c.from) + c.insert + content.slice(c.to);
}
const baker = new Baker({} as App);
/** The handleBake path: Baker.bakeVerse, as main.ts calls it. */
const handleBakePath = (content: string, raw: string, verse = V16) =>
  baker.bakeVerse(content, raw, verse, "inline", { format: "codeblock", ...opts });
/** The vault/file bake command path. */
const vaultPath = (content: string) =>
  baker.bakeFile(content, true, async (ref) => byRef[`${ref.book} ${ref.chapter}:${ref.startVerse}`] ?? null, opts);

describe("bake placement: prose around the token", () => {
  it("A {John 3:16} B -> paragraph A, a top-level bible fence on its own lines, paragraph B", () => {
    const out = handleBakePath("Intro\n\nA {John 3:16} B\n\nOutro", "{John 3:16}");
    const lines = out.split("\n");
    const b = blocks(out);
    expect(b.map((x) => [x.kind, x.text.split("\n")[0], x.in.join("/")])).toEqual([
      ["Paragraph", "Intro", ""],
      ["Paragraph", "A", ""],
      ["FencedCode", "```bible", ""],
      ["Paragraph", "B", ""],
      ["Paragraph", "Outro", ""],
    ]);
    const fence = b[2];
    expect(lines[fence.startLine]).toBe("```bible");
    expect(lines[fence.endLine]).toBe("```");
    expect(lines.slice(fence.startLine, fence.endLine + 1).join("\n")).toBe(FENCE16);
    expect(lines[fence.startLine - 1]).toBe("A");
    expect(lines[fence.endLine + 1]).toBe("B");
  });

  it("token at line start and at line end keep the other side's prose as its own paragraph", () => {
    const start = blocks(handleBakePath("{John 3:16} tail", "{John 3:16}"));
    expect(start.map((x) => [x.kind, x.text.split("\n")[0]])).toEqual([["FencedCode", "```bible"], ["Paragraph", "tail"]]);
    const end = blocks(handleBakePath("head {John 3:16}", "{John 3:16}"));
    expect(end.map((x) => [x.kind, x.text.split("\n")[0]])).toEqual([["Paragraph", "head"], ["FencedCode", "```bible"]]);
  });

  it("a token alone on its line is replaced exactly as before (no extra lines)", () => {
    expect(handleBakePath("x\n{John 3:16}\ny", "{John 3:16}")).toBe(`x\n${FENCE16}\ny`);
    expect(handleBakePath("{John 3:16}", "{John 3:16}")).toBe(FENCE16);
  });

  it("the rest of the note keeps its structure (heading, list, later fence untouched)", () => {
    const rest = "## Later\n\n- one\n- two\n\n```js\nlet x = 1;\n```\n";
    const out = handleBakePath(`See {John 3:16} now.\n\n${rest}`, "{John 3:16}");
    expect(out.endsWith(rest)).toBe(true);
    const b = blocks(out);
    expect(b.filter((x) => x.kind === "FencedCode").map((x) => x.text.split("\n")[0])).toEqual(["```bible", "```js"]);
    expect(b.some((x) => x.kind === "ATXHeading2")).toBe(true);
  });
});

describe("bake placement: several tokens on one line", () => {
  const line = "A {John 3:16} and {John 3:17} B";
  const expectShape = (out: string) =>
    expect(blocks(out).map((x) => [x.kind, x.text.split("\n")[0], x.text.split("\n")[1] ?? ""])).toEqual([
      ["Paragraph", "A", ""],
      ["FencedCode", "```bible", "John 3:16"],
      ["Paragraph", "and", ""],
      ["FencedCode", "```bible", "John 3:17"],
      ["Paragraph", "B", ""],
    ]);

  it("vault/file bake command (right-to-left) yields two valid fences and all prose", async () => {
    expectShape(await vaultPath(line));
  });

  it("handleBake path, one token after the other, yields the same", () => {
    expectShape(handleBakePath(handleBakePath(line, "{John 3:16}"), "{John 3:17}", V17));
  });
});

describe("bake placement: containers", () => {
  it("blockquote: fence and both prose parts stay inside one blockquote, prefixed", () => {
    const out = handleBakePath("> A {John 3:16} B\n\nafter", "{John 3:16}");
    const b = blocks(out);
    expect(b.map((x) => [x.kind, x.text.split("\n")[0], x.in.join("/")])).toEqual([
      ["Paragraph", "A", "Blockquote"],
      ["FencedCode", "```bible", "Blockquote"],
      ["Paragraph", "B", "Blockquote"],
      ["Paragraph", "after", ""],
    ]);
    const lines = out.split("\n");
    for (let i = b[1].startLine; i <= b[1].endLine; i++) expect(lines[i].startsWith(">")).toBe(true);
    expect(b[1].text).toBe(FENCE16.split("\n").map((l) => l.trim()).join("\n"));
  });

  it("callout body: the fence stays in the callout under its header line", () => {
    const out = handleBakePath("> [!note] Title\n> see {John 3:16} here\n\nafter", "{John 3:16}");
    const b = blocks(out);
    expect(out.split("\n")[0]).toBe("> [!note] Title");
    expect(b.map((x) => [x.kind, x.text.split("\n")[0], x.in.join("/")])).toEqual([
      ["Paragraph", "[!note] Title", "Blockquote"],
      ["FencedCode", "```bible", "Blockquote"],
      ["Paragraph", "here", "Blockquote"],
      ["Paragraph", "after", ""],
    ]);
    expect(b[0].text).toBe("[!note] Title\nsee");
  });

  it("bullet list: fence is item content (indented), next item survives", () => {
    const out = handleBakePath("- A {John 3:16} B\n- next", "{John 3:16}");
    const b = blocks(out);
    expect(b.map((x) => [x.kind, x.text.split("\n")[0], x.in.join("/")])).toEqual([
      ["Paragraph", "A", "BulletList/ListItem"],
      ["FencedCode", "```bible", "BulletList/ListItem"],
      ["Paragraph", "B", "BulletList/ListItem"],
      ["Paragraph", "next", "BulletList/ListItem"],
    ]);
    const tree = parser.parse(out);
    let items = 0; tree.iterate({ enter: (n) => { if (n.name === "ListItem") items++; } });
    expect(items).toBe(2);
  });

  it("ordered list item that is only the token: fence on the marker line, inside the item", () => {
    const out = handleBakePath("1. {John 3:16}\n2. two", "{John 3:16}");
    expect(out.split("\n")[0]).toBe("1. ```bible");
    const b = blocks(out);
    expect(b.map((x) => [x.kind, x.in.join("/")])).toEqual([
      ["FencedCode", "OrderedList/ListItem"],
      ["Paragraph", "OrderedList/ListItem"],
    ]);
  });

  it("native callout mid-line: callout is its own blockquote and the trailing prose is not swallowed", () => {
    const callout = formatCalloutBake(V16, "quote", false, "");
    const out = placeVia("A {John 3:16} B\nnext line", "{John 3:16}", callout);
    const b = blocks(out);
    expect(b.map((x) => [x.kind, x.in.join("/")])[0]).toEqual(["Paragraph", ""]);
    const quoted = b.filter((x) => x.in.includes("Blockquote"));
    expect(quoted.length).toBeGreaterThan(0);
    expect(quoted.some((x) => x.text.includes("B"))).toBe(false);
    const last = b[b.length - 1];
    expect([last.kind, last.in.join("/"), last.text]).toEqual(["Paragraph", "", "B\nnext line"]);
  });

  it("native callout alone on its line followed by prose gets a blank separator", () => {
    const callout = formatCalloutBake(V16, "quote", false, "");
    const out = placeVia("{John 3:16}\nnext line", "{John 3:16}", callout);
    const b = blocks(out);
    expect(b[b.length - 1]).toMatchObject({ kind: "Paragraph", in: [], text: "next line" });
  });
});

describe("bake placement: editor path (Bake button)", () => {
  it("InlineBakeJob writes one change that parses correctly; one undo restores the original", async () => {
    const before = "Intro\n\n> A {John 3:16} B\n\nOutro";
    const view = new EditorView({ state: EditorState.create({ doc: before, extensions: [history()] }), parent: document.body });
    const from = before.indexOf("{John 3:16}");
    const source = { state: view.state, posAtDOM: () => from } as unknown as EditorView;
    const el = document.createElement("span"); document.body.append(el);
    const spec = parseInlineSpec("John 3:16, no-nl, no-v");
    if (!spec) throw new Error("spec");
    const job = new InlineBakeJob(() => undefined);
    const r = await job.run(source, el, "{John 3:16}", spec, { verseNewLine: false, showVerseNumbers: false, nativeCalloutType: "quote" }, () => "", async () => V16);
    expect(r.outcome).toBe("written");
    view.dispatch(r.change!);
    const out = view.state.doc.toString();
    expect(blocks(out).map((x) => [x.kind, x.text.split("\n")[0], x.in.join("/")])).toEqual([
      ["Paragraph", "Intro", ""],
      ["Paragraph", "A", "Blockquote"],
      ["FencedCode", "```bible", "Blockquote"],
      ["Paragraph", "B", "Blockquote"],
      ["Paragraph", "Outro", ""],
    ]);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(before);
    el.remove(); view.destroy();
  });
});
