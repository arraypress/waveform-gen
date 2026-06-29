# Changelog

All notable changes to `@arraypress/waveform-gen` are documented here. The
format is based on [Keep a Changelog](https://keepachangelog.com/) and this
project adheres to [Semantic Versioning](https://semver.org/).

## [1.5.0] — 2026-06-30

### Changed

- **`generatePeaks()` default `samples` raised 200 → 1800**, aligning the Node
  library API with the CLI (which already defaulted to 1800) and the core
  player's live-decode resolution. A bare `generatePeaks(file)` now returns 1800
  peaks — the SoundCloud-scale figure that keeps wide / high-DPI waveforms
  crisp. Pass `{ samples }` to override. CLI output is unchanged.
