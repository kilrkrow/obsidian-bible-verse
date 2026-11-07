// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parser } from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import { Baker, canPlaceBake, formatCodeBlockBake, placeBakedBlock, UNSAFE_BAKE_NOTICE } from "../src/baker";
import { InlineBakeJob } from "../src/inline-bake";
import { parseInlineSpec } from "../src/parser";
import type { App } from "obsidian";
import type { CachedVerse } from "../src/types";

/**
 * Obsidian syntax that CommonMark reads as plain paragraph text: wikilinks and
 * embeds, `$$` display math, `%%` comments, inline `$` math, highlights,
 * inline footnotes and block IDs. Splitting a paragraph there would damage
 * the note, so the bake is refused: the note is unchanged through bakeVerse,
 * bakeFile and the Bake button, and the refusal happens before any fetch.
 * Controls show the same syntax elsewhere in the note doesn't block a bake.
 */

const V16: CachedVerse = { reference: "John 3:16", translation: "KJV", bibleId: "eng_kjv", text: "For God so loved the world", copyright: "", fetchedAt: 0 };
const opts = { verseNewLine: false, showVerseNumbers: false };
const FENCE16 = formatCodeBlockBake(V16, opts);
const T = "{John 3:16}";
const baker = new Baker({} as App);

const CONTAINERS = new Set(["Document", "Blockquote", "BulletList", "OrderedList", "ListItem"]);
function shape(md: string): [string, string, string][] {
  const out: [string, string, string][] = [];
  parser.parse(md).iterate({
    enter: (n) => {
      if (CONTAINERS.has(n.name)) return true;
      if (n.name === "QuoteMark" || n.name === "ListMark") return false;
      const chain: string[] = [];
      for (let p: SyntaxNode | null = n.node.parent; p; p = p.parent) if (CONTAINERS.has(p.name) && p.name !== "Document") chain.unshift(p.name);
      out.push([n.name, md.slice(n.from, n.to).split("\n")[0].replace(/^[\s>]*/, "").trim(), chain.join("/")]);
      return false;
    },
  });
  return out;
}

let refusals = 0;
const viaBakeVerse = (content: string) => baker.bakeVerse(content, T, V16, "inline", { format: "codeblock", ...opts }, () => refusals++);
async function viaBakeFile(content: string) {
  const skipped: string[] = [];
  let fetches = 0;
  const out = await baker.bakeFile(content, true, async () => { fetches++; return V16; }, opts, (raw) => skipped.push(raw));
  return { out, skipped, fetches };
}
async function viaButton(content: string) {
  const view = new EditorView({ state: EditorState.create({ doc: content, extensions: [history()] }), parent: document.body });
  const source = { state: view.state, posAtDOM: () => content.indexOf(T) } as unknown as EditorView;
  const el = document.createElement("span"); document.body.append(el);
  const notices: string[] = [];
  let fetches = 0;
  const spec = parseInlineSpec("John 3:16, no-nl, no-v");
  const r = await new InlineBakeJob((m: string) => notices.push(m)).run(source, el, T, spec!, { verseNewLine: false, showVerseNumbers: false, nativeCalloutType: "quote" }, () => "", async () => { fetches++; return V16; });
  if (r.change) view.dispatch(r.change);
  el.remove();
  return { doc: view.state.doc.toString(), outcome: r.outcome, notices, fetches, view };
}

async function refusedEverywhere(content: string): Promise<void> {
  const at = content.indexOf(T);
  expect(at).toBeGreaterThanOrEqual(0);
  const before = refusals;
  expect(viaBakeVerse(content)).toBe(content);
  expect(refusals).toBe(before + 1);
  const f = await viaBakeFile(content);
  expect(f.out).toBe(content);
  expect(f.skipped).toEqual([T]);
  expect(f.fetches).toBe(0);
  const b = await viaButton(content);
  expect(b.outcome).toBe("refused");
  expect(b.notices).toEqual([UNSAFE_BAKE_NOTICE]);
  expect(b.fetches).toBe(0);
  expect(b.doc).toBe(content);
  b.view.destroy();
  expect(canPlaceBake(content, at, at + T.length)).toBe(false);
  expect(placeBakedBlock(content, at, at + T.length, FENCE16)).toBeNull();
}

async function bakedEverywhere(content: string): Promise<string> {
  const a = viaBakeVerse(content);
  expect(a).not.toBe(content);
  const f = await viaBakeFile(content);
  expect(f.skipped).toEqual([]);
  expect(f.out).toBe(a);
  const b = await viaButton(content);
  expect(b.outcome).toBe("written");
  expect(b.doc).toBe(a);
  expect(undo(b.view)).toBe(true);
  expect(b.view.state.doc.toString()).toBe(content);
  b.view.destroy();
  return a;
}

const refuse = (name: string, content: string) => it(name, () => refusedEverywhere(content));

describe("wikilinks and embeds", () => {
  refuse("alias: [[Study|{ref}]]", "See [[Study|{John 3:16}]] here");
  refuse("target: [[{ref}]]", "See [[{John 3:16}]] here");
  refuse("heading link: [[Study#{ref}]]", "See [[Study#{John 3:16}]] here");
  refuse("block link with alias: [[Study#^abc|{ref}]]", "See [[Study#^abc|{John 3:16}]] here");
  refuse("embed: ![[Notes {ref}]]", "![[Notes {John 3:16}]]");
  refuse("image embed alias: ![[img.png|{ref}]]", "![[img.png|{John 3:16}]]");
  refuse("second of two links on the line", "[[a]] and [[b {John 3:16}]] c");
  refuse("unclosed [[ before the token", "Open [[Study {John 3:16} here");
  refuse("link opened on the line above in the same paragraph", "See [[Study\n{John 3:16}]] here");
  it("control: a closed link before the token is kept on its line", async () => {
    const out = await bakedEverywhere("See [[Study|notes]] {John 3:16} and [[More]]");
    expect(out.split("\n")[0]).toBe("See [[Study|notes]]");
    expect(out.split("\n").pop()).toBe("and [[More]]");
  });
});

describe("$$ display math", () => {
  refuse("the reported case: inline-code $$, then a real $$ block around the token", "`$$`\n\n$$\n{John 3:16}\n$$");
  refuse("token between $$ on one line", "See $$ x {John 3:16} $$ here");
  refuse("unmatched $$ anywhere in the note", "Cost $$\n\n{John 3:16} today");
  refuse("$$ in the token's paragraph", "A $$x$$ then {John 3:16}");
  it("control: $$ inside fenced code doesn't count", async () => {
    await bakedEverywhere("```\n$$\n```\n\n{John 3:16} today");
  });
  it("control: a closed $$ block elsewhere", async () => {
    const out = await bakedEverywhere("$$\nx^2\n$$\n\nSee {John 3:16} today");
    expect(out.startsWith("$$\nx^2\n$$\n\nSee\n```bible")).toBe(true);
  });
});

describe("%% comments", () => {
  refuse("block comment around the token", "%%\n{John 3:16}\n%%");
  refuse("inline comment around the token", "Text %% {John 3:16} %% more");
  refuse("inline-code %% before a real comment", "`%%`\n\n%%\n{John 3:16}\n%%");
  refuse("unmatched %% in the note", "50%% off\n\n{John 3:16}");
  it("control: %% inside inline code and a closed comment elsewhere", async () => {
    await bakedEverywhere("Use `%%` for comments.\n\n%% hidden %%\n\nSee {John 3:16} today");
  });
});

describe("inline math, highlights, inline footnotes, HTML comments", () => {
  refuse("inline $ math around the token", "where $x = {John 3:16}$ holds");
  refuse("highlight around the token", "==see {John 3:16} today==");
  refuse("inline footnote around the token", "Text^[see {John 3:16} too] more");
  refuse("HTML comment around the token", "a <!-- {John 3:16} --> b");
  it("control: dollar amounts on both sides are even, so not math", async () => {
    await bakedEverywhere("costs $5 and $6, see {John 3:16} today");
  });
  it("control: a closed highlight before the token", async () => {
    const out = await bakedEverywhere("==key== {John 3:16} next");
    expect(out.split("\n")[0]).toBe("==key==");
  });
  it("control: an escaped \\$ isn't a math delimiter", async () => {
    await bakedEverywhere("price \\$5 {John 3:16} and $6");
  });
});

describe("block IDs and tags", () => {
  refuse("block ID at the end of the token's line", "See {John 3:16} today ^abc123");
  refuse("block ID on a later line of the same paragraph", "See {John 3:16}\nmore ^id-1");
  it("control: a block ID on another paragraph", async () => {
    const out = await bakedEverywhere("Intro ^intro\n\nSee {John 3:16} today");
    expect(out.startsWith("Intro ^intro\n\nSee\n")).toBe(true);
  });
  it("tags survive as text on both sides of the block", async () => {
    const out = await bakedEverywhere("#study {John 3:16} #faith");
    expect(out.split("\n")[0]).toBe("#study");
    expect(out.split("\n").pop()).toBe("#faith");
    expect(shape(out).map((x) => x[0])).toEqual(["Paragraph", "FencedCode", "Paragraph"]);
  });
});
