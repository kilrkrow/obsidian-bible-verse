import { App, TFile } from "obsidian";
import { BibleReference, CachedVerse } from "./types";
import { parseReference, formatReference, parseInlineSpec } from "./parser";

/** Regex to find {ref} patterns in note source */
const INLINE_REF_REGEX = /\{([A-Za-z0-9][^}\n]*)\}/g;

/** Regex to find bible code blocks */
const CODEBLOCK_REGEX = /```bible\s*\n([\s\S]*?)\n```/g;

const CODEBLOCK_BAKE_SEPARATOR = "\n---\n";

export class Baker {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Extract all bakeable references from note content.
   */
  extractReferences(content: string, includeInline: boolean): { raw: string; ref: BibleReference | null; offset: number; type: "inline" | "block"; body?: string }[] {
    const results: { raw: string; ref: BibleReference | null; offset: number; type: "inline" | "block"; body?: string }[] = [];
    
    // 1. Find inline references (only if requested)
    if (includeInline) {
      let match;
      const inlineRegex = new RegExp(INLINE_REF_REGEX.source, "g");
      while ((match = inlineRegex.exec(content)) !== null) {
        const spec = parseInlineSpec(match[1]);
        if (spec) {
          results.push({
            raw: match[0],
            ref: spec.ref,
            offset: match.index,
            type: "inline"
          });
        }
      }
    }

    // 2. Find code blocks
    let match;
    const blockRegex = new RegExp(CODEBLOCK_REGEX.source, "g");
    while ((match = blockRegex.exec(content)) !== null) {
      const body = match[1];
      const lines = body.split("\n");
      if (lines.length > 0) {
        const ref = parseReference(lines[0].trim());
        results.push({
          raw: match[0],
          ref: ref,
          offset: match.index,
          type: "block",
          body: body
        });
      }
    }

    return results.sort((a, b) => a.offset - b.offset);
  }

  /**
   * Bake a verse into the content.
   * If it's an inline reference, it is CONVERTED to a code block.
   */
  bakeVerse(content: string, refRaw: string, verse: CachedVerse, type: "inline" | "block" = "inline"): string {
    if (type === "inline") {
      // Convert to code block format
      const block = `\`\`\`bible\n${verse.reference}\ntranslation: ${verse.translation}\n${CODEBLOCK_BAKE_SEPARATOR}${verse.text}\n\`\`\``;
      return content.replace(refRaw, block);
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
    fetchVerse: (ref: BibleReference) => Promise<CachedVerse | null>
  ): Promise<string> {
    const refs = this.extractReferences(content, bakeInline);
    if (refs.length === 0) return content;

    let result = content;
    for (let i = refs.length - 1; i >= 0; i--) {
      const { raw, ref, offset, type } = refs[i];
      if (!ref) continue;

      const verse = await fetchVerse(ref);
      if (!verse) continue;

      if (type === "inline") {
        const block = `\`\`\`bible\n${verse.reference}\ntranslation: ${verse.translation}\n${CODEBLOCK_BAKE_SEPARATOR}${verse.text}\n\`\`\``;
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
    fetchVerse?: (ref: BibleReference) => Promise<CachedVerse | null>
  ): Promise<number> {
    const files = this.app.vault.getMarkdownFiles();
    let count = 0;

    for (const file of files) {
      const content = await this.app.vault.read(file);
      let newContent: string;
      
      if (action === "strip") {
        newContent = this.stripBakedText(content);
      } else if (fetchVerse) {
        newContent = await this.bakeFile(content, bakeInline, fetchVerse);
      } else {
        continue;
      }

      if (newContent !== content) {
        await this.app.vault.modify(file, newContent);
        count++;
      }
    }

    return count;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
