/**
 * Capture the HelloAO payloads the Strong's layer reads, as test fixtures.
 * Run once (or to refresh): node test/fixtures/capture-strongs.mjs
 *
 *   - KJV Proverbs 3 chapter JSON (carries thisChapterWordsLink)
 *   - KJV Proverbs 3 word alignment (.words.json)
 *   - STEPBible lexicon entries for the tagged words of Proverbs 3:5
 *
 * The "no words file" case uses the existing BSB fixtures, whose chapter
 * payloads have no thisChapterWordsLink.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = "https://bible.helloao.org/api";

const FILES = [
  { url: `${BASE}/eng_kjv/PRO/3.json`, out: "data/eng_kjv_PRO_3.json" },
  { url: `${BASE}/eng_kjv/PRO/3.words.json`, out: "data/eng_kjv_PRO_3.words.json" },
  ...["H0982", "H3068", "H3820", "H8172", "H0998"].map((n) => ({
    url: `${BASE}/d/stepbible-lexicon/lexicon/${n}.json`,
    out: `data/lexicon/${n}.json`,
  })),
];

async function main() {
  await mkdir(`${HERE}/data/lexicon`, { recursive: true });
  for (const { url, out } of FILES) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: status ${res.status}`);
    const json = await res.json();
    await writeFile(`${HERE}/${out}`, JSON.stringify(json, null, 2) + "\n");
    console.log(`wrote ${out}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
