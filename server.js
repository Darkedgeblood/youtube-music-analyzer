const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const API_KEY = process.env.YOUTUBE_API_KEY || 'AIzaSyCBnit-kfRGJXCYt8yvX0oUipbgm75G2gc';
const BASE_URL = 'https://www.googleapis.com/youtube/v3';
const TOP_N = 50;                 // max results returned to the client
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour in-memory cache per year
const SEARCH_QUERIES = [
    'official music video',
    'official video',
    'song',
    'lyric video',
];

// In-memory cache: { year: { data, timestamp } }
const cache = {};

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(cors({ origin: '*' }));
app.use(express.json());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Axios instance with sane timeout so requests never hang forever. */
const http = axios.create({ timeout: 15000 });

/**
 * GET wrapper with retry + exponential backoff for 429 / 5xx responses.
 * YouTube's search endpoint is rate-limited per-second AND per-day; backing
 * off instead of failing instantly is what makes this server feel "stable".
 */
async function ytGet(url, params, retries = 4) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await http.get(url, { params });
            return res.data;
        } catch (err) {
            lastError = err;
            const status = err.response?.status;
            const retryable = status === 429 || (status >= 500 && status < 600) || err.code === 'ECONNABORTED';
            if (!retryable || attempt === retries) break;
            // Respect Retry-After if YouTube sends it, otherwise back off exponentially
            const retryAfter = parseInt(err.response?.headers?.['retry-after'] || '0', 10);
            const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(2000 * 2 ** attempt, 16000);
            await new Promise(r => setTimeout(r, waitMs));
        }
    }
    throw lastError;
}

/** Fetch full snippet+statistics for up to N video ids, batched in chunks of 50. */
async function getVideoDetails(videoIds) {
    const details = {};
    // YouTube's videos endpoint accepts max 50 ids per call
    for (let i = 0; i < videoIds.length; i += 50) {
        const chunk = videoIds.slice(i, i + 50);
        const data = await ytGet(`${BASE_URL}/videos`, {
            key: API_KEY,
            part: 'snippet,statistics',
            id: chunk.join(','),
        });
        for (const video of data.items || []) {
            details[video.id] = {
                title: video.snippet?.title || 'Unknown title',
                channel: video.snippet?.channelTitle || 'Unknown channel',
                viewCount: parseInt(video.statistics?.viewCount || '0', 10),
                publishedAt: video.snippet?.publishedAt || null,
                categoryId: video.snippet?.categoryId || null,
            };
        }
    }
    return details;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Route: GET /top-music-videos?year=YYYY
// ---------------------------------------------------------------------------
app.get('/top-music-videos', async (req, res) => {
    const yearParam = String(req.query.year || '').trim();
    const year = parseInt(yearParam, 10);
    const currentYear = new Date().getFullYear();

    if (!yearParam || Number.isNaN(year) || year < 2005 || year > currentYear) {
        return res.status(400).json({
            error: `Invalid year. Please provide a year between 2005 and ${currentYear}.`,
        });
    }

    // Serve from cache when fresh
    const cached = cache[year];
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return res.json({ ...cached.data, cached: true });
    }

    try {
        const seen = new Set();
        const candidates = [];

        // Spread a few focused queries with a polite delay between calls to
        // stay under the per-second rate limit instead of hammering the API.
<<<<<<< HEAD
        const PAGES_PER_QUERY = 3; // 50/page => up to 150 per query
=======
        const PAGES_PER_QUERY = 2; // 50/page => up to 100 per query
>>>>>>> f452251099b44a48bab45473954177111e134802
        for (const query of SEARCH_QUERIES) {
            let pageToken = '';
            for (let page = 0; page < PAGES_PER_QUERY; page++) {
                const data = await ytGet(`${BASE_URL}/search`, {
                    key: API_KEY,
                    part: 'snippet',
                    q: query,
                    type: 'video',
                    maxResults: 50,
                    videoCategoryId: 10, // Music
                    order: 'viewCount',
                    publishedAfter: `${year}-01-01T00:00:00Z`,
                    publishedBefore: `${year}-12-31T23:59:59Z`,
                    pageToken,
                });

                for (const item of data.items || []) {
                    const id = item.id?.videoId;
                    if (id && !seen.has(id)) {
                        seen.add(id);
                        candidates.push(id);
                    }
                }

                pageToken = data.nextPageToken;
                if (!pageToken) break;
                await sleep(300); // be polite between page requests
            }
            await sleep(300);
            // Early exit: we already have far more than we need
<<<<<<< HEAD
            if (candidates.length >= 400) break; // extra margin; year filter discards out-of-range hits
=======
            if (candidates.length >= TOP_N * 3) break;
>>>>>>> f452251099b44a48bab45473954177111e134802
        }

        if (candidates.length === 0) {
            return res.json({ year, total: 0, videos: [] });
        }

        const details = await getVideoDetails(candidates);

<<<<<<< HEAD
        // YouTube's search date filter is LOOSE (documented quirk): when
        // ordering by viewCount it returns videos uploaded outside the
        // requested range. So we filter by the video's REAL upload date here.
=======
>>>>>>> f452251099b44a48bab45473954177111e134802
        const videos = Object.entries(details)
            .map(([videoId, v]) => ({
                videoId,
                title: v.title,
                channel: v.channel,
                viewCount: v.viewCount,
                publishedAt: v.publishedAt,
            }))
            .filter(v => v.publishedAt && v.publishedAt.startsWith(String(year)))
            .sort((a, b) => b.viewCount - a.viewCount)
            .slice(0, TOP_N)
            .map((v, i) => ({ rank: i + 1, ...v }));

        const payload = { year, total: videos.length, videos };
        cache[year] = { data: payload, timestamp: Date.now() };
        res.json(payload);
    } catch (error) {
        const status = error.response?.status;
        const apiMessage = error.response?.data?.error?.message;
        console.error(`Error fetching videos for ${year}:`, status || '', apiMessage || error.message);
        res.status(status && status < 600 ? status : 500).json({
            error: status === 403
                ? 'YouTube API quota exceeded or key invalid. Try again later.'
                : 'Failed to fetch videos. Please try again.',
        });
    }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
