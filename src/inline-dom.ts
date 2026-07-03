/**
 * DOM post-processing for the inline display style.
 *
 * Obsidian's MarkdownRenderer emits block elements (`<p>`, `<br>`) that can't
 * live inside an inline context, so we flatten them. This module has NO
 * `obsidian` dependency — it operates purely on a populated DOM node — so it can
 * be unit-tested directly under jsdom.
 */

/**
 * Flatten rendered markdown for inline display.
 *
 * - `<p>` wrappers are unwrapped; a `bible-verse-para-break` block-span is
 *   inserted between paragraph groups to preserve the gap.
 * - `<br>` elements (from single "\n" separators) are either turned into a
 *   `bible-verse-line-break` block-span (when `verseNewLine` is set) or
 *   collapsed to a space (so inline verses flow). The trailing "\n" text node
 *   MarkdownRenderer emits after each `<br>` is stripped either way, since under
 *   CM6's white-space: pre-wrap it would render as an extra blank line.
 */
export function flattenInlineContent(container: HTMLElement, verseNewLine: boolean): void {
  // Flatten all <p> wrappers — inline context can't hold block elements.
  const paragraphs = Array.from(container.querySelectorAll("p"));
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    while (p.firstChild) {
      container.insertBefore(p.firstChild, p);
    }
    if (i < paragraphs.length - 1) {
      const sep = document.createElement("span");
      sep.className = "bible-verse-para-break";
      container.insertBefore(sep, p);
    }
    p.remove();
  }

  for (const br of Array.from(container.querySelectorAll("br"))) {
    const next = br.nextSibling;
    if (next?.nodeType === Node.TEXT_NODE && (next as Text).data.startsWith("\n")) {
      (next as Text).data = (next as Text).data.slice(1);
    }
    if (verseNewLine) {
      const lineBreak = document.createElement("span");
      lineBreak.className = "bible-verse-line-break";
      br.replaceWith(lineBreak);
    } else {
      br.replaceWith(document.createTextNode(" "));
    }
  }
}
