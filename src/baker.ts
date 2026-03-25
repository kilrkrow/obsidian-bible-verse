import { App, TFile } from "obsidian";
import { BibleReference, CachedVerse } from "./types";
import { parseReference, formatReference } from "./parser";

/** Regex to find bib:ref patterns in note source */
const INLINE_REF_REGEX = /\bbib:([A-Za-z0-9][^<>\n]*?\d+(?::\d+(?:-\d+(?::\d+)?)?(?:,\s*\d+)*)?)(?=[\s.,;:!?)\]<>]|$)/g;

/** Regex to find existing baked blocks */
const BAKED_BLOCK_REGEX =
  /(\bbib:[A-Za-z0-9][^<>\n]*?\d+(?::\d+(?:-\d+(?::\d+)?)?(?:,\s*\d+)*)?)\s*\n%%bible-baked\|([^%]+)%%\n([\s\S]*?)%%end-bible%%/g;

/**
 * Handles baking (embedding) and unbaking verse text in note source.
 */
export class Baker {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Extract all bib:ref references from note content.
   */
  extractReferences(content: string): { raw: string; ref: BibleReference; offset: number }[] {
    const results: { raw: string; ref: BibleReference; offset: number }[] = [];
    let match;
    const regex = new RegExp(INLINE_REF_REGEX.source, "g");
    while ((match = regex.exec(content)) !== null) {
      const ref = parseReference(match[1]);
      if (ref) {
        results.push({ raw: match[0], ref, offset: match.index });
      }
    }
    return results;
  }

  /**
   * Bake a verse into the note content after its bib:ref.
   * If already baked, update the baked block.
   */
  bakeVerse(content: string, refRaw: string, verse: CachedVerse): string {
    const bakedBlock = `\n%%bible-baked|${verse.translation}%%\n${verse.text}\n%%end-bible%%`;

    // Check if already baked — update it
    const existingPattern = new RegExp(
      escapeRegex(refRaw) +
        "\\s*\\n%%bible-baked\\|[^%]+%%\\n[\\s\\S]*?%%end-bible%%",
      "g"
    );

    if (existingPattern.test(content)) {
      return content.replace(existingPattern, refRaw + bakedBlock);
    }

    // Not yet baked — insert after the bib:ref
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
   */
  extractBakedText(
    content: string,
    refRaw: string
  ): { translation: string; text: string } | null {
    const pattern = new RegExp(
      escapeRegex(refRaw) +
        "\\s*\\n%%bible-baked\\|([^%]+)%%\\n([\\s\\S]*?)%%end-bible%%"
    );
    const match = content.match(pattern);
    if (!match) return null;
    return { translation: match[1], text: match[2].trim() };
  }

  /**
   * Bake all verses in a single file.
   * Returns the updated content.
   */
  async bakeFile(
    content: string,
    fetchVerse: (ref: BibleReference) => Promise<CachedVerse | null>
  ): Promise<string> {
    const refs = this.extractReferences(content);
    let result = content;

    for (const { raw, ref } of refs) {
      const verse = await fetchVerse(ref);
      if (verse) {
        result = this.bakeVerse(result, raw, verse);
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
