import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generatePeaks } from '../lib/generate.js';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeWav, tone } from './helpers/wav.js';

/**
 * generatePeaks decodes a real audio file end-to-end via `audio-decode` and
 * extracts normalized peaks. These tests run an actual decode of a generated
 * PCM WAV, which also pins the `audio-decode` v3 buffer shape
 * (`{ channelData, sampleRate }`) that toAudioBufferView() adapts.
 */

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

	it('calls a corrupt file of a supported format corrupt, without the m4a/aac hint', async () => {
		const file = join(dir, 'broken.mp3');
		await writeFile(file, Buffer.from('this is definitely not audio'));

		const err = await generatePeaks(file).catch(e => e);
		expect(err.message).toMatch(/broken\.mp3.*corrupt or unreadable/);
		expect(err.message).not.toMatch(/m4a|not supported/);
	});

	it('rejects a file that decodes to no audio instead of returning empty peaks', async () => {
		// An ID3 header followed by junk "decodes" to zero channels.
		const file = join(dir, 'empty.mp3');
		await writeFile(file, Buffer.concat([Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00'), Buffer.alloc(200, 7)]));

		await expect(generatePeaks(file)).rejects.toThrow(/empty\.mp3.*corrupt or unreadable/);
	});

	it('keeps the convert-first hint for m4a/aac', async () => {
		const file = join(dir, 'voice.m4a');
		await writeFile(file, Buffer.from('not decodable here'));

		await expect(generatePeaks(file)).rejects.toThrow(/m4a\/aac are not supported .* ffmpeg -i "voice\.m4a" "voice\.wav"/s);
	});
});

describe('generatePeaks samples option', () => {
	it.each([-5, 0, 100.5, NaN, 'abc', Infinity])('rejects samples = %s', async (samples) => {
		const file = await writeWav('s.wav', tone(8000, 0.25, 220, 0.5));
		await expect(generatePeaks(file, { samples })).rejects.toThrow(/samples must be a positive integer/);
	});

	it('accepts a numeric string, as the CLI does', async () => {
		const file = await writeWav('n.wav', tone(8000, 0.25, 220, 0.5));
		expect((await generatePeaks(file, { samples: '64' })).peaks).toHaveLength(64);
	});

	it('defaults to 1800 when samples is omitted', async () => {
		const file = await writeWav('d.wav', tone(8000, 0.5, 220, 0.5));
		expect((await generatePeaks(file)).peaks).toHaveLength(1800);
	});
});
