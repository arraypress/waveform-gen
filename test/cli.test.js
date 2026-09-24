import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFile, readFile, mkdtemp, mkdir, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { encodeWav, tone } from './helpers/wav.js';

/**
 * The CLI's flags are the one place waveform-gen takes untyped input. A bad
 * numeric flag used to become NaN and travel silently into generation — a NaN
 * sample count writes a peaks file with nothing usable in it, and a NaN
 * precision skips rounding altogether — so the failure surfaced as a quietly
 * wrong output file rather than as a rejected flag.
 *
 * Flags are parsed before any file work, so these run without audio fixtures.
 */
const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'waveform-gen.js');

/** Run the CLI and resolve with its exit code and streams (never rejects). */
function run(args, opts = {}) {
	return new Promise((resolve) => {
		execFile('node', [BIN, ...args], opts, (error, stdout, stderr) => {
			resolve({ code: error ? error.code : 0, stdout, stderr });
		});
	});
}

describe('numeric flags', () => {
	it('rejects a non-numeric --samples instead of generating NaN peaks', async () => {
		const { code, stderr } = await run(['--samples', 'abc', 'song.mp3']);
		expect(code).toBe(1);
		expect(stderr).toContain('--samples expects an integer');
	});

	it('rejects a non-integer or out-of-range --samples', async () => {
		expect((await run(['--samples', '1.5', 'song.mp3'])).code).toBe(1);
		expect((await run(['--samples', '0', 'song.mp3'])).code).toBe(1);
		expect((await run(['--samples', '-100', 'song.mp3'])).code).toBe(1);
	});

	it('rejects a non-numeric --precision', async () => {
		const { code, stderr } = await run(['--precision', 'two', 'song.mp3']);
		expect(code).toBe(1);
		expect(stderr).toContain('--precision expects an integer');
	});

	it('still accepts negative precision, the documented "do not round" case', async () => {
		// Valid flags get past parsing and fail later, on the missing input file.
		const { stderr } = await run(['--precision', '-1', 'missing.mp3']);
		expect(stderr).not.toContain('--precision expects');
		expect(stderr).toContain('No audio files found');
	});

	it('accepts a valid --samples', async () => {
		const { stderr } = await run(['--samples', '900', 'missing.mp3']);
		expect(stderr).not.toContain('--samples expects');
		expect(stderr).toContain('No audio files found');
	});
});

describe('--format', () => {
	it('rejects an unrecognised format rather than silently writing json', async () => {
		const { code, stderr } = await run(['--format', 'josn', 'song.mp3']);
		expect(code).toBe(1);
		expect(stderr).toContain('--format expects json or inline');
	});

	it('accepts the supported formats', async () => {
		for (const format of ['json', 'inline']) {
			const { stderr } = await run(['--format', format, 'missing.mp3']);
			expect(stderr).not.toContain('--format expects');
		}
	});
});

// ============================================
// Runs against real (synthesised) audio
// ============================================

let dir;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'wfgen-cli-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

/**
 * Write a short WAV under the temp dir, creating parent folders. `amp` varies
 * the signal so two same-named files are distinguishable by their peaks.
 */
async function wav(rel, amp = 0.5) {
	const file = join(dir, rel);
	await mkdir(dirname(file), { recursive: true });
	// A decaying envelope, so normalised peaks differ between amplitudes.
	const data = tone(8000, 0.25, 220, amp).map((v, i, a) => v * (1 - (i / a.length) * amp));
	await writeFile(file, encodeWav(data, 8000));
	return file;
}

const readJson = async (rel) => JSON.parse(await readFile(join(dir, rel), 'utf8'));

describe('--output layout', () => {
	it('mirrors subdirectories under --output instead of flattening them', async () => {
		await wav('in/a/intro.wav', 0.3);
		await wav('in/b/intro.wav', 0.9);
		const { code } = await run(['in', '--recursive', '--output', 'out', '--samples', '16'], { cwd: dir });

		expect(code).toBe(0);
		const a = await readJson('out/a/intro.json');
		const b = await readJson('out/b/intro.json');
		expect(a.peaks).toHaveLength(16);
		expect(a.peaks).not.toEqual(b.peaks);
		expect(existsSync(join(dir, 'out/intro.json'))).toBe(false);
	});

	it('refuses to overwrite an output path already written in the same run', async () => {
		await wav('in/song.mp3.wav'); // decoy: distinct basename, must be unaffected
		const first = await wav('in/song.wav', 0.3);
		// Same basename, different extension: both map to in/song.json.
		await writeFile(join(dir, 'in/song.flac'), await readFile(first));
		const { stdout, stderr } = await run(['in', '--samples', '16'], { cwd: dir });

		expect(stderr).toMatch(/song\.(wav|flac).*same output/);
		expect(stdout).toContain('1 failed');
		expect((await readdir(join(dir, 'in'))).filter(f => f.endsWith('.json')).sort())
			.toEqual(['song.json', 'song.mp3.json']);
	});
});

describe('failures', () => {
	it('exits non-zero when any file fails, so a build step stops', async () => {
		await wav('in/good.wav');
		await writeFile(join(dir, 'in/bad.wav'), 'not audio');
		const { code } = await run(['in', '--samples', '16'], { cwd: dir });

		expect(code).toBe(1);
		expect(existsSync(join(dir, 'in/good.json'))).toBe(true);
	});

	it('still reports errors under --quiet, while hiding progress', async () => {
		await wav('in/good.wav');
		await writeFile(join(dir, 'in/bad.wav'), 'not audio');
		const { code, stdout, stderr } = await run(['in', '--quiet', '--samples', '16'], { cwd: dir });

		expect(code).toBe(1);
		expect(stdout).toBe('');
		expect(stderr).toContain('bad.wav');
		expect(stderr).not.toContain('good.wav');
	});

	it('reports a missing input path under --quiet and fails the run', async () => {
		await wav('in/good.wav');
		const { code, stderr } = await run(['in/good.wav', 'in/typo.wav', '--quiet'], { cwd: dir });

		expect(code).toBe(1);
		expect(stderr).toContain('typo.wav');
	});

	it('exits 0 when every file succeeds', async () => {
		await wav('in/good.wav');
		const { code, stderr } = await run(['in', '--quiet', '--samples', '16'], { cwd: dir });
		expect(code).toBe(0);
		expect(stderr).toBe('');
	});
});

describe('flag syntax', () => {
	it('accepts --flag=value', async () => {
		await wav('in/good.wav');
		const { code, stdout } = await run(['--samples=16', '--format=inline', 'in/good.wav'], { cwd: dir });

		expect(code).toBe(0);
		expect(JSON.parse(stdout)).toHaveLength(16);
		expect(existsSync(join(dir, 'in/good.json'))).toBe(false);
	});

	it('accepts --output=<dir> and negative --precision=<n>', async () => {
		await wav('in/good.wav');
		const { code } = await run(['in/good.wav', '--output=out', '--precision=-1', '--samples', '16'], { cwd: dir });
		expect(code).toBe(0);
		expect((await readJson('out/good.json')).peaks).toHaveLength(16);
	});

	it('rejects an unknown flag with exit 2 instead of treating it as a path', async () => {
		for (const flag of ['-q', '--sample', '--quiet=yes']) {
			const { code, stderr } = await run(['song.mp3', flag], { cwd: dir });
			expect(code, flag).toBe(2);
			expect(stderr, flag).toMatch(/Unknown flag|does not take a value/);
		}
	});

	it('rejects a value flag with no value with exit 2', async () => {
		for (const args of [['song.mp3', '--output'], ['--output', '--quiet', 'song.mp3'], ['--samples=', 'song.mp3']]) {
			const { code, stderr } = await run(args, { cwd: dir });
			expect(code, args.join(' ')).toBe(2);
			expect(stderr, args.join(' ')).toMatch(/--(output|samples) needs a value/);
		}
	});

	it('treats everything after -- as a path', async () => {
		await wav('-odd.wav');
		const { code } = await run(['--samples', '16', '--', '-odd.wav'], { cwd: dir });
		expect(code).toBe(0);
		expect(existsSync(join(dir, '-odd.json'))).toBe(true);
	});

	it('still shows help for -h', async () => {
		const { code, stdout } = await run(['-h']);
		expect(code).toBe(0);
		expect(stdout).toContain('Usage:');
	});
});

describe('--format inline', () => {
	it('prints a bare peaks array for a single file', async () => {
		await wav('in/a.wav');
		const { code, stdout } = await run(['in/a.wav', '--format', 'inline', '--samples', '16'], { cwd: dir });
		expect(code).toBe(0);
		const out = JSON.parse(stdout);
		expect(Array.isArray(out)).toBe(true);
		expect(out).toHaveLength(16);
	});

	it('prints one object keyed by path for several files, not unlabelled arrays', async () => {
		await wav('in/a.wav', 0.3);
		await wav('in/sub/b.wav', 0.9);
		const { code, stdout } = await run(['in/a.wav', 'in/sub/b.wav', '--format', 'inline', '--samples', '16'], { cwd: dir });

		expect(code).toBe(0);
		const out = JSON.parse(stdout);
		expect(Object.keys(out)).toEqual(['in/a.wav', 'in/sub/b.wav']);
		expect(out['in/a.wav']).toHaveLength(16);
		expect(out['in/a.wav']).not.toEqual(out['in/sub/b.wav']);
	});

	it('prints an object for a directory input, even with one file in it', async () => {
		await wav('in/a.wav');
		const { stdout } = await run(['in', '--format', 'inline', '--samples', '16'], { cwd: dir });
		expect(Object.keys(JSON.parse(stdout))).toEqual(['in/a.wav']);
	});

	it('leaves failed files out of the object and exits 1', async () => {
		await wav('in/a.wav');
		await writeFile(join(dir, 'in/bad.wav'), 'not audio');
		const { code, stdout, stderr } = await run(['in', '--format', 'inline', '--samples', '16'], { cwd: dir });

		expect(code).toBe(1);
		expect(Object.keys(JSON.parse(stdout))).toEqual(['in/a.wav']);
		expect(stderr).toContain('bad.wav');
	});
});

describe('JSON output format', () => {
	// The player reads exactly { peaks, bpm?, markers? } from these files.
	it('writes only peaks by default', async () => {
		await wav('in/a.wav');
		await run(['in/a.wav', '--samples', '16'], { cwd: dir });
		expect(Object.keys(await readJson('in/a.json'))).toEqual(['peaks']);
	});

	it('writes { peaks, bpm, markers } with --bpm and a markers sidecar', async () => {
		// A click every 0.5 s (120 BPM) at 22.05 kHz, so onset detection has beats to find.
		const rate = 22050;
		const data = new Float32Array(rate * 4);
		for (let t = 0; t < data.length; t += rate / 2) {
			for (let j = 0; j < 400; j++) data[t + j] = Math.sin(j / 3) * 0.9 * (1 - j / 400);
		}
		await writeFile(join(dir, 'beat.wav'), encodeWav(data, rate));
		await writeFile(join(dir, 'beat.markers.txt'), '# comment\n0:00 Intro\n0:02 Drop\n');
		const { code } = await run(['beat.wav', '--bpm', '--samples', '16'], { cwd: dir });

		expect(code).toBe(0);
		const out = await readJson('beat.json');
		expect(Object.keys(out)).toEqual(['peaks', 'bpm', 'markers']);
		expect(out.peaks).toHaveLength(16);
		expect(typeof out.bpm).toBe('number');
		expect(out.markers).toEqual([{ time: 0, label: 'Intro' }, { time: 2, label: 'Drop' }]);
	});
});
