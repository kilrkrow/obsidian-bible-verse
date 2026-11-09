// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parser } from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import { Baker, formatCalloutBake, formatCodeBlockBake, placeBakedBlock, UNSAFE_BAKE_NOTICE } from "../src/baker";
import { InlineBakeJob } from "../src/inline-bake";
import { parseInlineSpec } from "../src/parser";
import type { App } from "obsidian";
import type { CachedVerse } from "../src/types";

/**
 * Container and code boundaries around a baked token, audited as a family:
 * indented and fenced code inside quotes, callouts and list items, tabs, mixed
 * explicit/lazy prefixes, token lines indented 4+ past their container, and
 * the places a bake is refused. Results are checked with a plain CommonMark
 * parse (every leaf block, its containers and its text), independent of the
 * placement code. A refusal must leave the note unchanged through all three
 * callers: bakeVerse, bakeFile and the Bake button.
 */

const V16: CachedVerse = { reference: "John 3:16", translation: "KJV", bibleId: "eng_kjv", text: "For God so loved the world", copyright: "", fetchedAt: 0 };
const opts = { verseNewLine: false, showVerseNumbers: false };
const FENCE16 = formatCodeBlockBake(V16, opts);
const T = "{John 3:16}";
const baker = new Baker({} as App);

const CONTAINERS = new Set(["Document", "Blockquote", "BulletList", "OrderedList", "ListItem"]);
/** Every leaf block: [kind, first text line, container chain]. */
function shape(md: string): [string, string, string][] {
  const out: [string, string, string][] = [];
  parser.parse(md).iterate({
    enter: (n) => {
      if (CONTAINERS.has(n.name)) return true;
      if (n.name === "QuoteMark" || n.name === "ListMark") return false;
      const chain: string[] = [];
      for (let p: SyntaxNode | null = n.node.parent; p; p = p.parent) if (CONTAINERS.has(p.name) && p.name !== "Document") chain.unshift(p.name);
      const first = md.slice(n.from, n.to).split("\n")[0].replace(/^[\s>]*/, "").trim();
      out.push([n.name, first, chain.join("/")]);
      return false;
    },
  });
  return out;
}
const lines = (s: string) => s.split("\n");

let refusals = 0;
const viaBakeVerse = (content: string) => baker.bakeVerse(content, T, V16, "inline", { format: "codeblock", ...opts }, () => refusals++);
async function viaBakeFile(content: string): Promise<{ out: string; skipped: string[] }> {
  const skipped: string[] = [];
  const out = await baker.bakeFile(content, true, async () => V16, opts, (raw) => skipped.push(raw));
  return { out, skipped };
}
async function viaButton(content: string): Promise<{ doc: string; outcome: string; notices: string[]; view: EditorView }> {
  const view = new EditorView({ state: EditorState.create({ doc: content, extensions: [history()] }), parent: document.body });
  const source = { state: view.state, posAtDOM: () => content.indexOf(T) } as unknown as EditorView;
  const el = document.createElement("span"); document.body.append(el);
  const notices: string[] = [];
  const spec = parseInlineSpec("John 3:16, no-nl, no-v");
  const r = await new InlineBakeJob((m: string) => notices.push(m)).run(source, el, T, spec!, { verseNewLine: false, showVerseNumbers: false, nativeCalloutType: "quote" }, () => "", async () => V16);
  if (r.change) view.dispatch(r.change);
  el.remove();
  return { doc: view.state.doc.toString(), outcome: r.outcome, notices, view };
}

/** All three callers bake identically; the result is returned. */
async function bakedEverywhere(content: string): Promise<string> {
  const a = viaBakeVerse(content);
  expect(a).not.toBe(content);
  const { out: b, skipped } = await viaBakeFile(content);
  expect(skipped).toEqual([]);
  const c = await viaButton(content);
  expect(c.outcome).toBe("written");
  expect(b).toBe(a);
  expect(c.doc).toBe(a);
  expect(undo(c.view)).toBe(true);
  expect(c.view.state.doc.toString()).toBe(content);
  c.view.destroy();
  return a;
}

/** All three callers refuse and leave the note exactly as it was. */
async function refusedEverywhere(content: string): Promise<void> {
  const before = refusals;
  expect(viaBakeVerse(content)).toBe(content);
  expect(refusals).toBe(before + 1);
  const { out, skipped } = await viaBakeFile(content);
  expect(out).toBe(content);
  expect(skipped).toEqual([T]);
  const c = await viaButton(content);
  expect(c.outcome).toBe("refused");
  expect(c.notices).toEqual([UNSAFE_BAKE_NOTICE]);
  expect(c.doc).toBe(content);
  c.view.destroy();
  const at = content.indexOf(T);
  expect(placeBakedBlock(content, at, at + T.length, FENCE16)).toBeNull();
}

describe("the reported case: indented code inside a quote", () => {
  it(">     code then {ref} tail: quoted code kept, fence and tail top-level", async () => {
    const content = ">     code\n{John 3:16} tail";
    expect(shape(content)).toEqual([["CodeBlock", "code", "Blockquote"], ["Paragraph", "{John 3:16} tail", ""]]);
    const out = await bakedEverywhere(content);
    expect(lines(out)[0]).toBe(">     code");
    expect(lines(out)[1]).toBe("```bible");
    expect(shape(out)).toEqual([
      ["CodeBlock", "code", "Blockquote"],
      ["FencedCode", "```bible", ""],
      ["Paragraph", "tail", ""],
    ]);
  });
});

describe("indented code above the token", () => {
  it("in a list item: fence and tail top-level, list intact", async () => {
    const out = await bakedEverywhere("- item\n\n      code\n{John 3:16} tail");
    expect(shape(out)).toEqual([
      ["Paragraph", "item", "BulletList/ListItem"],
      ["CodeBlock", "code", "BulletList/ListItem"],
      ["FencedCode", "```bible", ""],
      ["Paragraph", "tail", ""],
    ]);
  });

  it("in a callout after a blank line: fence and tail top-level", async () => {
    const out = await bakedEverywhere("> [!note] T\n>\n>     code\n{John 3:16} tail");
    expect(shape(out)).toEqual([
      ["Paragraph", "[!note] T", "Blockquote"],
      ["CodeBlock", "code", "Blockquote"],
      ["FencedCode", "```bible", ""],
      ["Paragraph", "tail", ""],
    ]);
  });

  it("in a callout right after its title: not code (it can't interrupt a paragraph), so the token is lazy and stays in the callout", async () => {
    const content = "> [!note] T\n>     more\n{John 3:16} tail";
    expect(shape(content)).toEqual([["Paragraph", "[!note] T", "Blockquote"]]);
    const out = await bakedEverywhere(content);
    expect(lines(out)[2]).toBe("> ```bible");
    expect(shape(out)).toEqual([
      ["Paragraph", "[!note] T", "Blockquote"],
      ["FencedCode", "```bible", "Blockquote"],
      ["Paragraph", "tail", "Blockquote"],
    ]);
  });

  it("in the outer of two quotes: fence top-level", async () => {
    const out = await bakedEverywhere("> > A\n>\n>     code\n{John 3:16} tail");
    expect(shape(out)).toEqual([
      ["Paragraph", "A", "Blockquote/Blockquote"],
      ["CodeBlock", "code", "Blockquote"],
      ["FencedCode", "```bible", ""],
      ["Paragraph", "tail", ""],
    ]);
  });

  it("in a quote inside a list item: fence top-level", async () => {
    const out = await bakedEverywhere("- > A\n  >\n  >     code\n{John 3:16} tail");
    expect(shape(out)).toEqual([
      ["Paragraph", "A", "BulletList/ListItem/Blockquote"],
      ["CodeBlock", "code", "BulletList/ListItem/Blockquote"],
      ["FencedCode", "```bible", ""],
      ["Paragraph", "tail", ""],
    ]);
  });

  it(">\\t\\tcode (tab stops: 6 columns) is code; the token after it is top-level", async () => {
    const content = ">\t\tcode\n{John 3:16} tail";
    expect(shape(content)[0]).toEqual(["CodeBlock", "code", "Blockquote"]);
    const out = await bakedEverywhere(content);
    expect(shape(out).slice(1)).toEqual([["FencedCode", "```bible", ""], ["Paragraph", "tail", ""]]);
  });

  it(">\\tA (tab stops: 2 columns) is a paragraph; the token after it is lazy and stays quoted", async () => {
    const out = await bakedEverywhere(">\tA\n{John 3:16} tail");
    expect(shape(out)).toEqual([
      ["Paragraph", "A", "Blockquote"],
      ["FencedCode", "```bible", "Blockquote"],
      ["Paragraph", "tail", "Blockquote"],
    ]);
  });
});

describe("fenced code above the token", () => {
  for (const f of ["```", "~~~"]) {
    it(`closed ${f} fence in a quote: fence and tail top-level, quoted fence kept`, async () => {
      const out = await bakedEverywhere(`> ${f}\n> code\n> ${f}\n{John 3:16} tail`);
      expect(shape(out)).toEqual([
        ["FencedCode", f, "Blockquote"],
        ["FencedCode", "```bible", ""],
        ["Paragraph", "tail", ""],
      ]);
    });

    it(`unterminated ${f} fence in a quote ends with the quote: token top-level`, async () => {
      const out = await bakedEverywhere(`> ${f}\n> code\n{John 3:16} tail`);
      expect(shape(out)).toEqual([
        ["FencedCode", f, "Blockquote"],
        ["FencedCode", "```bible", ""],
        ["Paragraph", "tail", ""],
      ]);
    });
  }

  it("unterminated fence in a list item ends with the item: token top-level", async () => {
    const out = await bakedEverywhere("- ```\n  code\n{John 3:16} tail");
    expect(shape(out)).toEqual([
      ["FencedCode", "```", "BulletList/ListItem"],
      ["FencedCode", "```bible", ""],
      ["Paragraph", "tail", ""],
    ]);
  });

  it("unterminated top-level fence: token is code, refused", () => refusedEverywhere("```\ncode\n{John 3:16} tail"));
  it("closed fence with the token inside: refused", () => refusedEverywhere("~~~\n{John 3:16}\n~~~"));
  it("fence inside a quote with the token inside: refused", () => refusedEverywhere("> ```\n> {John 3:16}\n> ```"));
});

describe("mixed explicit and lazy prefixes", () => {
  it("> > A, > B, then lazy {ref} tail: stays at the inner level", async () => {
    const out = await bakedEverywhere("> > A\n> B\n{John 3:16} tail");
    expect(lines(out)[2]).toBe("> > ```bible");
    expect(shape(out)).toEqual([
      ["Paragraph", "A", "Blockquote/Blockquote"],
      ["FencedCode", "```bible", "Blockquote/Blockquote"],
      ["Paragraph", "tail", "Blockquote/Blockquote"],
    ]);
  });

  it("> - a, lazy b, lazy {ref} tail: stays in the list item inside the quote", async () => {
    const out = await bakedEverywhere("> - a\nb\n{John 3:16} tail");
    expect(lines(out)[2]).toBe(">   ```bible");
    expect(shape(out)).toEqual([
      ["Paragraph", "a", "Blockquote/BulletList/ListItem"],
      ["FencedCode", "```bible", "Blockquote/BulletList/ListItem"],
      ["Paragraph", "tail", "Blockquote/BulletList/ListItem"],
    ]);
  });

  it("token at the end of a lazy line with more lazy text below: the next line keeps the containers", async () => {
    const out = await bakedEverywhere("> A\nB {John 3:16}\nC\n\nafter");
    expect(shape(out)).toEqual([
      ["Paragraph", "A", "Blockquote"],
      ["FencedCode", "```bible", "Blockquote"],
      ["Paragraph", "C", "Blockquote"],
      ["Paragraph", "after", ""],
    ]);
  });

  it("-<TAB>A then lazy {ref}: tab prefix becomes spaces at the same column", async () => {
    const out = await bakedEverywhere("-\tA\n{John 3:16} tail\n-\tnext");
    expect(lines(out)[1]).toBe("    ```bible");
    expect(shape(out)).toEqual([
      ["Paragraph", "A", "BulletList/ListItem"],
      ["FencedCode", "```bible", "BulletList/ListItem"],
      ["Paragraph", "tail", "BulletList/ListItem"],
      ["Paragraph", "next", "BulletList/ListItem"],
    ]);
  });
});

describe("token lines indented 4+ past their container", () => {
  it("> A then >     {ref} tail: paragraph continuation, stays quoted", async () => {
    const out = await bakedEverywhere("> A\n>     {John 3:16} tail");
    expect(lines(out)[1]).toBe("> ```bible");
    expect(shape(out)).toEqual([
      ["Paragraph", "A", "Blockquote"],
      ["FencedCode", "```bible", "Blockquote"],
      ["Paragraph", "tail", "Blockquote"],
    ]);
  });

  it("- item then 6-space {ref} tail: paragraph continuation, stays in the item", async () => {
    const out = await bakedEverywhere("- item\n      {John 3:16} tail");
    expect(lines(out)[1]).toBe("  ```bible");
    expect(shape(out)).toEqual([
      ["Paragraph", "item", "BulletList/ListItem"],
      ["FencedCode", "```bible", "BulletList/ListItem"],
      ["Paragraph", "tail", "BulletList/ListItem"],
    ]);
  });

  it("4-space {ref} at top level: indented code, refused", () => refusedEverywhere("text\n\n    {John 3:16}"));
  it(">     {ref}: indented code in a quote, refused", () => refusedEverywhere(">     {John 3:16}"));
  it("item, blank, 6-space {ref}: indented code in the item, refused", () => refusedEverywhere("- a\n\n      {John 3:16}"));
});

describe("task items and CRLF", () => {
  it("- [ ] {ref}: the task stays a task and the block goes inside the item", async () => {
    const out = await bakedEverywhere("- [ ] {John 3:16}\n- [x] done");
    expect(lines(out)[0]).toBe("- [ ] ");
    expect(lines(out)[1]).toBe("  ```bible");
  });

  it("CRLF lazy line: block quoted, CRLF throughout, trailing newline kept", () => {
    const out = viaBakeVerse("> A\r\n{John 3:16} tail\r\n");
    expect(out.split("\r\n")[1]).toBe("> ```bible");
    expect(/\r(?!\n)|(?<!\r)\n/.test(out)).toBe(false);
    expect(out.endsWith("> tail\r\n")).toBe(true);
    expect(shape(out.replace(/\r\n/g, "\n"))).toEqual([
      ["Paragraph", "A", "Blockquote"],
      ["FencedCode", "```bible", "Blockquote"],
      ["Paragraph", "tail", "Blockquote"],
    ]);
  });
});

describe("other places a bake is refused (note unchanged)", () => {
  const cases: [string, string][] = [
    ["ATX heading", "# {John 3:16}"],
    ["setext heading", "A {John 3:16}\n---"],
    ["table cell", "| a | {John 3:16} |\n| - | - |"],
    ["inline code", "See `{John 3:16}` here"],
    ["link text", "See [{John 3:16}](https://example.org)"],
    ["emphasis", "See *{John 3:16}* here"],
    ["HTML block", "<div>\n{John 3:16}\n</div>"],
    ["front matter", "---\nverse: {John 3:16}\n---\nbody"],
    ["$$ math block", "$$\n{John 3:16}\n$$"],
    ["%% comment", "%% {John 3:16} %%"],
    ["footnote definition", "[^1]: {John 3:16}"],
    ["text after the token would start a list", "See {John 3:16} - a classic"],
  ];
  for (const [name, content] of cases) it(name, () => refusedEverywhere(content));

  it("vault bake skips only the refused token and bakes the rest", async () => {
    const { out, skipped } = await viaBakeFile("# {John 3:16}\n\nSee {John 3:16} today");
    expect(skipped).toEqual([T]);
    expect(lines(out)[0]).toBe("# {John 3:16}");
    expect(shape(out)).toEqual([
      ["ATXHeading1", "# {John 3:16}", ""],
      ["Paragraph", "See", ""],
      ["FencedCode", "```bible", ""],
      ["Paragraph", "today", ""],
    ]);
  });

  it("native callout bake is refused the same way", () => {
    const content = "# {John 3:16}";
    expect(placeBakedBlock(content, 2, 2 + T.length, formatCalloutBake(V16, "quote", false, ""))).toBeNull();
  });
});
