import { Notice } from "obsidian";
import {
  chooseSense,
  splitMarkedText,
  hasMarkers,
  transliterationFor,
  toggleKey,
  LexiconEntry,
  LexiconSense,
  StrongsWord,
  STRONGS_CREDIT,
  STRONGS_LICENSE_URL,
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
  /** Store the full set of word keys shown as transliterations. */
  setTransliterated(keys: string[]): void;
  /** Add one markdown line after the token. */
  insertLineBelow(word: StrongsWord, sense: LexiconSense | null): void;
}

/** Everything the renderer needs to draw a verse with the layer on. */
export interface StrongsLayer {
  /** Tagged words, indexed by the markers in the verse text. */
  words: StrongsWord[];
  /** Keys currently shown as transliterations. */
  transliterated: Set<string>;
  /** Transliterations already looked up for those keys. */
  transliterations: Map<string, string>;
  lookup(number: string): Promise<LexiconEntry | null>;
  writer: StrongsWriter;
}

const WORD_CLASS = "bible-verse-strongs-word";
const TRANSLITERATED_CLASS = "is-transliterated";
const BADGE_CLASS = "bible-verse-strongs-badge";

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
      frag.appendChild(createWordSpan(doc, word, layer));
    }
    textNode.parentNode?.replaceChild(frag, textNode);
  }

  paintAdapted(root, layer);
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
    void toggleWord(span, word, layer);
  });
  return span;
}

/** Show the English word or its transliteration, per the layer's state. */
function paintWord(span: HTMLElement, word: StrongsWord, layer: StrongsLayer): void {
  const shown = layer.transliterated.has(word.key) ? layer.transliterations.get(word.key) : undefined;
  span.textContent = shown ?? word.english;
  span.toggleClass(TRANSLITERATED_CLASS, shown !== undefined);
  span.setAttr(
    "aria-label",
    shown !== undefined ? `${word.english} (${word.number}), shown as ${shown}` : `${word.english} (${word.number})`
  );
}

/**
 * Mark the verse once any word is transliterated, so it is no longer presented
 * as untouched translation wording. Placed beside the reference label.
 */
function paintAdapted(root: HTMLElement, layer: StrongsLayer): void {
  const wrapper = root.closest<HTMLElement>(".bible-verse") ?? root;
  const adapted = [...layer.transliterated].some((k) => layer.transliterations.has(k));
  wrapper.toggleClass("bible-verse--adapted", adapted);

  root.querySelectorAll(`.${BADGE_CLASS}`).forEach((el) => el.remove());
  if (!adapted) return;

  const label = root.querySelector<HTMLElement>(".bible-verse-ref");
  const badge = root.ownerDocument.createElement("span");
  badge.className = BADGE_CLASS;
  badge.textContent = "with transliteration";
  badge.setAttr(
    "title",
    "Some words are shown as their Hebrew or Greek transliteration, so this is not the translation's own wording."
  );
  if (label && label.parentElement) label.insertAdjacentElement("afterend", badge);
  else wrapper.appendChild(badge);
}

/** Flip one word between English and transliteration, and persist it. */
async function toggleWord(span: HTMLElement, word: StrongsWord, layer: StrongsLayer): Promise<void> {
  if (!layer.transliterated.has(word.key)) {
    let translit = layer.transliterations.get(word.key) ?? null;
    if (translit === null) {
      try {
        translit = transliterationFor(await layer.lookup(word.number));
      } catch (e) {
        console.error("Bible Verse: lexicon lookup failed", e);
      }
    }
    if (translit === null) {
      new Notice(`No transliteration for ${word.number}.`);
      return;
    }
    layer.transliterations.set(word.key, translit);
  }

  const keys = toggleKey([...layer.transliterated], word.key);
  layer.transliterated = new Set(keys);
  paintWord(span, word, layer);

  const root = span.closest<HTMLElement>(".bible-verse");
  if (root) paintAdapted(root, layer);
  popover.refresh();

  layer.writer.setTransliterated(keys);
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
    this.anchor = anchor;
    this.word = word;
    this.layer = layer;

    const el = this.el;
    el.empty();
    el.createDiv({ cls: "bible-verse-strongs-loading", text: word.number });
    this.place(anchor);

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
    el.empty();

    const head = el.createDiv({ cls: "bible-verse-strongs-head" });
    head.createSpan({ cls: "bible-verse-strongs-number", text: word.number });
    if (sense?.transliteration) {
      head.createSpan({ cls: "bible-verse-strongs-translit", text: sense.transliteration });
    }
    if (sense?.lemma) {
      head.createSpan({ cls: "bible-verse-strongs-lemma", text: sense.lemma });
    }

    if (sense?.gloss) {
      el.createDiv({ cls: "bible-verse-strongs-gloss", text: sense.gloss });
    }
    if (sense?.definition) {
      el.createDiv({ cls: "bible-verse-strongs-definition", text: sense.definition });
    }
    if (!sense) {
      el.createDiv({
        cls: "bible-verse-strongs-definition",
        text: failed ? "Could not load the lexicon entry." : "No lexicon entry for this number.",
      });
    }

    const actions = el.createDiv({ cls: "bible-verse-strongs-actions" });
    const shown = layer.transliterated.has(word.key);
    if (sense?.transliteration || shown) {
      const swap = actions.createEl("button", {
        text: shown ? `Show "${word.english}"` : `Show as ${sense?.transliteration ?? ""}`,
        attr: { type: "button" },
      });
      swap.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (anchor.isConnected) void toggleWord(anchor, word, layer);
      });
    }
    if (sense) {
      const insert = actions.createEl("button", { text: "Insert below", attr: { type: "button" } });
      insert.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        layer.writer.insertLineBelow(word, sense);
        this.close();
      });
    }

    const credit = el.createDiv({ cls: "bible-verse-strongs-credit" });
    const link = credit.createEl("a", { text: STRONGS_CREDIT, href: STRONGS_LICENSE_URL });
    link.setAttr("target", "_blank");
    link.setAttr("rel", "noopener");

    this.place(anchor);
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

    el.style.setProperty("left", `${left}px`);
    el.style.setProperty("top", `${top}px`);
  }
}

const popover = new StrongsPopover();

/**
 * Close the Strong's popover: always, or with `within` only when the word it
 * belongs to is inside that element (a widget being torn down).
 */
export function closeStrongsPopover(within?: HTMLElement): void {
  if (within && !popover.isAnchoredIn(within)) return;
  popover.close();
}
