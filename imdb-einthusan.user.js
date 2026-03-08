// ==UserScript==
// @name         Einthusan IMDB Ratings
// @namespace    http://tampermonkey.net/
// @version      0.5
// @description  Show IMDB ratings next to Wiki/Trailer on einthusan.tv movie pages
// @author       Robins Tharakan
// @license      Apache-2.0
// @downloadURL  https://raw.githubusercontent.com/robins/masala-script/main/imdb-einthusan.user.js
// @updateURL    https://raw.githubusercontent.com/robins/masala-script/main/imdb-einthusan.user.js
// @match        https://einthusan.tv/movie/results/*
// @match        https://einthusan.tv/movie/browse/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      omdbapi.com
// ==/UserScript==

(function () {
    'use strict';

    // ──────────────────────────────────────────────
    // Configuration
    // ──────────────────────────────────────────────
    const USE_STATIC_RATING = false;  // true = skip API, return static 9.9
    const STATIC_RATING     = '9.9';

    // API key stored in Tampermonkey — prompted on first run
    let OMDB_API_KEY = GM_getValue('omdb_api_key', '');
    if (!OMDB_API_KEY) {
        OMDB_API_KEY = prompt(
            'Einthusan IMDB Ratings\n\n'
            + 'Enter your OMDB API key (free at https://www.omdbapi.com/apikey.aspx):'
        );
        if (OMDB_API_KEY) {
            GM_setValue('omdb_api_key', OMDB_API_KEY.trim());
            OMDB_API_KEY = OMDB_API_KEY.trim();
        } else {
            console.warn('[IMDB Ratings] No API key provided.');
            OMDB_API_KEY = null; // will show Fail badges
        }
    }

    // ──────────────────────────────────────────────
    // Inject styles once
    // ──────────────────────────────────────────────
    const STYLE_ID = 'imdb-rating-styles';
    if (!document.getElementById(STYLE_ID)) {
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .imdb-badge {
                display: inline-flex;
                align-items: center;
                text-decoration: none;
                margin-left: 14px;
                gap: 4px;
                cursor: pointer;
            }
            .imdb-badge__icon {
                background-color: #f5c518;
                color: #000;
                padding: 2px 6px;
                border-radius: 4px;
                font-weight: bold;
                font-size: 12px;
                line-height: 1;
            }
            .imdb-badge__rating {
                color: #666;
                font-weight: bold;
                font-size: 13px;
            }
        `;
        document.head.appendChild(style);
    }

    // ──────────────────────────────────────────────
    // Fetch rating (stub or real API)
    // ──────────────────────────────────────────────
    function fetchRating(movieName, year, callback) {
        if (USE_STATIC_RATING) {
            callback(STATIC_RATING, null);
            return;
        }

        if (!OMDB_API_KEY) {
            callback('Fail', null);
            return;
        }

        // Real OMDB API call (disabled while USE_STATIC_RATING is true)
        const yearParam = year ? `&y=${year}` : '';
        const url = `https://www.omdbapi.com/?apikey=${OMDB_API_KEY}&t=${encodeURIComponent(movieName)}${yearParam}`;

        GM_xmlhttpRequest({
            method: 'GET',
            url: url,
            onload(response) {
                try {
                    const data = JSON.parse(response.responseText);
                    if (data.Response === 'True' && data.imdbRating) {
                        callback(data.imdbRating, data.imdbID);
                    } else {
                        callback('Fail', null);
                    }
                } catch {
                    callback('Fail', null);
                }
            },
            onerror() {
                callback(null, null);
            }
        });
    }

    // ──────────────────────────────────────────────
    // Build the IMDB badge element
    // ──────────────────────────────────────────────
    function createBadge(rating, imdbID) {
        const link = document.createElement('a');
        link.className = 'imdb-badge';
        link.target = '_blank';
        link.href = imdbID
            ? `https://www.imdb.com/title/${imdbID}/`
            : '#';

        const icon = document.createElement('span');
        icon.className = 'imdb-badge__icon';
        icon.textContent = 'IMDb';

        const ratingSpan = document.createElement('span');
        ratingSpan.className = 'imdb-badge__rating';
        ratingSpan.textContent = rating ?? 'N/A';

        link.appendChild(icon);
        link.appendChild(ratingSpan);
        return link;
    }

    // ──────────────────────────────────────────────
    // Main: inject ratings into every movie card
    // ──────────────────────────────────────────────
    function addIMDBRatings() {
        // Each movie card is an <li> containing div.block3 > div.extras
        const extrasContainers = document.querySelectorAll('div.block3 div.extras');

        extrasContainers.forEach(extras => {
            // Mark synchronously BEFORE the async fetch to prevent
            // duplicate badges from concurrent observer firings
            if (extras.dataset.imdbAdded) return;
            extras.dataset.imdbAdded = '1';

            // Walk up to the owning <li> to get movie metadata
            const card = extras.closest('li');
            if (!card) return;

            // Movie name from div.block2 a.title h3
            const titleElem = card.querySelector('div.block2 a.title h3');
            const movieName = titleElem ? titleElem.textContent.trim() : null;
            if (!movieName) return;

            // Year from the info text (e.g. "2025  HINDI  ...")
            let year = null;
            const infoElem = card.querySelector('div.block2 .info');
            if (infoElem) {
                const m = infoElem.textContent.match(/\b(19|20)\d{2}\b/);
                if (m) year = m[0];
            }

            // Try to extract IMDb ID from the existing Wiki link
            let existingImdbID = null;
            const wikiLink = extras.querySelector('a[href*="imdb.com"]');
            if (wikiLink) {
                const idMatch = wikiLink.href.match(/tt\d+/);
                if (idMatch) existingImdbID = idMatch[0];
            }

            // Fetch (or stub) the rating and insert the badge
            fetchRating(movieName, year, (rating, imdbID) => {
                // Prefer the ID we already have from the Wiki link
                const finalID = existingImdbID || imdbID;
                const badge = createBadge(rating, finalID);
                extras.appendChild(badge);
            });
        });
    }

    // ──────────────────────────────────────────────
    // Observe DOM changes (debounced, on body)
    // ──────────────────────────────────────────────
    let debounceTimer = null;
    function debouncedAdd() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(addIMDBRatings, 300);
    }

    function observeResults() {
        // Always observe body — Einthusan swaps the entire content
        // container on AJAX page transitions
        const observer = new MutationObserver(debouncedAdd);
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // ──────────────────────────────────────────────
    // Detect AJAX page navigation (pushState / popstate)
    // ──────────────────────────────────────────────
    let lastUrl = location.href;
    function onUrlChange() {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            debouncedAdd();
        }
    }

    // Monkey-patch pushState/replaceState so we catch SPA navigations
    const origPushState = history.pushState;
    history.pushState = function () {
        origPushState.apply(this, arguments);
        onUrlChange();
    };
    const origReplaceState = history.replaceState;
    history.replaceState = function () {
        origReplaceState.apply(this, arguments);
        onUrlChange();
    };
    window.addEventListener('popstate', onUrlChange);

    // ──────────────────────────────────────────────
    // Bootstrap
    // ──────────────────────────────────────────────
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', () => {
            addIMDBRatings();
            observeResults();
        });
    } else {
        addIMDBRatings();
        observeResults();
    }

})();
