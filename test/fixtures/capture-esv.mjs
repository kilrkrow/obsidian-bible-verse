/**
 * Capture real ESV API responses as test fixtures.
 * Requires an ESV API key:  ESV_API_KEY=xxxx node test/fixtures/capture-esv.mjs
 *
 * We always request verse-number markers ("[n]"); the client derives every
 * v/nl combo from this single marked response (see formatEsvPassageText).
 *
 * NOTE: the query params below mirror ESV_TEXT_PARAMS in src/format.ts.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const KEY = process.env.ESV_API_KEY;
if (!KEY) {
  console.error("Set ESV_API_KEY environment variable.");
  process.exit(2);
}

// Mirror of ESV_TEXT_PARAMS in src/format.ts (keep in sync).
const BASE = {
  "include-headings": "false",
  "include-footnotes": "false",
  "include-short-copyright": "false",
  "include-passage-references": "false",
  "indent-paragraphs": "0",
  "indent-poetry": "false",
  "indent-declares": "0",
  "indent-psalm-doxology": "0",
};

const PASSAGES = [
  { slug: "john_3_16",       query: "John 3:16" },
  { slug: "john_3_16-18",    query: "John 3:16-18" },
  { slug: "john_3_16_18",    query: "John 3:16,18" },
  { slug: "psalm_23",        query: "Psalm 23" },
  { slug: "luke_19_27-30",   query: "Luke 19:27-30" },
];

async function main() {
  await mkdir(`${HERE}/data`, { recursive: true });
  let ok = 0, fail = 0;
  for (const { slug, query } of PASSAGES) {
    const params = new URLSearchParams({ q: query, ...BASE, "include-verse-numbers": "true" });
    try {
      const res = await fetch(`https://api.esv.org/v3/passage/text/?${params}`, {
        headers: { Authorization: `Token ${KEY}` },
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = await res.json();
      const out = `${HERE}/data/esv_${slug}.json`;
      await writeFile(out, JSON.stringify({ query, passages: json.passages }, null, 2));
      console.log(`  ✓ ESV ${query}`);
      ok++;
    } catch (e) {
      console.error(`  ✗ ESV ${query} — ${e.message}`);
      fail++;
    }
  }
  console.log(`\n${ok} captured, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
