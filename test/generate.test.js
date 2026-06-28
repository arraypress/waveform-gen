import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generatePeaks } from '../lib/generate.js';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * generatePeaks decodes a real audio file end-to-end via `audio-decode` and
 * extracts normalized peaks. These tests run an actual decode of a generated
 * PCM WAV, which also pins the `audio-decode` v3 buffer shape
 * (`{ channelData, sampleRate }`) that toAudioBufferView() adapts.
 */

/** Encode a mono Float32 signal as a 16-bit PCM WAV buffer. */
function encodeWav(samples, sampleRate) {
	const n = samples.length;
	const buf = Buffer.alloc(44 + n * 2);
	buf.write('RIFF', 0);
	buf.writeUInt32LE(36 + n * 2, 4);
	buf.write('WAVE', 8);
	buf.write('fmt ', 12);
	buf.writeUInt32LE(16, 16);          // PCM fmt chunk size
	buf.writeUInt16LE(1, 20);           // format = PCM
	buf.writeUInt16LE(1, 22);           // channels = 1
	buf.writeUInt32LE(sampleRate, 24);
	buf.writeUInt32LE(sampleRate * 2, 28);
	buf.writeUInt16LE(2, 32);           // block align
	buf.writeUInt16LE(16, 34);          // bits per sample
	buf.write('data', 36);
	buf.writeUInt32LE(n * 2, 40);
	let o = 44;
	for (let i = 0; i < n; i++) {
		let s = Math.max(-1, Math.min(1, samples[i]));
		s = s < 0 ? s * 0x8000 : s * 0x7fff;
		buf.writeInt16LE(s | 0, o);
		o += 2;
	}
	return buf;
}

function tone(sampleRate, seconds, freq, amp) {
	const n = Math.floor(sampleRate * seconds);
	const data = new Float32Array(n);
	for (let i = 0; i < n; i++) data[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate) * amp;
	return data;
}

let dir;
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'wfgen-')); });
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

async function writeWav(name, data, sampleRate = 8000) {
	const file = join(dir, name);
	await writeFile(file, encodeWav(data, sampleRate));
	return file;
}

describe('generatePeaks', () => {
	it('extracts the requested number of normalized peaks from a real WAV decode', async () => {
		const file = await writeWav('tone.wav', tone(8000, 1, 220, 0.5));
		const { peaks, bpm } = await generatePeaks(file, { samples: 64 });

		expect(peaks).toHaveLength(64);
		expect(Math.max(...peaks)).toBeCloseTo(1, 5);   // normalized to a 1.0 ceiling
		expect(Math.min(...peaks)).toBeGreaterThanOrEqual(0);
		expect(bpm).toBeNull();                          // not requested
	});

	it('honours the precision option when rounding peaks', async () => {
		const file = await writeWav('tone2.wav', tone(8000, 1, 440, 0.4));
		const { peaks } = await generatePeaks(file, { samples: 32, precision: 1 });

		expect(peaks).toHaveLength(32);
		for (const p of peaks) {
			expect(Number(p.toFixed(1))).toBe(p); // no more than 1 decimal place
		}
	});

	it('returns a numeric or null BPM without throwing when detection is on', async () => {
		const file = await writeWav('bpm.wav', tone(8000, 1, 110, 0.6));
		const { bpm } = await generatePeaks(file, { samples: 32, detectBPM: true });
		expect(bpm === null || typeof bpm === 'number').toBe(true);
	});

	it('throws a clear, actionable error for an undecodable file', async () => {
		const file = join(dir, 'broken.xyz');
		await writeFile(file, Buffer.from('this is definitely not audio'));

		await expect(generatePeaks(file)).rejects.toThrow(/Cannot decode .* Supported formats are mp3, wav, flac, and ogg/s);
	});
});
