import { Plugin, normalizePath } from "obsidian";
import { CachedVerse } from "./types";

/**
 * How many cache files to read at once. Enough to overlap disk latency, few
 * enough to stay well under open-file limits (macOS defaults to 256).
 */
const READ_CONCURRENCY = 16;

/**
 * Manages a local JSON cache of fetched Bible verses.
 * Cache is stored in the plugin's data directory as individual JSON files
 * keyed by translation+reference.
 */
export class VerseCache {
  public plugin: Plugin;
  private cache: Map<string, CachedVerse> = new Map();
  private loading: Promise<void> | null = null;
  private cacheDir: string;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.cacheDir = normalizePath(`${plugin.manifest.dir}/cache`);
  }

  /** Build a cache key from translation, reference, and formatting settings */
  private key(translation: string, reference: string, nl = false, vn = true, pb = false): string {
    const suffix = `${nl ? "nl" : "sn"}_${vn ? "vn" : "sv"}_${pb ? "pb" : "np"}`;
    return `${translation}_${reference}_${suffix}`.toLowerCase().replace(/\s+/g, "_").replace(/:/g, "_");
  }

  /**
   * Read every cached verse from disk into memory. Safe to call any number of
   * times: the first call starts the read and later calls share it.
   *
   * Not awaited in onload. Each cached verse is its own file, so the folder
   * grows with use, and reading it before onload returned held up Obsidian's
   * startup by seconds. Anything that needs a cached verse to decide whether
   * to download awaits this first; the synchronous get() simply misses until
   * the read finishes, and those callers already fall back to the async path.
   */
  load(): Promise<void> {
    this.loading ??= this.readAll();
    return this.loading;
  }

  private async readAll(): Promise<void> {
    try {
      const adapter = this.plugin.app.vault.adapter;
      if (!(await adapter.exists(this.cacheDir))) {
        await adapter.mkdir(this.cacheDir);
        return;
      }

      const files = (await adapter.list(this.cacheDir)).files;
      let next = 0;
      const worker = async (): Promise<void> => {
        while (next < files.length) {
          const file = files[next++];
          try {
            const entry = JSON.parse(await adapter.read(file)) as CachedVerse;
            // Old cache entries won't have the new naming scheme but will be
            // re-cached correctly when fetched.
            const fileName = file.split("/").pop()?.replace(".json", "");
            // A verse fetched while the read was running is at least as new
            // as the copy on disk, so keep it.
            if (fileName && !this.cache.has(fileName)) {
              this.cache.set(fileName, entry);
            }
          } catch {
            // Skip corrupted cache entries
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, files.length) }, worker));
    } catch (e) {
      // An unreadable cache folder only costs a re-download, never the plugin.
      console.warn("Bible Verse: could not read the verse cache", e);
    }
  }

  /** Number of cached verses loaded from disk. */
  get size(): number {
    return this.cache.size;
  }

  /** Get a cached verse, or null if not cached */
  get(translation: string, reference: string, nl = false, vn = true, pb = false): CachedVerse | null {
    return this.cache.get(this.key(translation, reference, nl, vn, pb)) ?? null;
  }

  /** Store a verse in the cache */
  async set(entry: CachedVerse, nl = false, vn = true, pb = false): Promise<void> {
    const k = this.key(entry.translation, entry.reference, nl, vn, pb);
    this.cache.set(k, entry);

    const adapter = this.plugin.app.vault.adapter;
    const exists = await adapter.exists(this.cacheDir);
    if (!exists) {
      await adapter.mkdir(this.cacheDir);
    }

    const filePath = normalizePath(`${this.cacheDir}/${k}.json`);
    await adapter.write(filePath, JSON.stringify(entry, null, 2));
  }

  /** Check if a verse is cached */
  has(translation: string, reference: string, nl = false, vn = true, pb = false): boolean {
    return this.cache.has(this.key(translation, reference, nl, vn, pb));
  }

  /** Clear the entire cache */
  async clear(): Promise<void> {
    // Let a read in progress finish first, or it would refill the cache.
    await this.load();
    const adapter = this.plugin.app.vault.adapter;
    const exists = await adapter.exists(this.cacheDir);
    if (exists) {
      const files = await adapter.list(this.cacheDir);
      for (const file of files.files) {
        await adapter.remove(file);
      }
    }
    this.cache.clear();
  }
}
