# Waveform Generator

Generate waveform peak data from audio files. A CLI tool and Node.js library for pre-computing waveform data
for [WaveformPlayer](https://github.com/arraypress/waveform-player)
and [WaveformBar](https://github.com/arraypress/waveform-bar).

Pre-generated waveforms mean instant visualization — no client-side audio decoding, no waiting for large files to
download.

![Version](https://img.shields.io/npm/v/@arraypress/waveform-gen)
![License](https://img.shields.io/npm/l/@arraypress/waveform-gen)

## Quick Start

No installation needed — run directly with `npx`:

```bash
npx @arraypress/waveform-gen ./audio/*.mp3
```

Or install globally:

```bash
npm install -g @arraypress/waveform-gen
waveform-gen ./audio/*.mp3
```

## CLI Usage

```bash
# Single file
waveform-gen song.mp3

# Multiple files (shell glob)
waveform-gen ./audio/*.mp3

# Entire directory
waveform-gen ./audio/

# Recursive directory scan
waveform-gen ./audio/ --recursive

# Custom output directory
waveform-gen ./audio/*.mp3 --output ./waveforms/

# Custom samples count
waveform-gen ./audio/*.mp3 --samples 300

# Print JSON array to stdout (for piping)
waveform-gen song.mp3 --format inline

# CSV output
waveform-gen ./audio/*.mp3 --format csv
```

### Options

| Option            | Default       | Description                            |
|-------------------|---------------|----------------------------------------|
| `--samples <n>`   | `200`         | Number of peaks to generate            |
| `--precision <n>` | `2`           | Decimal places for rounding            |
| `--output <dir>`  | Same as input | Output directory for generated files   |
| `--format <type>` | `json`        | Output format: `json`, `inline`, `csv` |
| `--recursive`     | `false`       | Scan directories recursively           |
| `--quiet`         | `false`       | Suppress progress output               |
| `--help, -h`      |               | Show help                              |

### Output Formats

**json** (default) — One `.json` file per audio file:

```json
{
  "file": "song.mp3",
  "samples": 200,
  "peaks": [
    0.12,
    0.45,
    0.89,
    0.34,
    ...
  ]
}
```

**inline** — Print raw JSON array to stdout (useful for piping):

```bash
waveform-gen song.mp3 --format inline
# [0.12,0.45,0.89,0.34,...]
```

**csv** — One `.csv` file per audio file:

```
0.12,0.45,0.89,0.34,...
```

## Library Usage

Use as a Node.js module in your own scripts:

```bash
npm install @arraypress/waveform-gen
```

```javascript
import {generatePeaks} from '@arraypress/waveform-gen';

// Basic usage
const peaks = await generatePeaks('./song.mp3');
console.log(peaks); // [0.12, 0.45, 0.89, ...]

// With options
const peaks = await generatePeaks('./song.mp3', {
    samples: 300,    // Number of peaks
    precision: 3     // Decimal places
});
```

### Batch Processing

```javascript
import {generatePeaks} from '@arraypress/waveform-gen';
import {readdir} from 'node:fs/promises';
import {writeFile} from 'node:fs/promises';

const files = (await readdir('./audio')).filter(f => f.endsWith('.mp3'));

for (const file of files) {
    const peaks = await generatePeaks(`./audio/${file}`);
    const name = file.replace('.mp3', '.json');
    await writeFile(`./waveforms/${name}`, JSON.stringify(peaks));
    console.log(`Generated: ${name}`);
}
```

## Using with WaveformPlayer

### HTML Data Attribute

```html
<!-- Paste the peaks array directly -->
<div data-waveform-player
     data-url="song.mp3"
     data-waveform="[0.12,0.45,0.89,0.34,0.67]">
</div>
```

### JavaScript

```javascript
// Load pre-generated data
const response = await fetch('/waveforms/song.json');
const {peaks} = await response.json();

new WaveformPlayer('#player', {
    url: 'song.mp3',
    waveform: peaks  // Instant display, no client-side processing
});
```

### WaveformBar

```html

<div data-wb-play
     data-url="song.mp3"
     data-title="My Song"
     data-wb-waveform="[0.12,0.45,0.89,0.34,0.67]">
</div>
```

## Build Script Example

Generate waveforms as part of your build process:

```javascript
// scripts/generate-waveforms.js
import {generatePeaks} from '@arraypress/waveform-gen';
import {readdir, writeFile, mkdir} from 'node:fs/promises';

const AUDIO_DIR = './public/audio';
const OUTPUT_DIR = './public/waveforms';

await mkdir(OUTPUT_DIR, {recursive: true});

const files = (await readdir(AUDIO_DIR))
    .filter(f => /\.(mp3|wav|flac|ogg)$/i.test(f));

console.log(`Generating waveforms for ${files.length} files...`);

for (const file of files) {
    const peaks = await generatePeaks(`${AUDIO_DIR}/${file}`, {
        samples: 200,
        precision: 2
    });

    const outName = file.replace(/\.[^.]+$/, '.json');
    await writeFile(
        `${OUTPUT_DIR}/${outName}`,
        JSON.stringify(peaks)
    );

    console.log(`  ✅ ${file} → ${outName}`);
}

console.log('Done!');
```

Add to your `package.json`:

```json
{
  "scripts": {
    "waveforms": "node scripts/generate-waveforms.js"
  }
}
```

Then run:

```bash
npm run waveforms
```

## Supported Audio Formats

- MP3
- WAV
- FLAC
- OGG
- M4A / AAC

## Algorithm

The peak extraction uses the same algorithm as WaveformPlayer's client-side generator:

1. Decode audio file to PCM samples
2. Divide samples into equal-sized buckets (one per peak)
3. Find the maximum absolute amplitude in each bucket
4. Normalize all peaks to a 0–1 range with a 0.95 ceiling

The output is identical to what `WaveformPlayer.generateWaveformData()` produces in the browser, so pre-generated and
client-generated waveforms are visually interchangeable.

## Requirements

- Node.js 18+

## License

MIT © [ArrayPress](https://github.com/arraypress)
