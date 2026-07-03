/**
 * Capture real HelloAO chapter JSON as test fixtures.
 * Run once (or to refresh): node test/fixtures/capture.mjs
 *
 * Chapters chosen to stress the formatting paths:
 *   - John 3   (JHN): prose, quotation context, good for ranges / non-contiguous
 *   - Psalms 23 (PSA): poetry / implicit line breaks
 *   - Luke 19  (LUK): KJV ¶ pilcrow paragraph markers
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = "https://bible.helloao.org/api";

// Mirror of the 15 free HelloAO translations in src/constants.ts
const TRANSLATIONS = [
  "eng_kjv", "BSB", "eng_asv", "eng_web", "eng_net", "eng_dby", "eng_dra",
  "eng_rv5", "eng_ylt", "eng_bbe", "eng_fbv", "eng_lsv", "eng_msb", "eng_gnv", "eng_ojb",
];

const CHAPTERS = [
  { usfm: "JHN", chapter: 3 },
  { usfm: "PSA", chapter: 23 },
  { usfm: "LUK", chapter: 19 },
];

async function main() {
  await mkdir(`${HERE}/data`, { recursive: true });
  let ok = 0, fail = 0;
  for (const id of TRANSLATIONS) {
    for (const { usfm, chapter } of CHAPTERS) {
      const url = `${BASE}/${id}/${usfm}/${chapter}.json`;
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const json = await res.json();
        const out = `${HERE}/data/${id}_${usfm}_${chapter}.json`;
        await writeFile(out, JSON.stringify(json, null, 2));
        console.log(`  ✓ ${id} ${usfm} ${chapter}`);
        ok++;
      } catch (e) {
        console.error(`  ✗ ${id} ${usfm} ${chapter} — ${e.message}`);
        fail++;
      }
    }
  }
  console.log(`\n${ok} captured, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
