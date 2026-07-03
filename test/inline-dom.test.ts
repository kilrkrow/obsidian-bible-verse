// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { flattenInlineContent } from "../src/inline-dom";

/**
 * Build a container populated as Obsidian's MarkdownRenderer would for inline
 * text: single "\n" separators become `<br>` followed by a "\n" text node;
 * blank lines become separate `<p>` blocks.
 */
function container(html: string): HTMLElement {
  const el = document.createElement("span");
  el.innerHTML = html;
  return el;
}

describe("flattenInlineContent", () => {
  it("no-nl: collapses <br> to spaces, no line-break spans", () => {
    const el = container("<p>16. verse one<br>\n17. verse two<br>\n18. verse three</p>");
    flattenInlineContent(el, false);

    expect(el.querySelectorAll("br").length).toBe(0);
    expect(el.querySelectorAll(".bible-verse-line-break").length).toBe(0);
    expect(el.querySelectorAll("p").length).toBe(0);
    expect(el.textContent).toBe("16. verse one 17. verse two 18. verse three");
  });

  it("nl: replaces each <br> with a line-break span, strips trailing newline", () => {
    const el = container("<p>16. verse one<br>\n17. verse two<br>\n18. verse three</p>");
    flattenInlineContent(el, true);

    expect(el.querySelectorAll("br").length).toBe(0);
    // Two separators between three verses.
    expect(el.querySelectorAll(".bible-verse-line-break").length).toBe(2);
    // Break spans are empty (pure structural line breaks).
    for (const s of el.querySelectorAll(".bible-verse-line-break")) {
      expect(s.textContent).toBe("");
    }
    // Trailing "\n" text nodes are stripped — no stray newlines remain.
    expect(el.textContent).toBe("16. verse one17. verse two18. verse three");
  });

  it("unwraps <p> and inserts a para-break span between paragraph groups", () => {
    const el = container("<p>verse one</p><p>verse two</p>");
    flattenInlineContent(el, false);

    expect(el.querySelectorAll("p").length).toBe(0);
    expect(el.querySelectorAll(".bible-verse-para-break").length).toBe(1);
    expect(el.textContent).toBe("verse oneverse two");
  });

  it("nl: line breaks within paragraphs plus a para-break between groups", () => {
    const el = container("<p>16. a<br>\n17. b</p><p>18. c<br>\n19. d</p>");
    flattenInlineContent(el, true);

    expect(el.querySelectorAll(".bible-verse-line-break").length).toBe(2);
    expect(el.querySelectorAll(".bible-verse-para-break").length).toBe(1);
    expect(el.querySelectorAll("p, br").length).toBe(0);
  });

  it("is a no-op on plain single-verse content", () => {
    const el = container("<p>For God so loved the world.</p>");
    flattenInlineContent(el, true);

    expect(el.querySelectorAll("p, br, .bible-verse-line-break, .bible-verse-para-break").length).toBe(0);
    expect(el.textContent).toBe("For God so loved the world.");
  });
});
