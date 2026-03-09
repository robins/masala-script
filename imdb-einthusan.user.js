// ==UserScript==
// @name         Einthusan IMDB Ratings
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Show IMDB ratings next to Wiki/Trailer on einthusan.tv movie pages
// @author       Robins Tharakan
// @license      Apache-2.0
// @downloadURL  https://raw.githubusercontent.com/robins/masala-script/main/imdb-einthusan.user.js
// @updateURL    https://raw.githubusercontent.com/robins/masala-script/main/imdb-einthusan.user.js
// @match        https://einthusan.tv/movie/results/*
// @match        https://einthusan.tv/movie/browse/*
// @match        https://einthusan.tv/movie/watch/*
// @match        https://einthusan.tv/premium/movie/watch/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      omdbapi.com
// @connect      wikipedia.org
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
    function fetchRating(movieName, year, wikiUrl, callback) {
        if (USE_STATIC_RATING) {
            callback(STATIC_RATING, null);
            return;
        }

        if (!OMDB_API_KEY) {
            callback('Fail', null, 'No OMDB API key configured');
            return;
        }

        const cacheKey = `${movieName}_${year || ''}`;
        let cache = {};
        try {
            cache = JSON.parse(GM_getValue('omdb_cache', '{}'));
        } catch (e) {
            cache = {};
        }

        const cached = cache[cacheKey];
        const ONE_DAY = 1 * 24 * 60 * 60 * 1000;
        const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
        
        if (cached) {
            const age = Date.now() - cached.ts;
            const ttl = (cached.rating === 'Fail') ? ONE_DAY : SEVEN_DAYS;
            if (age < ttl) {
                callback(cached.rating, cached.id, cached.reason);
                return;
            }
        }

        const base = `https://www.omdbapi.com/?apikey=${OMDB_API_KEY}`;
        const enc  = encodeURIComponent(movieName);

        // Helper: fetch raw text
        function fetchText(url) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET', url,
                    onload(r)  { resolve(r.responseText); },
                    onerror(e) { reject(e); }
                });
            });
        }

        // Helper: fetch JSON from OMDB
        function omdb(url) {
            return fetchText(url).then(JSON.parse);
        }

        // Intercept callback to cache the result
        const originalCallback = callback;
        callback = (rating, id, reason) => {
            cache[cacheKey] = { rating, id, reason, ts: Date.now() };
            GM_setValue('omdb_cache', JSON.stringify(cache));
            originalCallback(rating, id, reason);
        };

        // Fallback chain:
        //  1. Exact title + year
        //  2. Wikipedia scraping (if wikiUrl) -> exact IMDb ID
        //  3. Exact title (no year)
        //  4. Search endpoint -> fetch by ID
        (async () => {
            try {
                // 1) Exact title + year
                if (year) {
                    const d = await omdb(`${base}&t=${enc}&y=${year}`);
                    if (d.Response === 'True' && d.imdbRating) {
                        return callback(d.imdbRating, d.imdbID);
                    }
                }

                // 2) Wikipedia Extraction (most reliable for regional movies)
                if (wikiUrl) {
                    try {
                        const html = await fetchText(wikiUrl);
                        const m = html.match(/imdb\.com\/title\/(tt\d+)/i);
                        if (m) {
                            const df = await omdb(`${base}&i=${m[1]}`);
                            if (df.Response === 'True' && df.imdbRating) {
                                return callback(df.imdbRating, df.imdbID);
                            }
                        }
                    } catch (e) {
                        // ignore wiki fetch errors and fall through
                    }
                }

                // 2) Exact title only
                const d2 = await omdb(`${base}&t=${enc}`);
                if (d2.Response === 'True' && d2.imdbRating) {
                    return callback(d2.imdbRating, d2.imdbID);
                }

                // 3) Search endpoint
                const yearParam = year ? `&y=${year}` : '';
                const ds = await omdb(`${base}&s=${enc}${yearParam}`);
                if (ds.Response === 'True' && ds.Search?.length) {
                    const id = ds.Search[0].imdbID;
                    const df = await omdb(`${base}&i=${id}`);
                    if (df.Response === 'True' && df.imdbRating) {
                        return callback(df.imdbRating, df.imdbID);
                    }
                }

                callback('Fail', null, 'Movie not found after 3 attempts');
            } catch (e) {
                callback('Fail', null, 'Error: ' + (e?.message || e?.statusText || 'request failed'));
            }
        })();
    }

    // ──────────────────────────────────────────────
    // Build the IMDB badge element
    // ──────────────────────────────────────────────
    function createBadge(rating, imdbID, failReason) {
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
        if (failReason) {
            ratingSpan.title = failReason;
            ratingSpan.style.cursor = 'help';
        }

        link.appendChild(icon);
        link.appendChild(ratingSpan);
        return link;
    }

    // ──────────────────────────────────────────────
    // Detect page type
    // ──────────────────────────────────────────────
    function isMovieWatchPage() {
        return /\/movie\/watch\//.test(location.pathname)
            || /\/premium\/movie\/watch\//.test(location.pathname);
    }

    // ──────────────────────────────────────────────
    // Listing pages: inject ratings into every card
    // ──────────────────────────────────────────────
    function addIMDBRatingsToListings() {
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

            // Try to extract Wikipedia URL
            let wikiUrl = null;
            const wikiLink = extras.querySelector('a[href*="wikipedia.org"]');
            if (wikiLink) {
                wikiUrl = wikiLink.href;
            }

            // Fetch (or stub) the rating and insert the badge
            fetchRating(movieName, year, wikiUrl, (rating, imdbID, failReason) => {
                const badge = createBadge(rating, imdbID, failReason);
                extras.appendChild(badge);
            });
        });
    }

    // ──────────────────────────────────────────────
    // Movie watch page: inject rating next to Wiki / Trailer
    // ──────────────────────────────────────────────
    function addIMDBRatingToMoviePage() {
        const extras = document.querySelector('div.extras');
        if (!extras || extras.dataset.imdbAdded) return;
        extras.dataset.imdbAdded = '1';

        // Movie title — h3 inside the movie info section
        const titleElem = document.querySelector('h3');
        const movieName = titleElem ? titleElem.textContent.trim() : null;
        if (!movieName) return;

        // Year from the <p> containing "2022 Tamil HD..." etc.
        let year = null;
        const infoParagraphs = document.querySelectorAll('p');
        for (const p of infoParagraphs) {
            const m = p.textContent.match(/\b(19|20)\d{2}\b/);
            if (m) { year = m[0]; break; }
        }

        // Try to extract Wikipedia URL
        let wikiUrl = null;
        const wikiLink = extras.querySelector('a[href*="wikipedia.org"]');
        if (wikiLink) {
            wikiUrl = wikiLink.href;
        }

        fetchRating(movieName, year, wikiUrl, (rating, imdbID, failReason) => {
            const badge = createBadge(rating, imdbID, failReason);
            extras.appendChild(badge);
        });
    }

    // ──────────────────────────────────────────────
    // Dispatcher: pick the right handler for the page
    // ──────────────────────────────────────────────
    function addIMDBRatings() {
        if (isMovieWatchPage()) {
            addIMDBRatingToMoviePage();
        } else {
            addIMDBRatingsToListings();
        }
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
