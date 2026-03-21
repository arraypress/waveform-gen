#!/usr/bin/env node

/**
 * waveform-gen CLI
 * Generate waveform peak data from audio files
 *
 * Usage:
 *   waveform-gen <files...> [options]
 *   waveform-gen ./audio/*.mp3
 *   waveform-gen song.mp3 --samples 300 --output ./waveforms/
 *   waveform-gen ./audio/*.mp3 --format inline --precision 3
 */

import {generatePeaks} from '../lib/generate.js';
import {writeFile, mkdir, readdir, stat} from 'node:fs/promises';
import {resolve, basename, extname, join, dirname} from 'node:path';
import {existsSync} from 'node:fs';
import {glob} from 'node:fs';

// Parse args
const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
  waveform-gen — Generate waveform peak data from audio files

  Usage:
    waveform-gen <files|directories...> [options]

  Examples:
    waveform-gen song.mp3
    waveform-gen ./audio/*.mp3
    waveform-gen ./audio/ --recursive
    waveform-gen ./audio/*.mp3 --output ./waveforms/
    waveform-gen ./audio/*.mp3 --format inline
    waveform-gen ./audio/*.mp3 --samples 300 --precision 3

  Options:
    --samples <n>      Number of peaks (default: 200)
    --precision <n>    Decimal places (default: 2)
    --output <dir>     Output directory (default: same as input)
    --format <type>    Output format: json (default), inline, csv, html
    --recursive        Scan directories recursively
    --quiet            Suppress progress output
    --help, -h         Show this help

  Output Formats:
    json      One .json file per audio file with { peaks: [...] }
    inline    Print JSON array to stdout (for piping/scripting)
    csv       One .csv file per audio file
    html      Single HTML file with ready-to-paste player markup

  Supported Audio:
    mp3, wav, flac, ogg
`);
    process.exit(0);
}

// Parse options
const options = {
    samples: 200,
    precision: 2,
    output: null,
    format: 'json',
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
    } else if (arg === '--recursive') {
        options.recursive = true;
    } else if (arg === '--quiet') {
        options.quiet = true;
    } else if (!arg.startsWith('--')) {
        inputPaths.push(arg);
    }
}

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac']);

/**
 * Resolve input paths to actual audio files
 */
async function resolveFiles(paths) {
    const files = [];

    for (const p of paths) {
        const resolved = resolve(p);

        try {
            const s = await stat(resolved);

            if (s.isFile()) {
                if (AUDIO_EXTENSIONS.has(extname(resolved).toLowerCase())) {
                    files.push(resolved);
                }
            } else if (s.isDirectory()) {
                const entries = await scanDir(resolved, options.recursive);
                files.push(...entries);
            }
        } catch (e) {
            // Not a direct file/dir — might be handled by shell glob already
            if (!options.quiet) {
                console.warn(`  ⚠ Skipping: ${p} (${e.code || e.message})`);
            }
        }
    }

    return [...new Set(files)]; // dedupe
}

/**
 * Scan directory for audio files
 */
async function scanDir(dir, recursive) {
    const files = [];
    const entries = await readdir(dir, {withFileTypes: true});

    for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isFile() && AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
            files.push(full);
        } else if (entry.isDirectory() && recursive) {
            const sub = await scanDir(full, true);
            files.push(...sub);
        }
    }

    return files;
}

/**
 * Generate output filename
 */
function getOutputPath(inputFile, outputDir, format) {
    const name = basename(inputFile, extname(inputFile));
    const extMap = {csv: '.csv', html: '.html'};
    const ext = extMap[format] || '.json';
    const dir = outputDir || dirname(inputFile);
    return join(dir, name + ext);
}

/**
 * Main
 */
async function main() {
    const files = await resolveFiles(inputPaths);

    if (files.length === 0) {
        console.error('No audio files found.');
        process.exit(1);
    }

    if (!options.quiet) {
        console.log(`\n  🎵 waveform-gen — ${files.length} file${files.length > 1 ? 's' : ''}`);
        console.log(`     samples: ${options.samples} | precision: ${options.precision} | format: ${options.format}\n`);
    }

    // Create output directory if needed
    if (options.output) {
        await mkdir(options.output, {recursive: true});
    }

    let successCount = 0;
    let errorCount = 0;
    const htmlSnippets = [];

    for (const file of files) {
        const name = basename(file);
        const nameNoExt = basename(file, extname(file));
        const title = nameNoExt.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

        try {
            if (!options.quiet && options.format !== 'html') {
                process.stdout.write(`  ⏳ ${name}...`);
            }

            const peaks = await generatePeaks(file, {
                samples: options.samples,
                precision: options.precision
            });

            if (options.format === 'inline') {
                // Print to stdout
                console.log(JSON.stringify(peaks));
            } else if (options.format === 'html') {
                // Collect snippets
                const peaksStr = JSON.stringify(peaks);
                htmlSnippets.push({name, title, peaks: peaksStr});
                if (!options.quiet) {
                    process.stdout.write(`  ✅ ${name}\n`);
                }
            } else {
                // Write file
                const outPath = getOutputPath(file, options.output, options.format);

                if (options.format === 'csv') {
                    await writeFile(outPath, peaks.join(',') + '\n');
                } else {
                    await writeFile(outPath, JSON.stringify({
                        file: name,
                        samples: options.samples,
                        peaks
                    }, null, 2) + '\n');
                }

                if (!options.quiet) {
                    process.stdout.write(`\r  ✅ ${name} → ${basename(outPath)}\n`);
                }
            }

            successCount++;
        } catch (err) {
            errorCount++;
            if (!options.quiet) {
                process.stdout.write(`\r  ❌ ${name}: ${err.message}\n`);
            }
        }
    }

    // Write combined HTML file
    if (options.format === 'html' && htmlSnippets.length > 0) {
        const outputDir = options.output || '.';
        await mkdir(outputDir, {recursive: true});
        const outPath = join(outputDir, 'waveforms.html');

        let html = `<!-- Generated by waveform-gen | ${htmlSnippets.length} tracks | ${options.samples} samples -->\n\n`;

        // WaveformPlayer snippets
        html += `<!-- ============================================\n     WaveformPlayer — data-waveform-player\n     ============================================ -->\n\n`;
        for (const s of htmlSnippets) {
            html += `<div data-waveform-player\n     data-url="${s.name}"\n     data-title="${s.title}"\n     data-waveform='${s.peaks}'>\n</div>\n\n`;
        }

        // WaveformBar snippets
        html += `<!-- ============================================\n     WaveformBar — data-wb-play\n     ============================================ -->\n\n`;
        for (const s of htmlSnippets) {
            html += `<div data-wb-play\n     data-url="${s.name}"\n     data-title="${s.title}"\n     data-wb-waveform='${s.peaks}'>\n</div>\n\n`;
        }

        await writeFile(outPath, html);

        if (!options.quiet) {
            console.log(`\n  📄 ${basename(outPath)} — ${htmlSnippets.length} players\n`);
        }
    }

    if (!options.quiet && options.format !== 'inline') {
        console.log(`  Done: ${successCount} generated, ${errorCount} failed\n`);
    }
}

main().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
});
