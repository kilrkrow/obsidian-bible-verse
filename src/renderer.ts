import { BibleReference, CachedVerse, DisplayStyle, BibleWebsite } from "./types";
import { formatReference } from "./parser";
import { generateLink } from "./linker";

/**
 * Render a single verse result into an HTML element.
 */
export function renderVerse(
  container: HTMLElement,
  ref: BibleReference,
  verse: CachedVerse,
  style: DisplayStyle,
  website: BibleWebsite
): void {
  const wrapper = container.createDiv({ cls: `bible-verse bible-verse-${style}` });
  const refStr = formatReference(ref);
  const url = generateLink(ref, verse.translation, website);

  switch (style) {
    case "sidebar":
      renderSidebar(wrapper, refStr, verse, url);
      break;
    case "callout":
      renderCallout(wrapper, refStr, verse, url);
      break;
    case "blockquote":
      renderBlockquote(wrapper, refStr, verse, url);
      break;
    case "inline":
      renderInline(wrapper, refStr, verse, url);
      break;
  }
}

function renderSidebar(el: HTMLElement, ref: string, verse: CachedVerse, url: string): void {
  const body = el.createDiv({ cls: "bible-verse-body" });
  body.createEl("p", { cls: "bible-verse-text", text: verse.text });

  const footer = el.createDiv({ cls: "bible-verse-footer" });
  const link = footer.createEl("a", {
    cls: "bible-verse-ref",
    text: `${ref} (${verse.translation})`,
    href: url,
  });
  link.setAttr("target", "_blank");
  link.setAttr("rel", "noopener");

  if (verse.copyright) {
    footer.createEl("span", { cls: "bible-verse-copyright", text: verse.copyright });
  }
}

function renderCallout(el: HTMLElement, ref: string, verse: CachedVerse, url: string): void {
  const header = el.createDiv({ cls: "bible-verse-header" });
  header.createSpan({ cls: "bible-verse-icon", text: "\uD83D\uDCD6" }); // 📖
  const link = header.createEl("a", {
    cls: "bible-verse-ref",
    text: `${ref} (${verse.translation})`,
    href: url,
  });
  link.setAttr("target", "_blank");
  link.setAttr("rel", "noopener");

  const body = el.createDiv({ cls: "bible-verse-body" });
  body.createEl("p", { cls: "bible-verse-text", text: verse.text });

  if (verse.copyright) {
    el.createDiv({ cls: "bible-verse-copyright", text: verse.copyright });
  }
}

function renderBlockquote(el: HTMLElement, ref: string, verse: CachedVerse, url: string): void {
  const body = el.createDiv({ cls: "bible-verse-body" });
  body.createEl("p", { cls: "bible-verse-text", text: verse.text });

  const footer = el.createDiv({ cls: "bible-verse-footer" });
  footer.createSpan({ text: "\u2014 " });
  const link = footer.createEl("a", {
    cls: "bible-verse-ref",
    text: `${ref} (${verse.translation})`,
    href: url,
  });
  link.setAttr("target", "_blank");
  link.setAttr("rel", "noopener");

  if (verse.copyright) {
    el.createDiv({ cls: "bible-verse-copyright", text: verse.copyright });
  }
}

function renderInline(el: HTMLElement, ref: string, verse: CachedVerse, url: string): void {
  el.createSpan({ cls: "bible-verse-text", text: `"${verse.text}" ` });
  const link = el.createEl("a", {
    cls: "bible-verse-ref",
    text: `(${ref}, ${verse.translation})`,
    href: url,
  });
  link.setAttr("target", "_blank");
  link.setAttr("rel", "noopener");

  if (verse.copyright) {
    el.createSpan({ cls: "bible-verse-copyright", text: ` ${verse.copyright}` });
  }
}

/**
 * Render a link-only element (when verse text is not available).
 */
export function renderLink(
  container: HTMLElement,
  ref: BibleReference,
  translation: string,
  website: BibleWebsite
): void {
  const refStr = formatReference(ref);
  const url = generateLink(ref, translation, website);

  const span = container.createSpan({ cls: "bible-verse bible-verse-link" });
  const link = span.createEl("a", {
    cls: "bible-verse-ref",
    text: `\uD83D\uDCD6 ${refStr}`,
    href: url,
  });
  link.setAttr("target", "_blank");
  link.setAttr("rel", "noopener");
}

/**
 * Render a comparison/parallel view of multiple translations.
 */
export function renderComparison(
  container: HTMLElement,
  ref: BibleReference,
  verses: CachedVerse[],
  website: BibleWebsite
): void {
  const wrapper = container.createDiv({ cls: "bible-verse-comparison" });
  const refStr = formatReference(ref);

  // Header
  wrapper.createEl("div", {
    cls: "bible-verse-comparison-header",
    text: refStr,
  });

  // Grid of translations
  const grid = wrapper.createDiv({ cls: "bible-verse-comparison-grid" });
  for (const verse of verses) {
    const col = grid.createDiv({ cls: "bible-verse-comparison-col" });
    const url = generateLink(ref, verse.translation, website);

    const header = col.createDiv({ cls: "bible-verse-comparison-trans" });
    const link = header.createEl("a", {
      text: verse.translation,
      href: url,
    });
    link.setAttr("target", "_blank");
    link.setAttr("rel", "noopener");

    col.createEl("p", { cls: "bible-verse-text", text: verse.text });

    if (verse.copyright) {
      col.createDiv({ cls: "bible-verse-copyright", text: verse.copyright });
    }
  }
}

/**
 * Render an error message.
 */
export function renderError(container: HTMLElement, message: string): void {
  container.createDiv({
    cls: "bible-verse bible-verse-error",
    text: `Bible Verse: ${message}`,
  });
}
