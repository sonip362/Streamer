# 🎧 Streamer - Modern Web Audio & PWA Streaming Player

A modern, high-performance web audio player and installable Progressive Web App (PWA) featuring 8D Spatial Audio, real-time 5-Band Equalizer, algorithmic room reverb convolution, auto-drop hype detection, beat-synced sound effects, and seamless streaming from both local library files and Jamendo Music.

---

## ✨ Key Features

### 🎧 Advanced Web Audio Engine
- **Dolby Atmos / 8D Spatial Audio**: Real-time 3D orbital HRTF panner node that oscillates on the X, Y, and Z axes (side-to-side, overhead, and depth) with built-in dynamic compressor protection to prevent distortion.
- **Master Audio Routing Pipeline**: Unified EQ bus ensuring all audio effects (Equalizer and Reverb) apply seamlessly across both standard stereo and 8D spatial audio modes.
- **5-Band Interactive Equalizer**: Real-time `BiquadFilterNode` frequency shaping (60Hz, 250Hz, 1kHz, 4kHz, 16kHz) with presets (*Flat*, *Bass Boost*, *Treble Boost*, *Vocal Boost*, *Rock*).
- **Algorithmic Environmental Reverb**: Realistic room acoustic simulation (*Room*, *Studio*, *Hall*, *Arena*) generated via custom impulse response convolution, dynamic pre-delay (15ms–65ms), and wet/dry balancing.
- **Crossfade Engine**: Configurable (0s to 5s) DJ-style smooth volume crossfading between track transitions.
- **Variable Playback Speed**: Flexible speed control (0.5×, 0.75×, 1×, 1.25×, 1.5×, 2×).
- **Live Canvas Waveform Visualizer**: Smooth animated audio visualizer synced to real-time frequency analysis.

---

### 🎉 DJ Performance FX & Soundboard (Pure Web Audio Synthesis)
- **Zero-Latency Synthesized SFX**: Handcrafted in pure Web Audio API code (no external MP3/audio files required):
  - 👏 **Single Clap**: Tight, punchy rhythm clap.
  - 🎉 **Cheer**: Layered crowd roar with resonant pitch sweeps.
  - 👏 **Applause**: Multi-burst stadium handclaps.
  - 📢 **DJ Air Horn**: Classic dual-sawtooth pitch-bending hype horn.
  - 💥 **Sub Drop**: Heavy 160Hz ➔ 32Hz sub-bass impact drop.
- **Auto DJ Drop Hype**: Real-time sub-bass transient monitor that automatically triggers a hype effect during sudden musical drops (with 25s–45s randomized cooldown).
- **120 BPM Beat Clap Engine**: Steady, synchronized 120 BPM quarter-note handclap track that pauses and resumes cleanly with playback.

---

### 📱 Modern UI & PWA (Installable)
- **Progressive Web App (PWA)**: Includes `manifest.json` and Service Worker (`sw.js`) for offline asset caching and desktop/mobile installation.
- **Responsive Mobile Interface**: Compact, icon-driven controls, slide-down audio settings drawer, and touch-friendly UI designed with Tailwind CSS v4.
- **Dual Music Sources**:
  - **Local Library**: Streams audio tracks directly from the local `Music/` directory via Node.js range requests.
  - **Jamendo API Integration**: Explore and stream trending CC-licensed music tracks online.
- **8D Audio Exporter / Converter**: Renders tracks with offline spatial audio processing and allows downloading the processed 8D `.wav` file.

---

## 🚀 Getting Started

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v16 or higher recommended)
- npm (bundled with Node.js)

### 2. Installation
Clone the repository and install dependencies:
```bash
git clone https://github.com/sonip362/Streamer.git
cd Streamer
npm install
```

### 3. Add Local Music (Optional)
Place your `.mp3`, `.wav`, or `.m4a` music files into the `Music/` folder in the project root.

### 4. Build Styles (Tailwind CSS v4)
Compile the Tailwind stylesheet:
```bash
npm run build:css
```
*(Or keep it watching for changes during development with `npm run watch:css`)*

### 5. Start the Server
```bash
npm start
```
Open your browser and navigate to:
```
http://localhost:3000
```

---

## 🗂️ Project Structure

```
├── Music/               # Local audio files directory
├── icons/               # PWA icons (192x192, 512x512)
├── index.html           # Main application interface & audio settings drawer
├── input.css            # Tailwind CSS v4 source styles
├── style.css            # Compiled production stylesheet
├── script.js            # Web Audio graph, playback engine, SFX synthesizer & UI logic
├── server.js            # Express server with HTTP byte-range audio streaming
├── sw.js                # Service Worker for offline caching & PWA support
├── manifest.json        # Web App Manifest
├── package.json         # Project scripts and dependencies
└── README.md            # Documentation
```

---

## 🎛️ Audio Pipeline Architecture

```
                  ┌────────────────────────┐
                  │   HTML5 Audio Source   │
                  └───────────┬────────────┘
                              │
                  ┌───────────▼────────────┐
                  │   5-Band Biquad EQ     │
                  └───────────┬────────────┘
                              │
                  ┌───────────▼────────────┐
                  │    Master EQ Bus       │
                  └─────┬────────────┬─────┘
                        │            │
         ┌──────────────┴──────┐     │
         ▼                     ▼     ▼
  ┌──────────────┐     ┌──────────────────────┐   ┌──────────────────────────┐
  │ Dry Stereo   │     │ 8D Spatial Orbit     │   │ Algorithmic Reverb       │
  │ Gain Node    │     │ (HRTF 3D Panner Node)│   │ (Pre-delay + Convolver)  │
  └──────┬───────┘     └──────────┬───────────┘   └────────────┬─────────────┘
         │                        │                            │
         │             ┌──────────▼───────────┐                │
         │             │ Compressor + Gain    │                │
         │             └──────────┬───────────┘                │
         │                        │                            │
         └────────────────┐       │       ┌────────────────────┘
                          ▼       ▼       ▼
                       ┌─────────────────────┐
                       │  Analyser Node      │
                       └──────────┬──────────┘
                                  ▼
                       ┌─────────────────────┐
                       │ Audio Destination   │
                       └─────────────────────┘
```

---

## 📄 License
This project is licensed under the [MIT License](LICENSE).
