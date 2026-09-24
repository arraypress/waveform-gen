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
import {resolve, basename, extname, join, dirname, relative, sep} from 'node:path';
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
    --output <dir>     Output directory (default: next to each audio file).
                       Subfolders of a directory input are mirrored inside it
    --format <type>    json (default) or inline (stdout). Inline prints a
                       peaks array for one file; for several files or a
                       directory, one object: {"<path>": [peaks], ...}
    --bpm              Detect tempo and write "bpm" into the JSON
    --recursive        Scan directories recursively
    --quiet            Suppress progress output (errors are still shown)
    --help, -h         Show this help
    --                 Treat every later argument as a path

  Value flags take --flag value or --flag=value.

  Exit status:
    0  every file generated
    1  a file failed, an input path is missing, or a flag value is invalid
    2  unknown flag, or a flag missing its value

  JSON Output (bpm only with --bpm, markers only with a sidecar):
    {
      "peaks": [0.2, 0.37, ...],
      "bpm": 120,
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

/**
 * Read an integer flag, exiting with a clear message when it isn't one.
 *
 * `parseInt('abc')` is NaN, which silently propagates: a NaN sample count
 * yields a peaks file with nothing usable in it, and a NaN precision skips
 * rounding entirely (the `precision >= 0` test is false for NaN). A CLI that
 * writes quietly wrong output is worse than one that refuses the flag.
 *
 * @param {string} flag - Flag name, for the error message.
 * @param {string} raw - Raw argument value.
 * @param {number} [min] - Lowest accepted value.
 * @returns {number} The parsed integer.
 */
function intArg(flag, raw, min = -Infinity) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min) {
        console.error(`[WaveformGen] ${flag} expects an integer${min > -Infinity ? ` of ${min} or more` : ''}, got: ${raw}`);
        process.exit(1);
    }
    return n;
}

/**
 * Exit with a usage error (status 2, distinct from a failed file's 1).
 *
 * @param {string} message - What was wrong with the command line.
 */
function usageError(message) {
    console.error(`[WaveformGen] ${message} (see --help)`);
    process.exit(2);
}

// Flags that switch something on, mapped to their option key.
const BOOLEAN_FLAGS = {'--bpm': 'bpm', '--recursive': 'recursive', '--quiet': 'quiet'};
const VALUE_FLAGS = new Set(['--samples', '--precision', '--output', '--format']);

// Unrecognised flags used to be dropped silently (`--samples=10` ran with the
// default and overwrote the file) and single-dash ones like `-q` were taken
// as input paths, so anything that isn't a known flag is now refused.
let flagsEnded = false;
for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (flagsEnded || !arg.startsWith('-') || arg === '-') {
        inputPaths.push(arg);
        continue;
    }
    if (arg === '--') {
        flagsEnded = true;
        continue;
    }

    // Split `--flag=value`.
    const eq = arg.startsWith('--') ? arg.indexOf('=') : -1;
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    let value = eq > 0 ? arg.slice(eq + 1) : undefined;

    if (flag in BOOLEAN_FLAGS) {
        if (value !== undefined) usageError(`${flag} does not take a value`);
        options[BOOLEAN_FLAGS[flag]] = true;
        continue;
    }
    if (!VALUE_FLAGS.has(flag)) usageError(`Unknown flag: ${flag}`);

    if (value === undefined) {
        // A following `--flag` is a forgotten value, not the value itself.
        // (Single-dash is let through for negative --precision.)
        value = args[i + 1];
        if (value === undefined || value.startsWith('--')) usageError(`${flag} needs a value`);
        i++;
    }
    if (value === '') usageError(`${flag} needs a value`);

    if (flag === '--samples') {
        options.samples = intArg('--samples', value, 1);
    } else if (flag === '--precision') {
        // Negative precision is the documented "don't round" escape hatch, so
        // only non-integers are rejected here.
        options.precision = intArg('--precision', value);
    } else if (flag === '--output') {
        options.output = value;
    } else if (flag === '--format') {
        // Only 'inline' is ever tested for downstream, so an unrecognised
        // format used to quietly behave as 'json' — writing files for someone
        // who asked for stdout, or vice versa.
        options.format = value;
        if (options.format !== 'json' && options.format !== 'inline') {
            console.error(`[WaveformGen] --format expects json or inline, got: ${options.format}`);
            process.exit(1);
        }
    }
}

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac']);

// ============================================
// File resolution
// ============================================

/**
 * Expand the input paths into audio files, each paired with its path relative
 * to the input it came from (just the basename for a file argument). That
 * relative path is what gets mirrored under --output, so `in/a/intro.wav` and
 * `in/b/intro.wav` land in separate folders instead of on top of each other.
 *
 * @param {string[]} paths - File and directory arguments.
 * @returns {Promise<{file: string, rel: string}[]>} Unique files, first input wins.
 */
async function resolveFiles(paths) {
    const entries = new Map();
    for (const p of paths) {
        const resolved = resolve(p);
        try {
            const s = await stat(resolved);
            if (s.isFile() && AUDIO_EXTENSIONS.has(extname(resolved).toLowerCase())) {
                if (!entries.has(resolved)) entries.set(resolved, basename(resolved));
            } else if (s.isDirectory()) {
                for (const file of await scanDir(resolved, options.recursive)) {
                    if (!entries.has(file)) entries.set(file, relative(resolved, file));
                }
            }
        } catch (e) {
            // Always shown and fails the run: under --quiet a typo'd path in a
            // build script would otherwise just produce one fewer JSON file.
            console.error(`[WaveformGen] Skipping ${p} (${e.code || e.message})`);
            process.exitCode = 1;
        }
    }
    return [...entries].map(([file, rel]) => ({file, rel}));
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

    let successCount = 0;
    let errorCount = 0;

    // Inline output: one file argument prints its bare peaks array (as it
    // always has); several files, or a directory, print a single object keyed
    // by path, since back-to-back unlabelled arrays can't be told apart.
    const inlineSingle = inputPaths.length === 1 && files.length === 1
        && files[0].file === resolve(inputPaths[0]);
    const inlinePeaks = {};

    // Output paths claimed so far this run, lower-cased so `Song.json` and
    // `song.json` collide as they would on a case-insensitive filesystem.
    // `song.mp3` + `song.wav` in one folder both want `song.json`; the later
    // one used to overwrite the earlier and still be reported as generated.
    const claimed = new Map();

    for (const {file, rel: name} of files) {
        const relJson = join(dirname(name), basename(name, extname(name)) + '.json');
        const outPath = options.output
            ? join(options.output, relJson)
            : join(dirname(file), basename(relJson));

        try {
            if (!options.quiet && options.format !== 'inline') {
                process.stdout.write(`  ⏳ ${name}...`);
            }

            if (options.format !== 'inline') {
                const key = resolve(outPath).toLowerCase();
                if (claimed.has(key)) {
                    throw new Error(`same output as ${claimed.get(key)} (${relJson}) — not overwriting; rename one of them`);
                }
                claimed.set(key, name);
            }

            // Generate peaks
            const result = await generatePeaks(file, {
                samples: options.samples,
                precision: options.precision,
                detectBPM: options.bpm
            });

            if (options.format === 'inline') {
                if (inlineSingle) {
                    console.log(JSON.stringify(result.peaks));
                } else {
                    inlinePeaks[relative(process.cwd(), file).split(sep).join('/')] = result.peaks;
                }
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
            await mkdir(dirname(outPath), {recursive: true});
            await writeFile(outPath, JSON.stringify(output, null, 2) + '\n');

            // Log
            if (!options.quiet) {
                const extras = [];
                if (result.bpm != null) extras.push(`${result.bpm} BPM`);
                if (markers.length) extras.push(`${markers.length} markers`);
                const suffix = extras.length ? ` (${extras.join(', ')})` : '';
                process.stdout.write(`\r  ✅ ${name} → ${relJson}${suffix}\n`);
            }

            successCount++;
        } catch (err) {
            // Errors ignore --quiet (which only hides progress): the docs'
            // own prebuild recipe runs quiet, and a corrupt file must not
            // ship as a silently missing JSON.
            errorCount++;
            process.stderr.write(`\r  ❌ ${name}: ${err.message}\n`);
        }
    }

    if (options.format === 'inline' && !inlineSingle) {
        console.log(JSON.stringify(inlinePeaks));
    }

    if (!options.quiet && options.format !== 'inline') {
        console.log(`\n  Done: ${successCount} generated, ${errorCount} failed\n`);
    }

    if (errorCount > 0) process.exitCode = 1;
}

main().catch(err => {
    console.error('[WaveformGen] Fatal error:', err.message);
    process.exit(1);
});