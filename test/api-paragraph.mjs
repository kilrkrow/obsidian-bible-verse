/**
 * Standalone test for KJV ¶ paragraph handling and verse number assembly.
 * Run with: node test/api-paragraph.mjs
 * No framework or Obsidian dependency needed.
 */

// ── Inline copy of extractVerseText (keep in sync with src/api.ts) ──────────
function extractVerseText(content) {
  const parts = [];
  for (const item of content) {
    if (typeof item === "string") {
      parts.push(item);
    } else if (typeof item === "object" && item !== null) {
      if ("text" in item) {
        let text = item.text;
        if (item.poem) {
          const indent = " ".repeat(Number(item.poem) * 2);
          const prefix = parts.length > 0 ? "\n" : "";
          text = prefix + indent + text;
        }
        parts.push(text);
      } else if (item.lineBreak || item.type === "line_break") {
        parts.push("\n");
      }
    }
  }
  return parts.join(" ").replace(/[ \t]*\n[ \t]*/g, "\n").trim();
}

// ── Inline copy of verse-assembly loop from getPassage ───────────────────────
function assemblePassage(chapterContent, requestedVerses, settings) {
  const paragraphs = [[]];

  for (const item of chapterContent) {
    if (typeof item !== "object" || item === null) continue;

    if (item.type === "verse") {
      const isIncluded = requestedVerses === null
        ? true
        : requestedVerses.has(item.number);

      if (isIncluded) {
        let text = extractVerseText(item.content);
        if (text) {
          if (text.startsWith("¶")) {
            text = text.replace(/^¶\s*/, "");
            if (paragraphs[paragraphs.length - 1].length > 0) {
              paragraphs.push([]);
            }
          }
          if (settings.showVerseNumbers) {
            text = `${item.number}. ${text}`;
          }
          paragraphs[paragraphs.length - 1].push(text);
        }
      }
    } else if (item.type === "paragraph" || item.type === "stanza_break") {
      if (paragraphs[paragraphs.length - 1].length > 0) {
        paragraphs.push([]);
      }
    }
  }

  const filled = paragraphs.filter(p => p.length > 0);
  const verseSep = settings.verseNewLine ? "\n" : " ";
  return (settings.paragraphBreaks && filled.length > 1
    ? filled.map(p => p.join(verseSep)).join("\n\n")
    : filled.flat().join(verseSep)
  )
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Test helpers ─────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(label, actual, expected) {
  if (actual === expected) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ── Mock KJV chapter content (Luke 19:27-29 style) ──────────────────────────
// Verse 27 starts normally; verse 28 has ¶ indicating a new paragraph in KJV.
const mockChapter = [
  { type: "verse", number: 27, content: ["But those mine enemies, which would not that I should reign over them, bring hither, and slay them before me."] },
  { type: "verse", number: 28, content: ["¶ And when he had thus spoken, he went before, ascending up to Jerusalem."] },
  { type: "verse", number: 29, content: ["And it came to pass, when he was come nigh to Bethphage and Bethany, at the mount called the mount of Olives, he sent two of his disciples,"] },
];

// ── Test 1: with para mode ON, ¶ creates a paragraph break ──────────────────
console.log("\nTest 1: para=true — ¶ splits into two paragraphs");
{
  const result = assemblePassage(mockChapter, null, { paragraphBreaks: true, verseNewLine: false, showVerseNumbers: false });
  const [p1, p2] = result.split("\n\n");
  assert("paragraph 1 is verse 27", p1.trim(), "But those mine enemies, which would not that I should reign over them, bring hither, and slay them before me.");
  assert("paragraph 2 starts with verse 28 (no ¶)", p2.trim().startsWith("And when he had thus spoken"), true);
  assert("verse 29 is in paragraph 2", p2.includes("Bethphage"), true);
}

// ── Test 2: verse number stays on same line as text ─────────────────────────
console.log("\nTest 2: showVerseNumbers=true — number + text on same line");
{
  const single = assemblePassage(
    [{ type: "verse", number: 28, content: ["¶ And when he had thus spoken, he went before, ascending up to Jerusalem."] }],
    null,
    { paragraphBreaks: true, verseNewLine: false, showVerseNumbers: true }
  );
  assert("verse number and text on same line", single, "28. And when he had thus spoken, he went before, ascending up to Jerusalem.");
}

// ── Test 3: para mode OFF — ¶ stripped, no paragraph break ──────────────────
console.log("\nTest 3: para=false — ¶ stripped, single paragraph");
{
  const result = assemblePassage(mockChapter, null, { paragraphBreaks: false, verseNewLine: false, showVerseNumbers: false });
  assert("no double newline in output", result.includes("\n\n"), false);
  assert("¶ not present in output", result.includes("¶"), false);
}

// ── Test 4: paragraph type items still work (non-KJV) ───────────────────────
console.log("\nTest 4: paragraph-type items still create breaks");
{
  const nonKjvChapter = [
    { type: "verse", number: 1, content: ["In the beginning God created the heavens and the earth."] },
    { type: "paragraph" },
    { type: "verse", number: 2, content: ["Now the earth was formless and empty."] },
  ];
  const result = assemblePassage(nonKjvChapter, null, { paragraphBreaks: true, verseNewLine: false, showVerseNumbers: false });
  assert("paragraph-type item creates double newline", result.includes("\n\n"), true);
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
