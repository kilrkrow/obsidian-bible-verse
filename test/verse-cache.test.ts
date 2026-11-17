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
    remove: vi.fn(async (path: string) => {
      delete files[path.split("/").pop()!];
    }),
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

describe("VerseCache.lookup", () => {
  it("reads nothing until a verse is asked for", () => {
    const { adapter } = fakeAdapter({ [`${KEY}.json`]: JSON.stringify(verse("Genesis 1:1")) });
    expect(adapter.list).not.toHaveBeenCalled();
    expect(adapter.read).not.toHaveBeenCalled();
  });

  it("reads only the asked-for verse's file, once per session", async () => {
    const files: Record<string, string> = {};
    for (let i = 1; i <= 40; i++) files[`bsb_psalm_${i}_sn_vn_np.json`] = JSON.stringify(verse(`Psalm ${i}`));
    const { adapter, cache } = fakeAdapter(files);

    const [a, b] = await Promise.all([cache.lookup("BSB", "Psalm 23"), cache.lookup("BSB", "Psalm 23")]);
    expect(a?.reference).toBe("Psalm 23");
    expect(b).toBe(a);
    await cache.lookup("BSB", "Psalm 23");

    expect(adapter.read).toHaveBeenCalledTimes(1);
    expect(adapter.read).toHaveBeenCalledWith(`${DIR}/bsb_psalm_23_sn_vn_np.json`);
    expect(adapter.list).not.toHaveBeenCalled();
    // Now in memory for the synchronous renderers too.
    expect(cache.get("BSB", "Psalm 23")?.reference).toBe("Psalm 23");
    expect(cache.get("BSB", "Psalm 24")).toBeNull();
  });

  it("keys on the format, so another format is a separate file", async () => {
    const { cache } = fakeAdapter({ [`${KEY}.json`]: JSON.stringify(verse("Genesis 1:1")) });
    expect(await cache.lookup("BSB", "Genesis 1:1", true)).toBeNull();
    expect(await cache.lookup("BSB", "Genesis 1:1")).not.toBeNull();
  });

  it("treats a missing or corrupted file as not cached", async () => {
    const { cache } = fakeAdapter({ "bsb_john_3_16_sn_vn_np.json": "{not json" });
    expect(await cache.lookup("BSB", "John 3:16")).toBeNull();
    expect(await cache.lookup("BSB", "Genesis 1:1")).toBeNull();
  });

  it("keeps a verse fetched while its file was being read", async () => {
    const { cache, stall, release } = fakeAdapter({ [`${KEY}.json`]: JSON.stringify(verse("Genesis 1:1", "old")) });
    stall();
    const reading = cache.lookup("BSB", "Genesis 1:1");
    await cache.set(verse("Genesis 1:1", "new"));
    release();
    expect((await reading)?.text).toBe("new");
    expect(cache.get("BSB", "Genesis 1:1")?.text).toBe("new");
  });

  it("clear waits for reads in flight, so nothing comes back afterwards", async () => {
    const { cache, stall, release } = fakeAdapter({ [`${KEY}.json`]: JSON.stringify(verse("Genesis 1:1")) });
    stall();
    void cache.lookup("BSB", "Genesis 1:1");
    const clearing = cache.clear();
    release();
    await clearing;
    expect(cache.get("BSB", "Genesis 1:1")).toBeNull();
    expect(await cache.lookup("BSB", "Genesis 1:1")).toBeNull();
  });
});

describe("VerseCache.hasEntries", () => {
  it("is true when the folder holds a saved verse, without reading it", async () => {
    const { adapter, cache } = fakeAdapter({ [`${KEY}.json`]: JSON.stringify(verse("Genesis 1:1")) });
    expect(await cache.hasEntries()).toBe(true);
    expect(adapter.read).not.toHaveBeenCalled();
  });

  it("is false for an empty, missing or unreadable folder", async () => {
    expect(await fakeAdapter({}).cache.hasEntries()).toBe(false);
    expect(await fakeAdapter({}, { dirExists: false }).cache.hasEntries()).toBe(false);
    expect(await fakeAdapter({}, { listFails: true }).cache.hasEntries()).toBe(false);
  });
});

describe("BibleApi.getPassage", () => {
  it("serves a verse saved in an earlier session without downloading", async () => {
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
