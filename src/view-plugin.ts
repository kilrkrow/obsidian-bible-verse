import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import type BibleVersePlugin from "./main";
import { parseInlineSpec } from "./parser";
import { formatReference } from "./parser";

// Matches {…} inline tokens (same pattern as inlinePostProcessor)
const INLINE_RE = /\{([A-Za-z0-9][^}\n]*)\}/g;

/**
 * A lightweight pill widget shown in Live Preview mode when the cursor is
 * not inside the {ref} token. Clicking the pill opens the reference on the
 * configured Bible website.
 */
class BibleRefWidget extends WidgetType {
  constructor(
    private readonly label: string,
    private readonly href: string
  ) {
    super();
  }

  toDOM(_view: EditorView): HTMLElement {
    const anchor = document.createElement("a");
    anchor.className = "bible-verse-pill";
    anchor.href = this.href;
    anchor.textContent = "\uD83D\uDCD6 " + this.label; // 📖 + label
    anchor.target = "_blank";
    anchor.rel = "noopener";
    // Prevent CM6 from treating this click as a selection event
    anchor.addEventListener("mousedown", (e) => e.preventDefault());
    return anchor;
  }

  /** Allow click events to pass through to the DOM element. */
  ignoreEvent(event: Event): boolean {
    return event.type === "mousedown" || event.type === "click";
  }

  eq(other: BibleRefWidget): boolean {
    return this.label === other.label && this.href === other.href;
  }
}

/**
 * Returns true if any selection range overlaps [from, to].
 */
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

/**
 * Build a CM6 ViewPlugin that decorates {ref}, {ref, TRANS}, and
 * {ref, TRANS1, TRANS2} tokens in Live Preview.
 *
 * Behaviour:
 *   - When the cursor is NOT inside the token → replace with a clickable pill.
 *   - When the cursor IS inside the token → show raw text for editing.
 */
export function buildViewPlugin(plugin: BibleVersePlugin) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
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

            // Don't decorate if the cursor is anywhere inside the token
            // (let the user see and edit the raw text).
            if (selectionOverlaps(selections, tokenStart, tokenEnd)) continue;

            const content = match[1].trim();
            const spec = parseInlineSpec(content);
            if (!spec) continue;

            const { ref, translations } = spec;
            const refLabel = formatReference(ref);

            // Build the display label including translation hint(s)
            let label: string;
            let href: string;
            if (translations.length === 0) {
              label = refLabel;
              const abbr = plugin.getTranslationAbbrPublic();
              href = plugin.generateLinkPublic(ref, abbr);
            } else if (translations.length === 1) {
              label = `${refLabel} (${translations[0]})`;
              const abbr = plugin.getTranslationAbbrPublic(plugin.resolveTranslationIdPublic(translations[0]));
              href = plugin.generateLinkPublic(ref, abbr);
            } else {
              // Comparison: show first translation's link
              label = `${refLabel} (${translations.join(" | ")})`;
              const abbr = plugin.getTranslationAbbrPublic(plugin.resolveTranslationIdPublic(translations[0]));
              href = plugin.generateLinkPublic(ref, abbr);
            }

            builder.add(
              tokenStart,
              tokenEnd,
              Decoration.replace({ widget: new BibleRefWidget(label, href) })
            );
          }
        }

        return builder.finish();
      }
    },
    { decorations: (v) => v.decorations }
  );
}
