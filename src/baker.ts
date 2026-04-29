import { App, TFile } from "obsidian";
import { BibleReference, CachedVerse } from "./types";
import { parseReference, formatReference, parseInlineSpec } from "./parser";

/** Regex to find {ref} patterns in note source */
const INLINE_REF_REGEX = /\{([A-Za-z0-9][^}\n]*)\}/g;

/** Regex to find existing baked blocks following a reference */
const BAKED_BLOCK_PATTERN =
  "\\s*\\n%%bible-baked\\|([^%]+)%%\\n([\\s\\S]*?)%%end-bible%%";

/**
 * Handles baking (embedding) and unbaking verse text in note source.
 */
export class Baker {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Extract all {ref} references from note content.
   * Returns metadata including the parsed reference and offset in the content.
   */
  extractReferences(content: string): { raw: string; ref: BibleReference; offset: number; translations: string[] }[] {
    const results: { raw: string; ref: BibleReference; offset: number; translations: string[] }[] = [];
    let match;
    const regex = new RegExp(INLINE_REF_REGEX.source, "g");
    while ((match = regex.exec(content)) !== null) {
      const spec = parseInlineSpec(match[1]);
      if (spec) {
        results.push({
          raw: match[0],
          ref: spec.ref,
          offset: match.index,
          translations: spec.translations,
        });
      }
    }
    return results;
  }

  /**
   * Bake a verse into the note content after its {ref}.
   * If already baked, update the baked block.
   */
  bakeVerse(content: string, refRaw: string, verse: CachedVerse): string {
    const bakedBlock = `\n%%bible-baked|${verse.translation}%%\n${verse.text}\n%%end-bible%%`;

    // Check if already baked — update it
    const existingPattern = new RegExp(
      escapeRegex(refRaw) + BAKED_BLOCK_PATTERN,
      "g"
    );

    if (existingPattern.test(content)) {
      return content.replace(existingPattern, refRaw + bakedBlock);
    }

    // Not yet baked — insert after the {ref}
    // Note: This string replace only replaces the FIRST occurrence.
    // Use bakeFile for robust multi-verse baking.
    return content.replace(refRaw, refRaw + bakedBlock);
  }

  /**
   * Strip all baked blocks from note content, leaving just the bib:ref markers.
   */
  stripBakedText(content: string): string {
    return content.replace(
      /\s*\n%%bible-baked\|[^%]+%%\n[\s\S]*?%%end-bible%%/g,
      ""
    );
  }

  /**
   * Check if a bib:ref has a baked block following it.
   */
  hasBakedBlock(content: string, refRaw: string): boolean {
    const pattern = new RegExp(
      escapeRegex(refRaw) +
        "\\s*\\n%%bible-baked\\|[^%]+%%\\n[\\s\\S]*?%%end-bible%%"
    );
    return pattern.test(content);
  }

  /**
   * Extract baked text for a reference if it exists.
   * Can be called with a raw marker (e.g. "{John 3:16}") or a plain reference string.
   */
  extractBakedText(
    content: string,
    refStr: string
  ): { translation: string; text: string } | null {
    // Try matching with the string as provided (could be the raw marker)
    let pattern = new RegExp(
      escapeRegex(refStr) + BAKED_BLOCK_PATTERN
    );
    let match = content.match(pattern);
    
    if (!match) {
      // Try wrapping in braces if it wasn't already
      if (!refStr.startsWith("{")) {
        pattern = new RegExp(
          escapeRegex(`{${refStr}}`) + BAKED_BLOCK_PATTERN
        );
        match = content.match(pattern);
      }
    }

    if (!match) return null;
    return { translation: match[1], text: match[2].trim() };
  }

  /**
   * Bake all verses in a single file using a single-pass offset-based approach.
   * This is more robust than sequential string replaces.
   */
  async bakeFile(
    content: string,
    fetchVerse: (ref: BibleReference) => Promise<CachedVerse | null>
  ): Promise<string> {
    const refs = this.extractReferences(content);
    if (refs.length === 0) return content;

    // Iterate backwards to keep offsets valid as we insert text
    let result = content;
    for (let i = refs.length - 1; i >= 0; i--) {
      const { raw, ref, offset } = refs[i];
      const verse = await fetchVerse(ref);
      if (!verse) continue;

      const bakedBlock = `\n%%bible-baked|${verse.translation}%%\n${verse.text}\n%%end-bible%%`;
      
      // Check if there is an existing block immediately following this reference
      const tail = result.slice(offset + raw.length);
      const blockMatch = tail.match(new RegExp("^" + BAKED_BLOCK_PATTERN));
      
      if (blockMatch) {
        // Replace existing block
        const blockLength = blockMatch[0].length;
        result = 
          result.slice(0, offset + raw.length) + 
          bakedBlock + 
          result.slice(offset + raw.length + blockLength);
      } else {
        // Insert new block
        result = 
          result.slice(0, offset + raw.length) + 
          bakedBlock + 
          result.slice(offset + raw.length);
      }
    }

    return result;
  }

  /**
   * Process all markdown files in the vault.
   */
  async processVault(
    action: "bake" | "strip",
    fetchVerse?: (ref: BibleReference) => Promise<CachedVerse | null>
  ): Promise<number> {
    const files = this.app.vault.getMarkdownFiles();
    let count = 0;

    for (const file of files) {
      const content = await this.app.vault.read(file);
      const refs = this.extractReferences(content);
      if (refs.length === 0) continue;

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

/** Escape special regex characters in a string */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
