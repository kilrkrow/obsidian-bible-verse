# Changelog

All notable changes to Bible Verse are documented here.

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
