/**
 * @module generate
 * @description Core waveform peak extraction from audio files
 */

import decode from 'audio-decode';
import {readFile} from 'node:fs/promises';

/**
 * Extract normalized peak data from an audio file
 * @param {string} filePath - Path to audio file (mp3, wav, flac, ogg)
 * @param {Object} [options={}]
 * @param {number} [options.samples=200] - Number of peaks to generate
 * @param {number} [options.precision=2] - Decimal places for rounding
 * @returns {Promise<number[]>} Array of normalized peak values (0-1)
 */
export async function generatePeaks(filePath, options = {}) {
    const samples = options.samples || 200;
    const precision = options.precision !== undefined ? options.precision : 2;

    // Read file
    const buffer = await readFile(filePath);

    // Decode audio
    const audioBuffer = await decode(buffer);

    // Extract peaks
    const peaks = extractPeaks(audioBuffer, samples);

    // Normalize
    const normalized = normalizePeaks(peaks);

    // Round
    if (precision >= 0) {
        const factor = Math.pow(10, precision);
        return normalized.map(p => Math.round(p * factor) / factor);
    }

    return normalized;
}

/**
 * Extract peak amplitudes from an AudioBuffer
 * @param {AudioBuffer} buffer
 * @param {number} samples
 * @returns {number[]}
 */
function extractPeaks(buffer, samples) {
    const sampleSize = buffer.length / samples;
    const sampleStep = ~~(sampleSize / 10) || 1;
    const channels = buffer.numberOfChannels;
    const peaks = [];

    for (let c = 0; c < channels; c++) {
        const chan = buffer.getChannelData(c);
        for (let i = 0; i < samples; i++) {
            const start = ~~(i * sampleSize);
            const end = ~~(start + sampleSize);
            let min = 0;
            let max = 0;

            for (let j = start; j < end; j += sampleStep) {
                const value = chan[j];
                if (value > max) max = value;
                if (value < min) min = value;
            }

            const peak = Math.max(Math.abs(max), Math.abs(min));
            if (c === 0 || peak > peaks[i]) {
                peaks[i] = peak;
            }
        }
    }

    return peaks;
}

/**
 * Normalize peaks to 0-1 range with 0.95 ceiling
 * @param {number[]} peaks
 * @param {number} [targetMax=0.95]
 * @returns {number[]}
 */
function normalizePeaks(peaks, targetMax = 0.95) {
    const maxPeak = Math.max(...peaks);
    if (maxPeak === 0) return peaks;
    const scale = targetMax / maxPeak;
    return peaks.map(p => Math.min(1, p * scale));
}
