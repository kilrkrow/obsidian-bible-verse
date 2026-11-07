import type { CachedVerse } from "./types";
import type { InlineSpec } from "./parser";
import type { WordDisplayState } from "./strongs";
import { resolveShowVerseNumbers } from "./format";
import { canPlaceBake, formatCalloutBake, formatCodeBlockBake, placeBakedBlock, UNSAFE_BAKE_NOTICE } from "./baker";
import { formatStrongsHeader } from "./strongs";
import { INLINE_TOKEN_SOURCE } from "./parser";
import type { EditorView } from "@codemirror/view";

export const COMPARISON_BAKE_NOTICE = "Bake one translation at a time; comparison passages cannot be baked from this button.";
export const BAKE_FAILED_NOTICE = "Could not fetch this passage. The live token is unchanged; try Bake again.";
export const BAKE_STALE_NOTICE = "Could not find this verse in the note to bake it. No text was changed.";

export interface InlineBakeSettings {
  verseNewLine: boolean;
  showVerseNumbers: boolean;
  nativeCalloutType: string;
}

/** Resolve one token to the established Baker formatter for an explicit Bake click. */
export function bakeResult(
  verse: CachedVerse,
  spec: InlineSpec,
  settings: InlineBakeSettings,
  url: string
): string | null {
  if (spec.translations.length >= 2) return null;

  // Native-callout tokens use the bake-pending Live Preview path. Keeping this
  // branch here makes the pure helper safe for every kind of inline bake.
  if (spec.styleOverride === "native-callout") {
    return formatCalloutBake(verse, settings.nativeCalloutType, spec.calloutCollapsed, url);
  }

  return formatCodeBlockBake(verse, {
    verseNewLine: spec.verseNewLine ?? settings.verseNewLine,
    showVerseNumbers: resolveShowVerseNumbers(spec.ref, spec.showVerseNumbers, settings.showVerseNumbers),
    style: spec.styleOverride ?? undefined,
    strongs: formatStrongsHeader({ transliterate: spec.transliterate, meanings: spec.meanings }) ?? undefined,
  });
}

/** Locate the exact token at the widget's current position immediately before dispatch. */
export function locateInlineBake(documentText: string, from: number, token: string): { from: number; to: number } | null {
  if (!new RegExp(`^(?:${INLINE_TOKEN_SOURCE})$`).test(token)) return null;
  return documentText.slice(from, from + token.length) === token
    ? { from, to: from + token.length }
    : null;
}

export interface InlineBakeDispatch {
  changes: { from: number; to: number; insert: string };
  userEvent: "input.paste";
}

export type InlineBakeOutcome = "written" | "failed" | "cancelled" | "comparison" | "refused";

/**
 * Own one widget's in-flight bake without any CodeMirror or Obsidian imports.
 * The token is matched again after the fetch; destroy() cancels the job, and a
 * second run cannot start until the first settles. The returned change is for
 * one editor dispatch and therefore one ordinary undo step.
 */
export class InlineBakeJob {
  private pending: { cancelled: boolean } | null = null;

  constructor(private readonly notice: (message: string) => void) {}

  get busy(): boolean {
    return this.pending !== null;
  }

  destroy(): void {
    if (this.pending) this.pending.cancelled = true;
    this.pending = null;
  }

  async run(
    source: EditorView,
    container: HTMLElement | null,
    token: string,
    spec: InlineSpec,
    settings: InlineBakeSettings,
    urlFor: (verse: CachedVerse) => string,
    fetchVerse: (words: WordDisplayState) => Promise<CachedVerse | null>
  ): Promise<{ outcome: InlineBakeOutcome; change?: InlineBakeDispatch }> {
    if (spec.translations.length >= 2) {
      this.notice(COMPARISON_BAKE_NOTICE);
      return { outcome: "comparison" };
    }
    if (this.pending) return { outcome: "cancelled" };
    if (!container?.isConnected || source.posAtDOM(container) < 0) return { outcome: "cancelled" };
    // Refuse an unsafe spot before fetching (checked again when placing).
    const early = locateInlineBake(source.state.doc.toString(), source.posAtDOM(container), token);
    if (early) {
      const text = source.state.doc.toString();
      if (!canPlaceBake(text, early.from, early.to)) {
        this.notice(UNSAFE_BAKE_NOTICE);
        return { outcome: "refused" };
      }
    }

    const job = { cancelled: false };
    this.pending = job;
    try {
      let verse: CachedVerse | null;
      try {
        verse = await fetchVerse({ transliterate: spec.transliterate, meanings: spec.meanings });
      } catch {
        verse = null;
      }
      if (job.cancelled || this.pending !== job || !container.isConnected) return { outcome: "cancelled" };
      if (!verse) {
        this.notice(BAKE_FAILED_NOTICE);
        return { outcome: "failed" };
      }

      const insert = bakeResult(verse, spec, settings, urlFor(verse));
      if (!insert) {
        this.notice(COMPARISON_BAKE_NOTICE);
        return { outcome: "comparison" };
      }
      const text = source.state.doc.toString();
      const range = locateInlineBake(text, source.posAtDOM(container), token);
      if (!range) {
        this.notice(BAKE_STALE_NOTICE);
        return { outcome: "failed" };
      }
      // Same placement as the Baker's command paths: the block on its own
      // lines, prose and container prefixes preserved, one change. Refused
      // where it can't be placed safely; the note is left unchanged.
      const changes = placeBakedBlock(text, range.from, range.to, insert);
      if (!changes) {
        this.notice(UNSAFE_BAKE_NOTICE);
        return { outcome: "refused" };
      }
      return { outcome: "written", change: { changes, userEvent: "input.paste" } };
    } finally {
      if (this.pending === job) this.pending = null;
    }
  }
}
