import { Notice } from "obsidian";
import {
  chooseSense,
  choiceLabel,
  definitionLines,
  glossMeaning,
  GLOSS_LABEL,
  meaningChoice,
  parseChoiceLabel,
  splitMarkedText,
  hasMarkers,
  meaningVerseText,
  setWordDisplay,
  transliterationFor,
  wordDisplayOf,
  LexiconEntry,
  LexiconSense,
  Meaning,
  StrongsWord,
  WordDisplay,
  WordDisplayState,
  STRONGS_CREDIT,
  STRONGS_LICENSE_URL,
  strongsTranslationLabel,
} from "./strongs";

/**
 * DOM half of the Strong's layer (#69), shared by Live Preview and Reading
 * view. The verse body arrives rendered with word markers in its text (see
 * strongs.ts); this swaps them for hoverable word spans and runs the popover.
 *
 * Writing back to the note differs between the two views, so it is passed in:
 * Live Preview batches into the widget's pending token patch, Reading view
 * rewrites the file.
 */

/** How a view persists the layer's edits. */
export interface StrongsWriter {
  /** Store what every word shows: the full transliteration and meaning sets. */
  setWords(state: WordDisplayState): void;
  /** Add one markdown line after the token; `meaningLabel` narrows it to one meaning. */
  insertLineBelow(word: StrongsWord, sense: LexiconSense | null, meaningLabel: string | null): void;
}

/** Everything the renderer needs to draw a verse with the layer on. */
export interface StrongsLayer {
  /** Tagged words, indexed by the markers in the verse text. */
  words: StrongsWord[];
  /** What each word shows instead of the English, if anything. */
  state: WordDisplayState;
  /** Transliterations already looked up, by word key. */
  transliterations: Map<string, string>;
  /** Text of each word's chosen meaning, by word key. */
  meaningTexts: Map<string, string>;
  /** Whether single words can be picked from a meaning (a setting, read live). */
  wordPicks(): boolean;
  /** The translation's abbreviation, as the reference label shows it ("KJV"). */
  translation: string;
  lookup(number: string): Promise<LexiconEntry | null>;
  writer: StrongsWriter;
}

const WORD_CLASS = "bible-verse-strongs-word";
const TRANSLITERATED_CLASS = "is-transliterated";
const MEANING_CLASS = "is-meaning";


/**
 * Swap the word markers under `root` for word spans. Call once the verse body
 * has rendered. Leaves `root` untouched if the text carries no markers.
 */
export function decorateStrongs(root: HTMLElement, layer: StrongsLayer): void {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    if (hasMarkers(node.data)) nodes.push(node);
  }
  if (nodes.length === 0) return;

  root.addClass("bible-verse--strongs");
  const created = new Map<string, { span: HTMLElement; word: StrongsWord }>();

  for (const textNode of nodes) {
    const frag = doc.createDocumentFragment();
    for (const seg of splitMarkedText(textNode.data)) {
      if (typeof seg === "string") {
        frag.appendChild(doc.createTextNode(seg));
        continue;
      }
      const word = layer.words[seg.index];
      if (!word) {
        frag.appendChild(doc.createTextNode(seg.text));
        continue;
      }
      const span = createWordSpan(doc, word, layer);
      if (!created.has(word.key)) created.set(word.key, { span, word });
      frag.appendChild(span);
    }
    textNode.parentNode?.replaceChild(frag, textNode);
  }

  paintAdapted(root, layer);
  popover.adopt(created, layer);
}

function createWordSpan(doc: Document, word: StrongsWord, layer: StrongsLayer): HTMLElement {
  const span = doc.createElement("span");
  span.className = WORD_CLASS;
  span.dataset.key = word.key;
  paintWord(span, word, layer);

  span.addEventListener("mouseenter", () => popover.scheduleShow(span, word, layer));
  span.addEventListener("mouseleave", () => popover.scheduleHide());
  // Keep the editor from moving its cursor into the token on click.
  span.addEventListener("mousedown", (e) => e.preventDefault());
  span.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    // A click flips English and transliteration; from a meaning it goes back
    // to the English. Meanings are picked in the popover.
    const current = wordDisplayOf(layer.state, word.key);
    void applyDisplay(span, word, layer, current.kind === "english" ? { kind: "transliteration" } : { kind: "english" });
  });
  return span;
}

/** The text a word shows, or undefined for the English. */
function shownText(word: StrongsWord, layer: StrongsLayer): { text: string; kind: WordDisplay["kind"] } | undefined {
  const display = wordDisplayOf(layer.state, word.key);
  if (display.kind === "meaning") {
    const text = layer.meaningTexts.get(word.key);
    return text !== undefined ? { text, kind: "meaning" } : undefined;
  }
  if (display.kind === "transliteration") {
    const text = layer.transliterations.get(word.key);
    return text !== undefined ? { text, kind: "transliteration" } : undefined;
  }
  return undefined;
}

/**
 * Show the English word, its transliteration or a meaning, per the layer's
 * state. A substituted word says what it replaced and where the text comes
 * from — the lexicon is CC BY 4.0, which asks for credit and for changes to be
 * marked, and a meaning is shown adapted (see meaningVerseText).
 */
function paintWord(span: HTMLElement, word: StrongsWord, layer: StrongsLayer): void {
  const shown = shownText(word, layer);
  span.textContent = shown?.text ?? word.english;
  span.toggleClass(TRANSLITERATED_CLASS, shown?.kind === "transliteration");
  span.toggleClass(MEANING_CLASS, shown?.kind === "meaning");

  if (!shown) {
    span.setAttr("aria-label", `${word.english} (${word.number})`);
    span.removeAttribute("title");
    return;
  }
  const display = wordDisplayOf(layer.state, word.key);
  let what = `transliteration, from the ${STRONGS_CREDIT}`;
  if (display.kind === "meaning") {
    const { line, alternative } = parseChoiceLabel(display.label);
    what = alternative === null
      ? `meaning ${line}, adapted from the ${STRONGS_CREDIT}`
      : `meaning ${line} (one word of it), adapted from the ${STRONGS_CREDIT}`;
  }
  const note = `"${word.english}" (${word.number}) shown as its ${what}`;
  span.setAttr("aria-label", note);
  span.setAttr("title", note);
}

/**
 * Once any word shows something other than the English, the verse is no
 * longer the translation's own wording, so the reference says so where readers
 * look for the translation: "Proverbs 3:5 (KJV-Strong's)". Hovering it gives
 * the lexicon credit. Undo every change and it reads "(KJV)" again.
 */
function paintAdapted(root: HTMLElement, layer: StrongsLayer): void {
  const wrapper = root.closest<HTMLElement>(".bible-verse") ?? root;
  const adapted = layer.words.some((w) => shownText(w, layer) !== undefined);
  wrapper.toggleClass("bible-verse--adapted", adapted);

  const label = wrapper.querySelector<HTMLElement>(".bible-verse-ref");
  if (!label) return;

  // Labels end in the translation: "Proverbs 3:5 (KJV)" or, inline,
  // "(Proverbs 3:5, KJV)". Swap just that, so a reference the verse-shift
  // controls have rewritten is kept.
  const plain = layer.translation;
  const marked = strongsTranslationLabel(plain);
  const text = label.textContent ?? "";
  const from = adapted ? `${plain})` : `${marked})`;
  const to = adapted ? `${marked})` : `${plain})`;
  if (text.endsWith(from)) label.textContent = text.slice(0, -from.length) + to;

  if (adapted) {
    label.setAttr(
      "title",
      `Some words are shown as transliterations or lexicon meanings, not the ${plain} wording. ` +
        `Lexicon text from the ${STRONGS_CREDIT}.`
    );
  } else {
    label.removeAttribute("title");
  }
}

/**
 * Set what one word shows, looking up the text it needs first, then repaint
 * and persist. Leaves everything as it was if the text cannot be found.
 */
async function applyDisplay(
  span: HTMLElement,
  word: StrongsWord,
  layer: StrongsLayer,
  display: WordDisplay
): Promise<void> {
  if (display.kind === "transliteration" && !layer.transliterations.has(word.key)) {
    let translit: string | null = null;
    try {
      translit = transliterationFor(await layer.lookup(word.number));
    } catch (e) {
      console.error("Bible Verse: lexicon lookup failed", e);
    }
    if (translit === null) {
      new Notice(`No transliteration for ${word.number}.`);
      return;
    }
    layer.transliterations.set(word.key, translit);
  }

  if (display.kind === "meaning") {
    let text: string | null = null;
    try {
      text = meaningChoice(chooseSense(await layer.lookup(word.number)), display.label)?.verseText ?? null;
    } catch (e) {
      console.error("Bible Verse: lexicon lookup failed", e);
    }
    if (text === null) {
      new Notice(`No meaning ${display.label} for ${word.number}.`);
      return;
    }
    layer.meaningTexts.set(word.key, text);
  }

  layer.state = setWordDisplay(layer.state, word.key, display);

  // The same word can be drawn more than once, e.g. a rebuilt widget still
  // settling; repaint every span for it under this verse.
  const root = span.closest<HTMLElement>(".bible-verse");
  const spans = root
    ? Array.from(root.querySelectorAll<HTMLElement>(`.${WORD_CLASS}`)).filter((s) => s.dataset.key === word.key)
    : [span];
  spans.forEach((s) => paintWord(s, word, layer));
  if (root) paintAdapted(root, layer);
  popover.refresh();

  layer.writer.setWords(layer.state);
}

// ── Popover ─────────────────────────────────────────────────────────────────

const SHOW_DELAY_MS = 150;
const HIDE_DELAY_MS = 250;

/**
 * One popover at a time, shared by every verse. It lives on the hovered word's
 * own document so it works in pop-out windows.
 */
class StrongsPopover {
  private el: HTMLElement | null = null;
  private anchor: HTMLElement | null = null;
  private word: StrongsWord | null = null;
  private layer: StrongsLayer | null = null;
  private showTimer: number | null = null;
  private hideTimer: number | null = null;

  scheduleShow(anchor: HTMLElement, word: StrongsWord, layer: StrongsLayer): void {
    this.cancelHide();
    this.cancelShow();
    // Timers stay on the main window so every set and clear pairs up; only
    // the popover element itself belongs to the word's own document.
    this.showTimer = window.setTimeout(() => {
      this.showTimer = null;
      void this.show(anchor, word, layer);
    }, SHOW_DELAY_MS);
  }

  scheduleHide(): void {
    this.cancelShow();
    this.cancelHide();
    this.hideTimer = window.setTimeout(() => {
      this.hideTimer = null;
      this.close();
    }, HIDE_DELAY_MS);
  }

  /** Redraw for the current word, after its state changed. */
  refresh(): void {
    if (this.el && this.anchor && this.word && this.layer) {
      void this.show(this.anchor, this.word, this.layer);
    }
  }

  /**
   * Follow a redraw. Saving a choice rewrites the token in Live Preview, which
   * rebuilds the verse and replaces the word the popover belongs to; move it
   * to the new span for the same word so the next pick still works.
   */
  adopt(spans: Map<string, { span: HTMLElement; word: StrongsWord }>, layer: StrongsLayer): void {
    if (!this.el || !this.word || !this.anchor || this.anchor.isConnected) return;
    const next = spans.get(this.word.key);
    if (!next || next.word.number !== this.word.number) return;
    this.anchor = next.span;
    this.word = next.word;
    this.layer = layer;
    this.refresh();
  }

  closeIfOrphaned(): void {
    if (this.anchor && !this.anchor.isConnected) this.close();
  }

  isAnchoredIn(el: HTMLElement): boolean {
    return this.anchor !== null && el.contains(this.anchor);
  }

  close(): void {
    this.cancelShow();
    this.cancelHide();
    this.el?.remove();
    this.el = null;
    this.anchor = null;
    this.word = null;
    this.layer = null;
  }

  private cancelShow(): void {
    if (this.showTimer !== null) {
      window.clearTimeout(this.showTimer);
      this.showTimer = null;
    }
  }

  private cancelHide(): void {
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  private async show(anchor: HTMLElement, word: StrongsWord, layer: StrongsLayer): Promise<void> {
    if (!anchor.isConnected) return;
    const doc = anchor.ownerDocument;

    if (!this.el || this.el.ownerDocument !== doc) {
      this.el?.remove();
      this.el = doc.body.createDiv({ cls: "bible-verse-strongs-popover" });
      this.el.addEventListener("mouseenter", () => this.cancelHide());
      this.el.addEventListener("mouseleave", () => this.scheduleHide());
      this.el.addEventListener("mousedown", (e) => e.preventDefault());
    }
    const refreshing = this.word?.key === word.key && this.el.childElementCount > 0;
    this.anchor = anchor;
    this.word = word;
    this.layer = layer;

    const el = this.el;
    // Keep the meaning list where it was scrolled to across a redraw.
    const scrollTop = refreshing ? el.querySelector(".bible-verse-strongs-definition")?.scrollTop ?? 0 : 0;
    if (!refreshing) {
      el.empty();
      el.createDiv({ cls: "bible-verse-strongs-loading", text: word.number });
      this.place(anchor);
    }

    let entry: LexiconEntry | null = null;
    let failed = false;
    try {
      entry = await layer.lookup(word.number);
    } catch (e) {
      console.error("Bible Verse: lexicon lookup failed", e);
      failed = true;
    }
    // Another word may have been hovered while this one loaded.
    if (this.el !== el || this.word !== word) return;

    const sense = chooseSense(entry);
    const display = wordDisplayOf(layer.state, word.key);
    el.empty();

    const head = el.createDiv({ cls: "bible-verse-strongs-head" });
    head.createSpan({ cls: "bible-verse-strongs-number", text: word.number });
    if (sense?.transliteration) {
      head.createSpan({ cls: "bible-verse-strongs-translit", text: sense.transliteration });
    }
    if (sense?.lemma) {
      head.createSpan({ cls: "bible-verse-strongs-lemma", text: sense.lemma });
    }

    // The gloss is offered as a meaning to pick, in a row like a numbered
    // meaning's (see glossMeaning); only when a numbered meaning already reads
    // the same is it a plain heading above the definition.
    const gloss = glossMeaning(sense);
    if (sense?.gloss && !gloss) {
      el.createDiv({ cls: "bible-verse-strongs-gloss", text: sense.gloss });
    }
    if (sense?.definition || gloss) {
      this.renderDefinition(el, anchor, word, layer, sense?.definition ?? "", gloss, display);
    }
    if (!sense) {
      el.createDiv({
        cls: "bible-verse-strongs-definition",
        text: failed ? "Could not load the lexicon entry." : "No lexicon entry for this number.",
      });
    }

    const actions = el.createDiv({ cls: "bible-verse-strongs-actions" });
    if (display.kind !== "english") {
      this.actionButton(actions, `Show "${word.english}"`, () => {
        if (anchor.isConnected) void applyDisplay(anchor, word, layer, { kind: "english" });
      });
    }
    if (sense?.transliteration && display.kind !== "transliteration") {
      this.actionButton(actions, `Show as ${sense.transliteration}`, () => {
        if (anchor.isConnected) void applyDisplay(anchor, word, layer, { kind: "transliteration" });
      });
    }
    if (sense) {
      const chosen = display.kind === "meaning" ? display.label : null;
      this.actionButton(actions, "Insert below", () => {
        layer.writer.insertLineBelow(word, sense, chosen);
        this.close();
      });
    }

    const credit = el.createDiv({ cls: "bible-verse-strongs-credit" });
    const link = credit.createEl("a", { text: STRONGS_CREDIT, href: STRONGS_LICENSE_URL });
    link.setAttr("target", "_blank");
    link.setAttr("rel", "noopener");

    const definitionEl = el.querySelector(".bible-verse-strongs-definition");
    if (definitionEl) definitionEl.scrollTop = scrollTop;
    this.place(anchor);
  }

  /**
   * The definition, with each numbered meaning as a row that shows it in the
   * verse. With word picks on, each comma-separated alternative in a row is a
   * pick of its own. Clicking whatever is already shown puts the English back.
   *
   * The gloss, when offered, is the first row, ahead of the lexicon text (see
   * glossMeaning): meaning 1 in an entry with no numbered meanings, otherwise
   * an unnumbered row in bold.
   *
   * Rows are divs with a button role, not buttons: themes style <button>
   * heavily, and a definition should still read as text.
   */
  private renderDefinition(
    el: HTMLElement,
    anchor: HTMLElement,
    word: StrongsWord,
    layer: StrongsLayer,
    definition: string,
    gloss: Meaning | null,
    display: WordDisplay
  ): void {
    const box = el.createDiv({ cls: "bible-verse-strongs-definition" });
    const lines = definitionLines(definition);
    if (gloss) lines.unshift({ text: gloss.text, meaning: gloss });

    const wordPicks = layer.wordPicks();
    const chosen = display.kind === "meaning" ? parseChoiceLabel(display.label) : null;
    const pick = (label: string, isShown: boolean) => {
      if (!anchor.isConnected) return;
      void applyDisplay(anchor, word, layer, isShown ? { kind: "english" } : { kind: "meaning", label });
    };

    if (lines.some((l) => l.meaning?.selectable)) {
      el.insertBefore(
        createDiv({
          cls: "bible-verse-strongs-hint",
          text: wordPicks
            ? "Pick a meaning, or one word of it, to show it in the verse."
            : "Pick a meaning to show it in the verse.",
        }),
        box
      );
    }

    for (const line of lines) {
      const m = line.meaning;
      if (!m || !m.selectable) {
        const plain = box.createDiv({
          cls: m ? "bible-verse-strongs-line bible-verse-strongs-heading" : "bible-verse-strongs-line",
          text: line.text,
        });
        if (m) plain.setCssProps({ "--depth": String(m.depth - 1) });
        continue;
      }

      const lineShown = chosen?.line === m.label && chosen.alternative === null;
      const row = box.createDiv({ cls: "bible-verse-strongs-meaning" });
      row.toggleClass("is-gloss", m.label === GLOSS_LABEL);
      row.setCssProps({ "--depth": String(m.depth - 1) });
      row.toggleClass("is-selected", lineShown);
      row.toggleClass("has-selected-word", chosen?.line === m.label && chosen.alternative !== null);
      makePressable(row, lineShown, lineShown ? `Show "${word.english}" again` : `Show "${m.verseText}" in the verse`, () =>
        pick(m.label, lineShown)
      );

      row.createSpan({ cls: "bible-verse-strongs-meaning-label", text: m.label === GLOSS_LABEL ? "" : m.label });
      const textEl = row.createSpan({ cls: "bible-verse-strongs-meaning-text" });

      if (!wordPicks || m.alternatives.length < 2) {
        textEl.setText(m.text);
        continue;
      }
      m.alternatives.forEach((alt, i) => {
        if (i > 0) textEl.appendText(", ");
        const n = i + 1;
        const altShown = chosen?.line === m.label && chosen.alternative === n;
        const altEl = textEl.createSpan({ cls: "bible-verse-strongs-alt", text: alt });
        altEl.toggleClass("is-selected", altShown);
        makePressable(altEl, altShown, altShown ? `Show "${word.english}" again` : `Show "${meaningVerseText(alt)}" in the verse`, () =>
          pick(choiceLabel(m.label, n), altShown)
        );
      });
    }
  }

  private actionButton(parent: HTMLElement, text: string, onClick: () => void): void {
    const btn = parent.createEl("button", { text, attr: { type: "button" } });
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
  }

  /** Below the word, kept inside the window; above it when there is no room. */
  private place(anchor: HTMLElement): void {
    const el = this.el;
    if (!el) return;
    const win = anchor.ownerDocument.defaultView ?? window;
    const r = anchor.getBoundingClientRect();
    const margin = 8;
    const width = el.offsetWidth;
    const height = el.offsetHeight;

    const left = Math.max(margin, Math.min(r.left, win.innerWidth - width - margin));
    const below = r.bottom + 4;
    const top = below + height + margin > win.innerHeight && r.top - height - 4 > margin
      ? r.top - height - 4
      : below;

    el.setCssProps({ left: `${left}px`, top: `${top}px` });
  }
}

/**
 * Make an element act as a toggle button: clickable, focusable, Enter/Space,
 * and pressed state for assistive tech. Clicks stop here, so a word inside a
 * meaning row does not also pick the whole row.
 */
function makePressable(el: HTMLElement, pressed: boolean, title: string, onPress: () => void): void {
  el.setAttr("role", "button");
  el.setAttr("tabindex", "0");
  el.setAttr("aria-pressed", String(pressed));
  el.setAttr("title", title);
  el.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onPress();
  });
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    e.stopPropagation();
    onPress();
  });
}

const popover = new StrongsPopover();

/** Close the Strong's popover (plugin unload). */
export function closeStrongsPopover(): void {
  popover.close();
}

/** How long a popover whose verse was torn down waits for the redraw. */
const ORPHAN_GRACE_MS = 1000;

/**
 * A widget is being torn down. If the popover belongs to a word inside it,
 * give the rebuilt verse a moment to adopt it, and close it if none does.
 */
export function releaseStrongsPopover(within: HTMLElement): void {
  if (!popover.isAnchoredIn(within)) return;
  window.setTimeout(() => popover.closeIfOrphaned(), ORPHAN_GRACE_MS);
}
