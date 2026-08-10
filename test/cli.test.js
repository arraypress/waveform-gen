import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
function run(args) {
	return new Promise((resolve) => {
		execFile('node', [BIN, ...args], (error, stdout, stderr) => {
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
