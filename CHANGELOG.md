# Changelog

All notable changes to `@arraypress/waveform-gen` are documented here. The
format is based on [Keep a Changelog](https://keepachangelog.com/) and this
project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [2.1.0] — 2026-10-06

### Added

- **`--manifest <file>`** writes one sounds manifest for
  `@arraypress/waveform-sounds` — `{"version": 1, "sounds": [...]}` with each
  file's `url`, `title`, `type`, `bpm`, `key`, `duration` and low-resolution
  `peaks` — so a list of hundreds of previews loads from one request instead
  of one JSON per sound. Without `--output` only the manifest is written;
  with it, the per-file JSON is written too and each sound links to it as
  `waveform`. Files that fail are left out and still fail the run.
  - `peaks` is an 8-bit hex string, two characters per bar, encoded exactly
    as waveform-sounds' `encodePeaks`: 64 bars by default
    (`--manifest-bars <n>`), downsampled max-per-bucket from the same
    normalised peaks the per-file JSON holds (loudest bar = `ff`).
  - `url` is `--base-url` (default `/`) joined with the path relative to
    `--root` (default: the deepest folder containing every input — a
    directory argument counts as itself, a file as its folder), each segment
    URL-encoded.
  - `type` is the file's folder name (none for files directly in the root);
    `--type <name>` sets one for every sound.
  - `bpm` and `key` are read from the file name
    (`NW_Bass_Loop_04_128_Fmin.wav` → 128, `Fm`, title `NW Bass Loop 04`),
    erring towards leaving them out: a BPM is a whole word of 50–220, a key
    is a whole word, and ambiguous spellings (a lone `A`, `Eb`, `Am`) count
    only beside the BPM. With `--bpm`, a detected tempo fills in when the
    name has none.
  - `--waveform-base-url <url>` is the public URL of `--output` for the
    `waveform` links (default: `--base-url`).
  - Sounds are sorted by path in natural order (`Loop 2` before `Loop 10`).
- **Library:** `buildManifest(files, options)`, plus the pieces it is made of
  — `parseFilename`, `manifestEntry`, `createManifest`, `encodePeaks`,
  `resamplePeaks`, `fileUrl`, `naturalCompare`, `commonRoot`, `relativeTo` —
  and `roundPeaks`.
- **`generatePeaks()` also returns `duration`**, the decoded length in
  seconds.

## [2.0.0] — 2026-09-24

### Changed

- **`--output` mirrors the input's folder structure.** With `--recursive`,
  every file used to land flat in the output directory, so `a/intro.wav` and
  `b/intro.wav` both wrote `intro.json` — the second silently replacing the
  first. Each file's path relative to the directory it was found in is now
  kept under `--output` (`out/a/intro.json`, `out/b/intro.json`), with folders
  created as needed. File arguments still write straight into `--output`.
- **The CLI exits 1 when any file fails.** It used to exit 0 regardless, so a
  corrupt file in a `prebuild` step shipped as a missing JSON without stopping
  the build. A missing input path now also counts as a failure.
- **`--quiet` no longer hides errors.** It suppresses progress and the summary
  only; per-file errors and skipped input paths always go to stderr.
- **Unknown flags and missing flag values are rejected (exit 2).** Anything
  starting with `-` that isn't a known flag used to be ignored or, for
  single-dash forms like `-q`, taken as an input path; a trailing `--output`
  with no value was dropped. Use `--` before paths that start with `-`.
- **`generatePeaks()` validates `samples`.** It must be a positive integer
  (numeric strings are accepted, as on the CLI); anything else throws. A
  negative count used to return `[]` and `100.5` returned 101 peaks. `0` used
  to fall back to the default and now throws too.
- **`--format inline` with several files prints one JSON object.** Each file
  used to print its own unlabelled array back to back, with no way to tell
  which was which. Several files, or any directory input, now print
  `{"<path>": [peaks], ...}` keyed by path relative to the working directory
  (failed files are left out). A single file argument still prints a bare
  array.

### Added

- **`--flag=value` syntax** for `--samples`, `--precision`, `--output` and
  `--format`. It was previously ignored, so `--samples=10 --format=inline`
  silently ran with the defaults and overwrote the JSON.

### Fixed

- **Two inputs that map to the same JSON no longer overwrite each other.**
  `song.mp3` and `song.wav` in one folder (or two same-named file arguments
  with `--output`) both target `song.json`; the later one now fails with a
  message naming the first instead of replacing it and being reported as
  generated.
- **Corrupt mp3/wav/flac/ogg files get an accurate error.** They were told
  "Supported formats are mp3, wav, flac, and ogg … m4a/aac are not supported —
  convert first", contradicting themselves. The convert hint is now shown only
  for m4a/aac; a supported format that won't decode is reported as corrupt or
  unreadable.
- **A file that decodes to no audio is an error, not empty peaks.** Some junk
  (an ID3 tag followed by garbage) decoded to zero channels and was written
  out as `{"peaks": []}`.

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
