// =============================================================
// STREAMER - ADVANCED AUDIO STUDIO & DOWNLOAD ENGINE
// Clean Light Theme • Zero Emojis • Background Sync & Atomic Locks
// =============================================================

const GITHUB_BASE = "https://raw.githubusercontent.com/sonip362/Video/main/Music/";
const JSDELIVR_BASE = "https://cdn.jsdelivr.net/gh/sonip362/Video@main/Music/";
const STORAGE_KEY = 'streamer_download_job';

// Unique Tab Identifier for Mutex Locking
const DOWNLOAD_TAB_ID = 'download_tab_' + Math.random().toString(36).substring(2, 10);
let currentJobId = Date.now();

// Parse track metadata from URL parameters or sessionStorage
const urlParams = new URLSearchParams(window.location.search);
let currentTrack = {
    title: urlParams.get('title') || '',
    artist: urlParams.get('artist') || '',
    file: urlParams.get('file') || '',
    streamUrl: urlParams.get('streamUrl') || ''
};

// Fallback to sessionStorage if URL params were not provided
if (!currentTrack.title && !currentTrack.file) {
    try {
        const stored = sessionStorage.getItem('advancedDownloadTrack') || sessionStorage.getItem('currentTrackForDownload');
        if (stored) {
            const parsed = JSON.parse(stored);
            currentTrack = {
                title: parsed.title || '',
                artist: parsed.artist || '',
                file: parsed.file || '',
                streamUrl: parsed.streamUrl || ''
            };
        }
    } catch (e) {
        console.warn('Could not read track from sessionStorage:', e);
    }
}

// Fallback defaults
if (!currentTrack.title) currentTrack.title = 'Selected Track';
if (!currentTrack.artist) currentTrack.artist = 'Streamer Audio';

// DOM Elements
const trackTitleEl = document.getElementById('trackTitle');
const trackArtistEl = document.getElementById('trackArtist');
const previewAudio = document.getElementById('previewAudio');
const btnPreviewPlay = document.getElementById('btnPreviewPlay');
const playIcon = document.getElementById('playIcon');
const previewProgressBar = document.getElementById('previewProgressBar');
const previewProgressCanvas = document.getElementById('previewProgressCanvas');
const previewProgressThumb = document.getElementById('previewProgressThumb');
const previewCurrentTime = document.getElementById('previewCurrentTime');
const previewTotalDuration = document.getElementById('previewTotalDuration');
const previewVolume = document.getElementById('previewVolume');

// Settings Elements
const eqPresetBadge = document.getElementById('eqPresetBadge');
const eqPresetChips = document.querySelectorAll('.eq-preset-chip');
const eqSliders = {
    eq60: document.getElementById('eq60'),
    eq250: document.getElementById('eq250'),
    eq1k: document.getElementById('eq1k'),
    eq4k: document.getElementById('eq4k'),
    eq16k: document.getElementById('eq16k')
};
const eqValBadges = {
    eq60Val: document.getElementById('eq60Val'),
    eq250Val: document.getElementById('eq250Val'),
    eq1kVal: document.getElementById('eq1kVal'),
    eq4kVal: document.getElementById('eq4kVal'),
    eq16kVal: document.getElementById('eq16kVal')
};

const reverbBadge = document.getElementById('reverbBadge');
const reverbChips = document.querySelectorAll('.reverb-chip');

const spatialBadge = document.getElementById('spatialBadge');
const btnToggle8D = document.getElementById('btnToggle8D');
const spatialToggleText = document.getElementById('spatialToggleText');

const speedBadge = document.getElementById('speedBadge');
const speedChips = document.querySelectorAll('.speed-chip');

const btnStartRender = document.getElementById('btnStartRender');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const statusText = document.getElementById('statusText');

// Toast Notification Elements
const toastContainer = document.getElementById('toastContainer');
const toastSpinner = document.getElementById('toastSpinner');
const toastMessage = document.getElementById('toastMessage');
const toastSubtext = document.getElementById('toastSubtext');
const btnToastCancel = document.getElementById('btnToastCancel');
let toastTimeout = null;

// Audio State
let audioCtx = null;
let sourceNode = null;
let eqFilterNodes = [];
let reverbConvolver = null;
let reverbDryGain = null;
let reverbWetGain = null;
let panner8DNode = null;
let pannerInterval = null;
let pannerAngle = 0;

// User Selected Audio Settings
let activeEqPreset = 'flat';
let eqGains = [0, 0, 0, 0, 0];
let activeReverb = 'none';
let is8DActive = false;
let activeSpeed = 1.0;

// Render Control Flag
let isRenderAborted = false;
let heartbeatInterval = null;

const EQ_PRESET_VALUES = {
    flat: [0, 0, 0, 0, 0],
    bass: [6, 4, 0, -2, -2],
    electronic: [4, 2, 0, 2, 4],
    vocal: [-2, 0, 4, 3, 1],
    rock: [4, 2, -1, 2, 4]
};

// Update Track Info in UI
trackTitleEl.textContent = currentTrack.title;
trackArtistEl.textContent = currentTrack.artist;
if (currentTrack.duration && currentTrack.duration !== "0:00" && previewTotalDuration) {
    previewTotalDuration.textContent = currentTrack.duration;
}

// Set audio stream source
const directStreamUrl = currentTrack.streamUrl || (currentTrack.file ? JSDELIVR_BASE + encodeURIComponent(currentTrack.file) : '');
if (directStreamUrl) {
    previewAudio.src = directStreamUrl;
}

// =============================================================
// TOAST NOTIFICATION HELPERS
// =============================================================
function showToast(title, subtext = "", isProcessing = true) {
    if (toastTimeout) clearTimeout(toastTimeout);
    if (toastMessage) toastMessage.textContent = title;
    if (toastSubtext) {
        toastSubtext.textContent = subtext;
        toastSubtext.style.display = subtext ? 'block' : 'none';
    }
    if (toastSpinner) toastSpinner.style.display = isProcessing ? 'block' : 'none';
    if (btnToastCancel) btnToastCancel.style.display = isProcessing ? 'block' : 'none';
    if (toastContainer) toastContainer.classList.add('show');
}

function hideToast(delay = 0) {
    if (delay > 0) {
        toastTimeout = setTimeout(() => {
            if (toastContainer) toastContainer.classList.remove('show');
        }, delay);
    } else {
        if (toastContainer) toastContainer.classList.remove('show');
    }
}

function cancelProcessing() {
    isRenderAborted = true;
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
    try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.setItem('streamer_download_cancelled', Date.now().toString());
    } catch (e) {}

    hideToast(0);
    if (progressContainer) progressContainer.style.display = 'none';
    if (btnStartRender) btnStartRender.disabled = false;
}

if (btnToastCancel) {
    btnToastCancel.addEventListener('click', cancelProcessing);
}

// Listen for cancel event broadcast from main player
window.addEventListener('storage', (e) => {
    if (e.key === 'streamer_download_cancelled') {
        isRenderAborted = true;
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }
        hideToast(0);
        if (progressContainer) progressContainer.style.display = 'none';
        if (btnStartRender) btnStartRender.disabled = false;
    }
});

// Notify before unload so index.html can seamlessly adopt rendering if needed
window.addEventListener('beforeunload', () => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            const job = JSON.parse(stored);
            if (!job.isComplete && !job.downloadTriggered && job.ownerTabId === DOWNLOAD_TAB_ID) {
                // Relinquish ownership immediately so main page can adopt without waiting
                job.isAbandoned = true;
                job.ownerTabId = null;
                localStorage.setItem(STORAGE_KEY, JSON.stringify(job));
            }
        }
    } catch (e) {}
});

// =============================================================
// WEB AUDIO GRAPH INITIALIZATION (LIVE PREVIEW)
// =============================================================
function initPreviewAudioGraph() {
    if (audioCtx) return;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass();

    sourceNode = audioCtx.createMediaElementSource(previewAudio);

    // 1. Equalizer Filter Chain
    const frequencies = [60, 250, 1000, 4000, 16000];
    const filterTypes = ['lowshelf', 'peaking', 'peaking', 'peaking', 'highshelf'];

    eqFilterNodes = frequencies.map((freq, i) => {
        const filter = audioCtx.createBiquadFilter();
        filter.type = filterTypes[i];
        filter.frequency.value = freq;
        filter.gain.value = eqGains[i];
        if (filterTypes[i] === 'peaking') filter.Q.value = 1.0;
        return filter;
    });

    for (let i = 0; i < eqFilterNodes.length - 1; i++) {
        eqFilterNodes[i].connect(eqFilterNodes[i + 1]);
    }

    // 2. Reverb Wet/Dry Routing
    reverbConvolver = audioCtx.createConvolver();
    reverbDryGain = audioCtx.createGain();
    reverbWetGain = audioCtx.createGain();

    reverbDryGain.gain.value = 1.0;
    reverbWetGain.gain.value = 0.0;

    // 3. 8D Spatial Panner Node
    panner8DNode = audioCtx.createPanner();
    panner8DNode.panningModel = 'HRTF';
    panner8DNode.distanceModel = 'linear';
    panner8DNode.rolloffFactor = 0;
    panner8DNode.coneOuterGain = 1;
    panner8DNode.positionX.setValueAtTime(0, audioCtx.currentTime);
    panner8DNode.positionY.setValueAtTime(0, audioCtx.currentTime);
    panner8DNode.positionZ.setValueAtTime(0, audioCtx.currentTime);

    // Connect Graph
    sourceNode.connect(eqFilterNodes[0]);

    const lastEq = eqFilterNodes[eqFilterNodes.length - 1];
    lastEq.connect(reverbDryGain);
    lastEq.connect(reverbConvolver);
    reverbConvolver.connect(reverbWetGain);

    reverbDryGain.connect(panner8DNode);
    reverbWetGain.connect(panner8DNode);

    panner8DNode.connect(audioCtx.destination);
}

// Generate Algorithmic Stereo Reverb Impulse
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

// Apply Reverb settings to live preview
function updateLiveReverb(type) {
    if (!audioCtx || !reverbConvolver) return;
    activeReverb = type;

    if (type === 'none') {
        reverbDryGain.gain.setValueAtTime(1.0, audioCtx.currentTime);
        reverbWetGain.gain.setValueAtTime(0.0, audioCtx.currentTime);
        return;
    }

    const configs = {
        room: { duration: 0.8, decay: 2.2, wet: 0.35 },
        studio: { duration: 1.3, decay: 2.6, wet: 0.42 },
        hall: { duration: 2.6, decay: 3.2, wet: 0.52 },
        arena: { duration: 4.2, decay: 3.8, wet: 0.60 }
    };

    const cfg = configs[type] || configs.room;
    reverbConvolver.buffer = generateReverbImpulse(audioCtx, cfg.duration, cfg.decay);
    reverbDryGain.gain.setValueAtTime(1.0 - cfg.wet * 0.4, audioCtx.currentTime);
    reverbWetGain.gain.setValueAtTime(cfg.wet, audioCtx.currentTime);
}

// Animate 8D Spatial Orbit
function start8DPannerOrbit() {
    stop8DPannerOrbit();
    if (!audioCtx || !panner8DNode) return;

    pannerInterval = setInterval(() => {
        if (previewAudio.paused || !is8DActive || !audioCtx) return;

        pannerAngle += 0.035;
        const radius = 1.6;
        const x = Math.sin(pannerAngle) * radius;
        const z = Math.cos(pannerAngle) * radius;
        const y = Math.sin(pannerAngle * 0.5) * 0.8;

        panner8DNode.positionX.setValueAtTime(x, audioCtx.currentTime);
        panner8DNode.positionY.setValueAtTime(y, audioCtx.currentTime);
        panner8DNode.positionZ.setValueAtTime(z, audioCtx.currentTime);
    }, 40);
}

function stop8DPannerOrbit() {
    if (pannerInterval) {
        clearInterval(pannerInterval);
        pannerInterval = null;
    }
    if (panner8DNode && audioCtx) {
        panner8DNode.positionX.setValueAtTime(0, audioCtx.currentTime);
        panner8DNode.positionY.setValueAtTime(0, audioCtx.currentTime);
        panner8DNode.positionZ.setValueAtTime(0, audioCtx.currentTime);
    }
}

// =============================================================
// PREVIEW AUDIO PLAYER CONTROLS
// =============================================================
function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// =============================================================
// MATERIAL 3 / ANDROID 13 LIVING WAVY SLIDER (Preview Player)
// =============================================================
class WavySlider {
    constructor({ container, canvas, thumb, onSeek }) {
        this.container = container;
        this.canvas = canvas;
        this.thumb = thumb;
        this.onSeek = onSeek;
        this.ctx = canvas ? canvas.getContext('2d') : null;

        this.progress = 0;
        this.phaseShift = 0;
        this.currentWaveHeight = 0;
        this.targetWaveHeight = 8;
        this.waveLength = 24;
        this.waveThickness = 3.5;
        this.speed = 36;
        this.isSeeking = false;
        this.isHovered = false;
        this.isPlaying = false;
        this.lastTime = performance.now();

        if (this.container && this.canvas && this.ctx) {
            this.init();
        }
    }

    init() {
        this.resize();
        window.addEventListener('resize', () => this.resize());

        this.container.addEventListener('pointerdown', (e) => {
            this.isSeeking = true;
            this.container.classList.add('seeking');
            try { this.container.setPointerCapture(e.pointerId); } catch (err) {}
            this.handlePointer(e);
        });

        this.container.addEventListener('pointermove', (e) => {
            if (this.isSeeking) {
                this.handlePointer(e);
            }
        });

        const stopSeeking = (e) => {
            if (this.isSeeking) {
                this.isSeeking = false;
                this.container.classList.remove('seeking');
                try { this.container.releasePointerCapture(e.pointerId); } catch (err) {}
            }
        };

        this.container.addEventListener('pointerup', stopSeeking);
        this.container.addEventListener('pointercancel', stopSeeking);

        this.container.addEventListener('mouseenter', () => {
            this.isHovered = true;
        });
        this.container.addEventListener('mouseleave', () => {
            this.isHovered = false;
        });

        requestAnimationFrame((t) => this.render(t));
    }

    handlePointer(e) {
        const rect = this.container.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const ratio = Math.max(0, Math.min(1, clickX / rect.width));
        this.progress = ratio;
        if (this.onSeek) {
            this.onSeek(ratio);
        }
    }

    resize() {
        if (!this.container || !this.canvas) return;
        const rect = this.container.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.width = rect.width;
        this.height = rect.height;
        this.canvas.width = Math.round(rect.width * dpr);
        this.canvas.height = Math.round(rect.height * dpr);
        if (this.ctx.resetTransform) {
            this.ctx.resetTransform();
        } else {
            this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        }
        this.ctx.scale(dpr, dpr);
    }

    setProgress(val) {
        if (!this.isSeeking) {
            this.progress = Math.max(0, Math.min(1, val));
        }
    }

    setPlaying(playing) {
        this.isPlaying = playing;
    }

    render(now) {
        const dt = Math.min(0.1, (now - this.lastTime) / 1000);
        this.lastTime = now;

        const isExpressive = document.documentElement.getAttribute('data-style') !== 'classic';
        const targetH = (this.isPlaying && isExpressive) ? (this.isHovered || this.isSeeking ? 10 : 8) : 0;
        
        this.currentWaveHeight += (targetH - this.currentWaveHeight) * 0.12;

        if (this.isPlaying && isExpressive) {
            this.phaseShift = (this.phaseShift + this.speed * dt) % this.waveLength;
        }

        const width = this.width || this.container.clientWidth;
        const height = this.height || this.container.clientHeight;
        const centerY = height / 2;
        const thumbX = Math.round(this.progress * width);

        this.ctx.clearRect(0, 0, width, height);

        const style = getComputedStyle(document.documentElement);
        const activeColor = style.getPropertyValue('--cyan-primary').trim() || '#06B6D4';
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const inactiveColor = isDark ? '#273549' : '#E2E8F0';

        const strokeW = (this.isHovered || this.isSeeking) ? 4.5 : this.waveThickness;

        const gap = (this.thumb && isExpressive) ? 2 : 0;
        if (thumbX + gap < width) {
            this.ctx.beginPath();
            this.ctx.lineCap = 'round';
            this.ctx.lineWidth = strokeW;
            this.ctx.strokeStyle = inactiveColor;
            this.ctx.moveTo(Math.min(width, thumbX + gap), centerY);
            this.ctx.lineTo(width, centerY);
            this.ctx.stroke();
        }

        if (thumbX > 0) {
            this.ctx.beginPath();
            this.ctx.lineCap = 'round';
            this.ctx.lineJoin = 'round';
            this.ctx.lineWidth = strokeW;
            this.ctx.strokeStyle = activeColor;

            if (this.currentWaveHeight > 0.4 && isExpressive) {
                this.ctx.moveTo(0, centerY);
                const step = 2;
                for (let x = 0; x <= thumbX; x += step) {
                    const radians = ((x - this.phaseShift) / this.waveLength) * Math.PI * 2;
                    const y = centerY + Math.sin(radians) * (this.currentWaveHeight / 2);
                    this.ctx.lineTo(x, y);
                }
                this.ctx.lineTo(thumbX, centerY);
            } else {
                this.ctx.moveTo(0, centerY);
                this.ctx.lineTo(thumbX, centerY);
            }
            this.ctx.stroke();
        }

        if (this.thumb) {
            this.thumb.style.left = `${thumbX}px`;
        }

        requestAnimationFrame((t) => this.render(t));
    }
}

let previewWavySlider = null;
if (previewProgressBar && previewProgressCanvas) {
    previewWavySlider = new WavySlider({
        container: previewProgressBar,
        canvas: previewProgressCanvas,
        thumb: previewProgressThumb,
        onSeek: (ratio) => {
            if (previewAudio.duration) {
                previewAudio.currentTime = ratio * previewAudio.duration;
                if (previewCurrentTime) previewCurrentTime.textContent = formatTime(previewAudio.currentTime);
            }
        }
    });
}

const downloadCard = document.querySelector('.download-card');

btnPreviewPlay.addEventListener('click', async () => {
    initPreviewAudioGraph();
    if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
    }

    if (previewAudio.paused) {
        previewAudio.play().then(() => {
            playIcon.innerHTML = '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>';
            btnPreviewPlay.classList.add('playing');
            if (downloadCard) downloadCard.classList.add('playing');
            if (previewWavySlider) previewWavySlider.setPlaying(true);
            if (is8DActive) start8DPannerOrbit();
        }).catch(err => {
            console.warn('Playback error:', err);
        });
    } else {
        previewAudio.pause();
        playIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"></polygon>';
        btnPreviewPlay.classList.remove('playing');
        if (downloadCard) downloadCard.classList.remove('playing');
        if (previewWavySlider) previewWavySlider.setPlaying(false);
        stop8DPannerOrbit();
    }
});

previewAudio.addEventListener('pause', () => {
    playIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"></polygon>';
    btnPreviewPlay.classList.remove('playing');
    if (downloadCard) downloadCard.classList.remove('playing');
    if (previewWavySlider) previewWavySlider.setPlaying(false);
    stop8DPannerOrbit();
});

previewAudio.addEventListener('timeupdate', () => {
    if (!previewAudio.duration) return;
    if (previewWavySlider && !previewWavySlider.isSeeking) {
        previewWavySlider.setProgress(previewAudio.currentTime / previewAudio.duration);
    }
    if (previewCurrentTime) previewCurrentTime.textContent = formatTime(previewAudio.currentTime);
    if (previewTotalDuration) previewTotalDuration.textContent = formatTime(previewAudio.duration);
});

previewAudio.addEventListener('loadedmetadata', () => {
    if (previewTotalDuration && previewAudio.duration) {
        previewTotalDuration.textContent = formatTime(previewAudio.duration);
    }
});

previewAudio.addEventListener('ended', () => {
    playIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"></polygon>';
    btnPreviewPlay.classList.remove('playing');
    if (previewWavySlider) {
        previewWavySlider.setProgress(0);
        previewWavySlider.setPlaying(false);
    }
    if (previewCurrentTime) previewCurrentTime.textContent = '0:00';
    if (downloadCard) downloadCard.classList.remove('playing');
    stop8DPannerOrbit();
});

previewVolume.addEventListener('input', () => {
    previewAudio.volume = parseFloat(previewVolume.value);
});

// =============================================================
// EQUALIZER CONTROLS
// =============================================================
function applyEqGainsToNodes() {
    if (!audioCtx || eqFilterNodes.length === 0) return;
    eqGains.forEach((gain, i) => {
        eqFilterNodes[i].gain.setValueAtTime(gain, audioCtx.currentTime);
    });
}

function updateEqUI() {
    const keys = ['eq60', 'eq250', 'eq1k', 'eq4k', 'eq16k'];
    const valKeys = ['eq60Val', 'eq250Val', 'eq1kVal', 'eq4kVal', 'eq16kVal'];

    eqGains.forEach((gain, i) => {
        eqSliders[keys[i]].value = gain;
        eqValBadges[valKeys[i]].textContent = gain > 0 ? `+${gain}` : `${gain}`;
    });
}

eqPresetChips.forEach(chip => {
    chip.addEventListener('click', () => {
        eqPresetChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');

        activeEqPreset = chip.dataset.preset;
        eqPresetBadge.textContent = chip.textContent;
        eqGains = [...EQ_PRESET_VALUES[activeEqPreset]];

        updateEqUI();
        applyEqGainsToNodes();
    });
});

Object.keys(eqSliders).forEach((key, index) => {
    const slider = eqSliders[key];
    const valKey = Object.keys(eqValBadges)[index];
    slider.addEventListener('input', () => {
        const val = parseFloat(slider.value);
        eqGains[index] = val;
        eqValBadges[valKey].textContent = val > 0 ? `+${val}` : `${val}`;

        eqPresetChips.forEach(c => c.classList.remove('active'));
        eqPresetBadge.textContent = 'Custom';

        applyEqGainsToNodes();
    });
});

// =============================================================
// REVERB CONTROLS
// =============================================================
reverbChips.forEach(chip => {
    chip.addEventListener('click', () => {
        reverbChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');

        const type = chip.dataset.reverb;
        reverbBadge.textContent = chip.textContent;
        updateLiveReverb(type);
    });
});

// =============================================================
// 8D SPATIAL AUDIO CONTROLS
// =============================================================
btnToggle8D.addEventListener('click', () => {
    initPreviewAudioGraph();
    is8DActive = !is8DActive;
    btnToggle8D.classList.toggle('active', is8DActive);

    if (is8DActive) {
        spatialBadge.textContent = 'On';
        spatialToggleText.textContent = '360° Spatial Sound: ON';
        if (!previewAudio.paused) start8DPannerOrbit();
    } else {
        spatialBadge.textContent = 'Off';
        spatialToggleText.textContent = '360° Spatial Sound: OFF';
        stop8DPannerOrbit();
    }
});

// =============================================================
// PLAYBACK SPEED CONTROLS
// =============================================================
speedChips.forEach(chip => {
    chip.addEventListener('click', () => {
        speedChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');

        activeSpeed = parseFloat(chip.dataset.speed);
        speedBadge.textContent = `${activeSpeed}x`;
        previewAudio.playbackRate = activeSpeed;
    });
});

// =============================================================
// LOCALSTORAGE BACKGROUND PROCESSING STATE
// =============================================================
function updateBackgroundJob(progress, status, isComplete = false) {
    if (isRenderAborted) return;

    const progressVal = Math.min(100, Math.max(0, Math.round(progress)));
    const job = {
        id: currentJobId,
        title: currentTrack.title,
        artist: currentTrack.artist,
        file: currentTrack.file,
        streamUrl: currentTrack.streamUrl,
        settings: {
            eqGains: [...eqGains],
            reverb: activeReverb,
            is8D: is8DActive,
            speed: activeSpeed
        },
        progress: progressVal,
        status: status,
        isComplete: isComplete,
        downloadTriggered: isComplete,
        ownerTabId: DOWNLOAD_TAB_ID,
        ownerType: 'download_page',
        isAbandoned: false,
        lastHeartbeat: Date.now(),
        timestamp: Date.now()
    };

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(job));
    } catch (e) {
        console.warn('LocalStorage error:', e);
    }

    // Update in-page progress elements
    if (progressContainer) progressContainer.style.display = 'flex';
    if (progressFill) progressFill.style.width = `${progressVal}%`;
    if (statusText) statusText.textContent = `${status} (${progressVal}%)`;

    // Show floating toast pill matching the UI screenshot
    if (!isComplete) {
        showToast(`Processing: ${currentTrack.title}`, `${status} (${progressVal}%)`, true);
    } else {
        showToast(`Download Ready: ${currentTrack.title}`, `Saved to downloads`, false);
        hideToast(3500);
        setTimeout(() => {
            try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
        }, 3500);
    }
}

// Check if an ongoing job exists in localStorage on page load
try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) {
        const job = JSON.parse(existing);
        if (!job.isComplete && (Date.now() - job.timestamp < 120000)) {
            showToast(`Processing: ${job.title}`, `${job.status} (${job.progress}%)`, true);
            if (progressContainer) progressContainer.style.display = 'flex';
            if (progressFill) progressFill.style.width = `${job.progress}%`;
            if (statusText) statusText.textContent = `${job.status} (${job.progress}%)`;
        }
    }
} catch (e) {}

// =============================================================
// 16-BIT PCM WAV ENCODER
// =============================================================
function audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // 1 = uncompressed PCM
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

// =============================================================
// OFFLINE AUDIO RENDERING & DOWNLOAD ENGINE
// =============================================================
btnStartRender.addEventListener('click', async () => {
    isRenderAborted = false;
    currentJobId = Date.now();
    btnStartRender.disabled = true;

    // Start fast heartbeat timer (400ms)
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const job = JSON.parse(stored);
                if (!job.isComplete && job.ownerTabId === DOWNLOAD_TAB_ID) {
                    job.lastHeartbeat = Date.now();
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(job));
                }
            }
        } catch (e) {}
    }, 400);

    try {
        updateBackgroundJob(10, 'Fetching audio stream...');
        if (isRenderAborted) return;

        // 1. Fetch Audio Buffer
        const fetchUrl = currentTrack.streamUrl || (currentTrack.file ? GITHUB_BASE + currentTrack.file : '');
        if (!fetchUrl) throw new Error('No audio URL found for this track.');

        let response;
        try {
            response = await fetch(fetchUrl);
            if (!response.ok) throw new Error('Stream fetch failed');
        } catch (fetchErr) {
            if (currentTrack.file) {
                response = await fetch(GITHUB_BASE + currentTrack.file);
            } else {
                throw fetchErr;
            }
        }

        if (isRenderAborted) return;
        updateBackgroundJob(25, 'Decoding audio data...');

        const arrayBuf = await response.arrayBuffer();
        if (isRenderAborted) return;

        const decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
        const decodedBuffer = await decodeCtx.decodeAudioData(arrayBuf);
        decodeCtx.close();

        if (isRenderAborted) return;
        updateBackgroundJob(45, 'Applying audio processing...');

        // 2. Setup OfflineAudioContext
        const sampleRate = decodedBuffer.sampleRate;
        const originalDuration = decodedBuffer.duration;
        const renderedDuration = originalDuration / activeSpeed;

        const offlineCtx = new OfflineAudioContext(2, Math.floor(sampleRate * renderedDuration), sampleRate);

        // Buffer Source
        const source = offlineCtx.createBufferSource();
        source.buffer = decodedBuffer;
        source.playbackRate.value = activeSpeed;

        // Equalizer Chain
        const frequencies = [60, 250, 1000, 4000, 16000];
        const filterTypes = ['lowshelf', 'peaking', 'peaking', 'peaking', 'highshelf'];

        const offlineFilters = frequencies.map((freq, i) => {
            const filter = offlineCtx.createBiquadFilter();
            filter.type = filterTypes[i];
            filter.frequency.value = freq;
            filter.gain.value = eqGains[i];
            if (filterTypes[i] === 'peaking') filter.Q.value = 1.0;
            return filter;
        });

        for (let i = 0; i < offlineFilters.length - 1; i++) {
            offlineFilters[i].connect(offlineFilters[i + 1]);
        }

        source.connect(offlineFilters[0]);
        let lastNode = offlineFilters[offlineFilters.length - 1];

        // Reverb Processing
        if (activeReverb !== 'none') {
            if (isRenderAborted) return;
            updateBackgroundJob(60, 'Synthesizing room reverb...');
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

        // 8D Spatial Audio Orbit Automation
        if (is8DActive) {
            if (isRenderAborted) return;
            updateBackgroundJob(75, 'Rendering 360° spatial orbit...');
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

        // Dynamics Compressor to Prevent Distortion/Clipping
        const compressor = offlineCtx.createDynamicsCompressor();
        compressor.threshold.value = -24;
        compressor.knee.value = 12;
        compressor.ratio.value = 8;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.15;

        lastNode.connect(compressor);
        compressor.connect(offlineCtx.destination);

        source.start(0);

        if (isRenderAborted) return;
        updateBackgroundJob(85, 'Rendering audio in browser...');

        const renderedBuffer = await offlineCtx.startRendering();

        if (isRenderAborted) return;
        updateBackgroundJob(95, 'Encoding 16-bit WAV file...');

        const wavBlob = audioBufferToWav(renderedBuffer);
        const downloadUrl = URL.createObjectURL(wavBlob);

        // Clean Filename
        const cleanTitle = (currentTrack.title || 'Audio').replace(/[/\\?%*:|"<>]/g, '');
        const cleanArtist = (currentTrack.artist || 'Artist').replace(/[/\\?%*:|"<>]/g, '');
        const filename = `${cleanArtist} - ${cleanTitle} (Custom).wav`;

        if (isRenderAborted) return;

        // ATOMIC DOWNLOAD CHECK TO PREVENT DUPLICATES
        try {
            const checkJob = JSON.parse(localStorage.getItem(STORAGE_KEY));
            if (checkJob && (checkJob.downloadTriggered || checkJob.isCancelled)) {
                console.log("Download was already triggered or cancelled. Skipping duplicate.");
                return;
            }
            if (checkJob) {
                checkJob.downloadTriggered = true;
                checkJob.isComplete = true;
                localStorage.setItem(STORAGE_KEY, JSON.stringify(checkJob));
            }
        } catch (e) {}

        // Trigger Download
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        updateBackgroundJob(100, 'Download complete', true);

        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }

        setTimeout(() => {
            btnStartRender.disabled = false;
        }, 1500);

    } catch (err) {
        if (isRenderAborted) return;
        console.error('Rendering error:', err);
        updateBackgroundJob(0, 'Processing error. Try direct download.', true);
        btnStartRender.disabled = false;
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }
    }
});

// =============================================================
// THEME & DESIGN STYLE SYNC (Inherit & apply theme from main page)
// =============================================================
const THEME_STORAGE_MAIN = 'streamer_main_theme';
const THEME_STORAGE_ACCENT = 'streamer_accent_theme';
const THEME_STORAGE_STYLE = 'streamer_design_style';

function applySavedTheme() {
    try {
        const savedMain = localStorage.getItem(THEME_STORAGE_MAIN) || 'light';
        const savedAccent = localStorage.getItem(THEME_STORAGE_ACCENT) || 'cyan';
        const savedStyle = localStorage.getItem(THEME_STORAGE_STYLE) || 'expressive';
        document.documentElement.setAttribute('data-theme', savedMain === 'dark' ? 'dark' : 'light');
        const validAccents = ['cyan', 'blue', 'purple', 'pink', 'amber', 'green'];
        document.documentElement.setAttribute('data-accent', validAccents.includes(savedAccent) ? savedAccent : 'cyan');
        document.documentElement.setAttribute('data-style', savedStyle === 'classic' ? 'classic' : 'expressive');
        if (typeof previewWavySlider !== 'undefined' && previewWavySlider) {
            previewWavySlider.resize();
        }
    } catch (e) {}
}

applySavedTheme();

// Listen for theme and style changes from main page in real-time
window.addEventListener('storage', (e) => {
    if (e.key === THEME_STORAGE_MAIN || e.key === THEME_STORAGE_ACCENT || e.key === THEME_STORAGE_STYLE) {
        applySavedTheme();
    }
});
