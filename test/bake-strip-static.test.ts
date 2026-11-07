import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Static chrome/a11y assertions complement the pure job tests. Real focus,
// hover, sizing and neighbor behavior belong to the integrated Obsidian critic.
// Normalize line endings so the checks hold on CRLF (Windows autocrlf) checkouts.
const view = readFileSync("src/view-plugin.ts", "utf8").replace(/\r\n/g, "\n");
const css = readFileSync("styles.css", "utf8").replace(/\r\n/g, "\n");

describe("Bake strip integration (#84)", () => {
  it("adds exactly one focusable peer control with a Bake description", () => {
    expect(view.match(/renderBakeButton\(controls, view\)/g)?.length).toBe(1);
    expect(view).toContain('cls: "bible-verse-bake-btn"');
    expect(view).toContain('attr: { type: "button", "aria-label": label, title: label }');
    expect(view).toContain('"Bake passage into the note"');
    expect(view).toContain('setIcon(btn, "lock-keyhole")');
  });

  it("uses the same mousedown hygiene and ignoreEvent allowlist as neighbors", () => {
    const bake = view.slice(view.indexOf("private renderBakeButton"), view.indexOf("private async bakeInlineToken"));
    expect(bake).toContain('addEventListener("mousedown", (e) => e.preventDefault())');
    expect(bake).toContain("e.stopPropagation()");
    expect(bake).toContain("this.holdRevealed()");
    expect(view).toContain('target.closest(".bible-verse-shift")');
  });

  it("leaves Enter/Space native and only leaves the control on Escape", () => {
    const bake = view.slice(view.indexOf("private renderBakeButton"), view.indexOf("private async bakeInlineToken"));
    expect(bake).toContain('e.key === "Escape"');
    expect(bake).toContain("btn.blur()");
    expect(bake).not.toContain('e.key === "Enter"');
    expect(bake).not.toContain('e.key === " "');
  });

  it("shares the existing button family and reserved reveal space", () => {
    expect(css).toContain(".bible-verse-strongs-btn,\n.bible-verse-bake-btn {");
    expect(css).toContain("min-width: 1.6em;");
    expect(css).toContain("height: 1.6em;");
    expect(css).toContain(".bible-verse-strongs-btn + .bible-verse-bake-btn");
    expect(css).not.toContain(".bible-verse-bake-btn {\n  position:");
  });
});
