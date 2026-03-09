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

## Features & Notes

*   **Supported Pages**: The script works on both broad listing pages (e.g., Year / Search Results / Browse) as well as the dedicated individual Movie Watch pages (both logged-in and logged-out URLs).
*   **Detailed Error Tooltips**: If an API lookup fails, hovering your mouse over the "Fail" or "N/A" badge will show exactly why the request failed (e.g., "Movie not found", "No OMDB API key configured", etc.) 
*   **Smart Matching via Wikipedia**: OMDB's title search is often unreliable for regional movies. If a direct exact-title match fails, this script automatically fetches the Einthusan-provided Wikipedia link in the background, extracts the exact IMDb ID, and queries OMDB again for perfect accuracy.
*   **Intelligent Caching**: To minimize network requests and API usage, ratings are cached locally in your browser. Successful ratings are cached for 7 days, while failed lookups (e.g., movie not found) are cached for 1 day.
*   **API Rate Limit Warning**: The free tier of the OMDB API allows **1,000 requests per day**. Because Einthusan browse pages can display 20+ movies at once, aggressively scrolling through many pages without caching could exhaust your daily limit. The built-in caching helps prevent this during normal usage.

## License

Copyright 2026 Robins Tharakan. Licensed under the [Apache License 2.0](LICENSE).
