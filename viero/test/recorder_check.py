"""Run by listener.test.js: push-to-talk Recorder + transcription job checks. Prints one JSON object."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "listener"))
import listener as L  # noqa: E402


class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


class Stream:
    def __init__(self):
        self.closed = False

    def stop(self):
        pass

    def close(self):
        self.closed = True


def make(fail=False):
    out = {"sent": [], "beeps": [], "submitted": [], "streams": []}
    clock = Clock()

    def open_stream(on_chunk):
        if fail:
            raise OSError("device busy")
        s = Stream()
        out["streams"].append(s)
        on_chunk("chunk")
        return s

    r = L.Recorder(open_stream, lambda **m: out["sent"].append(m), out["beeps"].append, out["submitted"].append, clock=clock, max_s=15)
    return r, out, clock


res = {}
r, o, c = make(fail=True)
for _ in range(30):
    r.press()  # Windows auto-repeat while the key is held
r.release()
res["busy_mic_one_error"] = sum(1 for m in o["sent"] if m.get("type") == "error") == 1 and o["beeps"].count("error") == 1 \
    and not any(m.get("type") == "tap" for m in o["sent"])

r, o, c = make()
r.press()
c.t = 0.1
r.release()
res["tap"] = [m.get("type") for m in o["sent"]] == ["state", "tap"] and o["submitted"] == [] and o["streams"][0].closed

r, o, c = make()
r.press()
r.press()
c.t = 1.0
r.release()
res["utterance"] = len(o["streams"]) == 1 and o["submitted"] == [["chunk"]] and o["streams"][0].closed

r, o, c = make()
r.press()
c.t = 16
r.tick()
capped = o["streams"][0].closed and any("held too long" in m.get("error", "") for m in o["sent"])
r.press()  # still held: auto-repeat must not reopen the mic
c.t = 30
r.release()  # the late key-up
res["cap"] = capped and len(o["streams"]) == 1 and o["submitted"] == []


class BadModel:
    def transcribe(self, *a, **k):
        raise RuntimeError("boom")


class Audio:
    size = 16000


sent = []
L.send = lambda **m: sent.append(m)
n = L.job(BadModel(), Audio(), "", None, 0)
res["job_survives"] = any(m.get("type") == "error" and "boom" in m.get("error", "") for m in sent) and n == 0
print(json.dumps(res))
