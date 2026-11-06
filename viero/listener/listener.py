"""Viero listener (spec 5.2): hold the push-to-talk key, speak, let go.

Talks to AIOS only through stdin/stdout, one JSON object per line:
  out: ready | fatal | state | heard | tap | error | done | ok
  in:  {"beep": "ok" | "unsure" | "error"}
When AIOS closes stdin (stopped or restarted) the listener exits, so no stray process is left.
Audio stays in memory and is dropped after transcription. Only --record DIR writes WAV files,
into a folder outside the vault, for the M3 real-mic bench.

Modes:  (none) live  |  --clips DIR (transcribe DIR/expected.tsv, for bench.js and tests)
        --record DIR (live, and also save each utterance)  |  --check (are the packages installed?)
        --fetch (load VIERO_MODEL, downloading it if needed: setup.js; live runs offline)
Env:    VIERO_KEY (pynput Key name, e.g. pause), VIERO_MODEL (tiny.en), VIERO_PROMPT (command vocabulary)
"""
import json
import os
import queue
import sys
import threading
import time
import wave

sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
RATE = 16000
TAP_S = 0.3  # a press shorter than this is a tap ("yes" while a question is open)
MAX_S = 15   # longest utterance: past this the mic closes on its own
FIX = "run: node modules/viero/setup.js"
_out = threading.Lock()


def send(**msg):
    with _out:
        sys.stdout.write(json.dumps(msg) + "\n")
        sys.stdout.flush()


BEEPS = {"start": [(880, 60)], "ok": [(1320, 70)], "unsure": [(660, 80), (880, 80)], "error": [(330, 140), (330, 140)]}


def beep(kind):
    def play():
        try:
            import winsound
            for freq, ms in BEEPS.get(kind, []):
                winsound.Beep(freq, ms)
        except Exception:
            pass
    threading.Thread(target=play, daemon=True).start()


def load_model(name):
    from faster_whisper import WhisperModel
    t = time.perf_counter()
    model = WhisperModel(name, device="cpu", compute_type="int8")
    return model, int((time.perf_counter() - t) * 1000)


def transcribe(model, audio, prompt):
    t = time.perf_counter()
    # temperature 0 only: the default fallback re-decodes unclear audio up to 5 more times (0.7-4 s), same words
    segs, _ = model.transcribe(audio, language="en", beam_size=1, temperature=0.0, initial_prompt=prompt or None)
    text = " ".join(s.text.strip() for s in segs).strip()
    return text, int((time.perf_counter() - t) * 1000)


def read_wav(path):
    import numpy as np
    with wave.open(path, "rb") as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0


def save_wav(path, audio):
    import numpy as np
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes((np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes())


def clips(model, folder, prompt):
    rows = [l.rstrip("\n").split("\t") for l in open(os.path.join(folder, "expected.tsv"), encoding="utf-8-sig") if l.strip()]
    for row in rows:
        text, ms = transcribe(model, read_wav(os.path.join(folder, row[0])), prompt)
        send(type="heard", file=row[0], expected=row[1] if len(row) > 1 else "", text=text, sttMs=ms)
    send(type="done")


def stdin_loop():
    for line in sys.stdin:
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        if isinstance(msg, dict) and msg.get("beep"):
            beep(msg["beep"])
    os._exit(0)  # AIOS closed the pipe


class Recorder:
    """Push-to-talk: one mic stream per physical key press, closed on key-up or after max_s.
    The stream factory, send, beep, submit and clock are passed in, so it is tested without a
    mic or keyboard (test/recorder_check.py)."""

    def __init__(self, open_stream, send, beep, submit, clock=time.perf_counter, max_s=MAX_S):
        self.open_stream, self.send, self.beep, self.submit, self.clock, self.max_s = open_stream, send, beep, submit, clock, max_s
        self.lock = threading.Lock()
        self.held = False
        self.stream = None
        self.chunks = []
        self.t0 = 0.0

    def _close(self):
        s, self.stream = self.stream, None
        if s is not None:
            try:
                s.stop()
                s.close()
            except Exception:
                pass
        return s

    def press(self):
        with self.lock:
            if self.held:
                return  # Windows auto-repeat while held: one try per physical press
            self.held = True
            self.chunks = []
            self.t0 = self.clock()
            try:
                self.stream = self.open_stream(self.chunks.append)
            except Exception as e:
                self.stream = None
                self.send(type="error", error="mic: " + str(e))
                self.beep("error")
                return
        self.beep("start")
        self.send(type="state", state="listening")

    def release(self):
        with self.lock:
            if not self.held:
                return
            self.held = False
            if self._close() is None:
                return  # the mic never opened, or the time cap already closed it
            if self.clock() - self.t0 < TAP_S:
                self.send(type="tap")
                return
            chunks, self.chunks = self.chunks, []
        self.submit(chunks)

    def tick(self):
        """Called twice a second: a missed key-up must not leave the mic open."""
        with self.lock:
            if self.stream is None or self.clock() - self.t0 <= self.max_s:
                return
            self._close()
            self.chunks = []
        self.send(type="error", error="stopped listening after %d s (key held too long)" % self.max_s)
        self.beep("error")


def job(model, audio, prompt, record_dir, n):
    """One utterance → one 'heard' line. Never raises: a failure is reported and the next
    utterance still works. Returns the recording counter."""
    send(type="state", state="transcribing")
    try:
        text, ms = transcribe(model, audio, prompt) if audio.size else ("", 0)
        if record_dir:
            n += 1
            save_wav(os.path.join(record_dir, "rec%02d.wav" % n), audio)
        send(type="heard", text=text, sttMs=ms, audioMs=int(audio.size * 1000 / RATE))
    except Exception as e:
        send(type="error", error="speech-to-text: " + str(e))
    return n


def live(model, prompt, key_name, record_dir=None):
    import numpy as np
    import sounddevice as sd
    from pynput import keyboard

    key = getattr(keyboard.Key, key_name, None)
    if key is None:
        send(type="fatal", error="unknown key " + key_name)
        sys.exit(1)
    jobs = queue.Queue()

    def open_stream(on_chunk):
        s = sd.InputStream(samplerate=RATE, channels=1, dtype="float32",
                           callback=lambda data, frames, t, status: on_chunk(data.copy()))
        s.start()
        return s

    def submit(chunks):
        jobs.put(np.concatenate(chunks).reshape(-1) if chunks else np.zeros(0, dtype="float32"))

    rec = Recorder(open_stream, send, beep, submit)

    def ticker():
        while True:
            time.sleep(0.5)
            rec.tick()

    def worker():
        n = 0
        while True:
            n = job(model, jobs.get(), prompt, record_dir, n)

    threading.Thread(target=ticker, daemon=True).start()
    threading.Thread(target=worker, daemon=True).start()
    with keyboard.Listener(on_press=lambda k: rec.press() if k == key else None,
                           on_release=lambda k: rec.release() if k == key else None) as listener:
        listener.join()


def main(argv):
    mode = argv[1] if len(argv) > 1 else ""
    if mode == "--check":
        try:
            import faster_whisper, numpy, pynput, sounddevice  # noqa: F401
        except Exception as e:
            send(type="fatal", error="missing package: %s (%s)" % (e, FIX))
            return 1
        send(type="ok")
        return 0
    name = os.environ.get("VIERO_MODEL", "tiny.en")
    prompt = os.environ.get("VIERO_PROMPT", "")
    try:
        model, load_ms = load_model(name)
    except Exception as e:
        send(type="fatal", error="speech model %s not ready: %s (run: node modules/viero/setup.js %s)" % (name, e, name))
        return 1
    if mode == "--fetch":
        send(type="ok", model=name, loadMs=load_ms)
        return 0
    if mode == "--clips":
        clips(model, argv[2], prompt)
        return 0
    try:
        import pynput, sounddevice  # noqa: F401
    except Exception as e:
        send(type="fatal", error="missing package: %s (%s)" % (e, FIX))
        return 1
    record_dir = argv[2] if mode == "--record" else None
    if record_dir:
        os.makedirs(record_dir, exist_ok=True)
    key = os.environ.get("VIERO_KEY", "")
    threading.Thread(target=stdin_loop, daemon=True).start()
    send(type="ready", model=name, loadMs=load_ms, key=key)
    live(model, prompt, key, record_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
