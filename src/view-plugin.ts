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
import { BibleReference, CachedVerse } from "./types";
import { renderVerse, renderError } from "./renderer";

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
      cachedVerse: CachedVerse | null;
      plugin: BibleVersePlugin;
    }
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement("span");
    container.className = "bible-verse-livepreview";

    if (this.spec.cachedVerse) {
      renderVerse(
        container,
        this.spec.ref,
        this.spec.cachedVerse,
        this.spec.plugin.settings.displayStyle,
        this.spec.plugin.settings.preferredWebsite
      );
    } else {
      // Placeholder pill
      this.renderPill(container);
      // Async fetch — update DOM in place, then signal the ViewPlugin
      this.fetchAndUpdate(container, view);
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
    const { plugin, ref, translations } = this.spec;

    try {
      let verse: CachedVerse;

      if (translations.length >= 2) {
        // For comparison mode in live preview we just show the first translation
        const id = plugin.resolveTranslationIdPublic(translations[0]);
        const abbr = plugin.getTranslationAbbrPublic(id);
        verse = await plugin.api.getPassage(ref, id, abbr);
      } else {
        const id = translations.length === 1
          ? plugin.resolveTranslationIdPublic(translations[0])
          : plugin.settings.defaultTranslation;
        const abbr = plugin.getTranslationAbbrPublic(id);
        verse = await plugin.api.getPassage(ref, id, abbr);
      }

      // Update the DOM in place (visible immediately)
      container.empty();
      renderVerse(
        container,
        ref,
        verse,
        plugin.settings.displayStyle,
        plugin.settings.preferredWebsite
      );

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
      this.spec.cachedVerse === other.spec.cachedVerse
    );
  }

  /** Allow link clicks and other events to pass through. */
  ignoreEvent(event: Event): boolean {
    return event.type !== "mousedown";
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

            const { ref, translations } = spec;
            const refLabel = formatReference(ref);

            // Resolve translation and check cache
            let translationId: string;
            let abbr: string;
            if (translations.length >= 1) {
              translationId = plugin.resolveTranslationIdPublic(translations[0]);
              abbr = plugin.getTranslationAbbrPublic(translationId);
            } else {
              translationId = plugin.settings.defaultTranslation;
              abbr = plugin.getTranslationAbbrPublic();
            }

            const cachedVerse = plugin.cache.get(abbr, refLabel) ?? null;

            // Build display label and href for the placeholder/widget header
            let label: string;
            if (translations.length === 0) {
              label = refLabel;
            } else if (translations.length === 1) {
              label = `${refLabel} (${translations[0]})`;
            } else {
              label = `${refLabel} (${translations.join(" | ")})`;
            }

            const href = plugin.generateLinkPublic(ref, abbr);

            const widget = new BibleVerseWidget({
              label,
              href,
              ref,
              translations,
              cachedVerse,
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
