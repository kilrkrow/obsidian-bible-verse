import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { RangeSetBuilder, StateEffect } from "@codemirror/state";
import type BibleVersePlugin from "./main";
import { parseInlineSpec, formatReference } from "./parser";
import { BibleReference, CachedVerse, DisplayStyle } from "./types";
import { renderVerse, renderComparison, renderError } from "./renderer";

// Matches {…} inline tokens (same pattern as inlinePostProcessor)
const INLINE_RE = /\{([A-Za-z0-9][^}\n]*)\}/g;

/**
 * Dispatched to the EditorView when an async verse fetch completes, so the
 * ViewPlugin knows to rebuild decorations and show the freshly-cached verse.
 */
export const verseFetchedEffect = StateEffect.define<void>();

// ─────────────────────────────────────────────────────────────────────────────
// Widget
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Live Preview widget for a {ref} token.
 *
 * - If the verse is already cached: renders the full verse immediately.
 * - If not cached: shows a link pill placeholder and kicks off a fetch;
 *   when the fetch completes it updates the DOM in place AND dispatches a
 *   verseFetchedEffect so the ViewPlugin rebuilds decorations (showing the
 *   cached verse from that point on).
 */
class BibleVerseWidget extends WidgetType {
  constructor(
    private readonly spec: {
      label: string;
      href: string;
      ref: BibleReference;
      translations: string[];
      styleOverride: DisplayStyle | null;
      verseNewLine: boolean | null;
      showVerseNumbers: boolean | null;
      cachedVerses: CachedVerse[];
      plugin: BibleVersePlugin;
    }
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement("span");
    container.className = "bible-verse-livepreview";

    const vnL = this.spec.verseNewLine ?? this.spec.plugin.settings.verseNewLine;
    const sVN = this.spec.showVerseNumbers ?? this.spec.plugin.settings.showVerseNumbers;

    if (this.spec.translations.length >= 2) {
      if (this.spec.cachedVerses.length === this.spec.translations.length) {
        renderComparison(
          container,
          this.spec.ref,
          this.spec.cachedVerses,
          this.spec.plugin.settings.preferredWebsite,
          this.spec.plugin.settings.showAttribution,
          this.spec.plugin.app,
          this.spec.plugin
        );
      } else {
        this.renderPill(container);
        this.fetchAndUpdate(container, view);
      }
    } else {
      const cached = this.spec.cachedVerses[0];
      if (cached) {
        renderVerse(
          container,
          this.spec.ref,
          cached,
          this.spec.styleOverride ?? this.spec.plugin.settings.displayStyle,
          this.spec.plugin.settings.preferredWebsite,
          this.spec.plugin.settings.showAttribution,
          this.spec.plugin.app,
          this.spec.plugin
        );
      } else {
        this.renderPill(container);
        this.fetchAndUpdate(container, view);
      }
    }

    return container;
  }

  private renderPill(container: HTMLElement): void {
    const a = document.createElement("a");
    a.className = "bible-verse-pill";
    a.textContent = "\uD83D\uDCD6 " + this.spec.label; // 📖 label
    a.href = this.spec.href;
    a.target = "_blank";
    a.rel = "noopener";
    a.addEventListener("mousedown", (e) => e.preventDefault());
    container.appendChild(a);
  }

  private async fetchAndUpdate(container: HTMLElement, view: EditorView): Promise<void> {
    const { plugin, ref, translations, verseNewLine, showVerseNumbers } = this.spec;
    const vnL = verseNewLine ?? plugin.settings.verseNewLine;
    const sVN = showVerseNumbers ?? plugin.settings.showVerseNumbers;

    try {
      const verses: CachedVerse[] = [];

      if (translations.length >= 2) {
        for (const trans of translations) {
          const id = plugin.resolveTranslationIdPublic(trans);
          const abbr = plugin.getTranslationAbbrPublic(id);
          const v = await plugin.api.getPassage(ref, id, abbr, {
            showVerseNumbers: sVN,
            verseNewLine: vnL,
          });
          verses.push(v);
        }
      } else {
        const id = translations.length === 1
          ? plugin.resolveTranslationIdPublic(translations[0])
          : plugin.settings.defaultTranslation;
        const abbr = plugin.getTranslationAbbrPublic(id);
        const v = await plugin.api.getPassage(ref, id, abbr, {
          showVerseNumbers: sVN,
          verseNewLine: vnL,
        });
        verses.push(v);
      }

      // Update the DOM in place (visible immediately)
      container.empty();
      if (translations.length >= 2) {
        await renderComparison(
          container,
          ref,
          verses,
          plugin.settings.preferredWebsite,
          plugin.settings.showAttribution,
          plugin.app,
          plugin
        );
      } else {
        await renderVerse(
          container,
          ref,
          verses[0],
          this.spec.styleOverride ?? plugin.settings.displayStyle,
          plugin.settings.preferredWebsite,
          plugin.settings.showAttribution,
          plugin.app,
          plugin
        );
      }

      // Signal the ViewPlugin so future decoration builds use the cache
      view.dispatch({ effects: verseFetchedEffect.of(undefined) });
    } catch (e) {
      console.error("Bible Verse Live Preview: fetch failed", e);
      container.empty();
      renderError(container, `Could not load ${formatReference(ref)}.`);
    }
  }

  /**
   * Two widgets are equal if they would render identically.
   * Comparing cachedVerse reference is enough — once a verse enters the cache
   * the same object is returned on subsequent lookups.
   */
  eq(other: BibleVerseWidget): boolean {
    return (
      this.spec.label === other.spec.label &&
      this.spec.cachedVerses.length === other.spec.cachedVerses.length &&
      this.spec.cachedVerses.every((v, i) => v === other.spec.cachedVerses[i]) &&
      this.spec.styleOverride === other.spec.styleOverride &&
      this.spec.verseNewLine === other.spec.verseNewLine &&
      this.spec.showVerseNumbers === other.spec.showVerseNumbers
    );
  }

  /**
   * Controls which events CodeMirror handles vs. what the widget DOM handles.
   *
   * Default CM6 behavior on mousedown inside a replace-decoration is to place
   * the caret at the token position, which un-replaces the widget. That made
   * clicking the rendered reference anchor feel broken — the user clicked
   * "John 3:16 (KJV)" expecting BibleHub to open, but instead saw raw "{John 3:16}".
   *
   * Fix: when a pointer event originates on an <a> inside the widget, return true
   * so CM leaves the event alone and the browser navigates the link normally.
   * For non-anchor targets (verse body text, callout background, etc.) mousedown
   * still returns false so the caret can move into the token for editing.
   *
   * click/auxclick always return true so left-click, middle-click (open in new
   * tab), and Ctrl/Cmd+click all reach the anchor default handler.
   */
  ignoreEvent(event: Event): boolean {
    const target = event.target as HTMLElement | null;
    const isAnchorEvent = !!(target && target.closest("a"));

    if (event.type === "mousedown") {
      // Let CM handle mousedown only when it is NOT on an anchor — that way
      // clicking the link opens the site, and clicking elsewhere still lets
      // the user drop the caret into the token for editing.
      return isAnchorEvent;
    }

    // All other events (click, auxclick, mouseup, etc.) stay with the DOM so
    // link navigation proceeds normally.
    return true;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function selectionOverlaps(
  ranges: readonly { from: number; to: number }[],
  from: number,
  to: number
): boolean {
  for (const sel of ranges) {
    if (sel.from <= to && sel.to >= from) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// ViewPlugin factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a CM6 ViewPlugin that decorates {ref} tokens in Live Preview.
 *
 * - Cursor inside token  → raw text shown for editing.
 * - Cursor outside token → replaced by a BibleVerseWidget:
 *     • cached verse  → full verse rendered inline
 *     • uncached      → pill link placeholder; async fetch updates the DOM
 *       and dispatches verseFetchedEffect to trigger decoration rebuild.
 */
export function buildViewPlugin(plugin: BibleVersePlugin) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
      }

      update(update: ViewUpdate): void {
        const needsRebuild =
          update.docChanged ||
          update.viewportChanged ||
          update.selectionSet ||
          update.transactions.some((tr) =>
            tr.effects.some((e) => e.is(verseFetchedEffect))
          );

        if (needsRebuild) {
          this.decorations = this.buildDecorations(update.view);
        }
      }

      buildDecorations(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        const selections = view.state.selection.ranges;

        for (const { from, to } of view.visibleRanges) {
          const text = view.state.doc.sliceString(from, to);
          INLINE_RE.lastIndex = 0;
          let match: RegExpExecArray | null;

          while ((match = INLINE_RE.exec(text)) !== null) {
            const tokenStart = from + match.index;
            const tokenEnd = tokenStart + match[0].length;

            // Keep raw text when cursor is inside the token
            if (selectionOverlaps(selections, tokenStart, tokenEnd)) continue;

            const content = match[1].trim();
            const spec = parseInlineSpec(content);
            if (!spec) continue;

            const { ref, translations, styleOverride, verseNewLine, showVerseNumbers } = spec;
            const refLabel = formatReference(ref);

            // Resolve formatting settings with overrides
            const vnL = verseNewLine ?? plugin.settings.verseNewLine;
            const sVN = showVerseNumbers ?? plugin.settings.showVerseNumbers;

            // Resolve translation and check cache
            const cachedVerses: CachedVerse[] = [];
            if (translations.length >= 2) {
              for (const trans of translations) {
                const id = plugin.resolveTranslationIdPublic(trans);
                const abbr = plugin.getTranslationAbbrPublic(id);
                const cached = plugin.cache.get(abbr, refLabel, vnL, sVN);
                if (cached) cachedVerses.push(cached);
              }
            } else {
              const id = translations.length === 1
                ? plugin.resolveTranslationIdPublic(translations[0])
                : plugin.settings.defaultTranslation;
              const abbr = plugin.getTranslationAbbrPublic(id);
              const cached = plugin.cache.get(abbr, refLabel, vnL, sVN);
              if (cached) cachedVerses.push(cached);
            }

            // Build display label and href for the placeholder/widget header
            let label: string;
            if (translations.length === 0) {
              label = refLabel;
            } else if (translations.length === 1) {
              label = `${refLabel} (${translations[0]})`;
            } else {
              label = `${refLabel} (${translations.join(" | ")})`;
            }

            // Primary translation for the pill link
            const primaryId = translations.length >= 1
              ? plugin.resolveTranslationIdPublic(translations[0])
              : plugin.settings.defaultTranslation;
            const primaryAbbr = plugin.getTranslationAbbrPublic(primaryId);
            const href = plugin.generateLinkPublic(ref, primaryAbbr);

            const widget = new BibleVerseWidget({
              label,
              href,
              ref,
              translations,
              styleOverride,
              verseNewLine,
              showVerseNumbers,
              cachedVerses,
              plugin,
            });

            builder.add(
              tokenStart,
              tokenEnd,
              Decoration.replace({ widget })
            );
          }
        }

        return builder.finish();
      }
    },
    { decorations: (v) => v.decorations }
  );
}
