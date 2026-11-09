import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * The built main.js may only require modules Obsidian provides at runtime
 * (the externals in esbuild.config.mjs). @lezer/markdown is bundled; its
 * @lezer/common and @lezer/highlight imports stay external.
 */
describe("main.js runtime requires", () => {
  const bundle = readFileSync(join(__dirname, "..", "main.js"), "utf8");
  const required = [...new Set([...bundle.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]))].sort();

  it("only Obsidian-provided modules are required", () => {
    expect(required).toEqual(["@codemirror/state", "@codemirror/view", "@lezer/common", "@lezer/highlight", "obsidian"]);
  });

  it("no dynamic require or import()", () => {
    expect(/require\([^"]/.test(bundle)).toBe(false);
    expect(/\bimport\(/.test(bundle)).toBe(false);
  });
});
