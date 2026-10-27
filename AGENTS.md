# Agent notes

## Keep CHANGELOG.md current

The in-app "What's new" pop-up (`src/whats-new.ts`, `src/whats-new-modal.ts`)
shows users the sections of `CHANGELOG.md`. A release with no section of its own
shows nothing, so the changelog has to be kept up to date.

- **Every user-facing change** goes under `## [Unreleased]` at the top of
  `CHANGELOG.md`, filed under `### Added`, `### Changed` or `### Fixed`. Create
  the section if it isn't there.
- **Write for users, not developers.** Say what they'll notice and how to use it,
  for example a new token, setting or command. Leave out refactors, file names
  and lint fixes, or keep them to one plain line.
- **When you bump the version** in `manifest.json`, `package.json` and
  `versions.json`, rename `## [Unreleased]` to `## [x.y.z] — YYYY-MM-DD` with the
  new version and today's date, in the same commit. The pop-up skips
  `[Unreleased]`, so a section left under that name never reaches users.
- **In the same commit, update `## What's new in x.y` in `README.md`** to the
  new version's highlights. Obsidian's Community plugins browser shows the
  README as the plugin page, so a stale section is the first thing people see.
- The heading format matters, because the pop-up parses it: `## [1.11.0] — 2026-10-16`.
  `test/whats-new.test.ts` fails if the version in `manifest.json` has no section.

## Before you push

- `npm test` and `npm run build` must pass.
- Commit the rebuilt `main.js` along with the source changes.
