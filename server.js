const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
// NEVER hardcode your API key. Rely on Render's Environment Variables.
const API_KEY = process.env.YOUTUBE_API_KEY; 
const BASE_URL = 'https://www.googleapis.com/youtube/v3';
const TOP_N = 50;                 
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // Cache for 24 hours to save quota

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
const http = axios.create({ timeout: 15000 });

async function ytGet(url, params, retries = 3) {
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
            
            const retryAfter = parseInt(err.response?.headers?.['retry-after'] || '0', 10);
            const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(2000 * 2 ** attempt, 10000);
            await new Promise(r => setTimeout(r, waitMs));
        }
    }
    throw lastError;
}

async function getVideoDetails(videoIds) {
    const details = {};
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

    // 1. Check Cache First (Costs 0 Quota)
    const cached = cache[year];
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        console.log(`Serving ${year} from cache!`);
        return res.json({ ...cached.data, cached: true });
    }

    try {
        const seen = new Set();
        const candidates = [];

        // OPTIMIZATION: Only use 1 broad query and 2 pages maximum.
        // This drops the quota cost from ~1,200 to ~200 per year.
        let pageToken = '';
        for (let page = 0; page < 2; page++) {
            const data = await ytGet(`${BASE_URL}/search`, {
                key: API_KEY,
                part: 'snippet',
                q: 'official music video',
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
            await sleep(300);
        }

        if (candidates.length === 0) {
            return res.json({ year, total: 0, videos: [] });
        }

        // Fetch precise view counts and dates
        const details = await getVideoDetails(candidates);

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
        
        // 2. Save to Cache for future requests
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
    console.log(`Server running on port ${PORT}`);
});