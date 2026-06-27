#!/usr/bin/env node

/**
 * waveform-gen CLI
 * Generate waveform peak data from audio files
 *
 * Usage:
 *   waveform-gen ./audio/*.mp3 --output ./waveforms/
 *   waveform-gen song.mp3 --format inline
 */

import {generatePeaks} from '../lib/generate.js';
import {writeFile, mkdir, readFile, readdir, stat} from 'node:fs/promises';
import {resolve, basename, extname, join, dirname} from 'node:path';
import {existsSync} from 'node:fs';

const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
  waveform-gen — Generate waveform peak data for WaveformPlayer

  Usage:
    waveform-gen <files|directories...> [options]

  Examples:
    waveform-gen ./audio/*.mp3 --output ./waveforms/
    waveform-gen ./audio/ --recursive --output ./waveforms/
    waveform-gen song.mp3 --samples 400
    waveform-gen song.mp3 --format inline

  Options:
    --samples <n>      Number of peaks (default: 1800)
    --precision <n>    Decimal places (default: 2)
    --output <dir>     Output directory (default: same as input)
    --format <type>    json (default) or inline (stdout)
    --bpm              Detect tempo and write "bpm" into the JSON
    --recursive        Scan directories recursively
    --quiet            Suppress progress output
    --help, -h         Show this help

  JSON Output:
    {
      "peaks": [0.2, 0.37, ...],
      "markers": [{"time": 30, "label": "Chorus"}]
    }

  Markers:
    Auto-detected from sidecar files. For song.mp3, place song.markers.txt
    in the same directory:

      0:00 Intro
      0:30 Verse 1
      1:15 Chorus
      1:02:30 Bridge

  Supported Audio:
    mp3, wav, flac, ogg
    (m4a/aac need converting first, e.g. ffmpeg -i in.m4a out.wav)
`);
    process.exit(0);
}

// ============================================
// Parse options
// ============================================

const options = {
    samples: 1800,
    precision: 2,
    output: null,
    format: 'json',
    bpm: false,
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
    } else if (arg === '--recursive') {
        options.recursive = true;
    } else if (arg === '--quiet') {
        options.quiet = true;
    } else if (!arg.startsWith('--')) {
        inputPaths.push(arg);
    }
}

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac']);

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
            if (!options.quiet) console.warn(`[WaveformGen] Skipping ${p} (${e.code || e.message})`);
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
// Main
// ============================================

async function main() {
    const files = await resolveFiles(inputPaths);

    if (files.length === 0) {
        console.error('[WaveformGen] No audio files found.');
        process.exit(1);
    }

    if (!options.quiet && options.format !== 'inline') {
        console.log(`\n  🎵 waveform-gen — ${files.length} file${files.length > 1 ? 's' : ''}`);
        console.log(`     samples: ${options.samples} | precision: ${options.precision}\n`);
    }

    if (options.output) {
        await mkdir(options.output, {recursive: true});
    }

    let successCount = 0;
    let errorCount = 0;

    for (const file of files) {
        const name = basename(file);
        const nameNoExt = basename(file, extname(file));

        try {
            if (!options.quiet && options.format !== 'inline') {
                process.stdout.write(`  ⏳ ${name}...`);
            }

            // Generate peaks
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

            // Markers
            const markers = await readMarkers(file);

            // Build output
            const output = {peaks: result.peaks};
            if (result.bpm != null) output.bpm = result.bpm;
            if (markers.length) output.markers = markers;

            // Write
            const outDir = options.output || dirname(file);
            const outPath = join(outDir, nameNoExt + '.json');
            await writeFile(outPath, JSON.stringify(output, null, 2) + '\n');

            // Log
            if (!options.quiet) {
                const extras = [];
                if (result.bpm != null) extras.push(`${result.bpm} BPM`);
                if (markers.length) extras.push(`${markers.length} markers`);
                const suffix = extras.length ? ` (${extras.join(', ')})` : '';
                process.stdout.write(`\r  ✅ ${name} → ${nameNoExt}.json${suffix}\n`);
            }

            successCount++;
        } catch (err) {
            errorCount++;
            if (!options.quiet) {
                process.stderr.write(`\r  ❌ ${name}: ${err.message}\n`);
            }
        }
    }

    if (!options.quiet && options.format !== 'inline') {
        console.log(`\n  Done: ${successCount} generated, ${errorCount} failed\n`);
    }
}

main().catch(err => {
    console.error('[WaveformGen] Fatal error:', err.message);
    process.exit(1);
});