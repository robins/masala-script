# 🌶️ Masala Script

The ultimate enhancement suite for Einthusan — featuring IMDb ratings, smart caching, and more.

## Scripts

| Script                                           | Description                                                | Install                                          |
| ------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------ |
| [imdb-einthusan.user.js](imdb-einthusan.user.js) | Show IMDb ratings inline on some Einthusan.tv browse pages | [Install](../../raw/main/imdb-einthusan.user.js) |

## Installation

1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension.
2. Click the **Install** link for the script you want — Tampermonkey will show an install dialog.
3. Some scripts may prompt for an API key on first run (e.g. a free [OMDB API key](https://www.omdbapi.com/apikey.aspx) for IMDb ratings).

## Development

If developing locally, you can serve scripts from a local HTTP server so Tampermonkey auto-detects version bumps:

```bash
# From the project folder
python -m http.server 8125
```

Then install via `http://localhost:8125/<script-name>.user.js`. Bump `@version` on each edit — Tampermonkey will prompt to update (or force it via Tampermonkey menu → *Check for userscript updates*).

## License

Copyright 2026 Robins Tharakan. Licensed under the [Apache License 2.0](LICENSE).
