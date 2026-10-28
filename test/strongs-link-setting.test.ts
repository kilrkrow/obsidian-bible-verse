// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from "vitest";
import { DEFAULT_SETTINGS, settingsFromSaved } from "../src/types";
import { BibleVerseSettingTab } from "../src/settings";
import type BibleVersePlugin from "../src/main";
import type { App } from "obsidian";

/**
 * The "Strong's number link" setting: Bible Hub by default, and loading a
 * data.json that predates it (or holds a value we don't know) gives Bible Hub
 * without touching anything else saved there.
 */

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.createFragment = () => document.createDocumentFragment();
  g.createEl = (tag: string, o?: { text?: string }) => {
    const el = document.createElement(tag);
    if (o?.text) el.textContent = o.text;
    return el;
  };
  (DocumentFragment.prototype as unknown as Record<string, unknown>).appendText = function (this: DocumentFragment, t: string) {
    this.append(t);
  };
});

describe("Strong's number link — default and migration", () => {
  it("defaults to Bible Hub", () => {
    expect(DEFAULT_SETTINGS.strongsLinkTarget).toBe("BibleHub");
  });

  it("a fresh install (no data.json) gets the defaults", () => {
    expect(settingsFromSaved(null)).toEqual(DEFAULT_SETTINGS);
    expect(settingsFromSaved(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("a data.json without the key gets Bible Hub and keeps every other key", () => {
    // A 1.12.3 data.json: no strongsLinkTarget, plus a key this version doesn't know.
    const saved = {
      defaultTranslation: "eng_web",
      preferredWebsite: "BlueLetter",
      displayStyle: "sidebar",
      showVerseNumbers: false,
      esvApiKey: "abc123",
      lastSeenVersion: "1.12.3",
      strongsWordPicks: true,
      someFutureKey: { nested: [1, 2] },
    };
    const copy = structuredClone(saved);
    const settings = settingsFromSaved(saved) as unknown as Record<string, unknown>;
    expect(settings.strongsLinkTarget).toBe("BibleHub");
    for (const [k, v] of Object.entries(copy)) expect(settings[k]).toEqual(v);
    // The saved object itself is left alone.
    expect(saved).toEqual(copy);
  });

  it("keeps a saved choice", () => {
    expect(settingsFromSaved({ strongsLinkTarget: "STEPBible" }).strongsLinkTarget).toBe("STEPBible");
    expect(settingsFromSaved({ strongsLinkTarget: "BlueLetter" }).strongsLinkTarget).toBe("BlueLetter");
    expect(settingsFromSaved({ strongsLinkTarget: "BibleHub" }).strongsLinkTarget).toBe("BibleHub");
  });

  it("replaces only an unknown value, with Bible Hub", () => {
    const saved = { strongsLinkTarget: "Somewhere", displayStyle: "inline", lastSeenVersion: "1.12.3" };
    const s = settingsFromSaved(saved);
    expect(s.strongsLinkTarget).toBe("BibleHub");
    expect(s.displayStyle).toBe("inline");
    expect(s.lastSeenVersion).toBe("1.12.3");
  });

  it("ignores a data.json that isn't an object", () => {
    expect(settingsFromSaved("junk" as never)).toEqual(DEFAULT_SETTINGS);
    expect(settingsFromSaved([] as never)).toEqual(DEFAULT_SETTINGS);
  });
});

describe("Strong's number link — settings row", () => {
  const items = () => {
    const plugin = { manifest: { name: "Bible Verse", version: "0.0.0" }, settings: { ...DEFAULT_SETTINGS } } as unknown as BibleVersePlugin;
    return new BibleVerseSettingTab({} as App, plugin).getSettingDefinitions() as unknown as {
      name?: string;
      desc?: unknown;
      control?: { type: string; key: string; options?: Record<string, string> };
    }[];
  };

  it("is a dropdown of the three sites, right after the other Strong's setting", () => {
    const all = items();
    const i = all.findIndex((d) => d.name === "Strong's number link");
    expect(i).toBeGreaterThan(0);
    expect(all[i - 1].name).toBe("Pick single words from lexicon meanings");
    expect(all[i].control).toEqual({
      type: "dropdown",
      key: "strongsLinkTarget",
      options: { BibleHub: "Bible Hub", STEPBible: "STEPBible", BlueLetter: "Blue Letter Bible" },
    });
    expect(typeof all[i].desc).toBe("string");
    expect(all[i].desc as string).not.toContain("\n");
  });
});
