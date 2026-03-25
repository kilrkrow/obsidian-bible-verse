# Bible Verse — Obsidian Plugin

Look up and display Bible verses directly in your Obsidian notes. Powered by [API.Bible](https://scripture.api.bible), with support for multiple translations, comparison views, and links to popular Bible websites.

## Features

- **Inline references** — Type `@[John 3:16]` anywhere in your notes to display a linked verse
- **Code block display** — Use ` ```bible ` blocks for full verse rendering with custom translation
- **Comparison view** — Compare verses across multiple translations side by side
- **Multiple display styles** — Sidebar, Callout, Blockquote, or Inline
- **Bible website links** — Links to BibleHub, BibleGateway, Blue Letter Bible, or Bible.com
- **Local caching** — Fetched verses are cached locally to reduce API calls
- **Bake mode** — Optionally persist verse text directly in your note source for offline access

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

## Getting an API Key

This plugin uses the free [API.Bible](https://scripture.api.bible) service.

1. Visit [scripture.api.bible](https://scripture.api.bible)
2. Sign up for a free account
3. Create an application to get your API key
4. Paste the key in plugin settings (Settings → Bible Verse → API Key)

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
translation: ESV
```
````

### Comparison View

Compare multiple translations:

````
```bible
Romans 8:28
compare: ESV, KJV, NASB
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

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| API Key | Your API.Bible API key (required) | — |
| Default Translation | API.Bible translation ID to use | KJV |
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

## License

[GPL-3.0](LICENSE)
