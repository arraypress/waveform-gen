import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFile, readFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { encodeWav, tone } from './helpers/wav.js';
import {
	parseFilename,
	encodePeaks,
	resamplePeaks,
	fileUrl,
	naturalCompare,
	commonRoot,
	manifestEntry,
	createManifest,
	buildManifest,
} from '../lib/index.js';

/**
 * `--manifest` writes the one-file-per-pack JSON that
 * @arraypress/waveform-sounds reads. Its peaks must decode in that package
 * exactly as encoded here, and its BPM / key / title come from file names,
 * where a wrong guess files a sound under the wrong filter — so the parsing
 * table leans on real-world sample names and on the names that must NOT
 * produce a BPM or key.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, '..', 'bin', 'waveform-gen.js');

// The core lives in a sibling repo in the family workspace. When it's there,
// the encoding is checked against the real thing; a standalone clone falls
// back to the pinned fixture below.
const CORE_DATA = join(HERE, '..', '..', 'waveform-sounds', 'src', 'js', 'data.js');
const CORE_DRAW = join(HERE, '..', '..', 'waveform-sounds', 'src', 'js', 'draw.js');
const hasCore = existsSync(CORE_DATA) && existsSync(CORE_DRAW);

describe('parseFilename', () => {
	const cases = [
		// name                              title                 bpm   key
		['Kick_01.wav',                      'Kick 01',            null, null],
		['NW_Bass_Loop_04_128_Fmin.wav',     'NW Bass Loop 04',    128,  'Fm'],
		['128_F#m_Pluck_Loop.wav',           'Pluck Loop',         128,  'F#m'],
		['Vocal Chop A.wav',                 'Vocal Chop A',       null, null],   // a lone A is a label
		['Pad_Cmaj_120.wav',                 'Pad',                120,  'C'],
		['Lead-140-A#min.wav',               'Lead',               140,  'A#m'],
		['Snare 808.wav',                    'Snare 808',          null, null],   // 808 is out of range
		['Loop 04.wav',                      'Loop 04',            null, null],
		['Bass_F_minor_90bpm.wav',           'Bass',               90,   'Fm'],
		['Drums_128_BPM_Groove.wav',         'Drums Groove',       128,  null],
		['Synth 128bpm Ebm.wav',             'Synth',              128,  'Ebm'],
		['Bbmin_Pad.wav',                    'Pad',                null, 'Bbm'],
		['Keys_C#_Major_100.wav',            'Keys',               100,  'C#'],
		['Lead_140_A.wav',                   'Lead',               140,  'A'],    // beside the BPM: a key
		['FM_Bass_Loop_120.wav',             'FM Bass Loop',       120,  null],   // FM the synth, not F major
		['fm_growl_95.wav',                  'fm growl',           95,   null],
		['I Am Here 100.wav',                'I Am Here',          100,  null],   // "Am" the word
		['Bass Loop 2 Am 90.wav',            'Bass Loop 2',        90,   'Am'],   // "Am" beside the BPM
		['Loop_090.wav',                     'Loop 090',           null, null],   // leading zero: an index
		['Kit 2 Loop 100 120.wav',           'Kit 2 Loop 100 120', null, null],   // two candidates: no guess
		['Top_Loop_(124)_Gm.wav',            'Top Loop',           124,  'Gm'],
		['Vinyl 1984 Loop.wav',              'Vinyl 1984 Loop',    null, null],
		['Plan B.wav',                       'Plan B',             null, null],
		['Lo-Fi Keys 85 Dm.mp3',             'Lo Fi Keys',         85,   'Dm'],
		['808_Bass_Glide_150_G.wav',         '808 Bass Glide',     150,  'G'],
		['Amb_Texture_Eb.wav',               'Amb Texture Eb',     null, null],   // lone flat: needs a BPM
		['128_Fmin.wav',                     '128 Fmin',           128,  'Fm'],   // nothing left: keep the name
		['Drum Loops/Kick 3.wav',            'Kick 3',             null, null],   // only the base name is read
	];

	it.each(cases)('%s', (name, title, bpm, key) => {
		expect(parseFilename(name)).toEqual({ title, bpm, key });
	});

	it('prefers a BPM marked as one over a bare number', () => {
		expect(parseFilename('Loop_100_Groove_bpm_120.wav').bpm).toBe(120);
		expect(parseFilename('Loop 100 128bpm.wav').bpm).toBe(128);
	});

	it('accepts the BPM range edges and nothing outside', () => {
		expect(parseFilename('Loop 50.wav').bpm).toBe(50);
		expect(parseFilename('Loop 220.wav').bpm).toBe(220);
		expect(parseFilename('Loop 49.wav').bpm).toBeNull();
		expect(parseFilename('Loop 221.wav').bpm).toBeNull();
	});
});

describe('encodePeaks', () => {
	const input = [0, 1, 0.5, 0.0019, 0.002, 0.062, 0.063, 1.5, -0.2, NaN, '0.25', 0.999];

	it('writes two lowercase hex characters per bar, clamped and rounded', () => {
		// Pinned fixture: what the core's encodePeaks produced for `input`.
		expect(encodePeaks(input)).toBe('00ff8000011010ff000040ff');
		expect(encodePeaks([])).toBe('');
		expect(encodePeaks(null)).toBe('');
	});

	it.skipIf(!hasCore)('is identical to waveform-sounds\' encodePeaks, and round-trips through its decodePeaks', async () => {
		const core = await import(pathToFileURL(CORE_DATA).href);
		const random = Array.from({ length: 500 }, (_, i) => Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1);
		for (const peaks of [input, random]) {
			const hex = encodePeaks(peaks);
			expect(hex).toBe(core.encodePeaks(peaks));
			expect(core.decodePeaks(hex)).toHaveLength(peaks.length);
		}
	});
});

describe('resamplePeaks', () => {
	it('keeps the loudest value in each bucket, so a transient survives', () => {
		const peaks = new Array(100).fill(0.1);
		peaks[37] = 1;
		const bars = resamplePeaks(peaks, 10);
		expect(bars).toHaveLength(10);
		expect(bars[3]).toBe(1);
		expect(bars.filter((b) => b === 1)).toHaveLength(1);
	});

	it('handles more bars than peaks, and empty input', () => {
		expect(resamplePeaks([0.2, 0.8], 4)).toEqual([0.2, 0.2, 0.8, 0.8]);
		expect(resamplePeaks([], 64)).toEqual([]);
	});

	it.skipIf(!hasCore)('matches waveform-sounds\' resample bucket for bucket', async () => {
		const { resample } = await import(pathToFileURL(CORE_DRAW).href);
		const peaks = Array.from({ length: 1800 }, (_, i) => Math.abs(Math.sin(i / 7)) * (i % 13 ? 0.6 : 1));
		for (const n of [1, 48, 64, 100, 1800, 2000]) {
			expect(resamplePeaks(peaks, n)).toEqual(resample(peaks, n));
		}
	});
});

describe('fileUrl', () => {
	it('joins the base and URL-encodes each segment', () => {
		expect(fileUrl('Drum Loops/kick 1.wav')).toBe('/Drum%20Loops/kick%201.wav');
		expect(fileUrl('Drum Loops/kick 1.wav', '/audio/')).toBe('/audio/Drum%20Loops/kick%201.wav');
		expect(fileUrl('a/F#m & more.wav', 'https://cdn.example.com/packs'))
			.toBe('https://cdn.example.com/packs/a/F%23m%20%26%20more.wav');
	});

	it('uses forward slashes for a Windows-style path', () => {
		expect(fileUrl('Bass\\Loop 1.wav', '/a')).toBe('/a/Bass/Loop%201.wav');
	});
});

describe('naturalCompare', () => {
	it('sorts Loop 2 before Loop 10, case-insensitively, folder by folder', () => {
		const paths = ['Loop 10.wav', 'loop 1.wav', 'Loop 2.wav', 'B/a.wav', 'A b/z.wav', 'A/z.wav'];
		expect([...paths].sort(naturalCompare))
			.toEqual(['A/z.wav', 'A b/z.wav', 'B/a.wav', 'loop 1.wav', 'Loop 2.wav', 'Loop 10.wav']);
	});
});

describe('commonRoot', () => {
	it('uses a directory as itself and a file as its folder', () => {
		expect(commonRoot([{ path: '/p/Drums/a.wav', isDir: false }, { path: '/p/Bass/b.wav', isDir: false }])).toBe('/p');
		expect(commonRoot([{ path: '/p/Drums', isDir: true }])).toBe('/p/Drums');
		expect(commonRoot([{ path: '/x/a.wav', isDir: false }, { path: '/y/b.wav', isDir: false }])).toBe('/');
		expect(commonRoot([])).toBeNull();
	});
});

describe('manifestEntry', () => {
	const peaks = Array.from({ length: 128 }, (_, i) => (i % 2 ? 1 : 0.5));

	it('builds url, title, type, bpm, key, duration and 64-bar hex peaks', () => {
		const entry = manifestEntry({ rel: 'Bass Loops/NW_Bass_Loop_04_128_Fmin.wav', peaks, duration: 8.0234, bpm: null }, { baseUrl: '/audio/' });
		expect(entry).toEqual({
			url: '/audio/Bass%20Loops/NW_Bass_Loop_04_128_Fmin.wav',
			title: 'NW Bass Loop 04',
			type: 'Bass Loops',
			bpm: 128,
			key: 'Fm',
			duration: 8.02,
			peaks: 'ff'.repeat(64),
		});
	});

	it('takes the type from the nearest folder, none in the root, --type over both', () => {
		expect(manifestEntry({ rel: 'kick.wav', peaks }).type).toBeUndefined();
		expect(manifestEntry({ rel: 'Drums/Kicks/kick.wav', peaks }).type).toBe('Kicks');
		expect(manifestEntry({ rel: 'Drums/kick.wav', peaks }, { type: 'One-shots' }).type).toBe('One-shots');
		expect(manifestEntry({ rel: 'kick.wav', peaks }, { type: 'One-shots' }).type).toBe('One-shots');
	});

	it('falls back to a detected BPM only when the name has none', () => {
		expect(manifestEntry({ rel: 'Loop_120.wav', peaks, bpm: 97 }).bpm).toBe(120);
		expect(manifestEntry({ rel: 'Loop.wav', peaks, bpm: 97 }).bpm).toBe(97);
		expect(manifestEntry({ rel: 'Loop.wav', peaks, bpm: null })).not.toHaveProperty('bpm');
	});

	it('honours bars and adds a waveform link only when given one', () => {
		const entry = manifestEntry({ rel: 'a.wav', peaks }, { bars: 16, waveform: '/wf/a.json' });
		expect(entry.peaks).toHaveLength(32);
		expect(entry.waveform).toBe('/wf/a.json');
		expect(manifestEntry({ rel: 'a.wav', peaks })).not.toHaveProperty('waveform');
	});

	it('createManifest sorts by path in natural order', () => {
		const items = ['Loop 10.wav', 'Loop 2.wav', 'Loop 1.wav'].map((rel) => ({ rel, entry: { rel } }));
		expect(createManifest(items)).toEqual({ version: 1, sounds: [{ rel: 'Loop 1.wav' }, { rel: 'Loop 2.wav' }, { rel: 'Loop 10.wav' }] });
	});
});

// ============================================
// Against real (synthesised) audio
// ============================================

let dir;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'wfgen-manifest-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

/** Write a WAV of `seconds` length under the temp dir. */
async function wav(rel, seconds = 0.5) {
	const file = join(dir, rel);
	await mkdir(dirname(file), { recursive: true });
	// A decaying tone, so the 64 bars aren't all equal.
	const data = tone(8000, seconds, 220, 0.8).map((v, i, a) => v * (1 - i / a.length));
	await writeFile(file, encodeWav(data, 8000));
	return file;
}

function run(args, opts = {}) {
	return new Promise((resolve) => {
		execFile('node', [BIN, ...args], opts, (error, stdout, stderr) => {
			resolve({ code: error ? error.code : 0, stdout, stderr });
		});
	});
}

const readJson = async (rel) => JSON.parse(await readFile(join(dir, rel), 'utf8'));

describe('buildManifest', () => {
	it('decodes files into a sorted manifest whose peaks peak at ff', async () => {
		const files = [await wav('p/Drums/Loop 10_120.wav', 1.5), await wav('p/Drums/Loop 2_120.wav'), await wav('p/Bass/Sub_90_Fm.wav')];
		const manifest = await buildManifest(files, { baseUrl: '/audio' });

		expect(manifest.version).toBe(1);
		expect(manifest.sounds.map((s) => s.url)).toEqual([
			'/audio/Bass/Sub_90_Fm.wav',
			'/audio/Drums/Loop%202_120.wav',
			'/audio/Drums/Loop%2010_120.wav',
		]);
		const loop10 = manifest.sounds[2];
		expect(loop10).toMatchObject({ title: 'Loop 10', type: 'Drums', bpm: 120, duration: 1.5 });
		expect(loop10.peaks).toMatch(/^[0-9a-f]{128}$/);
		// Normalised like the per-file JSON: the loudest bar is exactly 1.0.
		expect(loop10.peaks.match(/../g)).toContain('ff');
	});

	it('rejects a file outside the given root', async () => {
		const file = await wav('elsewhere/a.wav');
		await expect(buildManifest([file], { root: join(dir, 'p') })).rejects.toThrow(/outside the manifest root/);
	});
});

describe('CLI --manifest', () => {
	it('writes only the manifest without --output, rooted at the input folder', async () => {
		await wav('previews/Drum Loops/Loop 10_120.wav');
		await wav('previews/Drum Loops/Loop 2_120.wav');
		await wav('previews/Kick_01.wav');
		const { code, stdout } = await run(['previews', '--recursive', '--manifest', 'public/sounds.json', '--base-url', '/audio/'], { cwd: dir });

		expect(code).toBe(0);
		expect(stdout).toContain('3 sounds, 2 with BPM, 0 with key');
		const { sounds } = await readJson('public/sounds.json');
		expect(sounds.map((s) => s.url)).toEqual([
			'/audio/Drum%20Loops/Loop%202_120.wav',
			'/audio/Drum%20Loops/Loop%2010_120.wav',
			'/audio/Kick_01.wav',
		]);
		expect(sounds[2]).not.toHaveProperty('type');
		expect(sounds[0]).not.toHaveProperty('waveform');
		expect(existsSync(join(dir, 'previews/Kick_01.json'))).toBe(false);
	});

	it('with --output, also writes per-file JSON and links each sound to it', async () => {
		await wav('previews/Bass/NW_Bass_Loop_04_128_Fmin.wav');
		const { code } = await run([
			'previews', '--recursive', '--samples', '200',
			'--manifest', 'public/sounds.json', '--root', 'previews', '--base-url', '/audio/',
			'--output', 'public/wf', '--waveform-base-url', '/wf/', '--manifest-bars', '32', '--type', 'One-shots',
		], { cwd: dir });

		expect(code).toBe(0);
		const [sound] = (await readJson('public/sounds.json')).sounds;
		expect(sound).toMatchObject({
			url: '/audio/Bass/NW_Bass_Loop_04_128_Fmin.wav',
			title: 'NW Bass Loop 04',
			type: 'One-shots',
			bpm: 128,
			key: 'Fm',
			duration: 0.5,
			waveform: '/wf/Bass/NW_Bass_Loop_04_128_Fmin.json',
		});
		expect(sound.peaks).toHaveLength(64);
		// The per-file JSON is still rounded to --precision.
		const { peaks } = await readJson('public/wf/Bass/NW_Bass_Loop_04_128_Fmin.json');
		expect(peaks).toHaveLength(200);
		for (const p of peaks) expect(Number(p.toFixed(2))).toBe(p);
	});

	it('roots shell-expanded file arguments at their common folder', async () => {
		const a = await wav('previews/Drums/a.wav');
		const b = await wav('previews/Bass/b.wav');
		await run([a, b, '--manifest', 'out.json', '--quiet'], { cwd: dir });
		const { sounds } = await readJson('out.json');
		expect(sounds.map((s) => [s.url, s.type])).toEqual([['/Bass/b.wav', 'Bass'], ['/Drums/a.wav', 'Drums']]);
	});

	it('writes the good files and exits 1 when one fails', async () => {
		await wav('previews/good.wav');
		await writeFile(join(dir, 'previews/bad.wav'), 'not audio');
		const { code, stderr } = await run(['previews', '--manifest', 'm.json', '--quiet'], { cwd: dir });

		expect(code).toBe(1);
		expect(stderr).toContain('bad.wav');
		expect((await readJson('m.json')).sounds.map((s) => s.title)).toEqual(['good']);
	});

	it('fails a file outside --root', async () => {
		await wav('previews/a.wav');
		await wav('other/b.wav');
		const { code, stderr } = await run(['previews', 'other', '--manifest', 'm.json', '--root', 'previews', '--quiet'], { cwd: dir });
		expect(code).toBe(1);
		expect(stderr).toContain('outside the manifest root');
		expect((await readJson('m.json')).sounds).toHaveLength(1);
	});

	it('rejects --format inline and a bad --manifest-bars', async () => {
		expect((await run(['a.wav', '--manifest', 'm.json', '--format', 'inline'])).code).toBe(2);
		const { code, stderr } = await run(['a.wav', '--manifest', 'm.json', '--manifest-bars', '0']);
		expect(code).toBe(1);
		expect(stderr).toContain('--manifest-bars expects an integer');
	});
});
