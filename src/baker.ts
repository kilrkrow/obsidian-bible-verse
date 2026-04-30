import { App, TFile } from "obsidian";
import { BibleReference, CachedVerse } from "./types";
import { parseReference, formatReference, parseInlineSpec } from "./parser";

/** Regex to find {ref} patterns in note source */
const INLINE_REF_REGEX = /\{([A-Za-z0-9][^}\n]*)\}/g;

/** Regex to find bible code blocks */
const CODEBLOCK_REGEX = /```bible\s*\n([\s\S]*?)\n```/g;

/** Regex patterns for baked data */
const INLINE_BAKE_PATTERN = " %%bible-baked\\|([^|]+)\\|(.*?)%%";
const CODEBLOCK_BAKE_SEPARATOR = "\n---\n";

export class Baker {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Extract all bakeable references ({ref} and ```bible blocks) from note content.
   */
  extractReferences(content: string): { raw: string; ref: BibleReference | null; offset: number; type: "inline" | "block"; body?: string }[] {
    const results: { raw: string; ref: BibleReference | null; offset: number; type: "inline" | "block"; body?: string }[] = [];
    
    // 1. Find inline references
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

    // 2. Find code blocks
    const blockRegex = new RegExp(CODEBLOCK_REGEX.source, "g");
    while ((match = blockRegex.exec(content)) !== null) {
      const body = match[1];
      const lines = body.split("\n");
      if (lines.length > 0) {
        const ref = parseReference(lines[0].trim());
        results.push({
          raw: match[0],
          ref: ref, // Might be null if first line isn't a ref
          offset: match.index,
          type: "block",
          body: body
        });
      }
    }

    // Sort by offset so bakeFile can process backwards correctly
    return results.sort((a, b) => a.offset - b.offset);
  }

  /**
   * Bake a verse into the note content.
   */
  bakeVerse(content: string, refRaw: string, verse: CachedVerse, type: "inline" | "block" = "inline"): string {
    if (type === "inline") {
      const escapedText = verse.text.replace(/\n/g, "\\n");
      const bakedMarker = ` %%bible-baked|${verse.translation}|${escapedText}%%`;
      
      const existingPattern = new RegExp(escapeRegex(refRaw) + " %%bible-baked\\|[^|]+\\|.*?%%", "g");
      if (existingPattern.test(content)) {
        return content.replace(existingPattern, refRaw + bakedMarker);
      }
      return content.replace(refRaw, refRaw + bakedMarker);
    } else {
      // Code block baking
      // If it already has a separator, replace everything after it
      const separatorIdx = refRaw.indexOf(CODEBLOCK_BAKE_SEPARATOR);
      let newBlock: string;
      if (separatorIdx > 0) {
        newBlock = refRaw.substring(0, separatorIdx) + CODEBLOCK_BAKE_SEPARATOR + verse.text + "\n```";
      } else {
        // Insert separator before the closing backticks
        newBlock = refRaw.replace(/\n```$/, CODEBLOCK_BAKE_SEPARATOR + verse.text + "\n```");
      }
      return content.replace(refRaw, newBlock);
    }
  }

  /**
   * Strip all baked text.
   */
  stripBakedText(content: string): string {
    let result = content;
    // Strip inline
    result = result.replace(/ %%bible-baked\|[^|]+\\|.*?%%/g, "");
    // Strip blocks (remove everything after --- inside a bible block)
    result = result.replace(/(```bible[\s\S]*?)\n---\n[\s\S]*?(\n```)/g, "$1$2");
    return result;
  }

  /**
   * Check if a reference is already baked.
   */
  hasBakedBlock(content: string, refRaw: string, type: "inline" | "block" = "inline"): boolean {
    if (type === "inline") {
      const pattern = new RegExp(escapeRegex(refRaw) + " %%bible-baked\\|[^|]+\\|.*?%%");
      return pattern.test(content);
    } else {
      return refRaw.includes(CODEBLOCK_BAKE_SEPARATOR);
    }
  }

  /**
   * Extract baked text fallback.
   */
  extractBakedText(content: string, refStr: string): { translation: string; text: string } | null {
    // Check inline first
    const inlinePattern = new RegExp(escapeRegex(`{${refStr}}`) + " %%bible-baked\\|([^|]+)\\|(.*?)%%");
    const inlineMatch = content.match(inlinePattern);
    if (inlineMatch) {
      return {
        translation: inlineMatch[1],
        text: inlineMatch[2].replace(/\\n/g, "\n")
      };
    }

    // Check code blocks
    // This is harder because we need to find the block for this ref
    const blocks = content.match(new RegExp(CODEBLOCK_REGEX.source, "g"));
    if (blocks) {
      for (const block of blocks) {
        if (block.includes(refStr) && block.includes(CODEBLOCK_BAKE_SEPARATOR)) {
          const parts = block.split(CODEBLOCK_BAKE_SEPARATOR);
          // Try to find translation in the header lines
          const header = parts[0];
          const lines = header.split("\n");
          let translation = "KJV"; // Fallback
          for (const line of lines) {
            if (line.toLowerCase().startsWith("translation:")) {
              translation = line.split(":")[1].trim();
            }
          }
          return {
            translation,
            text: parts[1].replace(/\n```$/, "").trim()
          };
        }
      }
    }

    return null;
  }

  async bakeFile(
    content: string,
    fetchVerse: (ref: BibleReference) => Promise<CachedVerse | null>
  ): Promise<string> {
    const refs = this.extractReferences(content);
    if (refs.length === 0) return content;

    let result = content;
    // Process backwards
    for (let i = refs.length - 1; i >= 0; i--) {
      const { raw, ref, offset, type } = refs[i];
      if (!ref) continue;

      const verse = await fetchVerse(ref);
      if (!verse) continue;

      if (type === "inline") {
        const escapedText = verse.text.replace(/\n/g, "\\n");
        const bakedMarker = ` %%bible-baked|${verse.translation}|${escapedText}%%`;
        
        // Check for existing inline bake
        const tail = result.slice(offset + raw.length);
        const inlineMatch = tail.match(/^ %%bible-baked\|[^|]+\\|.*?%%/);
        
        if (inlineMatch) {
          result = result.slice(0, offset + raw.length) + bakedMarker + result.slice(offset + raw.length + inlineMatch[0].length);
        } else {
          result = result.slice(0, offset + raw.length) + bakedMarker + result.slice(offset + raw.length);
        }
      } else {
        // Code block bake
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
        newContent = await this.bakeFile(content, fetchVerse);
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
