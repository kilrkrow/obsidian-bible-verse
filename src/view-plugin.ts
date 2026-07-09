import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { setIcon, editorLivePreviewField } from "obsidian";
import type BibleVersePlugin from "./main";
import { parseInlineSpec, formatReference } from "./parser";
import { BibleReference, CachedVerse, DisplayStyle, BibleWebsite } from "./types";
import { renderVerse, renderComparison, renderError, renderBakePending } from "./renderer";
import { verseFetchedEffect } from "./effects";

// Matches {…} inline tokens (same pattern as inlinePostProcessor)
const INLINE_RE = /\{([A-Za-z0-9][^}\n]*)\}/g;

/**
 * Live Preview widget for a {ref} token.
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
      paragraphBreaks: boolean | null;
      bake: boolean;
      cachedVerses: CachedVerse[];
      preferredWebsite: BibleWebsite;
      plugin: BibleVersePlugin;
    }
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const container = activeDocument.createElement("span");
    container.className = "bible-verse-livepreview";

    const vnL = this.spec.verseNewLine ?? this.spec.plugin.settings.verseNewLine;

    // References that bake (the `bake` token or native-callout style) show a
    // placeholder in the editor; the actual bake happens on Reading-view render.
    const effectiveStyle = this.spec.styleOverride ?? this.spec.plugin.settings.displayStyle;
    if ((this.spec.bake || effectiveStyle === "native-callout") && this.spec.translations.length < 2) {
      renderBakePending(container, this.spec.ref);
      return container;
    }

    if (this.spec.translations.length === 1 && this.spec.plugin.isTranslationLinkOnly(this.spec.translations[0])) {
      this.renderPill(container);
      return container;
    }

    if (this.spec.translations.length >= 2) {
      if (this.spec.cachedVerses.length === this.spec.translations.length) {
        void renderComparison(
          container,
          this.spec.ref,
          this.spec.cachedVerses,
          this.spec.preferredWebsite,
          this.spec.plugin.settings.showAttribution,
          this.spec.plugin.app,
          this.spec.plugin
        );
      } else {
        this.renderPill(container);
        void this.fetchAndUpdate(container, view);
      }
    } else {
      const cached = this.spec.cachedVerses[0];
      if (cached) {
        void renderVerse(
          container,
          this.spec.ref,
          cached,
          this.spec.styleOverride ?? this.spec.plugin.settings.displayStyle,
          this.spec.preferredWebsite,
          this.spec.plugin.settings.showAttribution,
          this.spec.plugin.app,
          this.spec.plugin,
          this.spec.paragraphBreaks ?? this.spec.plugin.settings.paragraphBreaks,
          vnL
        );
      } else {
        this.renderPill(container);
        void this.fetchAndUpdate(container, view);
      }
    }

    return container;
  }

  private renderPill(container: HTMLElement): void {
    const a = activeDocument.createElement("a");
    a.className = "bible-verse-pill";
    
    const iconSpan = a.createSpan({ cls: "bible-verse-icon" });
    setIcon(iconSpan, "book-open");
    
    a.createSpan({ text: " " + this.spec.label });
    a.href = this.spec.href;
    a.target = "_blank";
    a.rel = "noopener";
    a.addEventListener("mousedown", (e) => e.preventDefault());
    container.appendChild(a);
  }

  private async fetchAndUpdate(container: HTMLElement, view: EditorView): Promise<void> {
    const { plugin, ref, translations, verseNewLine, showVerseNumbers, paragraphBreaks } = this.spec;
    const vnL = verseNewLine ?? plugin.settings.verseNewLine;
    const sVN = showVerseNumbers ?? plugin.settings.showVerseNumbers;
    const pb = paragraphBreaks ?? plugin.settings.paragraphBreaks;

    try {
      const verses: CachedVerse[] = [];

      if (translations.length >= 2) {
        for (const trans of translations) {
          const id = plugin.resolveTranslationIdPublic(trans);
          const abbr = plugin.getTranslationAbbrPublic(id);
          const v = await plugin.fetchFromProvider(ref, id, abbr, {
            showVerseNumbers: sVN,
            verseNewLine: vnL,
            paragraphBreaks: pb,
          });
          verses.push(v);
        }
      } else {
        const id = translations.length === 1
          ? plugin.resolveTranslationIdPublic(translations[0])
          : plugin.settings.defaultTranslation;
        const abbr = plugin.getTranslationAbbrPublic(id);
        const v = await plugin.fetchFromProvider(ref, id, abbr, {
          showVerseNumbers: sVN,
          verseNewLine: vnL,
          paragraphBreaks: pb,
        });
        verses.push(v);
      }

      container.empty();
      if (translations.length >= 2) {
        await renderComparison(
          container,
          ref,
          verses,
          this.spec.preferredWebsite,
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
          this.spec.preferredWebsite,
          plugin.settings.showAttribution,
          plugin.app,
          plugin,
          pb,
          vnL
        );
      }

      view.dispatch({ effects: verseFetchedEffect.of(undefined) });
    } catch (e) {
      console.error("Bible Verse Live Preview: fetch failed", e);
      container.empty();
      renderError(container, `Could not load ${formatReference(ref)}.`);
    }
  }

  eq(other: BibleVerseWidget): boolean {
    return (
      this.spec.label === other.spec.label &&
      this.spec.cachedVerses.length === other.spec.cachedVerses.length &&
      this.spec.cachedVerses.every((v, i) => v === other.spec.cachedVerses[i]) &&
      this.spec.styleOverride === other.spec.styleOverride &&
      this.spec.verseNewLine === other.spec.verseNewLine &&
      this.spec.showVerseNumbers === other.spec.showVerseNumbers &&
      this.spec.paragraphBreaks === other.spec.paragraphBreaks &&
      this.spec.bake === other.spec.bake &&
      this.spec.preferredWebsite === other.spec.preferredWebsite
    );
  }

  ignoreEvent(event: Event): boolean {
    const target = event.target as HTMLElement | null;
    const isAnchorEvent = !!(target && target.closest("a"));

    if (event.type === "mousedown") {
      return isAnchorEvent;
    }

    return true;
  }
}

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
          // Live Preview <-> Source mode toggle (#27)
          update.state.field(editorLivePreviewField) !== update.startState.field(editorLivePreviewField) ||
          update.transactions.some((tr) =>
            tr.effects.some((e) => e.is(verseFetchedEffect))
          );

        if (needsRebuild) {
          this.decorations = this.buildDecorations(update.view);
        }
      }

      buildDecorations(view: EditorView): DecorationSet {
        // Source mode shows raw syntax — never replace {…} with widgets (#27)
        if (!view.state.field(editorLivePreviewField)) {
          return Decoration.none;
        }

        const builder = new RangeSetBuilder<Decoration>();
        const selections = view.state.selection.ranges;

        for (const { from, to } of view.visibleRanges) {
          const text = view.state.doc.sliceString(from, to);
          INLINE_RE.lastIndex = 0;
          let match: RegExpExecArray | null;

          while ((match = INLINE_RE.exec(text)) !== null) {
            const tokenStart = from + match.index;
            const tokenEnd = tokenStart + match[0].length;

            // Escaped token (\{...}) — leave it as literal text (#28)
            if (tokenStart > 0 && view.state.doc.sliceString(tokenStart - 1, tokenStart) === "\\") continue;

            if (selectionOverlaps(selections, tokenStart, tokenEnd)) continue;

            const content = match[1].trim();
            const spec = parseInlineSpec(content);
            if (!spec) continue;

            const { ref, translations, styleOverride, verseNewLine, showVerseNumbers, paragraphBreaks, bake } = spec;
            const refLabel = formatReference(ref);
            const vnL = verseNewLine ?? plugin.settings.verseNewLine;
            const sVN = showVerseNumbers ?? plugin.settings.showVerseNumbers;
            const pb = paragraphBreaks ?? plugin.settings.paragraphBreaks;

            const cachedVerses: CachedVerse[] = [];
            if (translations.length >= 2) {
              for (const trans of translations) {
                const id = plugin.resolveTranslationIdPublic(trans);
                const abbr = plugin.getTranslationAbbrPublic(id);
                const cached = plugin.cache.get(abbr, refLabel, vnL, sVN, pb);
                if (cached) cachedVerses.push(cached);
              }
            } else {
              const id = translations.length === 1
                ? plugin.resolveTranslationIdPublic(translations[0])
                : plugin.settings.defaultTranslation;
              const abbr = plugin.getTranslationAbbrPublic(id);
              const cached = plugin.cache.get(abbr, refLabel, vnL, sVN, pb);
              if (cached) cachedVerses.push(cached);
            }

            let label: string;
            if (translations.length === 0) {
              label = refLabel;
            } else if (translations.length === 1) {
              label = `${refLabel} (${translations[0]})`;
            } else {
              label = `${refLabel} (${translations.join(" | ")})`;
            }

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
              paragraphBreaks,
              bake,
              cachedVerses,
              preferredWebsite: plugin.settings.preferredWebsite,
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
