# Changelog

All notable changes to Bible Verse are documented here.

## [1.12.2] — 2026-10-27

### Fixed

- **Strong's words with a single meaning can be picked too** — when a lexicon entry has no numbered meanings, such as *trying* in James 1:3 (G1383, "testing"), its gloss was a plain bold label you couldn't choose. It's now a meaning row like 1, 1a or 2 in any other entry: pick it to show "testing" in the verse, pick it again to bring back the King James word, and **Insert below** bolds it in the inserted line. A gloss of several words, such as "Greek, Gentile", can be picked one word at a time with **Pick single words from lexicon meanings** on. Entries that already have numbered meanings are unchanged.

## [1.12.1] — 2026-10-23

### Fixed

- **Baking a Strong's verse keeps what's on screen** — adding `bake` to a verse with transliterations or lexicon meanings, baking it as a native callout, or using the bake commands used to write the plain King James text and lose every choice you'd made. The baked text now reads the way the screen does: transliterations in italics, meanings in ⌜ ⌝, labelled KJV-Strong's and credited to the STEPBible lexicon. Your choices are recorded in the baked block too, so **Refresh baked verses** keeps them.
- **"KJV-Strong's" instead of a separate label** — a verse with transliterations or meanings carried a "with transliteration and lexicon meanings" label that sat away from the reference and read like a stray tooltip. Now the reference itself names the translation: "Proverbs 3:5 (KJV-Strong's)". Hover it for the STEPBible credit.
- **Release notes for 1.12.0** — they didn't appear after updating to 1.12.0. In short: 1.12.0 added Strong's numbers and the STEPBible lexicon on King James verses. Put the cursor in a verse, run **Toggle Strong's on this verse**, and hover a word for its entry; click it, or pick one of its meanings, to show that in the verse instead. The README has the full guide.

### Coming soon

- **A video on using Strong's** — a short walkthrough of the Strong's feature is in the works. It'll be linked from the README, and from these notes, when it's ready.

## [1.12.0] — 2026-10-23

### Added

**Strong's numbers and the STEPBible lexicon, on King James verses.** Look into the Hebrew and Greek behind a verse without leaving your note.

- **Turn it on** — put the cursor in a verse such as `{Proverbs 3:5}` and run **Toggle Strong's on this verse** from the command palette, or hover the reference and click the new Strong's button (the languages icon) next to the verse controls. Words that have a Strong's number get a dotted underline.
- **Hover a word** to see its Strong's number, transliteration, Hebrew or Greek lemma, gloss and definition. *LORD* in Proverbs 3:5 shows H3068, *ye.ho.vah*, "LORD".
- **Click a word** to show it in the verse as its transliteration. Click it again to bring back the King James word.
- **Pick a meaning** — the definition's numbered meanings (1, 1a, 1b…) are clickable. Pick one and the verse shows it in place of the word: "In all thy ⌜journey⌝ acknowledge him" for *ways* (H1870, 1b). Verb meanings drop their leading "to" so they read in the sentence.
- **Pick a single word from a meaning**, such as *ignore* from "to forget, ignore, wither", by turning on **Pick single words from lexicon meanings** in settings. It's off by default.
- **Insert below** adds the word's full lexicon entry as a line under the verse, ready for study notes, with any meaning you picked in bold.

Your choices are saved in the note and survive a reload. Whenever a verse shows anything other than the King James words, it's labelled "with transliteration" or "with lexicon meanings", and hovering a changed word shows what it replaced. Lexicon text is credited to the STEPBible lexicon (CC BY 4.0, STEPBible.org / Tyndale House) in the popover, on every inserted line, and in settings.

Works in Live Preview and Reading view. ESV, the link-only translations and side-by-side comparisons don't have Strong's data, so you'll get a short notice and nothing changes.

## [1.11.0] — 2026-10-22

### Added

- **What's new after an update** — the first time Obsidian starts after Bible Verse updates, a short pop-up shows what changed in the new version, with a link to ask questions or share ideas in Discussions. It appears once per update, never on a fresh install, and can be turned off with "Show what's new after updates" in settings. The "Show what's new" command opens it any time.
- **A map of supported translations** — the README now has a chart of which translations Bible Verse can show, and a Request a translation button that opens a GitHub issue form.

### Fixed

- **Verse controls in pop-out windows** — hovering a verse in a note opened in a separate Obsidian window now reliably reveals the verse controls, including right after you edit the reference. Previously the reveal check ran on the main window and could miss.
- Removed leftover support for multi-chapter spans (such as `John 3:16-4:20`), which Bible Verse already refuses, so a reference the plugin writes out can always be read back in. No change in behavior is expected.

## [1.10.0] — 2026-10-08

### Changed

- **A lone verse hides its verse number by default** — a reference that resolves to exactly one verse (`{John 3:16}`) no longer shows `16.`. Asking explicitly still wins: inline `v` / `no-v`, or `numbers: true` / `numbers: false` in a `bible` code block. Ranges, comma lists and whole chapters still follow the "Show verse numbers" setting. This applies everywhere a verse renders: Live Preview, Reading view, `bible` code blocks, comparison views, ESV, and baked text.
- **Reading-view comparisons obey `v` / `no-v`** — inline comparisons such as `{John 3:16, KJV, WEB, v}` now honor the token in Reading view, matching Live Preview.

## [1.8.1] — 2026-08-12

### Added

- **Settings are searchable** — on Obsidian 1.13 and later the settings tab is built with the declarative settings API, so every option now turns up in Obsidian's settings search. The token forms are indexed as well: searching `para`, `eoc` or `KJV` finds the syntax reference. Older Obsidian versions are unaffected and keep the existing settings tab.

### Changed

- Setting labels, dropdown options, and the token-syntax table now live in one place shared by both settings paths, so the two can't drift apart.
- Declared the JavaScript library level the code actually uses (ES2020) and moved DOM construction to Obsidian's `createEl` / `createSpan` helpers. This clears 32 warnings from Obsidian's plugin review scan; there is no change in behavior.

### Known issues

- On Obsidian 1.13+, turning off "show verse numbers" no longer greys out "new line per verse" immediately — the row updates the next time the settings tab is drawn. Obsidian's API for the instant update requires a `minAppVersion` of 1.13.0, which would drop support for older versions.

## [1.8.0] — 2026-08-05

### Added

- **Doubled braces are accepted** — `{{John 3:16}}` now renders as a single token in Live Preview, Reading view, and the baker. Previously only the inner `{…}` matched, leaving a stray `{` and `}` bracketing the rendered verse. Unbalanced braces (`{{ref}` / `{ref}}`) are unchanged: the inner pair matches and the odd brace stays as text.

### Changed

- The `{ref}` token pattern lives in one place (`INLINE_TOKEN_SOURCE` in `parser.ts`) instead of being hand-copied into the Live Preview plugin, the Reading-view postprocessor, and the baker, so the three can no longer drift apart.
- Autocomplete tracks the opening brace depth: accepting a suggestion inside `{{…` closes with `}}` and moves the cursor past both, never past more closing braces than are actually present.

## [1.6.5] — 2026-07-04

### Added

- **Bake to a native, collapsible callout** — the new `native-callout` display style (token `native-callout` / `nco`) writes a verse permanently into your note as a real Obsidian callout (`> [!quote]+ [John 3:16 (KJV)](…)`), so it inherits your theme, icon packs, and native fold behavior. Use `nco-` to start it collapsed, `nco+` to force expanded. The callout type (default `quote`) is configurable in settings.
- **`bake` token** — `{ref, bake}` bakes a reference into a ` ```bible ` code block on render.

Baking is one-way: once written, the text is ordinary Markdown and the plugin no longer tracks it. In the editor a "will bake" pill is shown; the bake happens when the note renders in Reading view.

## [1.6.4] — 2026-07-03

### Added

- **ESV (English Standard Version) inline text** — display ESV as text using your own free API key from [api.esv.org](https://api.esv.org). The required Crossway attribution is shown automatically; without a key, ESV falls back to a link.
- **In-plugin feedback** — a "Send feedback" button in settings and a "Report a bug on GitHub" command.
- **GitHub issue templates** — structured bug-report and feature-request forms.

### Fixed

- **`nl` now takes effect in the inline display style** — "new line per verse" was silently ignored for `inline`; each verse now breaks correctly (without reintroducing the Live Preview blank-line issue).
- **ESV honors `nl` / `no-nl`** consistently with the HelloAO translations, and its poetry/paragraph breaks are normalized to match.
- Removed a redundant inline `(ESV)` marker now that attribution is handled explicitly.

## [1.6.3] — 2026-06-08

### Fixed

- **Verse double-spacing in Live Preview** — Verses in `nl` mode were rendering with a blank line between each verse in Live Preview (edit mode) while appearing correctly in reading mode. Root cause: CodeMirror 6's editor inherits `white-space: pre-wrap` into rendered content, causing the whitespace text nodes that Obsidian's markdown renderer emits after each `<br>` to render as real line breaks. Fixed by explicitly setting `white-space: normal` on the verse body container.
- **Inline style line breaks** — `{ref, inline}` displayed verses on separate lines instead of as continuous quoted text, in both reading mode and Live Preview. Root cause: `<br>` elements from the markdown renderer were left in place after paragraph unwrapping. Fixed by replacing `<br>` with a space in the inline rendering path.

## [1.6.2] — 2026-05-20

### Added

- Reading sections (`para` mode) — display a full chapter with paragraph groupings preserved, matching the structure of the original text
- IntelliSense helper mode — after accepting a verse suggestion, a follow-up menu offers common modifiers (callout, sidebar, verse numbers, etc.)
- Inline syntax examples and collapsible quick-reference in the settings tab

### Fixed

- KJV pilcrow (`¶`) character stripped before verse-number prepend to prevent broken line breaks
- Paragraph spacing normalised across inline and block display styles
- Verse number list markers escaped so `1.` is not misread as a markdown ordered list

## [1.6.0] — 2026-04-25

### Added

- Initial public release prepared for Obsidian community plugin submission
- Inline `{ref}` syntax with support for translation override, style override, verse numbers, and new-line-per-verse flags
- Display styles: callout, sidebar, blockquote, inline
- Side-by-side translation comparison (`{ref, KJV | NIV}`)
- Baked verse text via `Bake` and `Refresh` commands
- Verse cache with optional persistence
- Quick Insert command palette modal
- Settings tab with per-option syntax examples
