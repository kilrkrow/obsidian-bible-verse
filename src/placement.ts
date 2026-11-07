import { parser as baseParser, GFM } from "@lezer/markdown";
import type { SyntaxNode, Tree } from "@lezer/common";

/**
 * Where a baked block (a ```bible fence or a native callout) goes when an
 * inline token is baked.
 *
 * The block cannot simply replace the token: with prose around it, or inside
 * a quote, callout or list, that breaks the note. Placement is decided from a
 * CommonMark parse of the note (@lezer/markdown with GFM tables and task
 * lists), not from line patterns:
 *
 * 1. The token must sit in the plain text of a paragraph (or task item) whose
 *    only containers are blockquotes/callouts and list items. A token inside
 *    code, a heading, a table, HTML, a link or other inline markup, front
 *    matter, a `$$` math block or a `%%` comment is refused.
 * 2. The block goes on its own lines. Text before the token stays on its line,
 *    text after it moves below the block. Every new line carries the
 *    paragraph's container prefix, taken from the line where the paragraph
 *    opened (so it is right for lazily continued lines too).
 * 3. The result is parsed again and must have exactly the expected structure:
 *    every other block unchanged, and the paragraph split into the text
 *    before, the block, and the text after, all in the paragraph's
 *    containers. If anything differs the bake is refused.
 *
 * A refusal returns null and the caller leaves the note unchanged.
 */

/** Shown when a bake is refused; the note is left unchanged. */
export const UNSAFE_BAKE_NOTICE =
  "This verse was not baked: a Bible block can't be placed safely at that spot (for example inside code, a heading, a table or a link). The note is unchanged.";

/** A text change: replace `from`..`to` with `insert`. */
export interface BakePlacement {
  from: number;
  to: number;
  insert: string;
}

const mdParser = baseParser.configure(GFM);
const CONTAINERS = new Set(["Document", "Blockquote", "BulletList", "OrderedList", "ListItem"]);
const MARKS = new Set(["QuoteMark", "ListMark"]);

/** CR before LF becomes a space so positions stay the same for the parser. */
const parseable = (text: string) => text.replace(/\r(?=\n)/g, " ");
const parse = (text: string): Tree => mdParser.parse(parseable(text));

interface Leaf { name: string; chain: string; text: string }

const normalize = (s: string) =>
  s.split("\n").map((l) => l.replace(/^[ \t>]*/, "").replace(/[ \t\r]+$/, "")).join("\n").replace(/\s+$/, "");

function chainOf(node: SyntaxNode): string[] {
  const chain: string[] = [];
  for (let p = node.parent; p; p = p.parent) if (CONTAINERS.has(p.name) && p.name !== "Document") chain.unshift(p.name);
  return chain;
}

/** The note's leaf blocks in order, with their containers and text. */
function outline(tree: Tree, src: string, prefix: string[] = []): Leaf[] {
  const out: Leaf[] = [];
  tree.iterate({
    enter: (n) => {
      if (CONTAINERS.has(n.name)) return true;
      if (MARKS.has(n.name)) return false;
      out.push({ name: n.name, chain: [...prefix, ...chainOf(n.node)].join("/"), text: normalize(src.slice(n.from, n.to)) });
      return false;
    },
  });
  return out;
}

/** Inside front matter, a `$$` math block or a `%%` comment? Refuse those. */
function inOpaqueRegion(text: string, from: number): boolean {
  const fm = /^---[ \t]*\r?\n/.exec(text);
  if (fm) {
    const close = /^(?:---|\.\.\.)[ \t]*\r?$/m.exec(text.slice(fm[0].length));
    const end = close ? fm[0].length + close.index + close[0].length : text.length;
    if (from < end) return true;
  }
  const head = text.slice(0, from);
  const count = (re: RegExp) => (head.match(re) || []).length;
  return count(/%%/g) % 2 === 1 || count(/\$\$/g) % 2 === 1;
}

/** Offset just past a line's container prefix (quote marks and indentation). */
function contentStart(tree: Tree, text: string, lineFrom: number, lineTo: number): number {
  let end = lineFrom;
  tree.iterate({
    from: lineFrom,
    to: lineTo,
    enter: (n) => {
      if (n.name === "QuoteMark" && n.from >= lineFrom && n.to <= lineTo) end = Math.max(end, n.to);
    },
  });
  while (end < lineTo && (text[end] === " " || text[end] === "\t")) end++;
  return end;
}

/**
 * A line prefix as a continuation prefix: quote marks kept, list markers and
 * tabs turned into spaces at the same visual columns (tab stops of 4).
 */
function toContinuation(prefix: string): string {
  let out = "";
  for (const ch of prefix) {
    if (ch === "\t") out += " ".repeat(4 - (out.length % 4));
    else out += ch === ">" ? ">" : " ";
  }
  return out;
}

const lineStartAt = (text: string, pos: number) => text.lastIndexOf("\n", pos - 1) + 1;
function lineEndAt(text: string, pos: number): { end: number; nl: number } {
  const nl = text.indexOf("\n", pos);
  if (nl === -1) return { end: text.length, nl };
  return { end: text[nl - 1] === "\r" ? nl - 1 : nl, nl };
}

export function placeBakedBlock(text: string, from: number, to: number, block: string): BakePlacement | null {
  if (from < 0 || to > text.length || from >= to) return null;
  if (inOpaqueRegion(text, from)) return null;
  const src = parseable(text);
  const tree = mdParser.parse(src);

  // 1. The paragraph holding the token, and nothing else around the token.
  let p: SyntaxNode | null = tree.resolveInner(from, 1);
  while (p && p.name !== "Paragraph" && p.name !== "Task" && !CONTAINERS.has(p.name)) p = p.parent;
  if (!p || (p.name !== "Paragraph" && p.name !== "Task")) return null;
  if (from < p.from || to > p.to) return null;
  for (let c = p.firstChild; c; c = c.nextSibling) if (c.from < to && c.to > from) return null;
  // A footnote definition is not a plain paragraph.
  if (/^\[\^[^\]]*\]:/.test(src.slice(p.from, p.to))) return null;
  const para = p;
  const chain = chainOf(para);

  // 2. Container prefix for new lines, from the line the paragraph opened on:
  // quote marks kept, list markers turned into spaces (same visual columns).
  const firstLineFrom = lineStartAt(text, para.from);
  const cont = toContinuation(text.slice(firstLineFrom, para.from));
  const blank = cont.replace(/[ \t]+$/, "");
  const prefixed = (l: string) => (l === "" ? blank : cont + l);

  const lineStart = lineStartAt(text, from);
  const { end: lineEnd, nl } = lineEndAt(text, to);
  const eol = nl === -1 ? (text.includes("\r\n") ? "\r\n" : "\n") : text[nl - 1] === "\r" ? "\r\n" : "\n";
  const isFirstLine = lineStart === firstLineFrom;
  const ownStart = isFirstLine ? para.from : contentStart(tree, text, lineStart, lineEnd);
  if (ownStart > from) return null;
  const beforeProse = text.slice(ownStart, from);
  const isQuoteBlock = /^>/.test(block);
  const blockLines = block.split(/\r?\n/);
  const out: string[] = [];

  if (beforeProse.trim() === "") {
    // The block starts this line. On the paragraph's first line its prefix is
    // kept as written; on a continuation line (lazy or partly prefixed) it
    // takes the paragraph's full prefix.
    out.push((isFirstLine ? text.slice(lineStart, from) : cont) + blockLines[0]);
  } else if (para.name === "Task" && isFirstLine && /^\[[ xX]\][ \t]+$/.test(beforeProse)) {
    out.push(text.slice(lineStart, from), prefixed(blockLines[0]));
  } else {
    out.push(text.slice(lineStart, from).replace(/[ \t]+$/, ""), prefixed(blockLines[0]));
  }
  for (const l of blockLines.slice(1)) out.push(prefixed(l));

  // 3. What follows the block: the rest of this line, or else the paragraph's
  // next line (which would otherwise lose its containers after the block).
  let changeEnd = lineEnd;
  let next = text.slice(to, lineEnd).replace(/^[ \t]+/, "");
  if (next === "" && nl !== -1 && para.to > nl) {
    const mFrom = nl + 1;
    const m = lineEndAt(text, mFrom);
    next = text.slice(contentStart(tree, text, mFrom, m.end), m.end);
    changeEnd = m.end;
  }
  if (next !== "") {
    if (isQuoteBlock) out.push(blank); // a callout would absorb the next line
    out.push(cont + next);
  } else if (isQuoteBlock && nl !== -1) {
    const nextLine = text.slice(nl + 1, lineEndAt(text, nl + 1).end);
    if (nextLine.trim() !== "" && nextLine.trim() !== blank.trim()) out.push(blank);
  }

  const change = { from: lineStart, to: changeEnd, insert: out.join(eol) };

  // 4. Verify: the new note must parse to exactly the expected blocks.
  const newText = text.slice(0, change.from) + change.insert + text.slice(change.to);
  const before = outline(tree, src);
  const at = indexOfLeaf(tree, para);
  if (at < 0) return null;
  const expected: Leaf[] = [...before.slice(0, at)];
  const chainStr = chain.join("/");
  const beforeText = normalize(src.slice(para.from, from));
  if (beforeText !== "") expected.push({ name: para.name, chain: chainStr, text: beforeText });
  expected.push(...outline(parse(block), block.replace(/\r(?=\n)/g, " "), chain));
  const afterText = normalize(src.slice(to, para.to)).replace(/^\s+/, "");
  if (afterText !== "") expected.push({ name: "Paragraph", chain: chainStr, text: afterText });
  expected.push(...before.slice(at + 1));
  const newSrc = parseable(newText);
  const actual = outline(mdParser.parse(newSrc), newSrc);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) return null;
  return change;
}

/** Position of a leaf block in `outline` order. */
function indexOfLeaf(tree: Tree, leaf: SyntaxNode): number {
  let i = 0;
  let found = -1;
  tree.iterate({
    enter: (n) => {
      if (found >= 0) return false;
      if (CONTAINERS.has(n.name)) return true;
      if (MARKS.has(n.name)) return false;
      if (n.from === leaf.from && n.to === leaf.to && n.name === leaf.name) found = i;
      i++;
      return false;
    },
  });
  return found;
}

/** Apply `placeBakedBlock` to a string; null when the bake is refused. */
export function spliceBakedBlock(text: string, from: number, to: number, block: string): string | null {
  const c = placeBakedBlock(text, from, to, block);
  return c ? text.slice(0, c.from) + c.insert + text.slice(c.to) : null;
}
