<div align="center">

# Waveform Gen

**Pre-generate waveform peak data from audio files.**
CLI and library that pre-computes waveform JSON for WaveformPlayer and WaveformBar — instant visualization, no client-side audio decoding.

![npm version](https://img.shields.io/npm/v/@arraypress/waveform-gen?style=flat-square&labelColor=09090b&color=3f3f46)
![license](https://img.shields.io/npm/l/@arraypress/waveform-gen?style=flat-square&labelColor=09090b&color=3f3f46)

**[Documentation](https://docs.waveformplayer.com/)** · [npm](https://www.npmjs.com/package/@arraypress/waveform-gen)

</div>

---

## Install

```bash
npm install @arraypress/waveform-gen
```

Then generate a `.json` per audio file:

```bash
npx @arraypress/waveform-gen ./audio/*.mp3 --output ./public/waveforms/ --bpm
```

### Sounds manifest

For [`@arraypress/waveform-sounds`](https://www.npmjs.com/package/@arraypress/waveform-sounds),
write one manifest for a whole pack instead of a JSON per sound:

```bash
npx @arraypress/waveform-gen ./public/previews/ --recursive \
  --manifest ./public/sounds.json --base-url /previews/
```

```json
{ "version": 1, "sounds": [
  { "url": "/previews/Bass/NW_Bass_Loop_04_128_Fmin.wav", "title": "NW Bass Loop 04",
    "type": "Bass", "bpm": 128, "key": "Fm", "duration": 8.02, "peaks": "1f3a…" }
] }
```

| Flag | Default | |
|---|---|---|
| `--manifest <file>` | | Where to write the manifest. Without `--output`, no per-file JSON is written. |
| `--root <dir>` | deepest folder containing every input | URLs and types are relative to it. |
| `--base-url <url>` | `/` | Public URL of `--root`. |
| `--type <name>` | the file's folder | Type for every sound (none for files directly in `--root`). |
| `--manifest-bars <n>` | `64` | Bars per sound, stored as 8-bit hex. |
| `--waveform-base-url <url>` | `--base-url` | Public URL of `--output`; with `--output`, each sound links its full JSON as `waveform`. |

`title`, `bpm` and `key` come from the file name, and are left out rather than
guessed: a BPM is a whole word of 50–220 (`128`, `128bpm`, `128_BPM`), a key a
whole word (`Fmin`, `F#m`, `Bbmin`, `F_minor`, `A#`); a lone `A` or `Eb` only
counts right beside the BPM. With `--bpm`, a detected tempo fills in when the
name has none. In code: `buildManifest(files, options)` and `parseFilename(name)`.

## Documentation

Full CLI options, library API and the JSON output format live in the docs.

### -> [docs.waveformplayer.com](https://docs.waveformplayer.com/)

[Overview](https://docs.waveformplayer.com/extensions/gen/) · [Library](https://docs.waveformplayer.com/extensions/gen/library/) · [Output format](https://docs.waveformplayer.com/extensions/gen/output/)

## License

MIT © [ArrayPress](https://github.com/arraypress)
