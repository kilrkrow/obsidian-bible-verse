import { App } from "obsidian";
import { BibleReference, CachedVerse } from "./types";
import { parseReference, parseInlineSpec, inlineTokenRegex, inlineTokenContent } from "./parser";
import { resolveShowVerseNumbers } from "./format";
import { formatStrongsHeader, isAdapted, parseStrongsHeader, STRONGS_CREDIT, WordDisplayState } from "./strongs";

/**
 * Fetch the text to bake. `words` carries a Strong's verse's word choices
 * (#69) so the bake writes what the screen shows; undefined for any other.
 */
export type BakeFetch = (
  ref: BibleReference,
  transId?: string,
  transAbbr?: string,
  nl?: boolean,
  vn?: boolean,
  words?: WordDisplayState
) => Promise<CachedVerse | null>;

/** Regex to find bible code blocks */
const CODEBLOCK_REGEX = /```bible\s*\n([\s\S]*?)\n```/g;

const CODEBLOCK_BAKE_SEPARATOR = "\n---\n";

/**
 * Render a verse as native Obsidian callout markdown (a one-way bake).
 * Every line is quote-prefixed; blank lines become bare ">". The title links
 * to the source website, and required attribution (e.g. ESV) is appended.
 * Pure function — exported for testing.
 */
export function formatCalloutBake(
  verse: CachedVerse,
  calloutType: string,
  collapsed: boolean,
  url: string
): string {
  const fold = collapsed ? "-" : "+";
  const title = `[${verse.reference} (${verse.label ?? verse.translation})](${url})`;
  const lines = verse.text.split("\n").map((l) => (l.length > 0 ? `> ${l}` : ">"));
  if (verse.requireAttribution && verse.copyright) {
    lines.push(">");
    lines.push(`> ${verse.copyright}`);
  }
  return `> [!${calloutType}]${fold} ${title}\n${lines.join("\n")}`;
}

export interface InlineBakeOptions {
  format?: "codeblock" | "callout";
  calloutType?: string;
  collapsed?: boolean;
  url?: string;
  /** Effective formatting flags at bake time — frozen into the block header. */
  verseNewLine?: boolean;
  showVerseNumbers?: boolean;
  style?: string;
  /** Strong's word choices for the header (formatStrongsHeader), if any. */
  strongs?: string;
}

/**
 * Render a verse as a ```bible code block with the text baked below the
 * separator. The formatting flags in effect at bake time (newline, numbers,
 * style) are frozen into the block header so the baked block keeps rendering
 * the same way regardless of the user's global settings (#37).
 * Pure function — exported for testing.
 */
export function formatCodeBlockBake(verse: CachedVerse, opts?: InlineBakeOptions): string {
  let header = `${verse.reference}\ntranslation: ${verse.translation}`;
  if (opts?.verseNewLine !== undefined) header += `\nnewline: ${opts.verseNewLine}`;
  if (opts?.showVerseNumbers !== undefined) header += `\nnumbers: ${opts.showVerseNumbers}`;
  if (opts?.style) header += `\nstyle: ${opts.style}`;
  // Recorded so a refresh re-applies the transliterations and meanings rather
  // than replacing them with the plain translation. The credit line is for
  // anyone reading the note without the plugin; the plugin ignores it.
  if (opts?.strongs) header += `\nstrongs: ${opts.strongs}\nlexicon: ${STRONGS_CREDIT}`;
  return `\`\`\`bible\n${header}\n${CODEBLOCK_BAKE_SEPARATOR}${verse.text}\n\`\`\``;
}

/** A text change: replace `from`..`to` with `insert`. */
export interface BakePlacement {
  from: number;
  to: number;
  insert: string;
}

/**
 * Container context of one Markdown line, as far as `limit` (the token start).
 *
 * Walks the line's leading containers one at a time, like CommonMark block
 * parsing: blockquote/callout markers (`>` plus one optional space) and list
 * markers (`-`, `*`, `+`, `1.`, `1)` followed by spaces/tabs). Columns are
 * visual, with tab stops every 4, so a tab after a list marker gives the
 * right content indent.
 *
 * - `lead` is the line's own prefix text (what precedes the content).
 * - `cont` is the prefix a continuation line needs to stay in the same
 *   containers: quote markers are kept, list markers become spaces up to the
 *   item's content column.
 * - `depth` counts the containers; `startsItem` says the line opens a list item.
 */
interface LineContext { lead: string; cont: string; depth: number; startsItem: boolean }

function lineContext(line: string, limit = line.length): LineContext {
  let pos = 0;
  let col = 0;
  let cont = "";
  let depth = 0;
  let startsItem = false;
  const width = (ch: string, at: number) => (ch === "\t" ? 4 - (at % 4) : 1);
  for (;;) {
    // Up to 3 columns of indent may precede a container marker.
    let p = pos;
    let c = col;
    while (p < limit && (line[p] === " " || line[p] === "\t") && c - col < 4) {
      c += width(line[p], c);
      p++;
    }
    if (c - col >= 4) break; // indented code, not a marker
    if (p < limit && line[p] === ">") {
      // Quote/callout marker: keep it verbatim, with one optional space.
      let q = p + 1;
      let qc = c + 1;
      if (q < limit && (line[q] === " " || line[q] === "\t")) {
        qc += width(line[q], qc);
        q++;
      }
      cont += line.slice(pos, q);
      pos = q;
      col = qc;
      depth++;
      continue;
    }
    const marker = /^(?:[-*+]|\d{1,9}[.)])/.exec(line.slice(p, limit));
    if (!marker) break;
    const m = p + marker[0].length;
    const mc = c + marker[0].length;
    if (m < limit && line[m] !== " " && line[m] !== "\t") break;
    // Spacing after the marker: 1-4 columns sets the content column; 5+ means
    // the content is indented code, so the content column is marker + 1.
    let s = m;
    let sc = mc;
    while (s < limit && (line[s] === " " || line[s] === "\t")) {
      sc += width(line[s], sc);
      s++;
    }
    if (sc - mc > 4 || s === m) {
      // Marker then (code or end of text): content starts one column past it.
      const contentCol = mc + 1;
      cont += " ".repeat(contentCol - col);
      pos = Math.min(m + 1, limit);
      col = contentCol;
      depth++;
      startsItem = true;
      break;
    }
    cont += " ".repeat(sc - col);
    pos = s;
    col = sc;
    depth++;
    startsItem = true;
  }
  // Indentation before the content (a continuation line inside a list item).
  let w = pos;
  while (w < limit && (line[w] === " " || line[w] === "\t")) w++;
  if (w === limit && limit === line.length) w = pos; // all-blank line: nothing to keep
  cont += line.slice(pos, w);
  return { lead: line.slice(0, w), cont, depth, startsItem };
}

/** Does this line (after its containers) open a block other than a paragraph? */
function opensBlock(content: string): boolean {
  return /^(?:#{1,6}(?:\s|$)|```|~~~|(?:[-*_][ \t]*){3,}$|>)/.test(content);
}

/**
 * The container context a block on `lines[index]` must carry.
 *
 * Usually the line's own context. But a paragraph line may sit inside a quote
 * or list item lazily, without repeating its markers ("> A" then "B" is one
 * quoted paragraph). Lines placed after such a line must carry the paragraph's
 * real container prefix, or the block would fall out of the quote/list. So
 * walk back through the paragraph to the line that opened it and take that
 * context when it is deeper.
 */
function blockContext(lines: string[], index: number, limit: number): LineContext {
  const own = lineContext(lines[index], limit);
  if (own.startsItem) return own;
  const ownContent = lines[index].slice(own.lead.length);
  if (opensBlock(ownContent)) return own;
  let best = own;
  for (let i = index - 1; i >= 0; i--) {
    const l = lines[i];
    const ctx = lineContext(l);
    const content = l.slice(ctx.lead.length);
    if (content.trim() === "") break; // blank (or marker-only) line ends the paragraph
    if (opensBlock(content)) break;
    if (ctx.depth > best.depth) best = { ...ctx, lead: own.lead, startsItem: false };
    if (ctx.startsItem) break; // the paragraph opened on this item line
    if (ctx.depth < own.depth) break;
  }
  return best;
}

/**
 * Place a baked block (a ```bible fence or a native callout) where the token at
 * `from`..`to` sits, as valid Markdown.
 *
 * Baking used to splice the block into the token's place, so a token with
 * prose around it ("See {John 3:16} today") produced a fence that started
 * mid-line and broke the rest of the note. The block now goes on its own lines:
 * text before the token stays on the first line, text after it moves to a line
 * after the block, and every block line carries the line's full container
 * prefix (nested blockquote/callout `>` markers and list continuation indents,
 * including a lazily continued quote or list paragraph) so it stays inside the
 * same containers. A line that holds only the token (plus its prefix) is
 * replaced in place, exactly as before. Line endings follow the document.
 *
 * The change covers the token's whole line, so a caller applies it as one edit
 * (one undo step in the editor).
 */
export function placeBakedBlock(text: string, from: number, to: number, block: string): BakePlacement {
  const lineStart = text.lastIndexOf("\n", from - 1) + 1;
  const nl = text.indexOf("\n", to);
  // The line's own ending (CRLF stays outside the change); else the document's.
  const crlf = nl > 0 && text[nl - 1] === "\r";
  const lineEnd = nl === -1 ? text.length : crlf ? nl - 1 : nl;
  const eol = nl === -1 ? (text.includes("\r\n") ? "\r\n" : "\n") : crlf ? "\r\n" : "\n";
  const before = text.slice(lineStart, from);
  const after = text.slice(to, lineEnd);

  const allLines = text.slice(0, lineEnd).split("\n").map((l) => l.replace(/\r$/, ""));
  const ctx = blockContext(allLines, allLines.length - 1, from - lineStart);
  const cont = ctx.cont;
  const blank = cont.replace(/[ \t]+$/, "");
  const prefixed = (l: string) => (l === "" ? blank : cont + l);

  // A callout/blockquote block would swallow a following paragraph line (lazy
  // continuation), so it needs a blank line after it; a fence does not.
  const isQuoteBlock = /^>/.test(block);

  const blockLines = block.split(/\r?\n/);
  const out: string[] = [];
  const lead = lineContext(before + "x", before.length).lead;
  if (before.slice(lead.length).trim() === "") {
    // Only the container prefix precedes the token: the block starts here.
    out.push(before + blockLines[0]);
  } else {
    out.push(before.replace(/[ \t]+$/, ""));
    out.push(prefixed(blockLines[0]));
  }
  for (const l of blockLines.slice(1)) out.push(prefixed(l));

  const rest = after.replace(/^[ \t]+/, "");
  if (rest.length > 0) {
    if (isQuoteBlock) out.push(blank);
    out.push(cont + rest);
  } else if (isQuoteBlock && nl !== -1) {
    const nextEnd = text.indexOf("\n", nl + 1);
    const next = text.slice(nl + 1, nextEnd === -1 ? text.length : nextEnd).replace(/\r$/, "");
    if (next.trim() !== "" && next.trim() !== blank.trim()) out.push(blank);
  }
  return { from: lineStart, to: lineEnd, insert: out.join(eol) };
}

/** Apply `placeBakedBlock` to a string. */
export function spliceBakedBlock(text: string, from: number, to: number, block: string): string {
  const c = placeBakedBlock(text, from, to, block);
  return text.slice(0, c.from) + c.insert + text.slice(c.to);
}

/** A bakeable reference (inline token or ```bible block) located in note text. */
export interface ExtractedReference {
  raw: string;
  ref: BibleReference | null;
  offset: number;
  type: "inline" | "block";
  body?: string;
  translations?: string[];
  verseNewLine?: boolean | null;
  showVerseNumbers?: boolean | null;
  styleOverride?: string | null;
  /** Strong's word choices to bake with, from the token or the block header. */
  words?: WordDisplayState | null;
}

/** A token's Strong's word choices, or null when it changes no word. */
function wordsOf(spec: { transliterate: string[]; meanings: Record<string, string> }): WordDisplayState | null {
  const state = { transliterate: spec.transliterate, meanings: spec.meanings };
  return isAdapted(state) ? state : null;
}

export class Baker {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Extract all bakeable references from note content.
   */
  extractReferences(content: string, includeInline: boolean): ExtractedReference[] {
    const results: ExtractedReference[] = [];
    
    // 1. Find inline references (only if requested)
    if (includeInline) {
      let match;
      const inlineRegex = inlineTokenRegex();
      while ((match = inlineRegex.exec(content)) !== null) {
        // Escaped token (\{...}) — literal text, never bake it (#28)
        if (match.index > 0 && content[match.index - 1] === "\\") continue;
        const spec = parseInlineSpec(inlineTokenContent(match));
        if (spec) {
          results.push({
            raw: match[0],
            ref: spec.ref,
            offset: match.index,
            type: "inline",
            translations: spec.translations,
            verseNewLine: spec.verseNewLine,
            showVerseNumbers: spec.showVerseNumbers,
            styleOverride: spec.styleOverride,
            words: wordsOf(spec),
          });
        }
      }
    }

    // 2. Find code blocks
    let match;
    const blockRegex = new RegExp(CODEBLOCK_REGEX.source, "g");
    while ((match = blockRegex.exec(content)) !== null) {
      const body = match[1];
      const header = body.split(CODEBLOCK_BAKE_SEPARATOR)[0];
      const lines = header.split("\n");
      if (lines.length > 0) {
        const ref = parseReference(lines[0].trim());
        
        // Parse config from block body
        const config: Record<string, string | undefined> = {};
        let words: WordDisplayState | null = null;
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          const colonIdx = line.indexOf(":");
          if (colonIdx > 0) {
            const key = line.substring(0, colonIdx).trim().toLowerCase();
            const value = line.substring(colonIdx + 1).trim().toLowerCase();
            config[key] = value;
            // Meaning labels are case-sensitive ("I.2b"), so read this one as written.
            if (key === "strongs") words = parseStrongsHeader(line.substring(colonIdx + 1));
          }
        }

        results.push({
          raw: match[0],
          ref: ref,
          offset: match.index,
          type: "block",
          body: body,
          translations: config.translation ? [config.translation] : (config.compare ? config.compare.split(",").map((s) => s.trim()) : []),
          verseNewLine: config.newline !== undefined ? config.newline === "true" : null,
          showVerseNumbers: (config.numbers !== undefined || config["verse-numbers"] !== undefined) 
            ? (config.numbers ?? config["verse-numbers"]) === "true" 
            : null,
          words,
        });
      }
    }

    return results.sort((a, b) => a.offset - b.offset);
  }

  /**
   * Bake a verse into the content.
   * If it's an inline reference, it is CONVERTED to a code block.
   */
  bakeVerse(content: string, refRaw: string, verse: CachedVerse, type: "inline" | "block" = "inline", opts?: InlineBakeOptions): string {
    if (type === "inline") {
      // Convert to a native callout (one-way) or the default ```bible code block.
      const block = opts?.format === "callout"
        ? formatCalloutBake(verse, opts.calloutType ?? "quote", opts.collapsed ?? false, opts.url ?? "")
        : formatCodeBlockBake(verse, opts);
      // First occurrence, as before; placed on its own lines so prose around
      // the token survives and the fence/callout is valid Markdown.
      const at = content.indexOf(refRaw);
      if (at < 0) return content;
      return spliceBakedBlock(content, at, at + refRaw.length, block);
    } else {
      // Code block baking
      const separatorIdx = refRaw.indexOf(CODEBLOCK_BAKE_SEPARATOR);
      let newBlock: string;
      if (separatorIdx > 0) {
        newBlock = refRaw.substring(0, separatorIdx) + CODEBLOCK_BAKE_SEPARATOR + verse.text + "\n```";
      } else {
        newBlock = refRaw.replace(/\n```$/, CODEBLOCK_BAKE_SEPARATOR + verse.text + "\n```");
      }
      return content.replace(refRaw, newBlock);
    }
  }

  /**
   * Strip all baked text. Only affects code blocks.
   */
  stripBakedText(content: string): string {
    return content.replace(/(```bible[\s\S]*?)\n---\n[\s\S]*?(\n```)/g, "$1$2");
  }

  /**
   * Check if a reference is already baked.
   */
  hasBakedBlock(content: string, refRaw: string, type: "inline" | "block" = "inline"): boolean {
    if (type === "inline") return false; // Inline references are never "already baked" (they convert to blocks)
    return refRaw.includes(CODEBLOCK_BAKE_SEPARATOR);
  }

  async bakeFile(
    content: string,
    bakeInline: boolean,
    fetchVerse: BakeFetch,
    defaults?: { verseNewLine: boolean; showVerseNumbers: boolean }
  ): Promise<string> {
    const refs = this.extractReferences(content, bakeInline);
    if (refs.length === 0) return content;

    let result = content;
    for (let i = refs.length - 1; i >= 0; i--) {
      const { raw, ref, offset, type, translations, verseNewLine, showVerseNumbers, styleOverride, words } = refs[i];
      if (!ref) continue;

      // We only bake single translation blocks for now
      const trans = (translations && translations.length === 1) ? translations[0] : undefined;

      const verse = await fetchVerse(
        ref,
        trans,
        undefined,
        verseNewLine ?? undefined,
        showVerseNumbers ?? undefined,
        words ?? undefined
      );
      if (!verse) continue;

      if (type === "inline") {
        // Freeze the effective formatting flags into the block header so the
        // baked block renders as fetched, independent of global settings (#37).
        const block = formatCodeBlockBake(verse, {
          verseNewLine: verseNewLine ?? defaults?.verseNewLine,
          showVerseNumbers: defaults
            ? resolveShowVerseNumbers(ref, showVerseNumbers, defaults.showVerseNumbers)
            : showVerseNumbers ?? undefined,
          style: styleOverride && styleOverride !== "native-callout" ? styleOverride : undefined,
          strongs: words ? formatStrongsHeader(words) ?? undefined : undefined,
        });
        // Right-to-left, so placing this block never moves an earlier offset.
        result = spliceBakedBlock(result, offset, offset + raw.length, block);
      } else {
        const separatorIdx = raw.indexOf(CODEBLOCK_BAKE_SEPARATOR);
        let newBlock: string;
        if (separatorIdx > 0) {
          newBlock = raw.substring(0, separatorIdx) + CODEBLOCK_BAKE_SEPARATOR + verse.text + "\n```";
        } else {
          newBlock = raw.replace(/\n```$/, CODEBLOCK_BAKE_SEPARATOR + verse.text + "\n```");
        }
        result = result.slice(0, offset) + newBlock + result.slice(offset + raw.length);
      }
    }

    return result;
  }

  async processVault(
    action: "bake" | "strip",
    bakeInline: boolean,
    fetchVerse?: BakeFetch,
    defaults?: { verseNewLine: boolean; showVerseNumbers: boolean }
  ): Promise<number> {
    const files = this.app.vault.getMarkdownFiles();
    let count = 0;

    for (const file of files) {
      const content = await this.app.vault.cachedRead(file);
      let newContent: string;

      if (action === "strip") {
        newContent = this.stripBakedText(content);
      } else if (fetchVerse) {
        newContent = await this.bakeFile(content, bakeInline, fetchVerse, defaults);
      } else {
        continue;
      }

      if (newContent !== content) {
        await this.app.vault.process(file, () => newContent);
        count++;
      }
    }

    return count;
  }
}

