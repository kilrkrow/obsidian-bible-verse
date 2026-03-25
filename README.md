# Bible Verse — Obsidian Plugin

Look up and display Bible verses directly in your Obsidian notes. Powered by [HelloAO Bible API](https://bible.helloao.org), with support for multiple translations, comparison views, and links to popular Bible websites. **No API key required.**

## Features

- **Inline references** — Type `@[John 3:16]` anywhere in your notes to display a linked verse
- **Code block display** — Use ` ```bible ` blocks for full verse rendering with custom translation
- **Comparison view** — Compare verses across multiple translations side by side
- **Multiple display styles** — Sidebar, Callout, Blockquote, or Inline
- **Bible website links** — Links to BibleHub, BibleGateway, Blue Letter Bible, or Bible.com
- **Local caching** — Fetched verses are cached locally to reduce API calls
- **Bake mode** — Optionally persist verse text directly in your note source for offline access
- **No API key needed** — Uses the free HelloAO Bible API with no registration required

## Installation

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release
2. Create a folder `obsidian-bible-verse` in your vault's `.obsidian/plugins/` directory
3. Copy the three files into the folder
4. Enable the plugin in Obsidian Settings → Community plugins

### Community Plugin (when available)

1. Open Obsidian Settings → Community plugins
2. Search for "Bible Verse"
3. Install and enable

## Usage

### Inline Syntax

Use `@[reference]` anywhere in your notes:

```
@[John 3:16]
@[1 Corinthians 13:4-7]
@[Psalm 23]
@[John 3:16-21,25]
```

### Code Block

Use a `bible` code block for full verse display:

````
```bible
John 3:16
translation: KJV
```
````

### Comparison View

Compare multiple translations:

````
```bible
Romans 8:28
compare: KJV, BSB, ASV
```
````

### Supported Reference Formats

| Format | Example |
|--------|---------|
| Simple verse | `John 3:16` |
| Verse range | `John 3:16-21` |
| Multiple verses | `John 3:16-21,25` |
| Whole chapter | `Psalm 23` |
| Multi-chapter range | `John 3:16-4:3` |
| Numbered books | `1 Corinthians 13:4-7` |

Book name variations are supported (e.g., "Psalm" / "Psalms", "Song of Solomon" / "Song of Songs").

## Available Translations

The plugin includes a curated set of freely available English translations:

| Abbreviation | Translation |
|-------------|-------------|
| KJV | King James Version |
| BSB | Berean Standard Bible |
| ASV | American Standard Version |
| WEB | World English Bible |
| NET | NET Bible |
| DARBY | Darby Translation |
| DRB | Douay-Rheims 1899 |
| ERV | Revised Version |
| YLT | Young's Literal Translation |
| BBE | Bible in Basic English |
| FBV | Free Bible Version |
| LSV | Literal Standard Version |
| MSB | Majority Standard Bible |
| GNV | Geneva Bible 1599 |
| OJB | Orthodox Jewish Bible |

Some commercially-licensed translations (NIV, NLT, NKJV, ESV, etc.) are not available for text display due to licensing restrictions. Link-only support for these translations may be added in a future version.

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Default Translation | Which translation to use by default | KJV |
| Preferred Website | Which Bible website to link to | BibleGateway |
| Display Style | Visual presentation of verses | Callout |
| Persist Verse Text | Automatically bake verse text into notes | Off |

## Bake Mode

When "Persist Verse Text" is enabled, fetched verse text is written directly into your note source:

```
@[John 3:16]
%%bible-baked|KJV%%
For God so loved the world...
%%end-bible%%
```

### Quick Lookup

Three commands for fast Bible reference workflows. Assign hotkeys in **Settings → Hotkeys**.

- **Quick insert reference** — Opens a modal where you type a Bible reference (e.g., "John 3:16") with real-time validation. On Enter, inserts `@[reference]` at the cursor. Optionally opens the verse on your preferred Bible site.
- **Search Bible for selected text** — Select any text in your note, then run this command to copy it to the clipboard and open a search on your preferred Bible website.
- **Open reference at cursor on Bible site** — Place your cursor inside an `@[ref]` marker and run this command to open that reference on your preferred Bible website.

### Commands

- **Bake all verses in this note** — Fetch and embed all `@[ref]` verses in the current note
- **Refresh baked verses in this note** — Re-fetch and update all baked verses
- **Refresh all baked verses in vault** — Re-fetch across all notes
- **Bake all existing verses across vault** — Bake all `@[ref]` in every note
- **Strip baked text from all notes** — Remove all baked text, keeping only `@[ref]` markers

## Supported Bible Websites

- [BibleHub](https://biblehub.com)
- [BibleGateway](https://www.biblegateway.com)
- [Blue Letter Bible](https://www.blueletterbible.org)
- [Bible.com (YouVersion)](https://www.bible.com)

## Data Source

Bible text is provided by the [HelloAO Bible API](https://bible.helloao.org). No API key or registration is required.

## License

[GPL-3.0](LICENSE)
