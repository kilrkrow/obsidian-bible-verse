import { Plugin } from "obsidian";
import { CachedVerse } from "./types";

/**
 * Manages a local JSON cache of fetched Bible verses.
 * Cache is stored in the plugin's data directory as individual JSON files
 * keyed by translation+reference.
 */
export class VerseCache {
  private plugin: Plugin;
  private cache: Map<string, CachedVerse> = new Map();
  private loaded = false;
  private cacheDir: string;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.cacheDir = `${plugin.manifest.dir}/cache`;
  }

  /** Build a cache key from translation and reference */
  private key(translation: string, reference: string): string {
    return `${translation}:${reference}`.toLowerCase().replace(/\s+/g, "_");
  }

  /** Load the full cache index from disk */
  async load(): Promise<void> {
    if (this.loaded) return;

    const adapter = this.plugin.app.vault.adapter;
    const exists = await adapter.exists(this.cacheDir);
    if (!exists) {
      await adapter.mkdir(this.cacheDir);
      this.loaded = true;
      return;
    }

    const files = await adapter.list(this.cacheDir);
    for (const file of files.files) {
      try {
        const data = await adapter.read(file);
        const entry: CachedVerse = JSON.parse(data);
        const k = this.key(entry.translation, entry.reference);
        this.cache.set(k, entry);
      } catch {
        // Skip corrupted cache entries
      }
    }
    this.loaded = true;
  }

  /** Get a cached verse, or null if not cached */
  get(translation: string, reference: string): CachedVerse | null {
    return this.cache.get(this.key(translation, reference)) ?? null;
  }

  /** Store a verse in the cache */
  async set(entry: CachedVerse): Promise<void> {
    const k = this.key(entry.translation, entry.reference);
    this.cache.set(k, entry);

    const adapter = this.plugin.app.vault.adapter;
    const exists = await adapter.exists(this.cacheDir);
    if (!exists) {
      await adapter.mkdir(this.cacheDir);
    }

    const filePath = `${this.cacheDir}/${k}.json`;
    await adapter.write(filePath, JSON.stringify(entry, null, 2));
  }

  /** Check if a verse is cached */
  has(translation: string, reference: string): boolean {
    return this.cache.has(this.key(translation, reference));
  }

  /** Clear the entire cache */
  async clear(): Promise<void> {
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
