/**
 * @module generate
 * @description Core waveform peak extraction and BPM detection from audio files
 */

import decode from 'audio-decode';
import {readFile} from 'node:fs/promises';
import {basename, extname} from 'node:path';

/**
 * Extract normalized peak data from an audio file
 * @param {string} filePath - Path to audio file (mp3, wav, flac, ogg)
 * @param {Object} [options={}]
 * @param {number} [options.samples=200] - Number of peaks to generate
 * @param {number} [options.precision=2] - Decimal places for rounding
 * @param {boolean} [options.detectBPM=false] - Also detect BPM
 * @returns {Promise<{peaks: number[], bpm: number|null}>}
 */
export async function generatePeaks(filePath, options = {}) {
    const samples = options.samples || 200;
    const precision = options.precision !== undefined ? options.precision : 2;

    // Read and decode
    const buffer = await readFile(filePath);
    let audioBuffer;
    try {
        audioBuffer = await decode(buffer);
    } catch (err) {
        // audio-decode throws "Missing decoder for <type> format" (or
        // "Cannot detect audio format") when the bundled decoders can't
        // handle the input. m4a/aac fall into this bucket — turn the cryptic
        // crash into a clear, actionable message.
        if (/missing decoder|cannot detect audio format/i.test(err.message)) {
            const ext = extname(filePath).toLowerCase().replace('.', '') || 'unknown';
            throw new Error(
                `Cannot decode "${basename(filePath)}" (${ext}). ` +
                `Supported formats are mp3, wav, flac, and ogg. ` +
                `m4a/aac are not supported — convert first, e.g.: ` +
                `ffmpeg -i "${basename(filePath)}" "${basename(filePath, extname(filePath))}.wav"`
            );
        }
        throw err;
    }

    // Extract peaks
    const peaks = extractPeaks(audioBuffer, samples);
    const normalized = normalizePeaks(peaks);

    // Round
    const rounded = precision >= 0
        ? normalized.map(p => Math.round(p * Math.pow(10, precision)) / Math.pow(10, precision))
        : normalized;

    // BPM detection
    let bpm = null;
    if (options.detectBPM) {
        bpm = detectBPM(audioBuffer);
    }

    return { peaks: rounded, bpm };
}

/**
 * Extract peak amplitudes from an AudioBuffer
 * @param {AudioBuffer} buffer
 * @param {number} samples
 * @returns {number[]}
 */
function extractPeaks(buffer, samples) {
    const sampleSize = buffer.length / samples;
    const channels = buffer.numberOfChannels;
    const peaks = [];

    for (let c = 0; c < channels; c++) {
        const chan = buffer.getChannelData(c);
        for (let i = 0; i < samples; i++) {
            const start = ~~(i * sampleSize);
            const end = ~~(start + sampleSize);
            let min = 0;
            let max = 0;

            // Scan every frame. The live player skips ~9/10 frames
            // (sampleStep = sampleSize/10) for real-time speed, but offline
            // we want accurate peaks and must not miss transients.
            for (let j = start; j < end; j++) {
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
 * Normalize peaks so the loudest peak is exactly 1.0.
 *
 * Mirrors the core player's extractPeaks normalization
 * (waveform-player/src/js/audio.js) — divide by the max — so pre-generated
 * JSON renders at identical amplitude to a live, in-browser decode. (Previously
 * this scaled to a 0.95 ceiling, making the same file render ~5% shorter.)
 * @param {number[]} peaks
 * @returns {number[]}
 */
function normalizePeaks(peaks) {
    const maxPeak = Math.max(...peaks);
    return maxPeak > 0 ? peaks.map(p => p / maxPeak) : peaks;
}

/**
 * Detect BPM from AudioBuffer
 * Ported from WaveformPlayer's bpm.js
 * @param {AudioBuffer} buffer
 * @returns {number|null}
 */
function detectBPM(buffer) {
    try {
        const channelData = buffer.getChannelData(0);
        const sampleRate = buffer.sampleRate;

        // Detect onsets (transients/beats)
        const windowSize = 2048;
        const hopSize = windowSize / 2;
        const onsets = [];
        let previousEnergy = 0;

        for (let i = 0; i < channelData.length - windowSize; i += hopSize) {
            let energy = 0;
            for (let j = i; j < i + windowSize; j++) {
                energy += channelData[j] * channelData[j];
            }
            energy = energy / windowSize;

            const energyDiff = energy - previousEnergy;
            const threshold = previousEnergy * 1.8 + 0.01;

            if (energyDiff > threshold && energy > 0.01) {
                const lastOnset = onsets[onsets.length - 1] || 0;
                const minDistance = sampleRate * 0.15;

                if (i - lastOnset > minDistance) {
                    onsets.push(i);
                }
            }

            previousEnergy = energy * 0.8 + previousEnergy * 0.2;
        }

        if (onsets.length < 2) return null;

        // Calculate intervals and convert to tempos
        const tempoGroups = {};
        for (let i = 1; i < onsets.length; i++) {
            const interval = (onsets[i] - onsets[i - 1]) / sampleRate;
            const tempo = 60 / interval;
            const bucket = Math.round(tempo / 3) * 3;
            if (bucket > 60 && bucket < 200) {
                tempoGroups[bucket] = (tempoGroups[bucket] || 0) + 1;
            }
        }

        // Find most common tempo
        let maxCount = 0;
        let detectedBPM = null;
        for (const [tempo, count] of Object.entries(tempoGroups)) {
            if (count > maxCount) {
                maxCount = count;
                detectedBPM = parseInt(tempo);
            }
        }

        if (!detectedBPM) return null;

        // Handle tempo ambiguity
        if (detectedBPM < 70 && tempoGroups[detectedBPM * 2]) {
            detectedBPM *= 2;
        } else if (detectedBPM > 160 && tempoGroups[Math.round(detectedBPM / 2)]) {
            detectedBPM = Math.round(detectedBPM / 2);
        }

        return detectedBPM - 1; // Calibration offset
    } catch (e) {
        return null;
    }
}