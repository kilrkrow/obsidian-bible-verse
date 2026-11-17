import { describe, expect, it, vi } from "vitest";
import { VerseCache } from "../src/cache";
import { BibleApi } from "../src/api";
import type { CachedVerse } from "../src/types";

const DIR = ".obsidian/plugins/bible-verse/cache";

function verse(reference: string, text = "In the beginning"): CachedVerse {
  return { reference, translation: "BSB", bibleId: "BSB", text, copyright: "", fetchedAt: 0 };
}

/** A vault adapter over an in-memory folder, with a hook to stall reads. */
function fakeAdapter(files: Record<string, string>, opts: { dirExists?: boolean; listFails?: boolean } = {}) {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  let stalled = false;
  const adapter = {
    exists: vi.fn(async () => opts.dirExists ?? true),
    mkdir: vi.fn(async () => {}),
    list: vi.fn(async () => {
      if (opts.listFails) throw new Error("EACCES");
      return { files: Object.keys(files).map((n) => `${DIR}/${n}`), folders: [] };
    }),
    read: vi.fn(async (path: string) => {
      if (stalled) await gate;
      const name = path.split("/").pop()!;
      if (!(name in files)) throw new Error("ENOENT");
      return files[name];
    }),
    write: vi.fn(async (path: string, data: string) => {
      files[path.split("/").pop()!] = data;
    }),
    remove: vi.fn(async () => {}),
  };
  const plugin = { app: { vault: { adapter } }, manifest: { dir: ".obsidian/plugins/bible-verse" } };
  return {
    adapter,
    cache: new VerseCache(plugin as never),
    stall: () => (stalled = true),
    release: () => release(),
  };
}

const KEY = "bsb_genesis_1_1_sn_vn_np";

describe("VerseCache.load", () => {
  it("reads nothing until asked", () => {
    const { adapter, cache } = fakeAdapter({ [`${KEY}.json`]: JSON.stringify(verse("Genesis 1:1")) });
    expect(cache.size).toBe(0);
    expect(adapter.list).not.toHaveBeenCalled();
  });

  it("reads the folder once however many callers wait on it", async () => {
    const files: Record<string, string> = {};
    for (let i = 1; i <= 40; i++) files[`bsb_psalm_${i}_sn_vn_np.json`] = JSON.stringify(verse(`Psalm ${i}`));
    const { adapter, cache } = fakeAdapter(files);
    await Promise.all([cache.load(), cache.load(), cache.load()]);
    await cache.load();
    expect(adapter.list).toHaveBeenCalledTimes(1);
    expect(adapter.read).toHaveBeenCalledTimes(40);
    expect(cache.size).toBe(40);
    expect(cache.get("BSB", "Psalm 23")?.reference).toBe("Psalm 23");
  });

  it("skips a corrupted file and keeps the rest", async () => {
    const { cache } = fakeAdapter({ "bad.json": "{not json", [`${KEY}.json`]: JSON.stringify(verse("Genesis 1:1")) });
    await cache.load();
    expect(cache.size).toBe(1);
  });

  it("creates a missing folder", async () => {
    const { adapter, cache } = fakeAdapter({}, { dirExists: false });
    await cache.load();
    expect(adapter.mkdir).toHaveBeenCalledWith(DIR);
  });

  it("does not fail when the folder can't be listed", async () => {
    const { cache } = fakeAdapter({}, { listFails: true });
    await expect(cache.load()).resolves.toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("keeps a verse fetched while the read was still running", async () => {
    const { cache, stall, release } = fakeAdapter({ [`${KEY}.json`]: JSON.stringify(verse("Genesis 1:1", "old")) });
    stall();
    const loading = cache.load();
    await cache.set(verse("Genesis 1:1", "new"));
    release();
    await loading;
    expect(cache.get("BSB", "Genesis 1:1")?.text).toBe("new");
  });

  it("clear waits for the read, so nothing comes back afterwards", async () => {
    const { cache, stall, release } = fakeAdapter({ [`${KEY}.json`]: JSON.stringify(verse("Genesis 1:1")) });
    stall();
    void cache.load();
    const clearing = cache.clear();
    release();
    await clearing;
    expect(cache.size).toBe(0);
  });
});

describe("BibleApi.getPassage before the cache has been read", () => {
  it("waits for the cache and serves the saved verse without downloading", async () => {
    const { cache } = fakeAdapter({ [`${KEY}.json`]: JSON.stringify(verse("Genesis 1:1")) });
    const api = new BibleApi(cache);
    const ref = { book: "Genesis", chapter: 1, startVerse: 1, endVerse: null, additionalVerses: [], raw: "Genesis 1:1" };
    const v = await api.getPassage(ref as never, "BSB", "BSB", {
      showVerseNumbers: true,
      verseNewLine: false,
      paragraphBreaks: false,
    });
    expect(v.text).toBe("In the beginning");
  });
});
