# Changelog

All notable changes to `@arraypress/waveform-gen` are documented here. The
format is based on [Keep a Changelog](https://keepachangelog.com/) and this
project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.6.0] — 2026-08-11

### Fixed

- **Bad CLI flags are rejected instead of silently producing wrong output.**
  `--samples abc` became `NaN` and wrote a peaks file with nothing usable in it;
  `--precision two` was likewise `NaN`, which skipped rounding entirely (the
  `precision >= 0` test is false for `NaN`). Both now exit with a message naming
  the flag. Negative `--precision` still means "don't round".
- **`--format` is validated.** Only `inline` was ever tested for downstream, so
  an unrecognised format quietly behaved as `json` — writing files for someone
  who asked for stdout.

## [1.5.1] — 2026-07-01

### Changed

- Harden `normalizePeaks` — replace `Math.max(...peaks)` with a reduce so very
  large peak arrays can't trip "RangeError: Maximum call stack size exceeded".

## [1.5.0] — 2026-06-30

### Changed

- **`generatePeaks()` default `samples` raised 200 → 1800**, aligning the Node
  library API with the CLI (which already defaulted to 1800) and the core
  player's live-decode resolution. A bare `generatePeaks(file)` now returns 1800
  peaks — the SoundCloud-scale figure that keeps wide / high-DPI waveforms
  crisp. Pass `{ samples }` to override. CLI output is unchanged.
