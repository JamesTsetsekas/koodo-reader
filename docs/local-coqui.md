# Local Coqui TTS edition

This branch is a Linux-focused Koodo Reader variant that sends the bundled
Coqui TTS plug-in to a local Coqui server instead of its unavailable
browser-side runtime.

## What changed

- Speech is generated serially with a small prefetch queue, retry handling,
  bounded audio caching, and reliable pause/resume state.
- The first sentence starts as soon as it is ready; later sentences are
  prefetched in the background.
- Playback speed is applied to generated WAV audio without regenerating the
  speech.
- TTS and search highlights each have independent background and text-color
  palettes, including custom colors and hex entry.

## Local service

Run a Coqui server on `http://127.0.0.1:5002` before opening Koodo. A VCTK
English model is a practical default. This branch expects SoX to be available
for speed conversion.

```sh
tts-server --model_name tts_models/en/vctk/vits --no-use_cuda --port 5002
```

## Scope

The Coqui bridge in `main.js` and `local-coqui.cjs` is intentionally local and
Linux-oriented. General queue, highlight, and document-positioning fixes can
be split into focused upstream pull requests after review; this branch should
not be treated as a drop-in replacement for Koodo's official releases.
