# Viero (voice)

Hold the push-to-talk key anywhere in Windows, say a command, let go. Viero runs the same commands
as Ctrl+K (`game mode`, `open music`, `volume 30` — whatever your modules declare). Near misses
ask "did you mean …?": say **yes** or tap the key. Nothing else ever runs from voice.

## Setup (once per computer)

1. Python 3.10+ on the computer.
2. In the vault folder: `node modules/viero/setup.js [model]` — makes `~/.cache/aios/viero-venv`
   (outside the vault), installs faster-whisper, sounddevice and pynput into it, and downloads the
   speech model once (default tiny.en). The live listener runs offline, so changing the model later
   means running setup again with that model.
3. In `system/machine.json` → `modules.viero`: `{ "enabled": true, "key": "pause", "model": "tiny.en" }`.
   Keys: f1-f20, pause, scroll_lock, ctrl_r, shift_r (the key still reaches the focused app, so pick
   one nothing uses). Models: tiny.en (fastest), base.en, small.en.
4. Turn Viero off and on in Modules (also after changing modes or apps, so it learns the new words).

## Privacy

- The microphone is open only while the key is held. Audio stays in memory and is dropped after it is
  turned into text; it is never written to the vault.
- The listener talks to AIOS only through its own stdin/stdout — no network port.
- Every utterance is logged as text in `outputs/viero/log.md` (time, words, command, result, timings).

## Latency

`node modules/viero/bench.js <clip folder>` plays recorded clips through the full path and prints
p50/p95 per stage. `make-clips.ps1` makes synthetic clips.
