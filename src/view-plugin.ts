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
import {
  parseInlineSpec,
  formatReference,
  inlineTokenRegex,
  inlineTokenContent,
  INLINE_TOKEN_SOURCE,
} from "./parser";
import { shiftReference, rewriteTokenReference, ShiftDelta } from "./shift";
import { BibleReference, CachedVerse, DisplayStyle, BibleWebsite } from "./types";
import { renderVerse, renderComparison, renderError, renderBakePending } from "./renderer";
import { verseFetchedEffect } from "./effects";

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
      /** Whole {…} token text, used to re-emit the same brace form on a shift. */
      token: string;
      /** Chapter length when a provider has reported one; undefined = unknown. */
      numberOfVerses?: number;
    }
  ) {
    super();
  }

  /**
   * The rendered DOM, kept only so `posAtDOM` can resolve the widget's current
   * document offset at click time. Deliberately not a position — see applyShift.
   */
  private containerEl: HTMLElement | null = null;

  toDOM(view: EditorView): HTMLElement {
    const container = createSpan({ cls: "bible-verse-livepreview" });
    this.containerEl = container;

    const vnL = this.spec.verseNewLine ?? this.spec.plugin.settings.verseNewLine;

    // References that bake (the `bake` token or native-callout style) show a
    // placeholder in the editor; the actual bake happens on Reading-view render.
    const effectiveStyle = this.spec.styleOverride ?? this.spec.plugin.settings.displayStyle;
    if ((this.spec.bake || effectiveStyle === "native-callout") && this.spec.translations.length < 2) {
      renderBakePending(container, this.spec.ref);
      return container;
    }

    // Link-only translations still carry a real reference, so the controls
    // apply; they just have no chapter length to clamp against.
    if (this.spec.translations.length === 1 && this.spec.plugin.isTranslationLinkOnly(this.spec.translations[0])) {
      this.renderPill(container);
      this.renderShiftControls(container, view);
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

    this.renderShiftControls(container, view);
    return container;
  }

  /**
   * The +/- verse controls (#49). Plain click moves the end verse, Alt-click
   * moves the start verse.
   *
   * Rendered as the container's last child. Every render path above builds its
   * root element synchronously before awaiting, so appending here keeps the
   * controls after the verse regardless of which path ran.
   */
  private renderShiftControls(container: HTMLElement, view: EditorView): void {
    const { ref, numberOfVerses } = this.spec;

    // Nothing to nudge — whole-chapter, multi-chapter, and discontinuous
    // references have no unambiguous start or end verse. Render no chrome at
    // all rather than four permanently dead buttons.
    const anyShiftPossible = ([-1, 1] as ShiftDelta[]).some(
      (d) =>
        shiftReference(ref, "end", d, numberOfVerses) !== null ||
        shiftReference(ref, "start", d, numberOfVerses) !== null
    );
    if (!anyShiftPossible) return;

    const controls = container.createSpan({ cls: "bible-verse-shift" });
    this.renderShiftButton(controls, view, -1);
    this.renderShiftButton(controls, view, 1);
  }

  private renderShiftButton(controls: HTMLElement, view: EditorView, delta: ShiftDelta): void {
    const { ref, numberOfVerses } = this.spec;
    const canEnd = shiftReference(ref, "end", delta, numberOfVerses) !== null;
    const canStart = shiftReference(ref, "start", delta, numberOfVerses) !== null;

    const verb = delta > 0 ? "Extend" : "Shrink";
    const btn = controls.createEl("button", {
      cls: "bible-verse-shift-btn",
      text: delta > 0 ? "+" : "−",
      attr: {
        type: "button",
        "aria-label": `${verb} passage (Alt-click to move the start verse)`,
        title: `${verb} passage — Alt-click to move the start verse`,
      },
    });

    // Disabled only when neither action is available, so Alt-click still works
    // at a boundary the end verse cannot cross.
    if (!canEnd && !canStart) {
      btn.disabled = true;
      return;
    }

    // Keep focus where it is. Without this the click moves the cursor into the
    // token, the decoration drops out (selectionOverlaps), and the widget is
    // replaced by raw text mid-click.
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.applyShift(view, e.altKey ? "start" : "end", delta);
    });
  }

  /**
   * Rewrite the token in the document.
   *
   * The position is resolved here rather than captured at build time: `eq()`
   * does not compare position, so CodeMirror reuses a widget instance when only
   * its offset moved, and any stored offset would be stale. `posAtDOM` is
   * always current, and the token is re-matched at that offset before writing —
   * if anything has shifted underneath us, bail rather than corrupt the note.
   */
  private applyShift(view: EditorView, target: "start" | "end", delta: ShiftDelta): void {
    const shifted = shiftReference(this.spec.ref, target, delta, this.spec.numberOfVerses);
    if (!shifted) return;
    if (!this.containerEl || !this.containerEl.isConnected) return;

    const from = view.posAtDOM(this.containerEl);

    // Confirm a token really does start here before writing. Cheap insurance
    // against a stale DOM reference, and the difference between a no-op and
    // mangling unrelated text.
    const line = view.state.doc.lineAt(from);
    const match = new RegExp(`^(?:${INLINE_TOKEN_SOURCE})`).exec(
      view.state.doc.sliceString(from, line.to)
    );
    if (!match || match[0] !== this.spec.token) return;

    const insert = rewriteTokenReference(match[0], shifted);
    if (insert === null) return;

    view.dispatch({
      changes: { from, to: from + match[0].length, insert },
    });
  }

  private renderPill(container: HTMLElement): void {
    const a = createEl("a", { cls: "bible-verse-pill" });

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

      // container.empty() above took the controls with it.
      this.renderShiftControls(container, view);

      view.dispatch({ effects: verseFetchedEffect.of(undefined) });
    } catch (e) {
      console.error("Bible Verse Live Preview: fetch failed", e);
      container.empty();
      renderError(container, `Could not load ${formatReference(ref)}.`);
      // Keep the controls on an error, so overshooting the end of a chapter is
      // recoverable by pressing the other button rather than editing by hand.
      this.renderShiftControls(container, view);
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
      this.spec.preferredWebsite === other.spec.preferredWebsite &&
      this.spec.token === other.spec.token &&
      // Drives which shift buttons are disabled, so a widget whose chapter
      // length has just arrived must re-render.
      this.spec.numberOfVerses === other.spec.numberOfVerses
    );
  }

  ignoreEvent(event: Event): boolean {
    const target = event.target as HTMLElement | null;
    const isAnchorEvent = !!(target && target.closest("a"));
    const isShiftControl = !!(target && target.closest(".bible-verse-shift"));

    if (event.type === "mousedown") {
      return isAnchorEvent || isShiftControl;
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
          const inlineRe = inlineTokenRegex();
          let match: RegExpExecArray | null;

          while ((match = inlineRe.exec(text)) !== null) {
            const tokenStart = from + match.index;
            const tokenEnd = tokenStart + match[0].length;

            // Escaped token (\{...}) — leave it as literal text (#28)
            if (tokenStart > 0 && view.state.doc.sliceString(tokenStart - 1, tokenStart) === "\\") continue;

            if (selectionOverlaps(selections, tokenStart, tokenEnd)) continue;

            const content = inlineTokenContent(match).trim();
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
              token: match[0],
              numberOfVerses: cachedVerses[0]?.numberOfVerses,
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
