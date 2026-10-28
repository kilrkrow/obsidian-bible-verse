// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BibleVerseSettingTab } from "../src/settings";
import { addVersionLabel, versionLabelText, VERSION_LABEL_CLASS } from "../src/version-label";
import type BibleVersePlugin from "../src/main";
import type { App } from "obsidian";

/**
 * The settings tab ends with "Bible Verse <version>", read from the loaded
 * manifest, so every build shows which version is running.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(HERE, "..", "manifest.json"), "utf8")) as { name: string; version: string };

beforeAll(() => {
  // Obsidian's DOM helpers, used by settings.ts at runtime.
  const g = globalThis as unknown as Record<string, unknown>;
  g.createFragment = () => document.createDocumentFragment();
  g.createEl = (tag: string, o?: { text?: string }) => {
    const el = document.createElement(tag);
    if (o?.text) el.textContent = o.text;
    return el;
  };
  const P = HTMLElement.prototype as unknown as Record<string, unknown>;
  P.empty = function (this: HTMLElement) { this.replaceChildren(); };
  P.addClass = function (this: HTMLElement, c: string) { this.classList.add(c); };
  (DocumentFragment.prototype as unknown as Record<string, unknown>).appendText = function (this: DocumentFragment, t: string) {
    this.append(t);
  };
});

describe("settings tab — version label", () => {
  it("reads name and version from the manifest", () => {
    expect(versionLabelText(manifest)).toBe(`Bible Verse ${manifest.version}`);
    expect(versionLabelText({ name: "Bible Verse", version: "9.9.9" })).toBe("Bible Verse 9.9.9");
  });

  it("is plain ASCII text", () => {
    expect(versionLabelText(manifest)).toMatch(/^[\x20-\x7e]+$/);
  });

  it("is the last row of the tab, showing manifest.json's version", () => {
    const plugin = { manifest, settings: {} } as unknown as BibleVersePlugin;
    const tab = new BibleVerseSettingTab({} as App, plugin);
    const items = tab.getSettingDefinitions();
    const last = items[items.length - 1] as { name: string; render: (s: { settingEl: HTMLElement }) => void };
    expect(last.name).toBe("Version");

    const settingEl = document.createElement("div");
    settingEl.textContent = "placeholder";
    last.render({ settingEl });
    const label = settingEl.querySelector(`.${VERSION_LABEL_CLASS}`)!;
    expect(label.textContent).toBe(`Bible Verse ${manifest.version}`);
    expect(settingEl.textContent).toBe(label.textContent);
  });

  it("appends one label element", () => {
    const el = document.createElement("div");
    addVersionLabel(el, manifest);
    expect(el.querySelectorAll(`.${VERSION_LABEL_CLASS}`).length).toBe(1);
  });
});
