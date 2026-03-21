#!/usr/bin/env node

/**
 * waveform-gen CLI
 * Generate waveform config JSON files for WaveformPlayer
 *
 * Usage:
 *   waveform-gen ./audio/*.mp3 --output ./waveforms/
 *   waveform-gen ./audio/*.mp3 --output ./waveforms/ --bpm --id3 --artwork ./covers/
 *   waveform-gen song.mp3 --format inline
 */

import {generatePeaks} from '../lib/generate.js';
import {writeFile, mkdir, readFile, readdir, stat} from 'node:fs/promises';
import {resolve, basename, extname, join, dirname, relative} from 'node:path';
import {existsSync} from 'node:fs';

const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
  waveform-gen — Generate waveform config JSON for WaveformPlayer

  Usage:
    waveform-gen <files|directories...> [options]

  Examples:
    waveform-gen ./audio/*.mp3 --output ./waveforms/
    waveform-gen ./audio/*.mp3 --output ./waveforms/ --bpm
    waveform-gen ./audio/*.mp3 --output ./waveforms/ --bpm --id3 --artwork ./covers/
    waveform-gen song.mp3 --meta key=Am --meta genre=house
    waveform-gen ./audio/*.mp3 --output ./waveforms/ --base-url assets/audio/
    waveform-gen song.mp3 --format inline

  Options:
    --samples <n>      Number of peaks (default: 200)
    --precision <n>    Decimal places (default: 2)
    --output <dir>     Output directory (default: same as input)
    --format <type>    json (default) or inline (stdout)
    --bpm              Detect BPM and include in meta
    --id3              Read title/artist/album from ID3 tags
    --artwork <dir>    Look for matching artwork by filename
    --base-url <path>  Prefix for audio URLs in JSON (e.g. assets/audio/)
    --meta <key=val>   Add custom meta fields (repeatable)
    --recursive        Scan directories recursively
    --quiet            Suppress progress output
    --help, -h         Show this help

  JSON Output:
    {
      "title": "Track Title",
      "subtitle": "Artist Name",
      "samples": 200,
      "peaks": [0.2, 0.37, ...],
      "markers": [{"time": 30, "label": "Chorus"}],
      "meta": {"bpm": "128", "key": "Am"}
    }

  Markers:
    Auto-detected from sidecar files. For song.mp3, place song.markers.txt
    in the same directory:

      0:00 Intro
      0:30 Verse 1
      1:15 Chorus
      1:02:30 Bridge

  Artwork:
    With --artwork ./covers/, matches by audio filename:
    song.mp3 → covers/song.webp (tries .webp .jpg .jpeg .png .svg .avif)

  ID3 Tags:
    Requires: npm install music-metadata
    Reads title, artist, album, and BPM from file metadata.

  Supported Audio:
    mp3, wav, flac, ogg, m4a, aac
`);
    process.exit(0);
}

// ============================================
// Parse options
// ============================================

const options = {
    samples: 200,
    precision: 2,
    output: null,
    format: 'json',
    bpm: false,
    id3: false,
    artworkDir: null,
    baseUrl: null,
    meta: {},
    recursive: false,
    quiet: false
};

const inputPaths = [];

for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--samples' && args[i + 1]) {
        options.samples = parseInt(args[++i]);
    } else if (arg === '--precision' && args[i + 1]) {
        options.precision = parseInt(args[++i]);
    } else if (arg === '--output' && args[i + 1]) {
        options.output = args[++i];
    } else if (arg === '--format' && args[i + 1]) {
        options.format = args[++i];
    } else if (arg === '--bpm') {
        options.bpm = true;
    } else if (arg === '--id3') {
        options.id3 = true;
    } else if (arg === '--artwork' && args[i + 1]) {
        options.artworkDir = args[++i];
    } else if (arg === '--base-url' && args[i + 1]) {
        options.baseUrl = args[++i];
    } else if (arg === '--meta' && args[i + 1]) {
        const pair = args[++i];
        const eq = pair.indexOf('=');
        if (eq > 0) {
            options.meta[pair.slice(0, eq)] = pair.slice(eq + 1);
        }
    } else if (arg === '--recursive') {
        options.recursive = true;
    } else if (arg === '--quiet') {
        options.quiet = true;
    } else if (!arg.startsWith('--')) {
        inputPaths.push(arg);
    }
}

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac']);
const IMAGE_EXTENSIONS = ['.webp', '.jpg', '.jpeg', '.png', '.svg', '.avif'];

// ============================================
// File resolution
// ============================================

async function resolveFiles(paths) {
    const files = [];
    for (const p of paths) {
        const resolved = resolve(p);
        try {
            const s = await stat(resolved);
            if (s.isFile() && AUDIO_EXTENSIONS.has(extname(resolved).toLowerCase())) {
                files.push(resolved);
            } else if (s.isDirectory()) {
                files.push(...await scanDir(resolved, options.recursive));
            }
        } catch (e) {
            if (!options.quiet) console.warn(`  ⚠ Skipping: ${p} (${e.code || e.message})`);
        }
    }
    return [...new Set(files)];
}

async function scanDir(dir, recursive) {
    const files = [];
    const entries = await readdir(dir, {withFileTypes: true});
    for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isFile() && AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
            files.push(full);
        } else if (entry.isDirectory() && recursive) {
            files.push(...await scanDir(full, true));
        }
    }
    return files;
}

// ============================================
// ID3 tags
// ============================================

async function readID3(filePath) {
    try {
        const mm = await import('music-metadata');
        const metadata = await mm.parseFile(filePath);
        return {
            title: metadata.common.title || null,
            artist: metadata.common.artist || null,
            album: metadata.common.album || null,
            bpm: metadata.common.bpm || null
        };
    } catch {
        return {title: null, artist: null, album: null, bpm: null};
    }
}

// ============================================
// Markers from sidecar .markers.txt
// ============================================

function parseTimestamp(ts) {
    const parts = ts.split(':').map(Number);
    if (parts.some(isNaN)) return null;
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return null;
}

async function readMarkers(audioFilePath) {
    const nameNoExt = basename(audioFilePath, extname(audioFilePath));
    const markerFile = join(dirname(audioFilePath), nameNoExt + '.markers.txt');
    if (!existsSync(markerFile)) return [];

    try {
        const content = await readFile(markerFile, 'utf-8');
        const markers = [];
        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const match = trimmed.match(/^(\S+)\s+(.+)$/);
            if (!match) continue;
            const time = parseTimestamp(match[1]);
            if (time === null) continue;
            markers.push({time, label: match[2].trim()});
        }
        return markers;
    } catch {
        return [];
    }
}

// ============================================
// Artwork lookup
// ============================================

function findArtwork(audioFilePath, artworkDir) {
    if (!artworkDir) return null;
    const nameNoExt = basename(audioFilePath, extname(audioFilePath));
    const resolvedDir = resolve(artworkDir);

    for (const ext of IMAGE_EXTENSIONS) {
        const candidate = join(resolvedDir, nameNoExt + ext);
        if (existsSync(candidate)) {
            if (options.output) return relative(resolve(options.output), candidate);
            return relative(dirname(audioFilePath), candidate);
        }
    }
    return null;
}

// ============================================
// Main
// ============================================

async function main() {
    const files = await resolveFiles(inputPaths);

    if (files.length === 0) {
        console.error('No audio files found.');
        process.exit(1);
    }

    if (!options.quiet && options.format !== 'inline') {
        const features = [];
        if (options.bpm) features.push('bpm');
        if (options.id3) features.push('id3');
        if (options.artworkDir) features.push('artwork');
        if (Object.keys(options.meta).length) features.push('meta');

        console.log(`\n  🎵 waveform-gen — ${files.length} file${files.length > 1 ? 's' : ''}`);
        console.log(`     samples: ${options.samples} | precision: ${options.precision}`);
        if (features.length) console.log(`     features: ${features.join(', ')}`);
        console.log('');
    }

    if (options.output) {
        await mkdir(options.output, {recursive: true});
    }

    let successCount = 0;
    let errorCount = 0;

    for (const file of files) {
        const name = basename(file);
        const nameNoExt = basename(file, extname(file));
        let title = nameNoExt.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        let subtitle = '';
        let album = '';

        try {
            if (!options.quiet && options.format !== 'inline') {
                process.stdout.write(`  ⏳ ${name}...`);
            }

            // Generate peaks + optional BPM
            const result = await generatePeaks(file, {
                samples: options.samples,
                precision: options.precision,
                detectBPM: options.bpm
            });

            if (options.format === 'inline') {
                console.log(JSON.stringify(result.peaks));
                successCount++;
                continue;
            }

            // ID3 tags
            let id3bpm = null;
            if (options.id3) {
                const tags = await readID3(file);
                if (tags.title) title = tags.title;
                if (tags.artist) subtitle = tags.artist;
                if (tags.album) album = tags.album;
                if (tags.bpm) id3bpm = tags.bpm;
            }

            // Markers
            const markers = await readMarkers(file);

            // Artwork
            const artwork = findArtwork(file, options.artworkDir);

            // Meta
            const meta = {...options.meta};
            const bpm = id3bpm || result.bpm;
            if (bpm) meta.bpm = String(bpm);
            if (album) meta.album = album;

            // Build config
            const url = options.baseUrl
                ? options.baseUrl.replace(/\/?$/, '/') + name
                : name;
            const config = {url, title, samples: options.samples, peaks: result.peaks};
            if (subtitle) config.subtitle = subtitle;
            if (artwork) config.artwork = artwork;
            if (markers.length) config.markers = markers;
            if (Object.keys(meta).length) config.meta = meta;

            // Write
            const outDir = options.output || dirname(file);
            const outPath = join(outDir, nameNoExt + '.json');
            await writeFile(outPath, JSON.stringify(config, null, 2) + '\n');

            // Log
            if (!options.quiet) {
                const extras = [];
                if (meta.bpm) extras.push(`${meta.bpm} BPM`);
                if (markers.length) extras.push(`${markers.length} markers`);
                if (artwork) extras.push('artwork');
                if (subtitle) extras.push(subtitle);
                const suffix = extras.length ? ` (${extras.join(', ')})` : '';
                process.stdout.write(`\r  ✅ ${name} → ${nameNoExt}.json${suffix}\n`);
            }

            successCount++;
        } catch (err) {
            errorCount++;
            if (!options.quiet) {
                process.stdout.write(`\r  ❌ ${name}: ${err.message}\n`);
            }
        }
    }

    if (!options.quiet && options.format !== 'inline') {
        console.log(`\n  Done: ${successCount} generated, ${errorCount} failed\n`);
    }
}

main().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
});