/**
 * Synthesised WAV fixtures, shared by the library and CLI suites so neither
 * has to ship binary audio.
 */

/** Encode a mono Float32 signal as a 16-bit PCM WAV buffer. */
export function encodeWav(samples, sampleRate) {
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

/** A sine tone of `seconds` length at `amp` peak amplitude. */
export function tone(sampleRate, seconds, freq, amp) {
	const n = Math.floor(sampleRate * seconds);
	const data = new Float32Array(n);
	for (let i = 0; i < n; i++) data[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate) * amp;
	return data;
}
