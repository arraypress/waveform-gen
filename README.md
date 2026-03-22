# Waveform Generator

Generate waveform peak data from audio files for [WaveformPlayer](https://github.com/arraypress/waveform-player)
and [WaveformBar](https://github.com/arraypress/waveform-bar).

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
# Generate JSON per audio file
waveform-gen ./audio/*.mp3 --output ./waveforms/

# Directory scan
waveform-gen ./audio/ --recursive --output ./waveforms/

# Custom sample count
waveform-gen ./audio/*.mp3 --output ./waveforms/ --samples 400

# Print peaks to stdout (for piping)
waveform-gen song.mp3 --format inline
```

### Options

| Option            | Default       | Description                  |
|-------------------|---------------|------------------------------|
| `--samples <n>`   | `1800`        | Number of peaks to generate  |
| `--precision <n>` | `2`           | Decimal places for rounding  |
| `--output <dir>`  | Same as input | Output directory             |
| `--format <type>` | `json`        | `json` or `inline` (stdout)  |
| `--recursive`     | off           | Scan directories recursively |
| `--quiet`         | off           | Suppress progress output     |

## Output Format

```json
{
  "peaks": [
    0.2,
    0.37,
    0.41,
    0.55,
    ...
  ]
}
```

With markers (auto-detected from sidecar file):

```json
{
  "peaks": [
    0.2,
    0.37,
    0.41,
    0.55,
    ...
  ],
  "markers": [
    {
      "time": 0,
      "label": "Intro"
    },
    {
      "time": 30,
      "label": "Chorus"
    }
  ]
}
```

## Markers

Place a `.markers.txt` file alongside the audio with the same name:

```
# song.markers.txt
0:00 Intro
0:30 Verse 1
1:15 Chorus
1:02:30 Bridge
```

Supports `SS`, `MM:SS`, and `H:MM:SS` timestamps. Lines starting with `#` are ignored. Markers are auto-detected — no
flag needed.

## Using with WaveformPlayer

```html

<div data-waveform-player
     data-url="song.mp3"
     data-waveform="waveforms/song.json">
</div>
```

## Using with WaveformBar

```html

<div data-wb-play
     data-url="song.mp3"
     data-wb-waveform="waveforms/song.json">
</div>
```

## Library Usage

```bash
npm install @arraypress/waveform-gen
```

```javascript
import {generatePeaks} from '@arraypress/waveform-gen';

const {peaks} = await generatePeaks('./song.mp3', {
    samples: 1800,
    precision: 2
});
```

## Supported Audio

MP3, WAV, FLAC, OGG, M4A, AAC

## Requirements

Node.js 18+

## Ecosystem

| Package                                                                 | Description                                                       |
|-------------------------------------------------------------------------|-------------------------------------------------------------------|
| **[WaveformPlayer](https://github.com/arraypress/waveform-player)**     | Core audio player with waveform visualization                     |
| **[WaveformBar](https://github.com/arraypress/waveform-bar)**           | Persistent bottom-bar player with queue, favorites, cart, DJ mode |
| **[WaveformGen](https://github.com/arraypress/waveform-gen)**           | CLI tool to pre-generate waveform JSON from audio files           |
| **[WaveformPlaylist](https://github.com/arraypress/waveform-playlist)** | Playlist and chapter support addon                                |
| **[WaveformTracker](https://github.com/arraypress/waveform-tracker)**   | Audio engagement analytics                                        |

## License

MIT © [ArrayPress](https://github.com/arraypress)