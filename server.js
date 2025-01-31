const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"]
}));  
app.use(express.json());

// YouTube API Configuration
const API_KEY = 'AIzaSyCBnit-kfRGJXCYt8yvX0oUipbgm75G2gc'; // Use your actual API key
const BASE_URL = 'https://www.googleapis.com/youtube/v3';

// Function to fetch video statistics (view count and release date)
const getVideoDetails = async (videoIds) => {
    if (!videoIds.length) return {};

    try {
        const response = await axios.get(`${BASE_URL}/videos`, {
            params: {
                key: API_KEY,
                part: 'statistics,snippet',
                id: videoIds.join(','),
            },
        });

        return response.data.items.reduce((acc, video) => {
            acc[video.id] = {
                viewCount: parseInt(video.statistics.viewCount, 10) || 0,
                publishedAt: video.snippet.publishedAt || "Unknown", // Ensure release date is always present
            };
            return acc;
        }, {});
    } catch (error) {
        console.error('Error fetching video statistics:', error.message);
        return {};
    }
};

// API Route: Fetch top music videos for a given year
app.get('/top-music-videos', async (req, res) => {
    const { year } = req.query;

    if (!year || isNaN(year)) {
        return res.status(400).json({ error: 'Invalid or missing year parameter' });
    }

    try {
        // Define multiple search queries for different languages
        const queries = [
            "music video", "song", "official video", "canción", "chanson", "música", 
            "lagu", "künstler", "videoclip", "cancione", "clip musical"
        ];

        let allVideos = [];
        let maxPages = 3; // Fetch up to 150 videos
        let pagesFetched = 0;

        for (let query of queries) {
            let nextPageToken = "";

            while (pagesFetched < maxPages) {
                const response = await axios.get(`${BASE_URL}/search`, {
                    params: {
                        part: "snippet",
                        q: query,
                        type: "video",
                        maxResults: 50,
                        videoCategoryId: 10,
                        order: "viewCount",
                        publishedAfter: `${year}-01-01T00:00:00Z`,
                        publishedBefore: `${year}-12-31T23:59:59Z`,
                        pageToken: nextPageToken,
                        key: API_KEY,
                    },
                });

                allVideos = [...allVideos, ...response.data.items];
                nextPageToken = response.data.nextPageToken;
                pagesFetched++;

                if (!nextPageToken) break; // Stop if no more pages
            }
        }

        // Remove duplicate videos
        allVideos = Array.from(new Map(allVideos.map(v => [v.id.videoId, v])).values());

        // Fetch detailed video statistics (view counts and release dates)
        const videoIds = allVideos.map(video => video.id.videoId);
        const videoStats = await getVideoDetails(videoIds);

        // Process and sort videos by view count
        const sortedVideos = allVideos
            .map(video => ({
                title: video.snippet.title,
                channel: video.snippet.channelTitle,
                publishedAt: videoStats[video.id.videoId]?.publishedAt || "Unknown", // Release Date
                viewCount: videoStats[video.id.videoId]?.viewCount || 0,
                videoId: video.id.videoId,
            }))
            .sort((a, b) => b.viewCount - a.viewCount)
            .slice(0, 20);

        res.json(sortedVideos);
    } catch (error) {
        console.error('Error fetching videos:', error.message);
        res.status(500).json({ error: 'Failed to fetch videos' });
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
