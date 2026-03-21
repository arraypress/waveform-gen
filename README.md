# Waveform Generator

Generate waveform config JSON files from audio files for [WaveformPlayer](https://github.com/arraypress/waveform-player) and [WaveformBar](https://github.com/arraypress/waveform-bar).

Pre-generated waveforms mean instant visualization — no client-side audio decoding needed.

![Version](https://img.shields.io/npm/v/@arraypress/waveform-gen)
![License](https://img.shields.io/npm/l/@arraypress/waveform-gen)

## Quick Start

```bash
# Run directly with npx
npx @arraypress/waveform-gen ./audio/*.mp3 --output ./waveforms/

# Or install globally
npm install -g @arraypress/waveform-gen
```

## CLI Usage

```bash
# Basic — generate JSON config per audio file
waveform-gen ./audio/*.mp3 --output ./waveforms/

# With BPM detection
waveform-gen ./audio/*.mp3 --output ./waveforms/ --bpm

# Full metadata — BPM, ID3 tags, artwork lookup
waveform-gen ./audio/*.mp3 --output ./waveforms/ --bpm --id3 --artwork ./covers/

# Custom meta fields
waveform-gen ./audio/*.mp3 --output ./waveforms/ --meta key=Am --meta genre=house

# Set audio URL prefix in JSON output
waveform-gen ./audio/*.mp3 --output ./waveforms/ --base-url assets/audio/

# Directory scan
waveform-gen ./audio/ --recursive --output ./waveforms/

# Print peaks to stdout (for piping)
waveform-gen song.mp3 --format inline
```

### Options

| Option | Default | Description |
|---|---|---|
| `--samples <n>` | `200` | Number of peaks to generate |
| `--precision <n>` | `2` | Decimal places for rounding |
| `--output <dir>` | Same as input | Output directory |
| `--format <type>` | `json` | `json` or `inline` (stdout) |
| `--bpm` | off | Detect BPM from audio |
| `--id3` | off | Read title/artist/album from ID3 tags |
| `--artwork <dir>` | off | Look for matching image by filename |
| `--base-url <path>` | filename only | Prefix for audio URLs in JSON |
| `--meta <key=val>` | — | Add custom meta fields (repeatable) |
| `--recursive` | off | Scan directories recursively |
| `--quiet` | off | Suppress progress output |

## Output Format

Each audio file produces a JSON config:

```json
{
  "url": "assets/audio/electric-desire.mp3",
  "title": "Electric Desire",
  "subtitle": "Synthwave Nights",
  "artwork": "../covers/electric-desire.webp",
  "samples": 200,
  "peaks": [0.2, 0.37, 0.41, 0.55, ...],
  "markers": [
    { "time": 0, "label": "Intro" },
    { "time": 30, "label": "Chorus" }
  ],
  "meta": {
    "bpm": "128",
    "album": "Night Drive",
    "key": "Am"
  }
}
```

Fields are included only when data is available — a basic run without flags produces `url`, `title`, `samples`, and `peaks`.

### Where Data Comes From

| Field | Source |
|---|---|
| `url` | Filename, or prefixed with `--base-url` |
| `title` | ID3 tag (`--id3`) or derived from filename |
| `subtitle` | ID3 artist tag (`--id3`) |
| `artwork` | Matched image file (`--artwork <dir>`) |
| `samples` | `--samples` flag |
| `peaks` | Generated from audio |
| `markers` | Sidecar `.markers.txt` file (auto-detected) |
| `meta.bpm` | ID3 tag (`--id3`) or detected (`--bpm`) |
| `meta.album` | ID3 tag (`--id3`) |
| `meta.*` | Custom fields (`--meta key=val`) |

## Markers

Place a `.markers.txt` file alongside the audio with the same name:

```
# electric-desire.markers.txt
0:00 Intro
0:30 Verse 1
1:15 Chorus
1:02:30 Bridge
```

Supports `SS`, `MM:SS`, and `H:MM:SS` timestamps. Lines starting with `#` are ignored. Markers are auto-detected — no flag needed.

## Artwork Lookup

With `--artwork ./covers/`, the tool looks for an image matching the audio filename:

```
audio/electric-desire.mp3 → covers/electric-desire.webp ✓
```

Tries extensions in order: `.webp`, `.jpg`, `.jpeg`, `.png`, `.svg`, `.avif`

## ID3 Tags

The `--id3` flag reads title, artist, album, and BPM from embedded file metadata. Falls back to filename-derived title if tags are missing.

## Using with WaveformPlayer

```html
<!-- Single attribute — JSON handles everything -->
<div data-waveform-player data-config="waveforms/electric-desire.json"></div>
```

## Using with WaveformBar

```js
WaveformBar.init({
    configPath: 'waveforms/'  // auto-resolves: audio/song.mp3 → waveforms/song.json
});
```

## Library Usage

```bash
npm install @arraypress/waveform-gen
```

```javascript
import { generatePeaks } from '@arraypress/waveform-gen';

const { peaks, bpm } = await generatePeaks('./song.mp3', {
    samples: 300,
    precision: 3,
    detectBPM: true
});
```

## Supported Audio

MP3, WAV, FLAC, OGG, M4A, AAC

## Requirements

Node.js 18+

## License

MIT © [ArrayPress](https://github.com/arraypress)