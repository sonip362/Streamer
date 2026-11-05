const GITHUB_BASE = "https://raw.githubusercontent.com/sonip362/Video/main/Music/";
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
const btnDownload8D = document.getElementById('btnDownload8D');

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
    const localUrl = "/" + encodedFilename;
    const musicSubfolderUrl = "/Music/" + encodedFilename;
    const proxyUrl = "/api/stream/" + encodedFilename;
    const githubUrl = GITHUB_BASE + encodedFilename;

    let arrayBuffer = null;
    let streamUrl = proxyUrl;

    try {
        const res = await fetch(localUrl, { headers: { 'Range': 'bytes=0-8192' } });
        if (res.ok || res.status === 206) {
            arrayBuffer = await res.arrayBuffer();
            streamUrl = localUrl;
        } else throw new Error();
    } catch (e) {
        try {
            const res = await fetch(musicSubfolderUrl, { headers: { 'Range': 'bytes=0-8192' } });
            if (res.ok || res.status === 206) {
                arrayBuffer = await res.arrayBuffer();
                streamUrl = musicSubfolderUrl;
            } else throw new Error();
        } catch (err) {
            try {
                const res = await fetch(githubUrl, { headers: { 'Range': 'bytes=0-8192' } });
                if (res.ok || res.status === 206) {
                    arrayBuffer = await res.arrayBuffer();
                    streamUrl = githubUrl;
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
                // Route through server proxy so we always get a fresh signed URL
                streamUrl: `/api/jamendo/stream/${item.id}`,
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

    const numBars = 30;
    const gap = 6 * dpr;
    const totalGaps = (numBars + 1) * gap;
    const barWidth = Math.max(3 * dpr, (w - totalGaps) / numBars);

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
    modalTrackArtist.textContent = track.artist;
    downloadModal.style.display = 'flex';
}

function closeDownloadModal() {
    downloadModal.style.display = 'none';
    selectedTrackForDownload = null;
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

function formatPlaylistTitle(title, maxLength = 18) {
    if (!title) return "";
    const cleanTitle = title.trim();
    if (cleanTitle.length <= maxLength) {
        return cleanTitle;
    }
    return `${cleanTitle.substring(0, maxLength - 3).trim()}...`;
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

        const formattedTitle = formatPlaylistTitle(track.title);
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
                    <span class="item-artist" title="${fullArtist}">${fullArtist}</span>
                </div>
            </div>
            <div class="item-right">
                <button class="btn-item-download" title="Download Options" onclick="event.stopPropagation(); handleDownloadClick(${actualIndex})">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                </button>
                <span class="source-tag">${track.sourceTag || "MP3 Tag"}</span>
                <span class="item-duration">${track.duration || "0:00"}</span>
            </div>
        `;
        playlistItemsEl.appendChild(li);
    });
}

window.handleDownloadClick = function (index) {
    const track = playlist[index];
    if (track) {
        openDownloadModal(track);
    }
};

btnModalClose.addEventListener('click', closeDownloadModal);
if (btnModalCancel) btnModalCancel.addEventListener('click', closeDownloadModal);

downloadModal.addEventListener('click', (e) => {
    if (e.target === downloadModal) closeDownloadModal();
});

if (btnToastCancel) {
    btnToastCancel.addEventListener('click', () => {
        is8DProcessingAborted = true;
        hideToast(0);
    });
}

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

btnDownload8D.addEventListener('click', () => {
    if (!selectedTrackForDownload) return;
    processAndDownload8D(selectedTrackForDownload);
});

function loadTrack(index) {
    if (!playlist || playlist.length === 0) return;
    currentIndex = index;
    const track = playlist[currentIndex];
    currentPlayingTrack = track;

    const encodedFile = encodeURIComponent(track.file);
    const localProxyUrl = '/api/stream/' + encodedFile;
    const githubUrl = GITHUB_BASE + encodedFile;
    const streamUrl = track.streamUrl || localProxyUrl;

    showSpinner("Loading audio stream...");
    audio.src = streamUrl;

    let triedFallback = false;
    audio.onerror = (e) => {
        if (!navigator.onLine) {
            showSpinner("No Internet Connection");
            if (streamStatus) streamStatus.classList.add('offline');
            if (statusText) statusText.textContent = "Offline • No Internet";
            return;
        }
        console.warn(`Stream failed for ${audio.src}, error code: ${audio.error ? audio.error.code : 'unknown'}`);

        if (!triedFallback) {
            triedFallback = true;
            // If primary failed, switch between proxy <-> direct GitHub Raw URL
            const nextFallback = audio.src.includes('/api/stream/') ? githubUrl : localProxyUrl;
            console.log("Switching audio source to fallback:", nextFallback);
            audio.src = nextFallback;
            if (isPlaying) {
                audio.play().catch(err => console.error("Playback error after fallback:", err));
            }
        } else {
            console.error("All stream sources failed for track:", track.file);
            hideSpinner();
            showToast("Stream Error", "Failed to load audio stream from all endpoints", false);
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

    currentTitleEl.textContent = formatPlaylistTitle(track.title);
    currentTitleEl.title = track.title;
    currentArtistEl.textContent = track.artist;
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

// =============================================================
// SYNTHESIZED SOUND EFFECTS ENGINE (Web Audio API)
// =============================================================
function playSFX(type) {
    if (!audioCtx) {
        if (typeof initWebAudio === 'function') initWebAudio();
    }
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const now = audioCtx.currentTime;

    switch (type) {
        case 'singleclap': {
            // Loud, punchy single handclap for 1-clap-per-beat BPM sync
            const burstDuration = 0.05;
            const buf = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * burstDuration), audioCtx.sampleRate);
            const d = buf.getChannelData(0);
            for (let i = 0; i < d.length; i++) {
                const t = i / d.length;
                const env = Math.exp(-t * 16);
                d[i] = (Math.random() * 2 - 1) * env;
            }

            const src = audioCtx.createBufferSource();
            src.buffer = buf;

            const flt = audioCtx.createBiquadFilter();
            flt.type = 'bandpass';
            flt.frequency.value = 1380;
            flt.Q.value = 2.2;

            const g = audioCtx.createGain();
            g.gain.setValueAtTime(0.75, now); // Loud & prominent
            g.gain.exponentialRampToValueAtTime(0.001, now + burstDuration);

            src.connect(flt);
            flt.connect(g);
            g.connect(audioCtx.destination);

            src.start(now);
            break;
        }

        case 'cheer': {
            // Crowd cheer: bandpass filtered noise with pitch modulation & ramp up
            const duration = 1.5;
            const bufferSize = audioCtx.sampleRate * duration;
            const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = (Math.random() * 2 - 1);
            }

            const noise = audioCtx.createBufferSource();
            noise.buffer = buffer;

            const filter = audioCtx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.setValueAtTime(800, now);
            filter.frequency.exponentialRampToValueAtTime(1400, now + 0.4);
            filter.frequency.linearRampToValueAtTime(900, now + duration);
            filter.Q.value = 3.0;

            const gain = audioCtx.createGain();
            gain.gain.setValueAtTime(0.01, now);
            gain.gain.linearRampToValueAtTime(0.35, now + 0.3);
            gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

            noise.connect(filter);
            filter.connect(gain);
            gain.connect(audioCtx.destination);

            noise.start(now);
            break;
        }

        case 'applause': {
            // Hand claps / Applause: multi-pulse noise bursts over 1.2s
            const duration = 1.2;
            const count = 16;
            for (let c = 0; c < count; c++) {
                const startTime = now + (c * 0.075) + (Math.random() * 0.03);
                const burstDuration = 0.05 + Math.random() * 0.03;
                const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * burstDuration, audioCtx.sampleRate);
                const d = buf.getChannelData(0);
                for (let i = 0; i < d.length; i++) {
                    d[i] = (Math.random() * 2 - 1);
                }

                const src = audioCtx.createBufferSource();
                src.buffer = buf;

                const flt = audioCtx.createBiquadFilter();
                flt.type = 'bandpass';
                flt.frequency.value = 1200 + Math.random() * 400;
                flt.Q.value = 2.0;

                const g = audioCtx.createGain();
                g.gain.setValueAtTime(0.25, startTime);
                g.gain.exponentialRampToValueAtTime(0.001, startTime + burstDuration);

                src.connect(flt);
                flt.connect(g);
                g.connect(audioCtx.destination);

                src.start(startTime);
            }
            break;
        }

        case 'airhorn': {
            // Classic DJ Air Horn sound: dual sawtooth oscillators with pitch bend
            const duration = 0.7;
            const freqs = [466.16, 587.33]; // Bb4 and D5 chord

            freqs.forEach(freq => {
                const osc = audioCtx.createOscillator();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(freq * 1.15, now);
                osc.frequency.exponentialRampToValueAtTime(freq, now + 0.08);

                const filter = audioCtx.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.value = 3500;

                const g = audioCtx.createGain();
                g.gain.setValueAtTime(0.25, now);
                g.gain.setValueAtTime(0.25, now + duration - 0.1);
                g.gain.exponentialRampToValueAtTime(0.001, now + duration);

                osc.connect(filter);
                filter.connect(g);
                g.connect(audioCtx.destination);

                osc.start(now);
                osc.stop(now + duration);
            });
            break;
        }

        case 'subdrop': {
            // Sub-Bass drop: sine wave sweeping from 160Hz down to 32Hz
            const duration = 1.0;
            const osc = audioCtx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(160, now);
            osc.frequency.exponentialRampToValueAtTime(32, now + duration);

            const g = audioCtx.createGain();
            g.gain.setValueAtTime(0.4, now);
            g.gain.exponentialRampToValueAtTime(0.001, now + duration);

            osc.connect(g);
            g.connect(audioCtx.destination);

            osc.start(now);
            osc.stop(now + duration);
            break;
        }
    }
}

// =============================================================
// AUTO DJ DROP HYPE DETECTION ENGINE
// =============================================================
let isAutoHypeEnabled = false;
let lastHypeTime = 0;
let bassEnergyHistory = [];
const HYPE_SFX_OPTIONS = ['cheer', 'applause', 'airhorn', 'subdrop'];

function checkDropAndTriggerSFX() {
    if (!isAutoHypeEnabled || !analyser || !dataArray || audio.paused) return;

    analyser.getByteFrequencyData(dataArray);

    // Calculate current low-frequency sub-bass energy (bins 0 to 4)
    let currentBass = 0;
    for (let i = 0; i < 4; i++) {
        currentBass += dataArray[i];
    }
    currentBass /= 4;

    bassEnergyHistory.push(currentBass);
    if (bassEnergyHistory.length > 30) bassEnergyHistory.shift();

    const avgBass = bassEnergyHistory.reduce((a, b) => a + b, 0) / bassEnergyHistory.length;

    const now = Date.now();
    // Cooldown check: minimum 25s - 45s between auto hype triggers (only sometimes!)
    const cooldownMs = 25000 + Math.random() * 20000;

    // Detect a high drop moment: bass energy suddenly surges > 1.75x rolling average & > 130 magnitude
    if (currentBass > 130 && currentBass > avgBass * 1.75 && (now - lastHypeTime > cooldownMs)) {
        lastHypeTime = now;
        const randomSFX = HYPE_SFX_OPTIONS[Math.floor(Math.random() * HYPE_SFX_OPTIONS.length)];
        console.log("🔥 Auto DJ Hype Drop Detected! Triggering SFX:", randomSFX);
        playSFX(randomSFX);
    }
}

// Poll audio energy every 250ms during active playback
setInterval(checkDropAndTriggerSFX, 250);

// Auto Hype Toggle UI
const btnAutoHype = document.getElementById('btnAutoHype');
const autoHypeText = document.getElementById('autoHypeText');

if (btnAutoHype) {
    btnAutoHype.addEventListener('click', () => {
        isAutoHypeEnabled = !isAutoHypeEnabled;
        btnAutoHype.classList.toggle('active', isAutoHypeEnabled);
        if (autoHypeText) {
            autoHypeText.textContent = isAutoHypeEnabled ? 'Auto Hype: ON 🔥' : 'Auto Hype: OFF';
        }
    });
}

// Manual SFX Chip Clicks
document.querySelectorAll('.sfx-chip').forEach(chip => {
    chip.addEventListener('click', () => {
        const sfx = chip.dataset.sfx;
        playSFX(sfx);
    });
});

// =============================================================
// FIXED 120 BPM BEAT CLAP ENGINE (500ms per clap)
// =============================================================
let isBeatClapEnabled = false;
const BPM_FIXED = 120;
const MS_PER_BEAT_120 = 60000 / BPM_FIXED; // exactly 500ms
let beatClockTimer = null;

function updateBeatClock() {
    if (beatClockTimer) {
        clearInterval(beatClockTimer);
        beatClockTimer = null;
    }
    if (!isBeatClapEnabled) return;

    // Fire initial clap immediately if audio is playing
    if (!audio.paused && audioCtx) {
        playSFX('singleclap');
    }

    beatClockTimer = setInterval(() => {
        if (isBeatClapEnabled && !audio.paused && audioCtx) {
            playSFX('singleclap');
        }
    }, MS_PER_BEAT_120);
}

// Pause/play listeners so claps stop when paused and resume cleanly
audio.addEventListener('pause', () => {
    if (beatClockTimer) {
        clearInterval(beatClockTimer);
        beatClockTimer = null;
    }
});

audio.addEventListener('play', () => {
    if (isBeatClapEnabled) {
        updateBeatClock();
    }
});

// Beat Clap Toggle UI
const btnBeatClap = document.getElementById('btnBeatClap');
const beatClapText = document.getElementById('beatClapText');

if (btnBeatClap) {
    btnBeatClap.addEventListener('click', () => {
        isBeatClapEnabled = !isBeatClapEnabled;
        btnBeatClap.classList.toggle('active', isBeatClapEnabled);
        if (beatClapText) {
            beatClapText.textContent = isBeatClapEnabled ? '👏 Beat Clap: 120 BPM' : '👏 Beat Clap: OFF';
        }
        updateBeatClock();
    });
}
