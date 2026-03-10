// ==UserScript==
// @name         Einthusan IMDB Ratings
// @namespace    http://tampermonkey.net/
// @version      1.5
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
// @connect      imdb.com
// @connect      graphql.imdb.com
// ==/UserScript==

(function () {
    'use strict';

    // ──────────────────────────────────────────────
    // Configuration
    // ──────────────────────────────────────────────

    // API key stored in Tampermonkey — custom modal on first run
    // (native prompt() gets hidden by Einthusan's own popups)
    let OMDB_API_KEY = GM_getValue('omdb_api_key', '');

    function showApiKeyModal() {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.id = 'imdb-apikey-overlay';
            overlay.style.cssText = `
                position: fixed; inset: 0;
                background: rgba(0,0,0,0.6);
                z-index: 2147483647;
                display: flex; align-items: center; justify-content: center;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            `;
            overlay.innerHTML = `
                <div style="background:#1a1a2e; color:#e0e0e0; border-radius:12px;
                            padding:28px 32px; max-width:420px; width:90%;
                            box-shadow:0 8px 32px rgba(0,0,0,0.5); text-align:center;">
                    <div style="font-size:22px; font-weight:bold; margin-bottom:6px;">
                        <span style="background:#f5c518; color:#000; padding:2px 8px;
                                     border-radius:4px; font-size:14px; vertical-align:middle;
                                     margin-right:6px;">IMDb</span>
                        Einthusan Ratings
                    </div>
                    <p style="color:#aaa; font-size:13px; margin:12px 0 18px;">
                        Enter your free OMDB API key to display IMDb ratings.<br>
                        <a href="https://www.omdbapi.com/apikey.aspx" target="_blank"
                           style="color:#f5c518;">Get a free key here &rarr;</a>
                    </p>
                    <input id="imdb-apikey-input" type="text" placeholder="e.g. a1b2c3d4"
                           style="width:100%; box-sizing:border-box; padding:10px 14px;
                                  border:1px solid #333; border-radius:6px; font-size:15px;
                                  background:#16213e; color:#fff; outline:none;
                                  margin-bottom:16px;" autocomplete="off" />
                    <div style="display:flex; gap:10px; justify-content:center;">
                        <button id="imdb-apikey-save" style="background:#f5c518; color:#000;
                                border:none; padding:8px 24px; border-radius:6px; font-weight:bold;
                                font-size:14px; cursor:pointer;">Save</button>
                        <button id="imdb-apikey-skip" style="background:transparent; color:#888;
                                border:1px solid #444; padding:8px 18px; border-radius:6px;
                                font-size:14px; cursor:pointer;">Skip</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);

            const input = overlay.querySelector('#imdb-apikey-input');
            input.focus();

            overlay.querySelector('#imdb-apikey-save').addEventListener('click', () => {
                const key = input.value.trim();
                overlay.remove();
                resolve(key || null);
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    const key = input.value.trim();
                    overlay.remove();
                    resolve(key || null);
                }
            });
            overlay.querySelector('#imdb-apikey-skip').addEventListener('click', () => {
                overlay.remove();
                resolve(null);
            });
        });
    }

    // Deferred bootstrap — waits for key modal if needed
    async function initWithApiKey() {
        if (!OMDB_API_KEY) {
            const key = await showApiKeyModal();
            if (key) {
                GM_setValue('omdb_api_key', key);
                OMDB_API_KEY = key;
            } else {
                console.warn('[IMDB Ratings] No API key provided.');
                OMDB_API_KEY = null;
            }
        }
        // Now start injecting ratings
        bootstrap();
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
    // IMDB scrape budget: only one direct IMDB HTML
    // scrape per page load to avoid rate-limiting
    // ──────────────────────────────────────────────
    let imdbScrapeUsed = false;

    // ──────────────────────────────────────────────
    // Fetch rating (stub or real API)
    // ──────────────────────────────────────────────
    function fetchRating(movieName, year, wikiUrl, directImdbId, callback, options) {
        const allowScrape = options?.allowScrape || false;
        if (!OMDB_API_KEY) {
            callback('Fail', null, 'No OMDB API key configured');
            return;
        }

        const cacheKey = `v3_${movieName}_${year || ''}_${directImdbId || ''}`;
        let cache = {};
        try {
            cache = JSON.parse(GM_getValue('omdb_cache', '{}'));
        } catch (e) {
            cache = {};
        }

        const cached = cache[cacheKey];
        const ONE_DAY = 1 * 24 * 60 * 60 * 1000;
        const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
        const noCacheRead = new URLSearchParams(location.search).has('nocacheread');

        if (cached && !noCacheRead) {
            const age = Date.now() - cached.ts;
            const isMissing = (cached.rating === 'Fail' || cached.rating === 'N/A');
            const ttl = isMissing ? ONE_DAY : SEVEN_DAYS;
            if (age < ttl) {
                callback(cached.rating, cached.id, cached.reason);
                return;
            }
        }

        const base = `https://www.omdbapi.com/?apikey=${OMDB_API_KEY}`;
        const enc = encodeURIComponent(movieName);

        // Helper: fetch raw text
        function fetchText(url) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET', url,
                    onload(r) { resolve(r.responseText); },
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

        // Helper: fetch IMDB rating via GraphQL API (bypasses OMDB)
        // Uses IMDB's own GraphQL endpoint which returns JSON ratings
        // without triggering the WAF challenge that blocks HTML scrapes
        function scrapeImdbRating(imdbId) {
            return new Promise((resolve) => {
                const query = JSON.stringify({
                    query: `query {
                        title(id: "${imdbId}") {
                            ratingsSummary {
                                aggregateRating
                                voteCount
                            }
                        }
                    }`
                });
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: 'https://graphql.imdb.com/',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-imdb-client-name': 'imdb-web-next-localized'
                    },
                    data: query,
                    onload(r) {
                        const body = r.responseText || r.response || '';
                        console.log(`[IMDB Ratings] GraphQL ${imdbId}: status=${r.status}, body=${body.substring(0, 300)}`);
                        try {
                            if (r.status === 200) {
                                const data = JSON.parse(body);
                                const rating = data?.data?.title?.ratingsSummary?.aggregateRating;
                                if (rating != null) {
                                    console.log(`[IMDB Ratings] GraphQL rating for ${imdbId}:`, rating);
                                    resolve(rating.toString());
                                    return;
                                }
                            }
                        } catch (e) {
                            console.error('[IMDB Ratings] Error parsing GraphQL response:', e);
                        }
                        resolve(null);
                    },
                    onerror(e) {
                        console.error('[IMDB Ratings] GraphQL request failed:', e);
                        resolve(null);
                    }
                });
            });
        }

        // Fallback chain:
        //  0. Direct IMDb ID
        //  1. Exact title + year
        //  2. Wikipedia scraping (if wikiUrl) -> exact IMDb ID
        //  3. Exact title (no year)
        //  4. Search endpoint -> fetch by ID
        (async () => {
            try {
                // Keep track of the best known IMDb ID for the badge link
                let knownImdbId = directImdbId || null;

                // 0) Direct IMDb ID
                if (directImdbId) {
                    const df = await omdb(`${base}&i=${directImdbId}`);
                    if (df.Response === 'True') {
                        if (df.imdbRating && df.imdbRating !== 'N/A') {
                            return callback(df.imdbRating, df.imdbID);
                        }
                        // OMDB returned N/A — try scraping IMDb directly.
                        // On single-movie pages (allowScrape), always attempt.
                        // On listing pages, respect the one-per-page budget.
                        if (allowScrape || !imdbScrapeUsed) {
                            if (!allowScrape) imdbScrapeUsed = true;
                            const scrapedRating = await scrapeImdbRating(directImdbId);
                            if (scrapedRating) {
                                return callback(scrapedRating, directImdbId);
                            }
                        }
                        // Scrape skipped or failed — fall through to remaining steps
                    }
                }

                // 1) Exact title + year
                if (year) {
                    const d = await omdb(`${base}&t=${enc}&y=${year}`);
                    if (d.Response === 'True' && d.imdbRating && d.imdbRating !== 'N/A') {
                        return callback(d.imdbRating, knownImdbId || d.imdbID);
                    }
                }

                // 2) Wikipedia Extraction (most reliable for regional movies)
                if (wikiUrl) {
                    try {
                        const html = await fetchText(wikiUrl);
                        const m = html.match(/imdb\.com\/title\/(tt\d+)/i);
                        if (m) {
                            if (!knownImdbId) knownImdbId = m[1];
                            const df = await omdb(`${base}&i=${m[1]}`);
                            if (df.Response === 'True' && df.imdbRating && df.imdbRating !== 'N/A') {
                                return callback(df.imdbRating, knownImdbId || df.imdbID);
                            }
                        }
                    } catch (e) {
                        // ignore wiki fetch errors and fall through
                    }
                }

                // 3) Exact title only
                const d2 = await omdb(`${base}&t=${enc}`);
                if (d2.Response === 'True' && d2.imdbRating && d2.imdbRating !== 'N/A') {
                    return callback(d2.imdbRating, knownImdbId || d2.imdbID);
                }

                // 4) Search endpoint
                const yearParam = year ? `&y=${year}` : '';
                const ds = await omdb(`${base}&s=${enc}${yearParam}`);
                if (ds.Response === 'True' && ds.Search?.length) {
                    const id = ds.Search[0].imdbID;
                    const df = await omdb(`${base}&i=${id}`);
                    if (df.Response === 'True' && df.imdbRating && df.imdbRating !== 'N/A') {
                        return callback(df.imdbRating, knownImdbId || df.imdbID);
                    }
                }

                callback('N/A', knownImdbId, 'Rating not available on OMDB');
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

            // Try to extract Wikipedia URL or Direct IMDb ID
            let wikiUrl = null;
            let directImdbId = null;

            const wikiLink = extras.querySelector('a[href*="wikipedia.org"]');
            if (wikiLink) {
                wikiUrl = wikiLink.href;
            }
            const imdbLink = extras.querySelector('a[href*="imdb.com/title/tt"]');
            if (imdbLink) {
                const m = imdbLink.href.match(/imdb\.com\/title\/(tt\d+)/i);
                if (m) directImdbId = m[1];
            }

            // Fetch (or stub) the rating and insert the badge
            fetchRating(movieName, year, wikiUrl, directImdbId, (rating, imdbID, failReason) => {
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

        // Try to extract Wikipedia URL or Direct IMDb ID
        let wikiUrl = null;
        let directImdbId = null;

        const wikiLink = extras.querySelector('a[href*="wikipedia.org"]');
        if (wikiLink) {
            wikiUrl = wikiLink.href;
        }
        const imdbLink = extras.querySelector('a[href*="imdb.com/title/tt"]');
        if (imdbLink) {
            const m = imdbLink.href.match(/imdb\.com\/title\/(tt\d+)/i);
            if (m) directImdbId = m[1];
        }

        fetchRating(movieName, year, wikiUrl, directImdbId, (rating, imdbID, failReason) => {
            const badge = createBadge(rating, imdbID, failReason);
            extras.appendChild(badge);
        }, { allowScrape: true });
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
    // Bootstrap — called by initWithApiKey() after
    // the API key is available (or skipped)
    // ──────────────────────────────────────────────
    function bootstrap() {
        addIMDBRatings();
        observeResults();
    }

    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', () => initWithApiKey());
    } else {
        initWithApiKey();
    }

})();
