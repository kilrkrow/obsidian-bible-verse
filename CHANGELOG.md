# Changelog

All notable changes to Bible Verse are documented here.

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
