import { App } from "obsidian";
import { BibleReference, CachedVerse } from "./types";
import { parseReference, parseInlineSpec, inlineTokenRegex, inlineTokenContent } from "./parser";

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
  const title = `[${verse.reference} (${verse.translation})](${url})`;
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
  return `\`\`\`bible\n${header}\n${CODEBLOCK_BAKE_SEPARATOR}${verse.text}\n\`\`\``;
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
            styleOverride: spec.styleOverride
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
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          const colonIdx = line.indexOf(":");
          if (colonIdx > 0) {
            const key = line.substring(0, colonIdx).trim().toLowerCase();
            const value = line.substring(colonIdx + 1).trim().toLowerCase();
            config[key] = value;
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
            : null
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
      // Use a replacer function so `$` in verse text isn't treated as a pattern.
      return content.replace(refRaw, () => block);
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
    fetchVerse: (
      ref: BibleReference,
      transId?: string,
      transAbbr?: string,
      nl?: boolean,
      vn?: boolean
    ) => Promise<CachedVerse | null>,
    defaults?: { verseNewLine: boolean; showVerseNumbers: boolean }
  ): Promise<string> {
    const refs = this.extractReferences(content, bakeInline);
    if (refs.length === 0) return content;

    let result = content;
    for (let i = refs.length - 1; i >= 0; i--) {
      const { raw, ref, offset, type, translations, verseNewLine, showVerseNumbers, styleOverride } = refs[i];
      if (!ref) continue;

      // We only bake single translation blocks for now
      const trans = (translations && translations.length === 1) ? translations[0] : undefined;

      const verse = await fetchVerse(
        ref,
        trans,
        undefined,
        verseNewLine ?? undefined,
        showVerseNumbers ?? undefined
      );
      if (!verse) continue;

      if (type === "inline") {
        // Freeze the effective formatting flags into the block header so the
        // baked block renders as fetched, independent of global settings (#37).
        const block = formatCodeBlockBake(verse, {
          verseNewLine: verseNewLine ?? defaults?.verseNewLine,
          showVerseNumbers: showVerseNumbers ?? defaults?.showVerseNumbers,
          style: styleOverride && styleOverride !== "native-callout" ? styleOverride : undefined,
        });
        result = result.slice(0, offset) + block + result.slice(offset + raw.length);
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
    fetchVerse?: (
      ref: BibleReference,
      transId?: string,
      transAbbr?: string,
      nl?: boolean,
      vn?: boolean
    ) => Promise<CachedVerse | null>,
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

