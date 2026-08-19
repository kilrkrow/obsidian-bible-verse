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
 * Quiet period before a burst of verse-shift clicks is written to the document
 * (#49). Long enough to coalesce repeated tapping into one change and one undo
 * step, short enough that a single click still feels immediate.
 */
const SHIFT_SETTLE_MS = 250;

/**
 * How long the control strip stays open after a click, regardless of hover.
 * Covers the rebuild that follows a commit and absorbs small mouse drift while
 * tapping, without leaving the strip open once you have moved on.
 */
const REVEAL_STICKY_MS = 3000;

/** Set on the label/controls wrapper while the controls should be visible. */
const REVEALED_CLASS = "is-revealed";

/**
 * Last known pointer position per document, so a rebuilt control strip can tell
 * whether the cursor is already sitting on it. Chromium does not re-evaluate
 * `:hover` for a newly inserted element until the pointer moves, and a burst of
 * shift clicks rebuilds the widget under a stationary cursor.
 *
 * One passive listener per document, registered on first use. Obsidian pop-out
 * windows each have their own, hence the map rather than a single pair.
 */
const pointerPositions = new WeakMap<Document, { x: number; y: number }>();

function trackPointer(doc: Document): void {
  if (pointerPositions.has(doc)) return;
  pointerPositions.set(doc, { x: -1, y: -1 });
  doc.addEventListener(
    "pointermove",
    (e: PointerEvent) => pointerPositions.set(doc, { x: e.clientX, y: e.clientY }),
    { passive: true }
  );
}

/** Whether the last known pointer position falls inside an element's box. */
function pointerIsInside(el: HTMLElement): boolean {
  const at = pointerPositions.get(el.ownerDocument);
  if (!at || at.x < 0) return false;
  const r = el.getBoundingClientRect();
  return at.x >= r.left && at.x <= r.right && at.y >= r.top && at.y <= r.bottom;
}

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

  /**
   * Pending state for a burst of shift clicks. Clicks accumulate here and are
   * written to the document once, after SHIFT_SETTLE_MS of quiet — so following
   * a teacher through ten verses is one document change and one undo step
   * rather than ten of each, and the widget survives the burst instead of being
   * torn down and refetched on every tap.
   */
  private pendingRef: BibleReference | null = null;
  private pendingTimer: number | null = null;

  /** Non-null while a recent click is holding the control strip open. */
  private revealTimer: number | null = null;

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
      this.attachShiftControls(container, view);
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
        ).then(() => this.attachShiftControls(container, view));
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
        ).then(() => this.attachShiftControls(container, view));
      } else {
        this.renderPill(container);
        void this.fetchAndUpdate(container, view);
      }
    }

    return container;
  }

  /**
   * The +/- verse controls (#49). Plain click moves the end verse, Alt-click
   * moves the start verse.
   *
   * Attached beside the reference label rather than at the end of the block:
   * the label is the one landmark every display style shares, though it sits in
   * a header for callout and a footer for sidebar and blockquote. Label and
   * controls are wrapped together so hovering either keeps both visible —
   * without the wrapper, travelling from the label to a button would cross a
   * gap and the controls would vanish under the cursor.
   *
   * Must be called after the renderer's promise settles. Sidebar, blockquote,
   * and inline only create the label after awaiting the verse text, so it does
   * not exist yet when the render call returns.
   */
  private attachShiftControls(container: HTMLElement, view: EditorView): void {
    const { ref, numberOfVerses } = this.spec;

    // Nothing to nudge — whole-chapter, multi-chapter, and discontinuous
    // references have no unambiguous start or end verse. Render no chrome at
    // all rather than permanently dead buttons.
    const anyShiftPossible = ([-1, 1] as ShiftDelta[]).some(
      (d) =>
        shiftReference(ref, "end", d, numberOfVerses) !== null ||
        shiftReference(ref, "start", d, numberOfVerses) !== null
    );
    if (!anyShiftPossible) return;

    // Fully undo any previous attach before re-attaching: drop the controls,
    // then unwrap the zone back around the label. Removing only the controls
    // would leave the old wrapper in place and nest a second one inside it.
    container.querySelectorAll(".bible-verse-shift").forEach((el) => el.remove());
    container.querySelectorAll(".bible-verse-shift-zone").forEach((old) => {
      const parent = old.parentElement;
      if (!parent) return;
      while (old.firstChild) parent.insertBefore(old.firstChild, old);
      old.remove();
    });

    const label = container.querySelector<HTMLElement>(
      ".bible-verse-ref, .bible-verse-comparison-header, .bible-verse-pill"
    );

    const zone = createSpan({ cls: "bible-verse-shift-zone" });
    if (label && label.parentElement) {
      label.parentElement.insertBefore(zone, label);
      zone.appendChild(label);
    } else {
      // No recognisable label (an error render, say) — fall back to the end of
      // the block so the controls still exist.
      container.appendChild(zone);
    }

    const controls = zone.createSpan({ cls: "bible-verse-shift" });
    this.renderShiftButton(controls, view, -1);
    this.renderShiftButton(controls, view, 1);

    this.bindReveal(zone);
  }

  /**
   * Wire the hover reveal.
   *
   * CSS `:hover` alone is not enough. When a shift commits, the widget is
   * rebuilt, and Chromium will not re-apply `:hover` to a freshly inserted
   * element until the pointer next moves — so the controls would disappear
   * under a stationary cursor mid-burst, exactly when they are being used. The
   * pointer position is tracked globally and re-checked against the new zone
   * once it lands, which restores the reveal without needing a mouse move.
   */
  private bindReveal(zone: HTMLElement): void {
    trackPointer(zone.ownerDocument);

    zone.addEventListener("pointerenter", () => {
      this.clearRevealTimer();
      zone.addClass(REVEALED_CLASS);
    });

    zone.addEventListener("pointerleave", () => {
      // A recent click holds the strip open through small mouse drift; let the
      // sticky timer close it instead of closing immediately.
      if (this.revealTimer === null) zone.removeClass(REVEALED_CLASS);
    });

    // The zone is not in the document yet. Once it is, reveal it if the pointer
    // is already inside — the post-commit rebuild case.
    requestAnimationFrame(() => {
      if (!zone.isConnected) return;
      if (pointerIsInside(zone) || this.revealTimer !== null) {
        zone.addClass(REVEALED_CLASS);
      }
    });
  }

  /** Hold the strip open for a moment after a click, then let hover decide. */
  private holdRevealed(): void {
    const zone = this.containerEl?.querySelector<HTMLElement>(".bible-verse-shift-zone");
    if (zone) zone.addClass(REVEALED_CLASS);

    this.clearRevealTimer();
    this.revealTimer = window.setTimeout(() => {
      this.revealTimer = null;
      const current = this.containerEl?.querySelector<HTMLElement>(".bible-verse-shift-zone");
      if (current && !pointerIsInside(current)) current.removeClass(REVEALED_CLASS);
    }, REVEAL_STICKY_MS);
  }

  private clearRevealTimer(): void {
    if (this.revealTimer !== null) {
      window.clearTimeout(this.revealTimer);
      this.revealTimer = null;
    }
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
        "data-delta": String(delta),
        "aria-label": `${verb} passage (Alt-click to move the start verse)`,
        title: `${verb} passage — Alt-click to move the start verse`,
      },
    });

    // Disabled only when neither action is available, so Alt-click still works
    // at a boundary the end verse cannot cross. Listeners are attached either
    // way, since updateButtonStates can re-enable the button mid-burst.
    btn.disabled = !canEnd && !canStart;

    // Keep focus where it is. Without this the click moves the cursor into the
    // token, the decoration drops out (selectionOverlaps), and the widget is
    // replaced by raw text mid-click.
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.holdRevealed();
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
    // Chain from the pending reference, not the rendered one, so a second click
    // during a burst advances from where the first one left off.
    const base = this.pendingRef ?? this.spec.ref;
    const shifted = shiftReference(base, target, delta, this.spec.numberOfVerses);
    if (!shifted) return;

    this.pendingRef = shifted;
    this.showPendingReference(shifted);
    this.updateButtonStates();

    if (this.pendingTimer !== null) window.clearTimeout(this.pendingTimer);
    this.pendingTimer = window.setTimeout(() => {
      this.pendingTimer = null;
      const ref = this.pendingRef;
      this.pendingRef = null;
      if (ref) this.commitShift(view, ref);
    }, SHIFT_SETTLE_MS);
  }

  /**
   * Reflect a pending shift in the reference label straight away. The verse
   * text stays stale until the change lands, but the reference is what the user
   * is tracking while tapping, and updating it keeps the controls from feeling
   * dead during a burst.
   */
  private showPendingReference(ref: BibleReference): void {
    if (!this.containerEl) return;
    const label = formatReference(ref);
    this.containerEl.querySelectorAll<HTMLElement>(".bible-verse-ref, .bible-verse-pill").forEach((el) => {
      // Labels carry a trailing "(KJV)" or "(KJV | ESV)"; keep it and swap only
      // the reference in front of it.
      const suffix = el.textContent?.match(/\s*\([^)]*\)\s*$/)?.[0] ?? "";
      el.textContent = `${label}${suffix}`;
    });
  }

  /** Re-evaluate which buttons are still usable as a burst approaches a bound. */
  private updateButtonStates(): void {
    if (!this.containerEl) return;
    const ref = this.pendingRef ?? this.spec.ref;
    this.containerEl.querySelectorAll<HTMLButtonElement>(".bible-verse-shift-btn").forEach((btn) => {
      const delta = (btn.dataset.delta === "1" ? 1 : -1) as ShiftDelta;
      const canEnd = shiftReference(ref, "end", delta, this.spec.numberOfVerses) !== null;
      const canStart = shiftReference(ref, "start", delta, this.spec.numberOfVerses) !== null;
      btn.disabled = !canEnd && !canStart;
    });
  }

  /** Write an accumulated shift to the document. */
  private commitShift(view: EditorView, shifted: BibleReference): void {
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

    void this.prefetchNeighbours(shifted);
  }

  /**
   * Warm the verse cache for the steps either side of where we just landed.
   *
   * buildDecorations reads the cache synchronously, so a warm entry means the
   * next click renders the verse immediately instead of falling back to the
   * pill placeholder and an async fetch. The chapter memo in BibleApi makes
   * this nearly free — neighbours are almost always in the chapter already
   * fetched, so this costs an assemble and a cache write, not a round trip.
   */
  private async prefetchNeighbours(from: BibleReference): Promise<void> {
    const { plugin, translations, numberOfVerses } = this.spec;

    // A comparison token would multiply the work by its translation count for
    // little gain; skip it and let those fetch on demand.
    if (translations.length >= 2) return;

    const id = translations.length === 1
      ? plugin.resolveTranslationIdPublic(translations[0])
      : plugin.settings.defaultTranslation;
    if (plugin.isTranslationLinkOnly(id)) return;

    const abbr = plugin.getTranslationAbbrPublic(id);
    const settings = {
      verseNewLine: this.spec.verseNewLine ?? plugin.settings.verseNewLine,
      showVerseNumbers: this.spec.showVerseNumbers ?? plugin.settings.showVerseNumbers,
      paragraphBreaks: this.spec.paragraphBreaks ?? plugin.settings.paragraphBreaks,
    };

    for (const delta of [1, -1] as ShiftDelta[]) {
      const next = shiftReference(from, "end", delta, numberOfVerses);
      if (!next) continue;
      try {
        await plugin.fetchFromProvider(next, id, abbr, settings);
      } catch {
        // A prefetch is a convenience; a failure here must stay invisible.
      }
    }
  }

  /**
   * Drop a pending timer when the widget goes away, so it cannot fire against
   * detached DOM. Any taps not yet written are lost, which needs an external
   * document change within the settle window to happen at all — and a dispatch
   * from here would re-enter CodeMirror's update cycle, which is worse.
   */
  destroy(): void {
    if (this.pendingTimer !== null) {
      window.clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    this.clearRevealTimer();
    this.pendingRef = null;
    this.containerEl = null;
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
      this.attachShiftControls(container, view);

      view.dispatch({ effects: verseFetchedEffect.of(undefined) });
    } catch (e) {
      console.error("Bible Verse Live Preview: fetch failed", e);
      container.empty();
      renderError(container, `Could not load ${formatReference(ref)}.`);
      // Keep the controls on an error, so overshooting the end of a chapter is
      // recoverable by pressing the other button rather than editing by hand.
      this.attachShiftControls(container, view);
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
