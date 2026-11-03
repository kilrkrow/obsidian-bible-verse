# Contributing to Bible Verse

Thanks for helping improve Bible Verse. This guide covers building, testing and
opening a pull request.

## Before you start

- **Bugs:** open a [bug report](https://github.com/kilrkrow/obsidian-bible-verse/issues/new?template=bug.yml).
- **Ideas:** open a [feature request](https://github.com/kilrkrow/obsidian-bible-verse/issues/new?template=feature.yml), or start a thread in [Discussions](https://github.com/kilrkrow/obsidian-bible-verse/discussions).
- **Translations:** use the [translation request](https://github.com/kilrkrow/obsidian-bible-verse/issues/new?template=translation-request.yml) form.

All issue forms are listed in [.github/ISSUE_TEMPLATE](.github/ISSUE_TEMPLATE). For
anything larger than a small fix, open an issue first so we can agree on the
approach.

## Build

You need Node.js 20 or later and npm.

```sh
npm ci
npm run build   # type-checks with tsc, then bundles src/ into main.js
npm run dev     # rebuilds main.js on every change
```

To try a build in Obsidian, copy `main.js`, `manifest.json` and `styles.css`
into `<vault>/.obsidian/plugins/bible-verse/` of a test vault and reload the
plugin.

## Test

```sh
npm test
```

Tests use [Vitest](https://vitest.dev) and live in `test/`. Add or update a
test with every behavior change.

## Pull requests

- Branch from `main` and keep each pull request to one change.
- Use [Conventional Commits](https://www.conventionalcommits.org) for commit
  messages and PR titles, for example `fix: ...`, `feat: ...` or `docs: ...`.
- `npm test` and `npm run build` must pass. Commit the rebuilt `main.js` with
  your source changes.
- Note every user-facing change under `## [Unreleased]` in `CHANGELOG.md`
  (see [AGENTS.md](AGENTS.md) for the format the in-app "What's new" pop-up
  reads).
- Build DOM with Obsidian's helpers (`createEl`, `createDiv`, `createSpan`)
  rather than `document.createElement`, and keep CSS to what Obsidian's plugin
  review accepts: no `:has` selectors, and `text-decoration-line`,
  `-style`, `-color` and `-thickness` instead of the `text-decoration`
  shorthand.
- Keep UI text plain ASCII.
- For visual changes, include before and after screenshots in light and dark
  themes.

## License

By contributing you agree that your contributions are licensed under the
[GPL-3.0](LICENSE).
