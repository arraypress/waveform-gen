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

## Documentation

Full CLI options, library API and the JSON output format live in the docs.

### -> [docs.waveformplayer.com](https://docs.waveformplayer.com/)

[Overview](https://docs.waveformplayer.com/extensions/gen/) · [Library](https://docs.waveformplayer.com/extensions/gen/library/) · [Output format](https://docs.waveformplayer.com/extensions/gen/output/)

## License

MIT © [ArrayPress](https://github.com/arraypress)
