// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Startup and the +/- nudge commands against a fake vault adapter whose
 * cache folder already holds saved verses (as on a long-used vault).
 */

vi.mock("obsidian", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  class Base {
    constructor(..._args: unknown[]) {}
  }
  /** Just enough of Plugin for onload(): registrations are recorded, not run. */
  class Plugin {
    app: unknown;
    manifest: unknown;
    commands: Record<string, { editorCallback?: (editor: unknown) => unknown }> = {};
    constructor(app: unknown, manifest: unknown) {
      this.app = app;
      this.manifest = manifest;
    }
    async loadData(): Promise<unknown> {
      return null;
    }
    async saveData(): Promise<void> {}
    addCommand(c: { id: string; editorCallback?: (editor: unknown) => unknown }) {
      this.commands[c.id] = c;
      return c;
    }
    addSettingTab() {}
    registerMarkdownPostProcessor() {}
    registerMarkdownCodeBlockProcessor() {}
    registerEditorSuggest() {}
    registerEditorExtension() {}
    registerEvent() {}
  }
  return {
    ...real,
    Plugin,
    Modal: Base,
    EditorSuggest: Base,
    MarkdownRenderChild: Base,
    Component: Base,
    MarkdownView: Base,
    TFile: Base,
    MarkdownRenderer: { render: async () => {} },
    setIcon: () => {},
    editorLivePreviewField: {},
    requestUrl: async () => {
      throw new Error("offline: no network in this test");
    },
  };
});

// esbuild bundles CHANGELOG.md as text; vitest has no such loader.
vi.mock("../src/whats-new-modal", () => ({ releaseNotesSince: () => [], WhatsNewModal: class {} }));

import BibleVersePlugin from "../src/main";
import type { CachedVerse } from "../src/types";

const PLUGIN_DIR = ".obsidian/plugins/bible-verse";
const CACHE_DIR = `${PLUGIN_DIR}/cache`;

function verse(reference: string, translation: string, numberOfVerses?: number): CachedVerse {
  return { reference, translation, bibleId: translation, text: "text", copyright: "", fetchedAt: 0, numberOfVerses };
}

/** A vault adapter over an in-memory cache folder, recording every call. */
function fakeVault(files: Record<string, string>) {
  const adapter = {
    exists: vi.fn(async () => true),
    mkdir: vi.fn(async () => {}),
    list: vi.fn(async () => ({ files: Object.keys(files).map((n) => `${CACHE_DIR}/${n}`), folders: [] })),
    read: vi.fn(async (path: string) => {
      const name = path.split("/").pop()!;
      if (!(name in files)) throw new Error("ENOENT");
      return files[name];
    }),
    write: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  };
  const layoutReady: Array<() => void> = [];
  const app = {
    vault: { adapter, getAbstractFileByPath: () => null },
    workspace: { onLayoutReady: (cb: () => void) => layoutReady.push(cb), iterateAllLeaves: () => {} },
  };
  const plugin = new BibleVersePlugin(app as never, { id: "bible-verse", dir: PLUGIN_DIR, version: "0.0.0" } as never);
  return { adapter, plugin, layoutReady };
}

const touchesCache = (calls: unknown[][]) => calls.filter((c) => String(c[0]).startsWith(CACHE_DIR));

beforeAll(() => {
  (globalThis as unknown as { activeDocument: Document }).activeDocument = document;
});

describe("onload", () => {
  it("reads and lists nothing in a populated cache folder", async () => {
    const files: Record<string, string> = {};
    for (let i = 1; i <= 50; i++) {
      files[`kjv_psalm_${i}_sn_vn_np.json`] = JSON.stringify(verse(`Psalm ${i}`, "KJV"));
    }
    const { adapter, plugin } = fakeVault(files);

    await plugin.onload();

    expect(touchesCache(adapter.read.mock.calls)).toEqual([]);
    expect(touchesCache(adapter.list.mock.calls)).toEqual([]);
    expect(adapter.read).not.toHaveBeenCalled();
    expect(adapter.list).not.toHaveBeenCalled();
  });
});

describe("+/- nudge commands", () => {
  /** Run a registered shift command on a one-line editor holding `line`. */
  async function nudge(plugin: BibleVersePlugin, id: string, line: string): Promise<string> {
    let text = line;
    const editor = {
      getCursor: () => ({ line: 0, ch: 2 }),
      getLine: () => text,
      replaceRange: (r: string, from: { ch: number }, to: { ch: number }) => {
        text = text.slice(0, from.ch) + r + text.slice(to.ch);
      },
    };
    const cmd = (plugin as unknown as { commands: Record<string, { editorCallback: (e: unknown) => unknown }> }).commands[id];
    await cmd.editorCallback(editor);
    return text;
  }

  it("clamps at chapter end using the chapter length from a verse only on disk", async () => {
    const abbrFiles: Record<string, string> = {};
    const { adapter, plugin } = fakeVault(abbrFiles);
    await plugin.onload();
    const abbr = plugin.getTranslationAbbrPublic(plugin.settings.defaultTranslation);
    // Saved in an earlier session: on disk, not in memory.
    const name = `${abbr}_john_3_16-36_sn_vn_np.json`.toLowerCase();
    abbrFiles[name] = JSON.stringify(verse("John 3:16-36", abbr, 36));
    expect(plugin.cache.get(abbr, "John 3:16-36")).toBeNull();

    expect(await nudge(plugin, "shift-end-forward", "{John 3:16-36}")).toBe("{John 3:16-eoc}");
    expect(adapter.read).toHaveBeenCalledWith(`${CACHE_DIR}/${name}`);
    expect(adapter.list).not.toHaveBeenCalled();
  });

  it("without a saved chapter length, still extends past the last verse", async () => {
    const { plugin } = fakeVault({});
    await plugin.onload();
    expect(await nudge(plugin, "shift-end-forward", "{John 3:16-36}")).toBe("{John 3:16-37}");
  });
});
