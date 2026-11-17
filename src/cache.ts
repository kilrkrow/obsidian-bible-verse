import { Plugin, normalizePath } from "obsidian";
import { CachedVerse } from "./types";

/**
 * Manages a local JSON cache of fetched Bible verses.
 * Cache is stored in the plugin's data directory as individual JSON files
 * keyed by translation+reference.
 *
 * Nothing is read at startup. Each verse's file name is its key, so a verse is
 * read from disk only when something asks for it (lookup), and then kept in
 * memory for the session. Reading the whole folder up front used to cost
 * seconds of Obsidian's startup, since the folder grows with every verse and
 * format ever looked up.
 */
export class VerseCache {
  public plugin: Plugin;
  /** Verses read from disk or fetched this session. */
  private cache: Map<string, CachedVerse> = new Map();
  /** Disk reads in flight, so concurrent lookups share one read. */
  private reading: Map<string, Promise<CachedVerse | null>> = new Map();
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
   * Whether any verse has ever been cached, on disk or this session. One folder
   * listing, no file reads.
   */
  async hasEntries(): Promise<boolean> {
    if (this.cache.size > 0) return true;
    try {
      const adapter = this.plugin.app.vault.adapter;
      if (!(await adapter.exists(this.cacheDir))) return false;
      return (await adapter.list(this.cacheDir)).files.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * A cached verse, read from its own file on disk the first time it's asked
   * for this session. Null if it was never cached (or its file is unreadable),
   * in which case the caller downloads it.
   */
  async lookup(translation: string, reference: string, nl = false, vn = true, pb = false): Promise<CachedVerse | null> {
    const k = this.key(translation, reference, nl, vn, pb);
    const hit = this.cache.get(k);
    if (hit) return hit;

    let pending = this.reading.get(k);
    if (!pending) {
      pending = this.readEntry(k).finally(() => this.reading.delete(k));
      this.reading.set(k, pending);
    }
    const entry = await pending;
    // A fetch that finished while the file was being read is at least as new.
    const current = this.cache.get(k);
    if (current) return current;
    if (entry) this.cache.set(k, entry);
    return entry;
  }

  private async readEntry(k: string): Promise<CachedVerse | null> {
    const adapter = this.plugin.app.vault.adapter;
    const filePath = normalizePath(`${this.cacheDir}/${k}.json`);
    try {
      return JSON.parse(await adapter.read(filePath)) as CachedVerse;
    } catch {
      // Never cached, corrupted or unreadable: the caller re-fetches.
      return null;
    }
  }

  /**
   * Get a verse already in memory (read or fetched earlier this session), or
   * null. Doesn't touch the disk; callers that miss go on to an async path
   * that uses lookup().
   */
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

  /** Check if a verse is in memory this session */
  has(translation: string, reference: string, nl = false, vn = true, pb = false): boolean {
    return this.cache.has(this.key(translation, reference, nl, vn, pb));
  }

  /** Clear the entire cache */
  async clear(): Promise<void> {
    // Let reads in flight finish first, or they would refill the cache.
    await Promise.all(this.reading.values());
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
