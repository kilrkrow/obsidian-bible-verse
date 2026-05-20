import { App, Component, MarkdownRenderer, setIcon } from "obsidian";
import { BibleReference, CachedVerse, DisplayStyle, BibleWebsite } from "./types";
import { formatReference } from "./parser";
import { generateLink } from "./linker";

/**
 * Render a single verse result into an HTML element.
 */
export async function renderVerse(
  container: HTMLElement,
  ref: BibleReference,
  verse: CachedVerse,
  style: DisplayStyle,
  website: BibleWebsite,
  showAttribution: boolean,
  app: App,
  component: Component
): Promise<void> {
  const wrapper = container.createDiv({ cls: `bible-verse bible-verse-${style}` });
  const refStr = formatReference(ref);
  const url = generateLink(ref, verse.translation, website);

  switch (style) {
    case "sidebar":
      await renderSidebar(wrapper, refStr, verse, url, showAttribution, app, component);
      break;
    case "callout":
      await renderCallout(wrapper, refStr, verse, url, showAttribution, app, component);
      break;
    case "blockquote":
      await renderBlockquote(wrapper, refStr, verse, url, showAttribution, app, component);
      break;
    case "inline":
      await renderInline(wrapper, refStr, verse, url, showAttribution, app, component);
      break;
  }
}

async function renderSidebar(
  el: HTMLElement, 
  ref: string, 
  verse: CachedVerse, 
  url: string, 
  showAttribution: boolean,
  app: App,
  component: Component
): Promise<void> {
  const body = el.createDiv({ cls: "bible-verse-body" });
  await renderText(body, verse.text, app, component);

  const footer = el.createDiv({ cls: "bible-verse-footer" });
  const link = footer.createEl("a", {
    cls: "bible-verse-ref",
    text: `${ref} (${verse.translation})`,
    href: url,
  });
  link.setAttr("target", "_blank");
  link.setAttr("rel", "noopener");

  if (showAttribution && verse.copyright) {
    footer.createEl("span", { cls: "bible-verse-copyright", text: verse.copyright });
  }
}

async function renderCallout(
  el: HTMLElement, 
  ref: string, 
  verse: CachedVerse, 
  url: string, 
  showAttribution: boolean,
  app: App,
  component: Component
): Promise<void> {
  const header = el.createDiv({ cls: "bible-verse-header" });
  const iconSpan = header.createSpan({ cls: "bible-verse-icon" });
  setIcon(iconSpan, "book-open");
  const link = header.createEl("a", {
    cls: "bible-verse-ref",
    text: `${ref} (${verse.translation})`,
    href: url,
  });
  link.setAttr("target", "_blank");
  link.setAttr("rel", "noopener");

  const body = el.createDiv({ cls: "bible-verse-body" });
  await renderText(body, verse.text, app, component);

  if (showAttribution && verse.copyright) {
    el.createDiv({ cls: "bible-verse-copyright", text: verse.copyright });
  }
}

async function renderBlockquote(
  el: HTMLElement, 
  ref: string, 
  verse: CachedVerse, 
  url: string, 
  showAttribution: boolean,
  app: App,
  component: Component
): Promise<void> {
  const body = el.createDiv({ cls: "bible-verse-body" });
  await renderText(body, verse.text, app, component);

  const footer = el.createDiv({ cls: "bible-verse-footer" });
  footer.createSpan({ text: "\u2014 " });
  const link = footer.createEl("a", {
    cls: "bible-verse-ref",
    text: `${ref} (${verse.translation})`,
    href: url,
  });
  link.setAttr("target", "_blank");
  link.setAttr("rel", "noopener");

  if (showAttribution && verse.copyright) {
    el.createDiv({ cls: "bible-verse-copyright", text: verse.copyright });
  }
}

async function renderInline(
  el: HTMLElement, 
  ref: string, 
  verse: CachedVerse, 
  url: string, 
  showAttribution: boolean,
  app: App,
  component: Component
): Promise<void> {
  const textSpan = el.createSpan({ cls: "bible-verse-text" });
  textSpan.createSpan({ text: "\"" });
  await renderText(textSpan, verse.text, app, component, true);
  textSpan.createSpan({ text: "\" " });

  const link = el.createEl("a", {
    cls: "bible-verse-ref",
    text: `(${ref}, ${verse.translation})`,
    href: url,
  });
  link.setAttr("target", "_blank");
  link.setAttr("rel", "noopener");

  if (showAttribution && verse.copyright) {
    el.createSpan({ cls: "bible-verse-copyright", text: ` ${verse.copyright}` });
  }
}

/**
 * Internal helper to render markdown text.
 */
async function renderText(el: HTMLElement, text: string, app: App, component: Component, isInline = false): Promise<void> {
  const container = isInline ? el.createSpan() : el.createDiv();
  await MarkdownRenderer.render(app, text, container, "", component);
  
  // If it's inline, we want to strip the wrapper <p> that renderMarkdown adds.
  // We move the children out of the <p> and then remove it, avoiding innerHTML.
  if (isInline) {
    const p = container.querySelector("p");
    if (p) {
      while (p.firstChild) {
        container.appendChild(p.firstChild);
      }
      p.remove();
    }
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
  const iconSpan = span.createSpan({ cls: "bible-verse-icon" });
  setIcon(iconSpan, "book-open");
  
  const link = span.createEl("a", {
    cls: "bible-verse-ref",
    text: ` ${refStr}`,
    href: url,
  });
  link.setAttr("target", "_blank");
  link.setAttr("rel", "noopener");
}

/**
 * Render a comparison/parallel view of multiple translations.
 */
export async function renderComparison(
  container: HTMLElement,
  ref: BibleReference,
  verses: CachedVerse[],
  website: BibleWebsite,
  showAttribution: boolean,
  app: App,
  component: Component
): Promise<void> {
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

    const textContainer = col.createDiv({ cls: "bible-verse-text" });
    await renderText(textContainer, verse.text, app, component);

    if (showAttribution && verse.copyright) {
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
