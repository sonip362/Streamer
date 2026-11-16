// CDN Base URLs for zero-backend static hosting (GitHub Pages)
const JSDELIVR_BASE = "https://cdn.jsdelivr.net/gh/sonip362/Video@main/Music/";
const GITHUB_RAW_BASE = "https://raw.githubusercontent.com/sonip362/Video/main/Music/";
const GITHUB_BASE = JSDELIVR_BASE; // Default to JSDelivr global edge CDN
const JAMENDO_CLIENT_ID = "8dc02fdd";

// Track list extracted directly from MP3 files or Jamendo API
let playlist = [];
let currentSource = "local"; // 'local', 'jamendo-trending', 'jamendo-phonk', 'jamendo-rock', 'jamendo-pop'

// Default list of MP3 track filenames (scanned from /Music or GitHub repo)
const DEFAULT_MP3_FILES = [
    "headlights.mp3",
    "montagem-alquimia.mp3",
    "montagem-guerreiro.mp3",
    "montagem-pegadora.mp3",
    "montagem-rugada.mp3",
    "montagem-uranium.mp3"
];

// State Management
let currentIndex = 0;
let currentPlayingTrack = null;
let isPlaying = false;
let isShuffle = false;
let repeatMode = 0; // 0 = off, 1 = repeat all, 2 = repeat one
let isAtmos8D = false;
let shuffleOrder = [];
let shuffleIndex = 0;
let atmosAngle = 0;
let selectedTrackForDownload = null;
let toastTimeout = null;
let is8DProcessingAborted = false;

// Audio Settings State
let eqNodes = [];       // BiquadFilterNode array
let mainAudioPathGainNode = null; // GainNode for main dry path
let reverbNode = null;  // ConvolverNode
let reverbFilterNode = null; // BiquadFilterNode lowpass filter
let reverbDelayNode = null; // DelayNode for pre-delay
let reverbGainNode = null;
let currentReverbType = 'none';
let crossfadeDuration = 0; // seconds
let crossfadeTimer = null;
let currentPlaybackRate = 1;


// DOM Elements
const audio = document.getElementById('audioPlayer');
const btnPlayPause = document.getElementById('btnPlayPause');
const playIcon = document.getElementById('playIcon');
const pauseIcon = document.getElementById('pauseIcon');
const btnNext = document.getElementById('btnNext');
const btnPrev = document.getElementById('btnPrev');
const btnShuffle = document.getElementById('btnShuffle');
const btnRepeat = document.getElementById('btnRepeat');
const repeatOneBadge = document.getElementById('repeatOneBadge');
const btnAtmos = document.getElementById('btnAtmos');
const btnMute = document.getElementById('btnMute');
const volumeSlider = document.getElementById('volumeSlider');
const progressBar = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');
const currentTimeEl = document.getElementById('currentTime');
const totalDurationEl = document.getElementById('totalDuration');
const currentTitleEl = document.getElementById('currentTitle');
const currentArtistEl = document.getElementById('currentArtist');
const artworkGenreEl = document.getElementById('artworkGenre');
const playerCard = document.getElementById('playerCard');
const playlistItemsEl = document.getElementById('playlistItems');
const searchInput = document.getElementById('searchInput');
const trackCountBadge = document.getElementById('trackCountBadge');

// Modal & Toast Elements
const downloadModal = document.getElementById('downloadModal');
const modalTrackTitle = document.getElementById('modalTrackTitle');
const modalTrackArtist = document.getElementById('modalTrackArtist');
const btnModalClose = document.getElementById('btnModalClose');
const btnModalCancel = document.getElementById('btnModalCancel');
const btnDownloadNormal = document.getElementById('btnDownloadNormal');
const btnDownloadAdvanced = document.getElementById('btnDownloadAdvanced');

const toastContainer = document.getElementById('toastContainer');
const toastSpinner = document.getElementById('toastSpinner');
const toastMessage = document.getElementById('toastMessage');
const toastSubtext = document.getElementById('toastSubtext');
const btnToastCancel = document.getElementById('btnToastCancel');

// Spinner & Connection Elements
const spinnerOverlay = document.getElementById('spinnerOverlay');
const spinnerText = document.getElementById('spinnerText');
const streamStatus = document.getElementById('streamStatus');
const statusText = document.getElementById('statusText');

// Helper: Show/Hide Artwork Spinner
function showSpinner(msg = "Loading stream...") {
    if (spinnerText) spinnerText.textContent = msg;
    if (spinnerOverlay) spinnerOverlay.style.display = 'flex';
}

function hideSpinner() {
    if (spinnerOverlay) spinnerOverlay.style.display = 'none';
}

// Helper: Toast Notifications / Mobile Sliding Bottom Sheet Menu
function showToast(title, subtext = "", isProcessing = true) {
    if (toastTimeout) clearTimeout(toastTimeout);
    toastMessage.textContent = title;
    if (toastSubtext) {
        toastSubtext.textContent = subtext;
        toastSubtext.style.display = subtext ? 'block' : 'none';
    }
    toastSpinner.style.display = isProcessing ? 'block' : 'none';
    if (btnToastCancel) btnToastCancel.style.display = isProcessing ? 'block' : 'none';
    toastContainer.classList.add('show');
}

function hideToast(delay = 0) {
    if (delay > 0) {
        toastTimeout = setTimeout(() => {
            toastContainer.classList.remove('show');
        }, delay);
    } else {
        toastContainer.classList.remove('show');
    }
}

// Helper: Format Time (seconds -> M:SS)
function formatTime(secs) {
    if (isNaN(secs) || secs < 0) return "0:00";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// --- ID3v2 Tag Reader directly from MP3 file bytes ---
function parseID3Tags(arrayBuffer) {
    const data = new DataView(arrayBuffer);
    const result = { title: null, artist: null, album: null, genre: null };

    if (data.byteLength < 10) return result;
    // Magic check "ID3"
    if (data.getUint8(0) !== 73 || data.getUint8(1) !== 68 || data.getUint8(2) !== 51) {
        return result;
    }

    const version = data.getUint8(3);
    const tagSize = ((data.getUint8(6) & 0x7f) << 21) |
        ((data.getUint8(7) & 0x7f) << 14) |
        ((data.getUint8(8) & 0x7f) << 7) |
        (data.getUint8(9) & 0x7f);

    let offset = 10;
    const end = Math.min(data.byteLength, 10 + tagSize);

    while (offset < end - 10) {
        let frameID = "";
        for (let i = 0; i < 4; i++) {
            const charCode = data.getUint8(offset + i);
            if (charCode >= 32 && charCode <= 126) {
                frameID += String.fromCharCode(charCode);
            }
        }

        if (frameID.length < 4) break;

        let frameSize;
        if (version === 4) {
            frameSize = ((data.getUint8(offset + 4) & 0x7f) << 21) |
                ((data.getUint8(offset + 5) & 0x7f) << 14) |
                ((data.getUint8(offset + 6) & 0x7f) << 7) |
                (data.getUint8(offset + 7) & 0x7f);
        } else {
            frameSize = data.getUint32(offset + 4, false);
        }

        if (frameSize <= 0 || offset + 10 + frameSize > data.byteLength) break;

        const frameContentOffset = offset + 10;
        const encoding = data.getUint8(frameContentOffset);
        let text = "";

        try {
            const textBytes = new Uint8Array(arrayBuffer, frameContentOffset + 1, frameSize - 1);
            if (encoding === 0 || encoding === 3) {
                text = new TextDecoder(encoding === 3 ? 'utf-8' : 'iso-8859-1').decode(textBytes);
            } else if (encoding === 1 || encoding === 2) {
                text = new TextDecoder('utf-16').decode(textBytes);
            }
            text = text.replace(/\0/g, '').trim();
        } catch (e) { }

        if (frameID === "TIT2" && text) result.title = text;
        if (frameID === "TPE1" && text) result.artist = text;
        if (frameID === "TALB" && text) result.album = text;
        if (frameID === "TCON" && text) result.genre = text;

        offset += 10 + frameSize;
    }

    return result;
}

// Clean filename to human-readable Title/Artist if ID3 tag is missing
function fallbackMetadataFromFilename(filename) {
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");
    const parts = nameWithoutExt.split(/[-_]/).map(p => p.trim()).filter(Boolean);

    if (parts.length >= 2) {
        const title = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
        return {
            title: title,
            artist: parts[0].toLowerCase().includes("montagem") ? "Funk Brazil" : parts[0],
            genre: filename.includes("montagem") ? "Brazilian Phonk" : "Electronic / Dance"
        };
    }

    const titleFormatted = nameWithoutExt
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, l => l.toUpperCase());

    return {
        title: titleFormatted,
        artist: filename.includes("montagem") ? "Funk Brazil" : "Audio Stream",
        genre: filename.includes("montagem") ? "Brazilian Phonk" : "Electronic / Dance"
    };
}

// Fetch MP3 file header bytes & parse ID3 tags
async function fetchMetadataForMP3(filename) {
    const encodedFilename = encodeURIComponent(filename);
    const jsdelivrUrl = JSDELIVR_BASE + encodedFilename;
    const githubRawUrl = GITHUB_RAW_BASE + encodedFilename;
    const localUrl = "/" + encodedFilename;
    const musicSubfolderUrl = "/Music/" + encodedFilename;

    let arrayBuffer = null;
    let streamUrl = jsdelivrUrl;

    // Try reading header bytes for ID3 tag parsing
    try {
        const res = await fetch(jsdelivrUrl, { headers: { 'Range': 'bytes=0-8192' } });
        if (res.ok || res.status === 206) {
            arrayBuffer = await res.arrayBuffer();
            streamUrl = jsdelivrUrl;
        } else throw new Error();
    } catch (e) {
        try {
            const res = await fetch(githubRawUrl, { headers: { 'Range': 'bytes=0-8192' } });
            if (res.ok || res.status === 206) {
                arrayBuffer = await res.arrayBuffer();
                streamUrl = githubRawUrl;
            } else throw new Error();
        } catch (err) {
            try {
                const res = await fetch(musicSubfolderUrl, { headers: { 'Range': 'bytes=0-8192' } });
                if (res.ok || res.status === 206) {
                    arrayBuffer = await res.arrayBuffer();
                    streamUrl = musicSubfolderUrl;
                }
            } catch (err2) { }
        }
    }

    let parsed = { title: null, artist: null, genre: null };
    if (arrayBuffer) {
        parsed = parseID3Tags(arrayBuffer);
    }

    const fallback = fallbackMetadataFromFilename(filename);

    return {
        id: filename,
        file: filename,
        streamUrl: streamUrl,
        title: parsed.title || fallback.title,
        artist: parsed.artist || fallback.artist,
        genre: parsed.genre || fallback.genre,
        duration: "0:00"
    };
}

// Track deduplication helper using normalized alphanumeric canonical key
function getCanonicalTrackKey(filename) {
    if (!filename) return "";
    return filename
        .normalize('NFC')
        .toLowerCase()
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '');
}

// Load MP3 tracks dynamically directly from files (local disk & GitHub API)
async function loadMP3Tracks() {
    showSpinner("Reading MP3 metadata tags...");
    const seenKeys = new Set();
    const uniqueFiles = [];

    function addFileIfUnique(file) {
        if (!file || typeof file !== 'string') return;
        const normFile = file.normalize('NFC');
        const key = getCanonicalTrackKey(normFile);
        if (key && !seenKeys.has(key)) {
            seenKeys.add(key);
            uniqueFiles.push(normFile);
        }
    }

    // 1. Try local server endpoint /api/tracks
    let serverSuccess = false;
    try {
        const res = await fetch('/api/tracks');
        if (res.ok) {
            const serverFiles = await res.json();
            if (Array.isArray(serverFiles) && serverFiles.length > 0) {
                serverFiles.forEach(addFileIfUnique);
                serverSuccess = true;
            }
        }
    } catch (e) { }

    // 2. If server API didn't return tracks, query direct GitHub Repository Contents API
    if (!serverSuccess || uniqueFiles.length === 0) {
        try {
            const ghRes = await fetch('https://api.github.com/repos/sonip362/Video/contents/Music');
            if (ghRes.ok) {
                const ghData = await ghRes.json();
                if (Array.isArray(ghData)) {
                    ghData.filter(item => item.name && item.name.toLowerCase().endsWith('.mp3'))
                        .forEach(item => addFileIfUnique(item.name));
                }
            }
        } catch (e) { }
    }

    let files = uniqueFiles;

    if (!files || files.length === 0) {
        DEFAULT_MP3_FILES.forEach(addFileIfUnique);
        files = uniqueFiles;
    }

    playlist = [];
    for (const filename of files) {
        const trackMeta = await fetchMetadataForMP3(filename);
        playlist.push(trackMeta);
    }

    generateShuffleOrder();
    if (!currentPlayingTrack && playlist.length > 0) {
        loadTrack(0);
    } else {
        renderPlaylist(searchInput.value);
    }
    hideSpinner();
}

let jamendoOffset = 0;
const PAGE_LIMIT = 50;

// Fetch tracks dynamically from Jamendo API with Pagination
async function fetchJamendoTracks(sourceType, query = "", append = false) {
    showSpinner("Fetching Jamendo music...");
    if (!append) {
        jamendoOffset = 0;
    }

    let url = `https://api.jamendo.com/v3.0/tracks/?client_id=${JAMENDO_CLIENT_ID}&format=json&limit=${PAGE_LIMIT}&offset=${jamendoOffset}&include=musicinfo`;

    if (query && query.trim().length > 0) {
        url += `&search=${encodeURIComponent(query.trim())}`;
    } else if (sourceType === 'jamendo-phonk') {
        url += `&fuzzytags=phonk+electronic+bass+hiphop&order=popularity_total`;
    } else if (sourceType === 'jamendo-rock') {
        url += `&fuzzytags=rock+indie&order=popularity_total`;
    } else if (sourceType === 'jamendo-pop') {
        url += `&fuzzytags=pop+dance&order=popularity_total`;
    } else {
        url += `&order=popularity_total`;
    }

    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Jamendo API error");
        const data = await res.json();
        if (data.results && Array.isArray(data.results)) {
            const newTracks = data.results.map(item => ({
                id: item.id,
                file: item.name,
                // Client-side direct stream for GitHub Pages static hosting
                streamUrl: item.audio,
                downloadUrl: item.audiodownload || item.audio,
                title: item.name,
                artist: item.artist_name,
                genre: (item.musicinfo && item.musicinfo.tags && item.musicinfo.tags.genres && item.musicinfo.tags.genres[0]) ? item.musicinfo.tags.genres[0].toUpperCase() : "JAMENDO",
                duration: formatTime(item.duration),
                coverUrl: item.album_image || item.image,
                sourceTag: "Jamendo"
            }));

            if (append) {
                playlist = playlist.concat(newTracks);
            } else {
                playlist = newTracks;
            }

            jamendoOffset += data.results.length;

            const loadMoreContainer = document.getElementById('loadMoreContainer');
            if (loadMoreContainer) {
                loadMoreContainer.style.display = data.results.length >= PAGE_LIMIT ? 'flex' : 'none';
            }

            generateShuffleOrder();
            if (!append && !currentPlayingTrack && playlist.length > 0) {
                loadTrack(0);
            } else {
                renderPlaylist(searchInput.value);
            }

            if (playlist.length === 0) {
                playlistItemsEl.innerHTML = `<li class="playlist-item" style="justify-content:center; color: var(--text-muted);">No Jamendo tracks found</li>`;
                trackCountBadge.textContent = "0 Tracks";
            }
        }
    } catch (err) {
        console.error("Jamendo fetch failed:", err);
        showToast("Jamendo Connection Error", "Loading local MP3 tracks...", false);
        hideToast(2500);
        loadMP3Tracks();
    } finally {
        hideSpinner();
    }
}

const btnLoadMore = document.getElementById('btnLoadMore');
if (btnLoadMore) {
    btnLoadMore.addEventListener('click', () => {
        if (currentSource !== 'local') {
            fetchJamendoTracks(currentSource, searchInput.value, true);
        }
    });
}

const btnRefreshTracks = document.getElementById('btnRefreshTracks');
if (btnRefreshTracks) {
    btnRefreshTracks.addEventListener('click', () => {
        if (currentSource === 'local') {
            loadMP3Tracks();
            showToast("Syncing MP3 Tracks", "Reading metadata from GitHub & disk...", false);
        } else {
            fetchJamendoTracks(currentSource, searchInput.value);
            showToast("Refreshing Jamendo", "Fetching latest Jamendo tracks...", false);
        }
        hideToast(2000);
    });
}

const playlistTabs = document.getElementById('playlistTabs');
if (playlistTabs) {
    playlistTabs.addEventListener('click', (e) => {
        const chip = e.target.closest('.tab-chip');
        if (!chip) return;
        document.querySelectorAll('.tab-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        currentSource = chip.dataset.source;
        searchInput.value = "";
        if (currentSource === 'local') {
            const loadMoreContainer = document.getElementById('loadMoreContainer');
            if (loadMoreContainer) loadMoreContainer.style.display = 'none';
            loadMP3Tracks();
        } else {
            fetchJamendoTracks(currentSource);
        }
    });
}

// --- Minimalist Line Wave Bars Canvas Visualizer & Dual-Path Spatial Audio ---
const canvas = document.getElementById('liveWaveCanvas');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
    if (!canvas) return;
    canvas.width = canvas.offsetWidth * (window.devicePixelRatio || 1);
    canvas.height = canvas.offsetHeight * (window.devicePixelRatio || 1);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

let wavePhase = 0;
let audioCtx = null;
let analyser = null;
let pannerNode = null;
let sourceNode = null;
let eqBusNode = null;
let dryGainNode = null;
let atmosGainNode = null;
let compressorNode = null;
let dataArray = null;
let sourceConnected = false;

function initWebAudio() {
    if (audioCtx) {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        return;
    }
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioCtx();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;

        pannerNode = audioCtx.createPanner();
        pannerNode.panningModel = 'HRTF';
        pannerNode.distanceModel = 'linear';
        pannerNode.rolloffFactor = 0;
        pannerNode.coneOuterGain = 1;

        if (pannerNode.positionX) {
            pannerNode.positionX.value = 0;
            pannerNode.positionY.value = 0;
            pannerNode.positionZ.value = 1;
        } else {
            pannerNode.setPosition(0, 0, 1);
        }

        // Dynamics compressor to prevent clipping/cracking
        compressorNode = audioCtx.createDynamicsCompressor();
        compressorNode.threshold.value = -24;
        compressorNode.knee.value = 12;
        compressorNode.ratio.value = 8;
        compressorNode.attack.value = 0.003;
        compressorNode.release.value = 0.15;

        dryGainNode = audioCtx.createGain();
        dryGainNode.gain.value = isAtmos8D ? 0.0 : 1.0;

        atmosGainNode = audioCtx.createGain();
        atmosGainNode.gain.value = isAtmos8D ? 1.3 : 0.0;

        sourceNode = audioCtx.createMediaElementSource(audio);
        eqBusNode = audioCtx.createGain();
        eqBusNode.gain.value = 1.0;

        // Route: sourceNode -> [EQ chain or direct] -> eqBusNode
        sourceNode.connect(eqBusNode);

        // From eqBusNode, audio feeds BOTH Stereo and 8D Atmos paths!
        // Dry Stereo path: eqBusNode -> dryGainNode -> analyser
        eqBusNode.connect(dryGainNode);
        dryGainNode.connect(analyser);

        // 8D Spatial path: eqBusNode -> pannerNode -> atmosGainNode -> compressorNode -> analyser
        eqBusNode.connect(pannerNode);
        pannerNode.connect(atmosGainNode);
        atmosGainNode.connect(compressorNode);
        compressorNode.connect(analyser);

        analyser.connect(audioCtx.destination);

        dataArray = new Uint8Array(analyser.frequencyBinCount);
        sourceConnected = true;
    } catch (e) {
        console.log("WebAudio setup info:", e);
    }
}

function updateDolbyAtmos8D() {
    if (isAtmos8D && pannerNode && isPlaying) {
        atmosAngle += 0.014;
        const radius = 1.5;
        const x = Math.sin(atmosAngle) * radius;
        const z = Math.cos(atmosAngle) * radius;
        // Vertical Y-axis oscillation for overhead/below immersive effect
        const y = Math.sin(atmosAngle * 0.45) * 1.2;

        if (pannerNode.positionX) {
            pannerNode.positionX.value = x;
            pannerNode.positionY.value = y;
            pannerNode.positionZ.value = z;
        } else {
            pannerNode.setPosition(x, y, z);
        }
    }
}

function drawLiveWaves() {
    requestAnimationFrame(drawLiveWaves);

    updateDolbyAtmos8D();

    const w = canvas.width;
    const h = canvas.height;

    if (w === 0 || h === 0) return;

    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#F8FAF9';
    ctx.fillRect(0, 0, w, h);

    let freqSum = 0;
    if (sourceConnected && analyser && isPlaying) {
        analyser.getByteFrequencyData(dataArray);
        for (let i = 0; i < dataArray.length; i++) {
            freqSum += dataArray[i];
        }
    }

    const intensity = isPlaying ? (freqSum > 0 ? (freqSum / dataArray.length) / 255 : 0.65) : 0.08;
    wavePhase += isPlaying ? 0.09 : 0.02;

    const dpr = window.devicePixelRatio || 1;
    const centerY = h / 2;

    ctx.beginPath();
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeStyle = '#CBD5E1';
    ctx.moveTo(0, centerY);
    ctx.lineTo(w, centerY);
    ctx.stroke();

    const numBars = Math.min(30, Math.max(16, Math.floor(w / (10 * dpr))));
    const gap = Math.max(2 * dpr, (w * 0.20) / (numBars + 1));
    const barWidth = Math.max(2 * dpr, (w - (numBars + 1) * gap) / numBars);

    for (let i = 0; i < numBars; i++) {
        let barHeight;
        if (sourceConnected && dataArray && dataArray[i] > 0) {
            barHeight = (dataArray[i] / 255) * (h * 0.48);
        } else {
            const sinVal = Math.sin(wavePhase + i * 0.4);
            const cosVal = Math.cos(wavePhase * 0.75 + i * 0.3);
            barHeight = isPlaying
                ? (Math.abs(sinVal + cosVal) / 2 + 0.15) * (h * 0.45)
                : 4 * dpr;
        }

        const x = gap + i * (barWidth + gap);
        const yTop = centerY - barHeight / 2;

        ctx.fillStyle = (i % 2 === 0) ? '#06B6D4' : '#38BDF8';

        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(x, yTop, barWidth, Math.max(3 * dpr, barHeight), 2 * dpr);
            ctx.fill();
        } else {
            ctx.fillRect(x, yTop, barWidth, Math.max(3 * dpr, barHeight));
        }
    }
}

drawLiveWaves();

function generateShuffleOrder() {
    shuffleOrder = Array.from({ length: playlist.length }, (_, i) => i);
    for (let i = shuffleOrder.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffleOrder[i], shuffleOrder[j]] = [shuffleOrder[j], shuffleOrder[i]];
    }
    shuffleIndex = shuffleOrder.indexOf(currentIndex);
    if (shuffleIndex === -1) shuffleIndex = 0;
}

function openDownloadModal(track) {
    selectedTrackForDownload = track;
    modalTrackTitle.textContent = track.title;
    modalTrackTitle.title = track.title;
    modalTrackArtist.textContent = track.artist;
    modalTrackArtist.title = track.artist;
    downloadModal.style.display = 'flex';
    void downloadModal.offsetHeight;
    downloadModal.classList.add('show');
}

function closeDownloadModal() {
    downloadModal.classList.remove('show');
    setTimeout(() => {
        if (!downloadModal.classList.contains('show')) {
            downloadModal.style.display = 'none';
            selectedTrackForDownload = null;
        }
    }, 300);
}

function triggerDownload(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1;
    const bitDepth = 16;
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;

    const length = buffer.length;
    const dataByteCount = length * blockAlign;
    const headerByteCount = 44;
    const totalByteCount = headerByteCount + dataByteCount;

    const arrayBuffer = new ArrayBuffer(totalByteCount);
    const view = new DataView(arrayBuffer);

    function writeString(offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataByteCount, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, dataByteCount, true);

    const channels = [];
    for (let i = 0; i < numChannels; i++) {
        channels.push(buffer.getChannelData(i));
    }

    let offset = 44;
    for (let i = 0; i < length; i++) {
        for (let ch = 0; ch < numChannels; ch++) {
            let sample = channels[ch][i];
            sample = Math.max(-1, Math.min(1, sample));
            sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
            view.setInt16(offset, sample, true);
            offset += 2;
        }
    }
    return new Blob([arrayBuffer], { type: 'audio/wav' });
}

async function processAndDownload8D(track) {
    is8DProcessingAborted = false;
    closeDownloadModal();
    showToast(`Processing 8D Spatial Audio`, `Track: ${track.title}`, true);

    try {
        const streamUrl = track.streamUrl || (GITHUB_BASE + track.file);

        let response;
        try {
            response = await fetch(streamUrl);
            if (!response.ok) throw new Error("Fetch failed");
        } catch (e) {
            response = await fetch(GITHUB_BASE + track.file);
        }

        if (is8DProcessingAborted) return;

        const arrayBuf = await response.arrayBuffer();

        if (is8DProcessingAborted) return;

        showToast(`Rendering 360° Spatial Orbit`, `Synthesizing HRTF binaural filters...`, true);

        const tempAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const decodedBuffer = await tempAudioCtx.decodeAudioData(arrayBuf);
        tempAudioCtx.close();

        if (is8DProcessingAborted) return;

        const sampleRate = decodedBuffer.sampleRate;
        const duration = decodedBuffer.duration;
        const offlineCtx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);

        const source = offlineCtx.createBufferSource();
        source.buffer = decodedBuffer;

        const panner = offlineCtx.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'linear';
        panner.rolloffFactor = 0;
        panner.coneOuterGain = 1;

        const gain = offlineCtx.createGain();
        gain.gain.value = 1.3;

        // Dynamics compressor to prevent clipping in offline render
        const offlineCompressor = offlineCtx.createDynamicsCompressor();
        offlineCompressor.threshold.value = -24;
        offlineCompressor.knee.value = 12;
        offlineCompressor.ratio.value = 8;
        offlineCompressor.attack.value = 0.003;
        offlineCompressor.release.value = 0.15;

        source.connect(panner);
        panner.connect(gain);
        gain.connect(offlineCompressor);
        offlineCompressor.connect(offlineCtx.destination);

        const timeStep = 0.05;
        let angle = 0;
        for (let t = 0; t < duration; t += timeStep) {
            angle += 0.014 * (timeStep / (1 / 60));
            const radius = 1.5;
            const x = Math.sin(angle) * radius;
            const z = Math.cos(angle) * radius;
            const y = Math.sin(angle * 0.45) * 1.2;
            panner.positionX.setValueAtTime(x, t);
            panner.positionY.setValueAtTime(y, t);
            panner.positionZ.setValueAtTime(z, t);
        }

        source.start(0);

        const renderedBuffer = await offlineCtx.startRendering();

        if (is8DProcessingAborted) return;

        const wavBlob = audioBufferToWav(renderedBuffer);
        const blobUrl = URL.createObjectURL(wavBlob);

        const cleanFileName = `${track.artist} - ${track.title} (8D Spatial).wav`.replace(/[/\\?%*:|"<>]/g, '');
        triggerDownload(blobUrl, cleanFileName);

        showToast(`8D Audio Download Ready!`, `Saved "${cleanFileName}" to downloads`, false);
        hideToast(3500);

    } catch (err) {
        if (is8DProcessingAborted) return;
        console.error("8D Rendering failed:", err);
        showToast(`Error processing 8D audio`, `Downloading normal MP3 instead...`, false);
        triggerDownload(track.streamUrl || (GITHUB_BASE + track.file), `${track.artist} - ${track.title}.mp3`);
        hideToast(3000);
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatPlaylistTitle(title, maxLength = 22) {
    if (!title) return "";
    const cleanTitle = title.trim();
    if (cleanTitle.length <= maxLength) {
        return cleanTitle;
    }
    return `${cleanTitle.substring(0, maxLength - 3).trim()}...`;
}

function formatPlaylistArtist(artist, maxLength = 24) {
    if (!artist) return "--";
    const cleanArtist = artist.trim();
    if (cleanArtist.length <= maxLength) {
        return cleanArtist;
    }
    return `${cleanArtist.substring(0, maxLength - 3).trim()}...`;
}

function renderPlaylist(filterQuery = "") {
    playlistItemsEl.innerHTML = "";
    const filtered = playlist.filter(track =>
        track.title.toLowerCase().includes(filterQuery.toLowerCase()) ||
        track.artist.toLowerCase().includes(filterQuery.toLowerCase())
    );

    trackCountBadge.textContent = `${filtered.length} Track${filtered.length !== 1 ? 's' : ''}`;

    filtered.forEach((track) => {
        const actualIndex = playlist.findIndex(t => t.id === track.id);
        const isActive = currentPlayingTrack && (
            (currentPlayingTrack.id && currentPlayingTrack.id === track.id) ||
            (currentPlayingTrack.title && currentPlayingTrack.title === track.title)
        );

        const formattedTitle = formatPlaylistTitle(track.title, 22);
        const formattedArtist = formatPlaylistArtist(track.artist, 24);
        const fullTitle = escapeHtml(track.title);
        const fullArtist = escapeHtml(track.artist);

        const li = document.createElement('li');
        li.className = `playlist-item ${isActive ? 'active' : ''} ${isActive && isPlaying ? 'playing' : ''}`;
        li.onclick = () => loadAndPlay(actualIndex);

        li.innerHTML = `
            <div class="item-left">
                <span class="track-number">${actualIndex + 1}</span>
                <div class="playing-equalizer">
                    <div class="eq-bar"></div>
                    <div class="eq-bar"></div>
                    <div class="eq-bar"></div>
                </div>
                <div class="track-details">
                    <span class="item-title" title="${fullTitle}">${escapeHtml(formattedTitle)}</span>
                    <span class="item-artist" title="${fullArtist}">${escapeHtml(formattedArtist)}</span>
                </div>
            </div>
            <div class="item-right">
                <button class="btn-item-menu" title="Track Options" onclick="event.stopPropagation(); handleTrackMenuClick(${actualIndex})">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="12" cy="5" r="2"></circle>
                        <circle cx="12" cy="12" r="2"></circle>
                        <circle cx="12" cy="19" r="2"></circle>
                    </svg>
                </button>
                <span class="source-tag">${track.sourceTag || "MP3 Tag"}</span>
                <span class="item-duration">${track.duration || "0:00"}</span>
            </div>
        `;
        playlistItemsEl.appendChild(li);
    });
}

window.handleTrackMenuClick = function (index) {
    const track = playlist[index];
    if (track) {
        openDownloadModal(track);
    }
};
window.handleDownloadClick = window.handleTrackMenuClick;

btnModalClose.addEventListener('click', closeDownloadModal);
if (btnModalCancel) btnModalCancel.addEventListener('click', closeDownloadModal);

downloadModal.addEventListener('click', (e) => {
    if (e.target === downloadModal) closeDownloadModal();
});

let isMainJobProcessing = false;
let isMainJobAborted = false;
const MAIN_TAB_ID = 'main_tab_' + Math.random().toString(36).substring(2, 10);

function cancelCurrentDownloadJob() {
    isMainJobAborted = true;
    is8DProcessingAborted = true;
    try {
        localStorage.removeItem('streamer_download_job');
        localStorage.setItem('streamer_download_cancelled', Date.now().toString());
    } catch (e) {}
    hideToast(0);
}

if (btnToastCancel) {
    btnToastCancel.addEventListener('click', cancelCurrentDownloadJob);
}

window.addEventListener('storage', (e) => {
    if (e.key === 'streamer_download_cancelled') {
        isMainJobAborted = true;
        is8DProcessingAborted = true;
        hideToast(0);
    }
});

btnDownloadNormal.addEventListener('click', () => {
    if (!selectedTrackForDownload) return;
    const track = selectedTrackForDownload;
    closeDownloadModal();
    const downloadUrl = track.streamUrl || (GITHUB_BASE + track.file);
    const filename = `${track.artist} - ${track.title}.mp3`;
    triggerDownload(downloadUrl, filename);
    showToast(`Downloading MP3...`, `${track.artist} - ${track.title}`, false);
    hideToast(2500);
});

if (btnDownloadAdvanced) {
    btnDownloadAdvanced.addEventListener('click', () => {
        if (!selectedTrackForDownload) return;
        const t = selectedTrackForDownload;
        closeDownloadModal();
        const params = new URLSearchParams({
            title: t.title || '',
            artist: t.artist || '',
            file: t.file || '',
            streamUrl: t.streamUrl || ''
        });
        sessionStorage.setItem('advancedDownloadTrack', JSON.stringify(t));
        window.open(`download.html?${params.toString()}`, '_blank');
    });
}

// =============================================================
// BACKGROUND AUDIO PROCESSING SYNC & TAKEOVER ENGINE
// =============================================================
function generateReverbImpulse(context, duration, decay) {
    const sampleRate = context.sampleRate;
    const length = Math.floor(sampleRate * duration);
    const impulse = context.createBuffer(2, length, sampleRate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);
    for (let i = 0; i < length; i++) {
        const factor = Math.pow(1 - i / length, decay);
        left[i] = (Math.random() * 2 - 1) * factor;
        right[i] = (Math.random() * 2 - 1) * factor;
    }
    return impulse;
}

async function claimAndRunJob(job) {
    if (isMainJobProcessing) return;

    // Check if another tab is already attempting to claim
    if (job.claimingTabId && job.claimingTabId !== MAIN_TAB_ID) return;

    // Tentative claim
    job.claimingTabId = MAIN_TAB_ID;
    job.isAbandoned = false;
    job.lastHeartbeat = Date.now();
    try {
        localStorage.setItem('streamer_download_job', JSON.stringify(job));
    } catch (e) { return; }

    // Wait 120ms to resolve concurrency races across tabs
    await new Promise(r => setTimeout(r, 120));

    try {
        const fresh = JSON.parse(localStorage.getItem('streamer_download_job'));
        if (!fresh || fresh.claimingTabId !== MAIN_TAB_ID || fresh.downloadTriggered || fresh.isComplete) {
            // Another tab claimed it or already finished, back off!
            return;
        }

        // Lock confirmed! Own the job:
        fresh.ownerTabId = MAIN_TAB_ID;
        fresh.claimingTabId = null;
        fresh.ownerType = 'main_page';
        fresh.lastHeartbeat = Date.now();
        localStorage.setItem('streamer_download_job', JSON.stringify(fresh));

        executeOfflineJobInMainPage(fresh);
    } catch (e) {}
}

async function executeOfflineJobInMainPage(job) {
    if (isMainJobProcessing) return;
    isMainJobProcessing = true;
    isMainJobAborted = false;

    function updateMainJobProgress(progress, status) {
        if (isMainJobAborted) return;
        const p = Math.min(100, Math.max(0, Math.round(progress)));
        showToast(`Processing: ${job.title}`, `${status} (${p}%)`, true);
        try {
            job.progress = p;
            job.status = status;
            job.ownerTabId = MAIN_TAB_ID;
            job.ownerType = 'main_page';
            job.lastHeartbeat = Date.now();
            localStorage.setItem('streamer_download_job', JSON.stringify(job));
        } catch (e) {}
    }

    try {
        updateMainJobProgress(15, 'Fetching audio stream...');
        if (isMainJobAborted) return;

        const streamUrl = job.streamUrl || (job.file ? GITHUB_BASE + job.file : '');
        if (!streamUrl) throw new Error('No audio URL found for this track.');

        let response;
        try {
            response = await fetch(streamUrl);
            if (!response.ok) throw new Error('Stream fetch failed');
        } catch (e) {
            if (job.file) {
                response = await fetch(GITHUB_BASE + job.file);
            } else {
                throw e;
            }
        }

        if (isMainJobAborted) return;
        updateMainJobProgress(30, 'Decoding audio data...');

        const arrayBuf = await response.arrayBuffer();
        if (isMainJobAborted) return;

        const decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
        const decodedBuffer = await decodeCtx.decodeAudioData(arrayBuf);
        decodeCtx.close();

        if (isMainJobAborted) return;
        updateMainJobProgress(50, 'Applying audio processing...');

        const settings = job.settings || { eqGains: [0, 0, 0, 0, 0], reverb: 'none', is8D: false, speed: 1.0 };
        const activeSpeed = settings.speed || 1.0;
        const sampleRate = decodedBuffer.sampleRate;
        const originalDuration = decodedBuffer.duration;
        const renderedDuration = originalDuration / activeSpeed;

        const offlineCtx = new OfflineAudioContext(2, Math.floor(sampleRate * renderedDuration), sampleRate);

        const source = offlineCtx.createBufferSource();
        source.buffer = decodedBuffer;
        source.playbackRate.value = activeSpeed;

        // Equalizer Chain
        const frequencies = [60, 250, 1000, 4000, 16000];
        const filterTypes = ['lowshelf', 'peaking', 'peaking', 'peaking', 'highshelf'];
        const eqGains = settings.eqGains || [0, 0, 0, 0, 0];

        const offlineFilters = frequencies.map((freq, i) => {
            const filter = offlineCtx.createBiquadFilter();
            filter.type = filterTypes[i];
            filter.frequency.value = freq;
            filter.gain.value = eqGains[i] || 0;
            if (filterTypes[i] === 'peaking') filter.Q.value = 1.0;
            return filter;
        });

        for (let i = 0; i < offlineFilters.length - 1; i++) {
            offlineFilters[i].connect(offlineFilters[i + 1]);
        }
        source.connect(offlineFilters[0]);
        let lastNode = offlineFilters[offlineFilters.length - 1];

        // Reverb
        const activeReverb = settings.reverb || 'none';
        if (activeReverb !== 'none') {
            if (isMainJobAborted) return;
            updateMainJobProgress(65, 'Synthesizing room reverb...');
            const configs = {
                room: { duration: 0.8, decay: 2.2, wet: 0.35 },
                studio: { duration: 1.3, decay: 2.6, wet: 0.42 },
                hall: { duration: 2.6, decay: 3.2, wet: 0.52 },
                arena: { duration: 4.2, decay: 3.8, wet: 0.60 }
            };
            const cfg = configs[activeReverb] || configs.room;
            const offlineReverb = offlineCtx.createConvolver();
            offlineReverb.buffer = generateReverbImpulse(offlineCtx, cfg.duration, cfg.decay);

            const dryGain = offlineCtx.createGain();
            const wetGain = offlineCtx.createGain();
            dryGain.gain.value = 1.0 - cfg.wet * 0.4;
            wetGain.gain.value = cfg.wet;

            const reverbOutput = offlineCtx.createGain();
            lastNode.connect(dryGain);
            lastNode.connect(offlineReverb);
            offlineReverb.connect(wetGain);

            dryGain.connect(reverbOutput);
            wetGain.connect(reverbOutput);
            lastNode = reverbOutput;
        }

        // 8D Orbit
        if (settings.is8D) {
            if (isMainJobAborted) return;
            updateMainJobProgress(78, 'Rendering 360° spatial orbit...');
            const panner = offlineCtx.createPanner();
            panner.panningModel = 'HRTF';
            panner.distanceModel = 'linear';
            panner.rolloffFactor = 0;
            panner.coneOuterGain = 1;

            const timeStep = 0.05;
            let angle = 0;
            for (let t = 0; t < renderedDuration; t += timeStep) {
                angle += 0.035 * (timeStep / (1 / 60));
                const radius = 1.6;
                const x = Math.sin(angle) * radius;
                const z = Math.cos(angle) * radius;
                const y = Math.sin(angle * 0.5) * 0.8;

                panner.positionX.setValueAtTime(x, t);
                panner.positionY.setValueAtTime(y, t);
                panner.positionZ.setValueAtTime(z, t);
            }
            lastNode.connect(panner);
            lastNode = panner;
        }

        const compressor = offlineCtx.createDynamicsCompressor();
        compressor.threshold.value = -24;
        compressor.knee.value = 12;
        compressor.ratio.value = 8;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.15;
        lastNode.connect(compressor);
        compressor.connect(offlineCtx.destination);

        source.start(0);

        if (isMainJobAborted) return;
        updateMainJobProgress(88, 'Rendering audio in browser...');

        const renderedBuffer = await offlineCtx.startRendering();

        if (isMainJobAborted) return;
        updateMainJobProgress(96, 'Encoding 16-bit WAV file...');

        const wavBlob = audioBufferToWav(renderedBuffer);
        const downloadUrl = URL.createObjectURL(wavBlob);

        const cleanTitle = (job.title || 'Audio').replace(/[/\\?%*:|"<>]/g, '');
        const cleanArtist = (job.artist || 'Artist').replace(/[/\\?%*:|"<>]/g, '');
        const filename = `${cleanArtist} - ${cleanTitle} (Custom).wav`;

        if (isMainJobAborted) return;

        // ATOMIC DOWNLOAD CHECK TO PREVENT DUPLICATES
        try {
            const checkJob = JSON.parse(localStorage.getItem('streamer_download_job'));
            if (checkJob && (checkJob.downloadTriggered || checkJob.isCancelled)) {
                console.log("Download already triggered or cancelled. Skipping duplicate.");
                return;
            }
            if (checkJob) {
                checkJob.downloadTriggered = true;
                checkJob.isComplete = true;
                localStorage.setItem('streamer_download_job', JSON.stringify(checkJob));
            }
        } catch (e) {}

        triggerDownload(downloadUrl, filename);

        showToast(`Download Ready: ${job.title}`, `Saved "${filename}" to downloads`, false);
        hideToast(3500);

        setTimeout(() => {
            try { localStorage.removeItem('streamer_download_job'); } catch (e) {}
        }, 3500);

    } catch (err) {
        if (isMainJobAborted) return;
        console.error('Background render error:', err);
        showToast('Processing Error', 'Could not complete background render', false);
        hideToast(3000);
        try { localStorage.removeItem('streamer_download_job'); } catch (e) {}
    } finally {
        isMainJobProcessing = false;
    }
}

function checkBackgroundDownloadJob() {
    try {
        const stored = localStorage.getItem('streamer_download_job');
        if (!stored) {
            if (isMainJobProcessing) {
                isMainJobAborted = true;
                isMainJobProcessing = false;
                hideToast(0);
            }
            return;
        }

        const job = JSON.parse(stored);
        if (!job || !job.timestamp) return;

        // Expire jobs older than 3 minutes or cancelled
        if (job.isCancelled || (Date.now() - job.timestamp > 180000)) {
            isMainJobAborted = true;
            isMainJobProcessing = false;
            hideToast(0);
            localStorage.removeItem('streamer_download_job');
            return;
        }

        // If completed or download already triggered
        if (job.isComplete || job.downloadTriggered) {
            showToast(`Download Ready: ${job.title}`, `Processed audio saved successfully`, false);
            hideToast(3500);
            setTimeout(() => {
                try { localStorage.removeItem('streamer_download_job'); } catch (e) {}
            }, 3500);
            return;
        }

        // Active Job: update UI toast
        showToast(`Processing: ${job.title}`, `${job.status} (${job.progress}%)`, true);

        // Check if an active worker currently owns this job and is alive (10s threshold)
        const hasLivingOwner = job.ownerTabId && (Date.now() - (job.lastHeartbeat || 0) < 10000) && !job.isAbandoned;

        // If this tab is the owner, refresh our heartbeat
        if (job.ownerTabId === MAIN_TAB_ID && isMainJobProcessing) {
            job.lastHeartbeat = Date.now();
            localStorage.setItem('streamer_download_job', JSON.stringify(job));
            return;
        }

        // If no living owner and we are not already processing, attempt atomic claim
        if (!hasLivingOwner && !isMainJobProcessing) {
            claimAndRunJob(job);
        }

    } catch (e) {
        console.warn('Storage sync error:', e);
    }
}

window.addEventListener('storage', (e) => {
    if (e.key === 'streamer_download_job') {
        checkBackgroundDownloadJob();
    }
});

// Periodic check for same-origin tabs
setInterval(checkBackgroundDownloadJob, 1000);
checkBackgroundDownloadJob();

function loadTrack(index) {
    if (!playlist || playlist.length === 0) return;
    currentIndex = index;
    const track = playlist[currentIndex];
    currentPlayingTrack = track;

    const encodedFile = encodeURIComponent(track.file);
    const jsdelivrUrl = JSDELIVR_BASE + encodedFile;
    const rawGithubUrl = GITHUB_RAW_BASE + encodedFile;
    const streamUrl = track.streamUrl || jsdelivrUrl;

    showSpinner("Loading audio stream...");
    audio.src = streamUrl;

    let fallbackStage = 0;
    audio.onerror = (e) => {
        if (!navigator.onLine) {
            showSpinner("No Internet Connection");
            if (streamStatus) streamStatus.classList.add('offline');
            if (statusText) statusText.textContent = "Offline • No Internet";
            return;
        }
        console.warn(`Stream failed for ${audio.src}, trying CDN fallback stage ${fallbackStage + 1}`);

        if (fallbackStage === 0) {
            fallbackStage = 1;
            // Try GitHub Raw CDN
            const next = audio.src.includes('cdn.jsdelivr.net') ? rawGithubUrl : jsdelivrUrl;
            console.log("Switching audio source to:", next);
            audio.src = next;
            if (isPlaying) audio.play().catch(err => console.error(err));
        } else if (fallbackStage === 1 && currentSource === 'local') {
            fallbackStage = 2;
            // Try relative static path (if hosted directly with files on GitHub Pages or local)
            const next = 'Music/' + encodedFile;
            console.log("Switching audio source to relative path:", next);
            audio.src = next;
            if (isPlaying) audio.play().catch(err => console.error(err));
        } else {
            console.error("All static stream mirrors failed for track:", track.file);
            hideSpinner();
            showToast("Stream Error", "Audio stream could not be loaded from CDN", false);
            hideToast(3000);
        }
    };

    const artworkContainer = document.querySelector('.artwork-container');
    if (artworkContainer) {
        if (track.coverUrl) {
            artworkContainer.style.backgroundImage = `linear-gradient(rgba(15,23,42,0.15), rgba(15,23,42,0.35)), url('${track.coverUrl}')`;
            artworkContainer.style.backgroundSize = 'cover';
            artworkContainer.style.backgroundPosition = 'center';
        } else {
            artworkContainer.style.backgroundImage = 'none';
        }
    }

    currentTitleEl.textContent = formatPlaylistTitle(track.title, 26);
    currentTitleEl.title = track.title;
    currentArtistEl.textContent = formatPlaylistArtist(track.artist, 28);
    currentArtistEl.title = track.artist;
    artworkGenreEl.textContent = track.genre;
    totalDurationEl.textContent = track.duration || "0:00";
    progressFill.style.width = "0%";
    currentTimeEl.textContent = "0:00";

    renderPlaylist(searchInput.value);
}

function loadAndPlay(index) {
    loadTrack(index);
    playAudio();
}

function playAudio() {
    initWebAudioAndEQ();
    showSpinner("Connecting audio stream...");
    audio.play().then(() => {
        isPlaying = true;
        hideSpinner();
        playIcon.style.display = 'none';
        pauseIcon.style.display = 'block';
        playerCard.classList.add('playing');
        renderPlaylist(searchInput.value);
    }).catch(err => {
        console.log("Playback error or autoplay blocked:", err);
        if (!navigator.onLine) {
            showSpinner("No Internet Connection");
        } else {
            hideSpinner();
        }
    });
}

function pauseAudio() {
    audio.pause();
    isPlaying = false;
    hideSpinner();
    playIcon.style.display = 'block';
    pauseIcon.style.display = 'none';
    playerCard.classList.remove('playing');
    renderPlaylist(searchInput.value);
}

function togglePlayPause() {
    if (isPlaying) {
        pauseAudio();
    } else {
        playAudio();
    }
}

function nextTrack() {
    if (playlist.length === 0) return;

    if (isShuffle) {
        shuffleIndex = (shuffleIndex + 1) % shuffleOrder.length;
        currentIndex = shuffleOrder[shuffleIndex];
    } else {
        if (currentIndex >= playlist.length - 1) {
            if (repeatMode === 1) {
                currentIndex = 0;
            } else {
                pauseAudio();
                return;
            }
        } else {
            currentIndex = currentIndex + 1;
        }
    }
    loadAndPlay(currentIndex);
}

function prevTrack() {
    if (playlist.length === 0) return;

    if (audio.currentTime > 3) {
        audio.currentTime = 0;
    } else {
        if (isShuffle) {
            shuffleIndex = (shuffleIndex - 1 + shuffleOrder.length) % shuffleOrder.length;
            currentIndex = shuffleOrder[shuffleIndex];
        } else {
            currentIndex = (currentIndex - 1 + playlist.length) % playlist.length;
        }
        loadAndPlay(currentIndex);
    }
}

btnPlayPause.addEventListener('click', togglePlayPause);
btnNext.addEventListener('click', nextTrack);
btnPrev.addEventListener('click', prevTrack);

btnShuffle.addEventListener('click', (e) => {
    isShuffle = !isShuffle;
    btnShuffle.classList.toggle('active', isShuffle);
    btnShuffle.title = `Shuffle: ${isShuffle ? 'ON' : 'OFF'}`;
    if (isShuffle) {
        generateShuffleOrder();
    }
    btnShuffle.blur();
});

btnRepeat.addEventListener('click', (e) => {
    repeatMode = (repeatMode + 1) % 3;
    if (repeatMode === 0) {
        btnRepeat.classList.remove('active');
        btnRepeat.title = "Repeat: OFF";
        repeatOneBadge.style.display = 'none';
    } else if (repeatMode === 1) {
        btnRepeat.classList.add('active');
        btnRepeat.title = "Repeat: ALL";
        repeatOneBadge.style.display = 'none';
    } else {
        btnRepeat.classList.add('active');
        btnRepeat.title = "Repeat: ONE";
        repeatOneBadge.style.display = 'flex';
    }
    btnRepeat.blur();
});

btnAtmos.addEventListener('click', (e) => {
    initWebAudioAndEQ();
    isAtmos8D = !isAtmos8D;
    btnAtmos.classList.toggle('active', isAtmos8D);
    btnAtmos.title = `Dolby Atmos 8D Spatial Audio: ${isAtmos8D ? 'ON' : 'OFF'}`;

    if (dryGainNode && atmosGainNode && audioCtx) {
        const now = audioCtx.currentTime;
        if (isAtmos8D) {
            dryGainNode.gain.setTargetAtTime(0.0, now, 0.03);
            atmosGainNode.gain.setTargetAtTime(1.3, now, 0.03);
        } else {
            dryGainNode.gain.setTargetAtTime(1.0, now, 0.03);
            atmosGainNode.gain.setTargetAtTime(0.0, now, 0.03);
        }
    }
    btnAtmos.blur();
});

audio.addEventListener('loadedmetadata', () => {
    if (audio.duration && !isNaN(audio.duration)) {
        const formatted = formatTime(audio.duration);
        totalDurationEl.textContent = formatted;
        if (playlist[currentIndex]) {
            playlist[currentIndex].duration = formatted;
            renderPlaylist(searchInput.value);
        }
    }
});

audio.addEventListener('waiting', () => showSpinner("Buffering audio..."));
audio.addEventListener('stalled', () => showSpinner("Connecting stream..."));
audio.addEventListener('canplay', () => hideSpinner());
audio.addEventListener('playing', () => hideSpinner());

window.addEventListener('offline', () => {
    showSpinner("No Internet Connection");
    if (streamStatus) streamStatus.classList.add('offline');
    if (statusText) statusText.textContent = "Offline • No Internet";
});

window.addEventListener('online', () => {
    hideSpinner();
    if (streamStatus) streamStatus.classList.remove('offline');
    if (statusText) statusText.textContent = "GitHub Raw Stream • Connected";
});

audio.addEventListener('timeupdate', () => {
    if (audio.duration) {
        const percent = (audio.currentTime / audio.duration) * 100;
        progressFill.style.width = `${percent}%`;
        currentTimeEl.textContent = formatTime(audio.currentTime);
        totalDurationEl.textContent = formatTime(audio.duration);
    }
});

progressBar.addEventListener('click', (e) => {
    const rect = progressBar.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;
    if (audio.duration) {
        audio.currentTime = (clickX / width) * audio.duration;
    }
});

audio.addEventListener('ended', () => {
    if (repeatMode === 2) {
        audio.currentTime = 0;
        playAudio();
    } else {
        nextTrack();
    }
});

volumeSlider.addEventListener('input', (e) => {
    audio.volume = e.target.value;
});

btnMute.addEventListener('click', () => {
    audio.muted = !audio.muted;
    btnMute.style.opacity = audio.muted ? '0.4' : '1';
});

let searchDebounceTimeout = null;
searchInput.addEventListener('input', (e) => {
    const q = e.target.value;
    if (currentSource === 'local') {
        renderPlaylist(q);
    } else {
        if (searchDebounceTimeout) clearTimeout(searchDebounceTimeout);
        searchDebounceTimeout = setTimeout(() => {
            fetchJamendoTracks(currentSource, q);
        }, 400);
    }
});

document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') {
        e.preventDefault();
        togglePlayPause();
    } else if (e.code === 'ArrowRight') {
        audio.currentTime = Math.min(audio.currentTime + 5, audio.duration);
    } else if (e.code === 'ArrowLeft') {
        audio.currentTime = Math.max(audio.currentTime - 5, 0);
    } else if (e.key === 'n' || e.key === 'N') {
        nextTrack();
    } else if (e.key === 'p' || e.key === 'P') {
        prevTrack();
    }
});

// Load tracks directly from MP3 files with ID3 tag parsing
loadMP3Tracks();

// --- PWA Service Worker Registration ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => {
                console.log('PWA ServiceWorker registered with scope:', reg.scope);
            })
            .catch(err => {
                console.error('ServiceWorker registration failed:', err);
            });
    });
}

// =============================================================
// AUDIO SETTINGS PANEL
// =============================================================

// --- Settings Panel Toggle ---
const btnSettingsToggle = document.getElementById('btnSettingsToggle');
const btnPlayerSettings = document.getElementById('btnPlayerSettings');
const settingsPanel = document.getElementById('settingsPanel');

function toggleAudioSettingsPanel() {
    if (!settingsPanel) return;
    const isOpen = settingsPanel.classList.toggle('open');
    if (btnSettingsToggle) btnSettingsToggle.classList.toggle('active', isOpen);
    if (btnPlayerSettings) btnPlayerSettings.classList.toggle('active', isOpen);
    if (isOpen) {
        settingsPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

if (btnSettingsToggle) btnSettingsToggle.addEventListener('click', toggleAudioSettingsPanel);
if (btnPlayerSettings) btnPlayerSettings.addEventListener('click', toggleAudioSettingsPanel);

// --- EQ: 5-Band BiquadFilter ---
// Frequencies: 60Hz (lowshelf), 250Hz (peaking), 1kHz (peaking), 4kHz (peaking), 16kHz (highshelf)
const EQ_BANDS = [
    { id: 'eq60', freq: 60, type: 'lowshelf' },
    { id: 'eq250', freq: 250, type: 'peaking' },
    { id: 'eq1k', freq: 1000, type: 'peaking' },
    { id: 'eq4k', freq: 4000, type: 'peaking' },
    { id: 'eq16k', freq: 16000, type: 'highshelf' },
];

const EQ_PRESETS = {
    flat: [0, 0, 0, 0, 0],
    bass: [8, 5, 0, -2, -3],
    treble: [-3, -2, 0, 5, 8],
    vocal: [-4, -2, 5, 4, 2],
    rock: [6, 3, -2, 4, 6],
};

function setupEQNodes() {
    if (!audioCtx || !sourceNode || !eqBusNode) return;
    eqNodes = EQ_BANDS.map(band => {
        const filter = audioCtx.createBiquadFilter();
        filter.type = band.type;
        filter.frequency.value = band.freq;
        filter.gain.value = 0;
        filter.Q.value = 1.4;
        return filter;
    });

    // Re-route source through EQ chain into eqBusNode:
    // sourceNode -> eq[0] -> eq[1] -> ... -> eq[last] -> eqBusNode
    try {
        sourceNode.disconnect();
    } catch (e) {}

    let prev = sourceNode;
    eqNodes.forEach(node => {
        prev.connect(node);
        prev = node;
    });
    prev.connect(eqBusNode);

    // Apply current slider values to the newly created EQ nodes
    EQ_BANDS.forEach((band, i) => {
        const slider = document.getElementById(band.id);
        if (slider) {
            applyEQBand(i, parseFloat(slider.value) || 0);
        }
    });

    // Re-apply reverb so it feeds from eqBusNode
    applyReverbRouting();
}

function applyEQBand(index, gainDb) {
    if (eqNodes.length === 0) {
        // EQ not initialized yet — will be initialized once audio starts
        return;
    }
    if (eqNodes[index]) {
        eqNodes[index].gain.value = gainDb;
    }
}

// Sync EQ sliders with nodes
EQ_BANDS.forEach((band, i) => {
    const slider = document.getElementById(band.id);
    const valEl = document.getElementById(band.id + 'Val');
    if (!slider) return;
    slider.addEventListener('input', () => {
        const v = parseFloat(slider.value);
        if (valEl) valEl.textContent = (v >= 0 ? '+' : '') + v;
        applyEQBand(i, v);
        // Deactivate preset chips
        document.querySelectorAll('.eq-preset-chip').forEach(c => c.classList.remove('active'));
        document.querySelector('.eq-preset-chip[data-preset="flat"]')?.classList.remove('active');
    });
});

// EQ Preset Chips
document.querySelectorAll('.eq-preset-chip').forEach(chip => {
    chip.addEventListener('click', () => {
        const preset = chip.dataset.preset;
        const gains = EQ_PRESETS[preset] || EQ_PRESETS.flat;
        EQ_BANDS.forEach((band, i) => {
            const slider = document.getElementById(band.id);
            const valEl = document.getElementById(band.id + 'Val');
            if (slider) slider.value = gains[i];
            if (valEl) valEl.textContent = (gains[i] >= 0 ? '+' : '') + gains[i];
            applyEQBand(i, gains[i]);
        });
        document.querySelectorAll('.eq-preset-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
    });
});

// --- Playback Speed ---
document.querySelectorAll('.speed-chip').forEach(chip => {
    chip.addEventListener('click', () => {
        currentPlaybackRate = parseFloat(chip.dataset.speed);
        audio.playbackRate = currentPlaybackRate;
        document.querySelectorAll('.speed-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const badge = document.getElementById('speedBadge');
        if (badge) badge.textContent = currentPlaybackRate + '×';
    });
});

// --- Reverb (Algorithmic Convolver) ---
function buildImpulseResponse(ctx, duration, decay) {
    const sampleRate = ctx.sampleRate;
    const length = Math.floor(sampleRate * duration);
    const impulse = ctx.createBuffer(2, length, sampleRate);

    for (let ch = 0; ch < 2; ch++) {
        const channel = impulse.getChannelData(ch);
        for (let i = 0; i < length; i++) {
            const time = i / sampleRate;
            // Exponential decay envelope for realistic acoustic tails
            const decayEnvelope = Math.exp(-time * (4.5 / duration));

            // Random white noise
            const noise = (Math.random() * 2 - 1);

            // Early reflections (dense initial echoes for room acoustics)
            let reflection = 0;
            if (time < 0.08 && (i % 250 === 0 || i % 370 === 0)) {
                reflection = (Math.random() * 2 - 1) * 0.9;
            }

            channel[i] = (noise * 0.7 + reflection * 0.5) * decayEnvelope;
        }
    }
    return impulse;
}

const REVERB_SETTINGS = {
    none: { dry: 1.00, wet: 0.00, delay: 0.000, duration: 0, decay: 0, cutoff: 20000 },
    room: { dry: 0.85, wet: 0.70, delay: 0.015, duration: 1.2, decay: 2.5, cutoff: 4200 },
    studio: { dry: 0.80, wet: 0.85, delay: 0.025, duration: 1.8, decay: 3.0, cutoff: 5500 },
    hall: { dry: 0.60, wet: 1.15, delay: 0.045, duration: 3.4, decay: 2.0, cutoff: 3500 },
    arena: { dry: 0.40, wet: 1.50, delay: 0.065, duration: 5.5, decay: 1.3, cutoff: 2600 },
};

function applyReverbRouting() {
    if (!audioCtx) return;

    // Disconnect any old reverb nodes
    if (reverbNode) { try { reverbNode.disconnect(); } catch (e) { } }
    if (reverbFilterNode) { try { reverbFilterNode.disconnect(); } catch (e) { } }
    if (reverbGainNode) { try { reverbGainNode.disconnect(); } catch (e) { } }
    if (reverbDelayNode) { try { reverbDelayNode.disconnect(); } catch (e) { } }

    const settings = REVERB_SETTINGS[currentReverbType] || REVERB_SETTINGS.none;

    // Dynamically balance main path volume when reverb is active
    if (eqBusNode) {
        eqBusNode.gain.value = settings.dry;
    }

    if (currentReverbType === 'none') return;

    reverbDelayNode = audioCtx.createDelay(0.2);
    reverbDelayNode.delayTime.value = settings.delay;

    reverbNode = audioCtx.createConvolver();
    reverbNode.buffer = buildImpulseResponse(audioCtx, settings.duration, settings.decay);

    reverbFilterNode = audioCtx.createBiquadFilter();
    reverbFilterNode.type = 'lowpass';
    reverbFilterNode.frequency.value = settings.cutoff;

    reverbGainNode = audioCtx.createGain();
    reverbGainNode.gain.value = settings.wet;

    // Route: eqBusNode (contains audio + EQ) -> pre-delay -> convolver -> lowpass filter -> wet gain -> analyser
    const reverbSource = eqBusNode || (eqNodes.length > 0 ? eqNodes[eqNodes.length - 1] : dryGainNode);
    if (reverbSource) {
        reverbSource.connect(reverbDelayNode);
        reverbDelayNode.connect(reverbNode);
        reverbNode.connect(reverbFilterNode);
        reverbFilterNode.connect(reverbGainNode);
        reverbGainNode.connect(analyser);
    }
}

document.querySelectorAll('.reverb-chip').forEach(chip => {
    chip.addEventListener('click', () => {
        currentReverbType = chip.dataset.reverb;
        document.querySelectorAll('.reverb-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        if (audioCtx) {
            applyReverbRouting();
        }
    });
});

// --- Crossfade ---
const crossfadeSlider = document.getElementById('crossfadeSlider');
const crossfadeBadge = document.getElementById('crossfadeBadge');
if (crossfadeSlider) {
    crossfadeSlider.addEventListener('input', () => {
        crossfadeDuration = parseFloat(crossfadeSlider.value);
        if (crossfadeBadge) {
            crossfadeBadge.textContent = crossfadeDuration === 0 ? 'Off' : crossfadeDuration + 's';
        }
    });
}

// Crossfade engine — monitors timeupdate to detect near-end and fade volume
audio.addEventListener('timeupdate', () => {
    if (!audio.duration || crossfadeDuration === 0) return;
    const remaining = audio.duration - audio.currentTime;
    if (remaining > 0 && remaining <= crossfadeDuration) {
        // Fade out current track volume
        const fadeFraction = remaining / crossfadeDuration;
        audio.volume = Math.max(0, fadeFraction * (parseFloat(document.getElementById('volumeSlider')?.value ?? 0.8)));
    } else {
        // Restore full volume
        const vol = parseFloat(document.getElementById('volumeSlider')?.value ?? 0.8);
        if (audio.volume < vol - 0.01) audio.volume = vol;
    }
});

// When EQ is needed but nodes haven't been created, initialize after first play
const _origInitWebAudio = initWebAudio;
function initWebAudioAndEQ() {
    _origInitWebAudio();
    if (audioCtx && eqNodes.length === 0) {
        setupEQNodes();
    }
    if (audioCtx && currentReverbType !== 'none') {
        applyReverbRouting();
    }
}
window.initWebAudio = initWebAudioAndEQ;

