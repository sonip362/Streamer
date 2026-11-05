const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');

const app = express();
const PORT = 3000;

// Enable CORS for audio streaming
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Range');
    next();
});

// Serve static directory (HTML, CSS, JS, Music files)
app.use(express.static(__dirname));

// Ensure /Music static route works if directory exists
const musicDir = path.join(__dirname, 'Music');
if (!fs.existsSync(musicDir)) {
    fs.mkdirSync(musicDir, { recursive: true });
}
app.use('/Music', express.static(musicDir));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Helper function to fetch files from GitHub API
function fetchGitHubMusicFiles() {
    return new Promise((resolve) => {
        const options = {
            hostname: 'api.github.com',
            path: '/repos/sonip362/Video/contents/Music',
            headers: { 'User-Agent': 'Node-Audio-Streamer' }
        };

        https.get(options, (githubRes) => {
            let data = '';
            githubRes.on('data', chunk => data += chunk);
            githubRes.on('end', () => {
                try {
                    const items = JSON.parse(data);
                    if (Array.isArray(items)) {
                        const mp3Names = items
                            .filter(item => item.name && item.name.toLowerCase().endsWith('.mp3'))
                            .map(item => item.name);
                        return resolve(mp3Names);
                    }
                } catch (e) { }
                resolve([]);
            });
        }).on('error', () => resolve([]));
    });
}

// Endpoint to dynamically scan and list all MP3 files in root, /Music, and GitHub repository
app.get('/api/tracks', async (req, res) => {
    const seenKeys = new Set();
    const uniqueFiles = [];

    function addIfUnique(filename) {
        if (!filename || typeof filename !== 'string') return;
        const norm = filename.normalize('NFC');
        const key = norm.toLowerCase().replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
        if (key && !seenKeys.has(key)) {
            seenKeys.add(key);
            uniqueFiles.push(norm);
        }
    }

    // 1. Fetch from GitHub Repository API
    const ghFiles = await fetchGitHubMusicFiles();
    ghFiles.forEach(addIfUnique);

    // 2. Check /Music folder locally
    if (fs.existsSync(musicDir)) {
        try {
            const musicFiles = fs.readdirSync(musicDir);
            musicFiles.forEach(file => {
                if (file.toLowerCase().endsWith('.mp3')) {
                    addIfUnique(file);
                }
            });
        } catch (e) { }
    }

    // 3. Check Root folder locally
    try {
        const rootFiles = fs.readdirSync(__dirname);
        rootFiles.forEach(file => {
            if (file.toLowerCase().endsWith('.mp3')) {
                addIfUnique(file);
            }
        });
    } catch (e) { }

    res.json(uniqueFiles);
});

// ─── Jamendo Stream Proxy ───────────────────────────────────────────────────
// Jamendo signed stream URLs expire quickly. This endpoint fetches a fresh
// signed URL from the API on every request and proxies the audio bytes,
// so the browser always gets a valid, live stream.
const JAMENDO_CLIENT_ID = '8dc02fdd';

app.get('/api/jamendo/stream/:trackId', async (req, res) => {
    const trackId = encodeURIComponent(req.params.trackId);
    const apiUrl = `https://api.jamendo.com/v3.0/tracks/?client_id=${JAMENDO_CLIENT_ID}&format=json&id=${trackId}&audioformat=mp32`;

    try {
        // 1. Get a fresh signed URL from the Jamendo API
        const apiRes = await fetch(apiUrl);
        if (!apiRes.ok) throw new Error(`Jamendo API returned ${apiRes.status}`);
        const data = await apiRes.json();

        if (!data.results || data.results.length === 0) {
            return res.status(404).send('Track not found');
        }

        const freshAudioUrl = data.results[0].audio;
        if (!freshAudioUrl) return res.status(404).send('No audio URL');

        // 2. Proxy the audio stream back to the client with Range support
        const rangeHeader = req.headers['range'];
        const streamHeaders = { 'User-Agent': 'Node-Audio-Streamer' };
        if (rangeHeader) streamHeaders['Range'] = rangeHeader;

        const audioRes = await fetch(freshAudioUrl, { headers: streamHeaders });

        res.setHeader('Content-Type', audioRes.headers.get('content-type') || 'audio/mpeg');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Access-Control-Allow-Origin', '*');

        const contentLength = audioRes.headers.get('content-length');
        const contentRange = audioRes.headers.get('content-range');
        if (contentLength) res.setHeader('Content-Length', contentLength);
        if (contentRange) res.setHeader('Content-Range', contentRange);

        res.status(audioRes.status);

        // Pipe audio bytes directly to the browser
        const { Readable } = require('stream');
        Readable.fromWeb(audioRes.body).pipe(res);

    } catch (err) {
        console.error('[Jamendo Proxy] Error:', err.message);
        if (!res.headersSent) res.status(500).send('Stream proxy error');
    }
});

// ─── GitHub Music Proxy ─────────────────────────────────────────────────────
// Proxies GitHub Raw files through localhost to bypass ISP/DNS/firewall blockades
// and handle special characters in filenames with proper Range support.
app.get('/api/stream/:filename', async (req, res) => {
    try {
        const rawFilename = req.params.filename;
        const encodedFilename = encodeURIComponent(rawFilename);

        // 1. If file exists on local disk, serve locally first
        const localPath = path.join(musicDir, rawFilename);
        if (fs.existsSync(localPath)) {
            return res.sendFile(localPath);
        }
        const rootPath = path.join(__dirname, rawFilename);
        if (fs.existsSync(rootPath)) {
            return res.sendFile(rootPath);
        }

        // 2. Fetch from GitHub Raw
        const githubUrl = `https://raw.githubusercontent.com/sonip362/Video/main/Music/${encodedFilename}`;
        const rangeHeader = req.headers['range'];
        const streamHeaders = {
            'User-Agent': 'Node-Audio-Streamer'
        };
        if (rangeHeader) {
            streamHeaders['Range'] = rangeHeader;
        }

        const audioRes = await fetch(githubUrl, { headers: streamHeaders });
        if (!audioRes.ok && audioRes.status !== 206) {
            return res.status(audioRes.status).send('GitHub stream error');
        }

        res.setHeader('Content-Type', audioRes.headers.get('content-type') || 'audio/mpeg');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Access-Control-Allow-Origin', '*');

        const contentLength = audioRes.headers.get('content-length');
        const contentRange = audioRes.headers.get('content-range');
        if (contentLength) res.setHeader('Content-Length', contentLength);
        if (contentRange) res.setHeader('Content-Range', contentRange);

        res.status(audioRes.status);

        const { Readable } = require('stream');
        Readable.fromWeb(audioRes.body).pipe(res);
    } catch (err) {
        console.error('[Stream Proxy] Error:', err.message);
        if (!res.headersSent) res.status(500).send('Stream proxy error');
    }
});
// ─────────────────────────────────────────────────────────────────────────────

// Video streaming endpoint
app.get('/video', (req, res) => {
    const videoPath = path.join(__dirname, 'videos', 'sample.mp4');
    if (!fs.existsSync(videoPath)) {
        return res.status(404).send("Video file not found");
    }
    const videoSize = fs.statSync(videoPath).size;

    const range = req.headers.range;

    if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : videoSize - 1;
        const chunksize = (end - start) + 1;
        const file = fs.createReadStream(videoPath, { start, end });
        const head = {
            'Content-Range': `bytes ${start}-${end}/${videoSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': 'video/mp4',
        };
        res.writeHead(206, head);
        file.pipe(res);
    } else {
        const head = {
            'Content-Length': videoSize,
            'Content-Type': 'video/mp4',
        };
        res.writeHead(200, head);
        fs.createReadStream(videoPath).pipe(res);
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`GitHub Repository & Local Music Streamer active.`);
});
