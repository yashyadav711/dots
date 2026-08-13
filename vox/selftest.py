#!/usr/bin/env python3
"""vox selftest — exercise every component and report what actually works.

Run with `vox test`. Safe to run any time: it never types into the focused
window (delivery is checked in clipboard mode against a sentinel) and it puts
the audio devices and config back exactly as it found them.

Layers, cheapest first:
  unit         pure logic — gesture, vocabulary, chunking, context, trimming
  detection    the VAD gate against speech and against noise
  engine       both recognisers, loading and transcribing
  end-to-end   record -> transcribe -> deliver, through the live daemon
  system       CLI, config, service, overlay, model lifecycle
"""

from __future__ import annotations

import importlib.util
import json
import math
import os
import shutil
import re
import subprocess
import sys
import time
import tomllib
import wave
from pathlib import Path

HOME = Path.home()
SHARE = HOME / ".local/share/vox"
CONFIG = HOME / ".config/vox/config.toml"
BENCH = SHARE / "bench"
SR = 16000

PASS, FAIL, SKIP = "PASS", "FAIL", "SKIP"
results: list[tuple[str, str, str, str]] = []      # layer, name, status, detail
_t0 = time.time()


def check(layer: str, name: str, ok: bool, detail: str = "") -> bool:
    results.append((layer, name, PASS if ok else FAIL, detail))
    mark = "\033[32m PASS \033[0m" if ok else "\033[31m FAIL \033[0m"
    print(f"[{mark}] {name:<44} {detail}")
    return ok


def skip(layer: str, name: str, why: str) -> None:
    results.append((layer, name, SKIP, why))
    print(f"[\033[33m SKIP \033[0m] {name:<44} {why}")


def phase(title: str) -> None:
    print(f"\n\033[1m── {title} ─────────────────────────────────────\033[0m"[:80])


def load_daemon():
    spec = importlib.util.spec_from_file_location("voxd_t", SHARE / "voxd.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["voxd_t"] = mod
    spec.loader.exec_module(mod)
    return mod


def read_wav(path: Path):
    import numpy as np
    with wave.open(str(path), "rb") as w:
        raw = w.readframes(w.getnframes())
    return np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0


def sock_cmd(cmd: str) -> dict:
    import socket
    sock = Path(os.environ.get("XDG_RUNTIME_DIR", "/tmp")) / "vox/vox.sock"
    if not sock.exists():
        return {"ok": False, "error": "daemon not running"}
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.settimeout(15)
            s.connect(str(sock))
            s.sendall(cmd.encode())
            return json.loads(s.recv(65536).decode() or "{}")
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


# ── unit ──────────────────────────────────────────────────────────────────────
def test_gesture(vd) -> None:
    ALT, ALT_R, CTRL, KEY_A = 56, 100, 29, 30
    DOWN, UP, REP = 1, 0, 2

    def fire(events, window=300.0):
        det = vd.DoubleTapDetector(window_ms=window)
        return [det.feed(c, v, t / 1000.0) for c, v, t in events].count("Alt")

    cases = [
        ("double tap fires", [(ALT, DOWN, 0), (ALT, UP, 60), (ALT, DOWN, 200)], 1),
        ("just inside the window", [(ALT, DOWN, 0), (ALT, UP, 100), (ALT, DOWN, 399)], 1),
        ("just outside the window", [(ALT, DOWN, 0), (ALT, UP, 100), (ALT, DOWN, 401)], 0),
        ("single tap ignored", [(ALT, DOWN, 0), (ALT, UP, 60)], 0),
        ("holding Alt ignored", [(ALT, DOWN, 0), (ALT, REP, 30), (ALT, UP, 500), (ALT, DOWN, 600)], 0),
        ("Alt+A chord ignored", [(ALT, DOWN, 0), (KEY_A, DOWN, 20), (KEY_A, UP, 40),
                                 (ALT, UP, 60), (ALT, DOWN, 150)], 0),
        ("Ctrl held blocks it", [(CTRL, DOWN, 0), (ALT, DOWN, 20), (ALT, UP, 60),
                                 (ALT, DOWN, 150), (CTRL, UP, 300)], 0),
        ("left then right Alt", [(ALT, DOWN, 0), (ALT, UP, 60), (ALT_R, DOWN, 200)], 1),
        ("triple tap fires once", [(ALT, DOWN, 0), (ALT, UP, 50), (ALT, DOWN, 150),
                                   (ALT, UP, 200), (ALT, DOWN, 300)], 1),
        ("two gestures fire twice", [(ALT, DOWN, 0), (ALT, UP, 50), (ALT, DOWN, 150),
                                     (ALT, UP, 200), (ALT, DOWN, 2000), (ALT, UP, 2050),
                                     (ALT, DOWN, 2150)], 2),
        ("letter between taps breaks it", [(ALT, DOWN, 0), (ALT, UP, 50), (KEY_A, DOWN, 80),
                                           (KEY_A, UP, 100), (ALT, DOWN, 150)], 0),
        ("Ctrl gesture is not Alt", [(CTRL, DOWN, 0), (CTRL, UP, 50), (CTRL, DOWN, 150)], 0),
    ]
    bad = [n for n, ev, want in cases if fire(ev) != want]
    check("unit", "double-tap gesture", not bad, f"{len(cases)-len(bad)}/{len(cases)} cases" +
          (f" — failed: {bad}" if bad else ""))
    check("unit", "input_event struct size", vd.EVENT.size == 24, f"{vd.EVENT.size} bytes")
    check("unit", "keyboards discoverable", len(vd.KeyWatcher.keyboards()) > 0,
          f"{len(vd.KeyWatcher.keyboards())} devices")


def test_vocabulary(vd) -> None:
    vocab = vd.Vocabulary()
    cases = [
        ("Yah hey daddy ka repo hai, julian ko bhejo", "Ye HeyDaddy ka repo hai, Julian ko bhejo"),
        ("n h q ka api endpoint deep seek pe hai", "NHQ ka API endpoint DeepSeek pe hai"),
        ("Thik hai? Yah main sub line mein hoon.", "Theek hai? Ye main Sublime mein hoon."),
        ("julien ko bhej do", "Julian ko bhej do"),
        # must be left alone
        ("yahan par yahi baat hai", "yahan par yahi baat hai"),
        ("Sublime already sahi hai", "Sublime already sahi hai"),
    ]
    bad = [src for src, want in cases if vocab.apply(src) != want]
    check("unit", "vocabulary replacements", not bad,
          f"{len(cases)-len(bad)}/{len(cases)} cases, {len(vocab.rules)} rules loaded")
    check("unit", "vocabulary file parses", len(vocab.rules) > 20, f"{len(vocab.rules)} rules")


def test_chunking(vd) -> None:
    cfg = vd.load_config()
    desk = vd.Desktop(cfg)
    text = " ".join(f"word{i}" for i in range(400))
    parts = desk._chunks(text)
    check("unit", "typing chunks rejoin exactly", "".join(parts) == text,
          f"{len(text)} chars -> {len(parts)} chunks")
    check("unit", "chunks respect the limit", all(len(p) <= desk.chunk_chars + 1 for p in parts),
          f"max {max(len(p) for p in parts)} vs limit {desk.chunk_chars}")
    check("unit", "short text stays one chunk", len(desk._chunks("chhota text")) == 1)


def test_audio_ctx(vd) -> None:
    ctx = vd.WhisperServerEngine._audio_ctx
    limit = vd.SHRINK_CTX_MAX_SEC
    short = ctx(limit)
    check("unit", "audio context shrinks for short clips", 0 < short < 1500,
          f"{limit:.0f}s -> {short} (~{short/50:.1f}s of context)")
    check("unit", "short context still covers the audio", short / 50 >= limit,
          f"{limit:.0f}s -> {short/50:.1f}s covered")
    check("unit", "audio context full for long clips", ctx(40.0) == 0,
          "40s -> full 30s window")
    # Past the limit a shortened context makes the decoder loop: a 9 s window
    # took 25 s and returned "Acko acko acko" instead of 4.9 s and the truth.
    # That is what froze the live caption, so anything longer must stay full.
    beyond = [ctx(d) for d in (limit + 0.1, 9.0, 14.0, 20.0)]
    check("unit", "no shrunk context past the safe limit", all(c == 0 for c in beyond),
          f"{limit:.0f}s+ -> {beyond}")
    grows = all(ctx(a) <= ctx(b) for a, b in zip([0.5, 1, 2, 3], [1, 2, 3, limit]))
    check("unit", "context grows monotonically below the limit", grows)


def test_trimming(vd) -> None:
    import numpy as np
    speech = read_wav(BENCH / "hi/mix1_16k.wav")
    trim = vd.Vox._trim_silence
    same = trim(speech).size == speech.size
    check("unit", "normal clip is not trimmed", same,
          f"{speech.size/SR:.1f}s unchanged" if same else "TRIMMED — would damage speech")
    padded = np.concatenate([np.zeros(20 * SR, np.float32), speech, np.zeros(40 * SR, np.float32)])
    out = trim(padded)
    check("unit", "long dead air is trimmed", out.size < speech.size + 3 * SR,
          f"{padded.size/SR:.0f}s -> {out.size/SR:.1f}s")


def test_meter(vd) -> None:
    """The waveform must answer one question honestly: is he being heard?

    It used to answer it only with lips on the microphone — speech from 40 cm
    drew 7 px of a 32 px wave, the same as the resting line.
    """
    import math
    import numpy as np
    speech = read_wav(BENCH / "hi/mix1_16k.wav")
    rng = np.random.default_rng(1)
    block = int(SR * 0.1)

    def bars(sig) -> list[float]:
        """Drive the real meter and return bar heights in pixels."""
        class Fake:
            db_hist = __import__("collections").deque(maxlen=100)
        meter = vd.Vox._meter.__get__(Fake(), Fake)
        out, smooth = [], 0.0
        for i in range(0, sig.size - block, block):
            rms = float(np.sqrt(np.mean(sig[i:i + block] ** 2)))
            smooth = max(meter(20 * math.log10(rms + 1e-7)), smooth * 0.82)
            out.append(smooth * 32)
        return out

    def voiced(sig) -> list[float]:
        return [v for j, v in enumerate(bars(sig))
                if float(np.sqrt(np.mean(speech[j * block:(j + 1) * block] ** 2))) > 0.004]

    quiet = rng.normal(0, 10 ** (-58 / 20), 20 * SR).astype(np.float32)
    for label, db in (("quiet", -58), ("busy", -42), ("loud", -34)):
        room = rng.normal(0, 10 ** (db / 20), 20 * SR).astype(np.float32)
        peak = max(bars(room))
        check("unit", f"wave rests through a {label} room", peak < 1.0,
              f"{db} dB room -> {peak:.1f} px of 32")

    # Every doubling of distance costs about 6 dB.
    heights = {}
    for label, att in (("at the mic", 0), ("40 cm", -12), ("80 cm", -18), ("1.5 m", -24)):
        v = voiced((speech * 10 ** (att / 20) + quiet[:speech.size]).astype(np.float32))
        heights[label] = (sum(v) / len(v), max(v))
    for label in ("40 cm", "80 cm", "1.5 m"):
        avg, peak = heights[label]
        check("unit", f"wave is alive at {label}", avg > 6.0 and peak > 14.0,
              f"avg {avg:.0f} px, peak {peak:.0f} px of 32")
    near = heights["at the mic"][0]
    far = heights["1.5 m"][0]
    check("unit", "distance costs height but never the signal", near > far > near * 0.25,
          f"at the mic {near:.0f} px -> 1.5 m {far:.0f} px")


# ── detection ─────────────────────────────────────────────────────────────────
def test_detection(vd) -> None:
    import numpy as np
    det = vd.SpeechDetector(vd.load_config())
    if not det.path:
        skip("detection", "speech gate", "no VAD model installed")
        return
    speech = read_wav(BENCH / "hi/mix1_16k.wav")
    frame = SR // 50
    rms = np.sqrt((speech[:speech.size - speech.size % frame]
                   .reshape(-1, frame) ** 2).mean(axis=1))
    first = int(np.flatnonzero(rms > rms.max() * 0.1)[0]) * frame
    rng = np.random.default_rng(23)
    noise = lambda secs, amp: rng.standard_normal(int(secs * SR)).astype(np.float32) * amp

    cases = [
        ("speech 0.8s", speech[first:first + int(0.8 * SR)], True),
        ("speech 1.2s", speech[first:first + int(1.2 * SR)], True),
        ("speech 9.4s", speech, True),
        ("speech at 4% volume", speech * 0.04, True),
        ("speech then 18s of room", np.concatenate([speech, noise(18, 0.05)]), True),
        ("quiet room 15s", noise(15, 0.0008), False),
        ("loud room 15s", noise(15, 0.05), False),
        ("loud room 60s", noise(60, 0.05), False),
        ("60Hz hum 15s", (np.sin(2 * np.pi * 60 * np.arange(15 * SR) / SR) * 0.03).astype(np.float32), False),
        ("digital silence 25s", np.zeros(25 * SR, np.float32), False),
        ("0.4s of room tone", noise(0.4, 0.05), False),
    ]
    bad = [n for n, a, want in cases if det.has_speech(a) != want]
    check("detection", "speech vs noise gate", not bad,
          f"{len(cases)-len(bad)}/{len(cases)} cases" + (f" — failed: {bad}" if bad else ""))


# ── engines ───────────────────────────────────────────────────────────────────
EXPECT_HI = "helmet na pahnane se bhaarat mein har ghante hoti hai chaar logon ki maut"
EXPECT_EN = "ask not what your country can do for you"


def similar(got: str, want: str) -> float:
    a, b = got.lower().split(), want.lower().split()
    return sum(1 for w in b if w in a) / max(len(b), 1)


def test_engines(vd) -> None:
    cfg = vd.load_config()
    hi = read_wav(BENCH / "hi/mix1_16k.wav")
    en = read_wav(BENCH / "jfk.wav")

    cfg_w = dict(cfg); cfg_w["whisper_port"] = 8621
    whisper = vd.WhisperServerEngine(cfg_w)
    ok, why = whisper.available()
    if not ok:
        skip("engine", "whisper (hinglish)", why)
    else:
        t0 = time.time(); whisper.load(); load = time.time() - t0
        check("engine", "whisper server starts", load < 10, f"{load:.2f}s")
        t0 = time.time(); text = whisper.transcribe(hi); el = time.time() - t0
        check("engine", "whisper transcribes hinglish", similar(text, EXPECT_HI) >= 0.8,
              f"{el:.2f}s (rtf {el/(hi.size/SR):.2f}) — {text[:52]!r}")
        # "segments carry timestamps" was checked here against the caption's
        # second server, the only instance that ran without `-nt`. Both are gone
        # (2026-08-13). The remaining server keeps `-nt` deliberately — see the
        # note in voxd._spawn — so timestamps are zero by design and asserting
        # otherwise would be testing a bug back into existence.
        segs = whisper._infer(hi, SR, segments=True)
        check("engine", "padding segments dropped",
              all(s < hi.size / SR for s, _e, _t in segs),
              f"all {len(segs)} start before {hi.size/SR:.1f}s")
        whisper.unload()
        check("engine", "whisper unloads", not whisper.loaded)

    parakeet = vd.ParakeetEngine(cfg)
    ok, why = parakeet.available()
    if not ok:
        skip("engine", "parakeet (english)", why)
    else:
        t0 = time.time(); text = parakeet.transcribe(en); el = time.time() - t0
        check("engine", "parakeet transcribes english", similar(text, EXPECT_EN) >= 0.9,
              f"{el:.2f}s (rtf {el/(en.size/SR):.2f}) — {text[:52]!r}")
        check("engine", "parakeet punctuates", any(c in text for c in ".,?"), repr(text[-24:]))
        parakeet.unload()
        check("engine", "parakeet unloads", not parakeet.loaded)


# ── end to end, through the running daemon ────────────────────────────────────
class Loopback:
    """Feed a wav file to the daemon as if it were the microphone."""

    def __init__(self):
        self.module = None
        self.saved_source = None
        self.saved_config = None

    def __enter__(self):
        self.saved_config = CONFIG.read_text()
        self.saved_source = subprocess.run(["pactl", "get-default-source"],
                                           capture_output=True, text=True).stdout.strip()
        self.module = subprocess.run(["pactl", "load-module", "module-null-sink",
                                      "sink_name=voxselftest"],
                                     capture_output=True, text=True).stdout.strip()
        subprocess.run(["pactl", "suspend-sink", "voxselftest", "0"], capture_output=True)
        # Match whatever the source line currently says, not one literal value.
        # It was `text.replace('source         = ""', ...)`, which silently
        # stopped matching on 2026-08-13 when the real config moved to
        # `source = "rnnoise_source"` — the rewrite became a no-op, the daemon
        # kept listening to the live denoised mic, and every end-to-end scenario
        # failed with "abort: no speech" while looking like a dictation bug.
        text = re.sub(r'^source\s*=\s*"[^"]*"', 'source = "voxselftest.monitor"',
                      self.saved_config, count=1, flags=re.M)
        text = text.replace('output            = "paste"', 'output            = "clipboard"')
        # Polish OFF for the end-to-end scenarios. They assert the exact words
        # that came out of whisper; the polish pass legitimately rewrites
        # punctuation and adds Markdown (`**Bharat**`), so leaving it on made
        # them compare a formatted paragraph against a raw transcript and fail
        # on the formatting. The core path — capture, decode, vocabulary,
        # deliver — is what these scenarios exist to protect. Polish gets its
        # own check below, against a fixed string, where it is deterministic.
        text = re.sub(r'^polish\s*=\s*true', 'polish = false', text, count=1, flags=re.M)
        CONFIG.write_text(text)
        subprocess.run(["systemctl", "--user", "restart", "vox"], capture_output=True)
        time.sleep(3)
        return self

    def play(self, path: Path) -> None:
        subprocess.run(["paplay", "-d", "voxselftest", str(path)], capture_output=True)

    def __exit__(self, *_):
        CONFIG.write_text(self.saved_config)
        if self.module and self.module.isdigit():
            subprocess.run(["pactl", "unload-module", self.module], capture_output=True)
        if self.saved_source:
            subprocess.run(["pactl", "set-default-source", self.saved_source], capture_output=True)
        subprocess.run(["systemctl", "--user", "restart", "vox"], capture_output=True)
        time.sleep(2)


def clipboard(expect_not: str = "", tries: int = 20) -> str:
    """Read the clipboard, waiting briefly for it to actually change.

    `transcribed` is logged a beat before the text is delivered, so a test that
    waits for that line and reads the clipboard on the next statement can beat
    `wl-copy` to it — which showed up as the sentinel string still being there
    and read like a delivery failure. Poll instead of sleeping a fixed amount.
    """
    for _ in range(tries):
        out = subprocess.run(["wl-paste", "-n"], capture_output=True,
                             text=True, timeout=10).stdout
        if not expect_not or out.strip() != expect_not:
            return out
        time.sleep(0.25)
    return out


def set_clipboard(text: str) -> None:
    """`wl-copy` forks and keeps serving the selection, holding its pipes open —
    so `capture_output=True` never returns. Send the output to /dev/null."""
    subprocess.run(["wl-copy", text], stdout=subprocess.DEVNULL,
                   stderr=subprocess.DEVNULL, timeout=10)


def journal_since(stamp: str) -> str:
    """Log text for this session only.

    `--since` has one-second granularity, so a test that starts in the same
    second the previous one finished sees the previous result too. Everything
    before the last `recording started` is therefore discarded."""
    out = subprocess.run(["journalctl", "--user", "-u", "vox", "--since", stamp,
                          "--no-pager", "-o", "cat"], capture_output=True, text=True,
                         timeout=30).stdout
    return out.rsplit("recording started", 1)[-1] if "recording started" in out else out


def wait_for(stamp: str, needle: str, seconds: int = 40) -> str:
    """Block until a line containing `needle` shows up in the daemon log."""
    for _ in range(seconds):
        time.sleep(1)
        for line in journal_since(stamp).splitlines():
            if needle in line:
                return line
    return ""


def spoken_result(line: str) -> str:
    """Pull the transcript out of a `transcribed …: '<text>'` log line."""
    import re
    match = re.search(r": '(.*)'\s*$", line)
    return match.group(1) if match else ""


def test_end_to_end() -> None:
    if shutil.which("paplay") is None:
        skip("end-to-end", "loopback tests", "paplay not available")
        return

    # The daemon log is the source of truth, not the clipboard — this desktop
    # has a clipboard manager that writes to the selection on its own, which
    # made an earlier version of this test fail on a reading nobody produced.
    with Loopback() as loop:
        # 1. a real utterance goes all the way through
        stamp = time.strftime("%Y-%m-%d %H:%M:%S")
        set_clipboard("VOX-SELFTEST-SENTINEL")
        sock_cmd("start")
        time.sleep(0.8)
        loop.play(BENCH / "hi/mix1_16k.wav")
        time.sleep(0.3)
        sock_cmd("stop")
        line = wait_for(stamp, "transcribed", 40)
        text = spoken_result(line)
        check("end-to-end", "hinglish transcribed", similar(text, EXPECT_HI) >= 0.8, repr(text[:56]))
        check("end-to-end", "vocabulary applied to the result",
              "achchha" not in text and "svaad" not in text,
              "book spellings normalised")
        delivered = clipboard(expect_not="VOX-SELFTEST-SENTINEL")
        check("end-to-end", "result reaches the clipboard", similar(delivered, EXPECT_HI) >= 0.8,
              repr(delivered.strip()[:48]))
        check("end-to-end", "trailing space added", delivered.endswith(" "),
              "ready for the next sentence")

        # 2. silence must produce nothing at all
        stamp = time.strftime("%Y-%m-%d %H:%M:%S")
        sock_cmd("start")
        time.sleep(12)
        sock_cmd("stop")
        time.sleep(5)
        logs = journal_since(stamp)
        check("end-to-end", "silence produces nothing",
              "abort: no speech" in logs and "transcribed" not in logs,
              "12s of silence rejected before the model")

        # 3. the live caption streams and grows
        import re
        stamp = time.strftime("%Y-%m-%d %H:%M:%S")
        sock_cmd("start")
        time.sleep(0.8)
        loop.play(BENCH / "long43.wav")
        time.sleep(0.3)
        sock_cmd("stop")
        # 45 s was enough until the polish pass landed. long43.wav is 43 s of
        # speech, so it decodes in ~17 s and then polishes for another ~7 s —
        # and `transcribed` is now logged only once BOTH are done. At 45 s this
        # wait started returning early, and scenario 4 below then found this
        # scenario's `transcribed` line inside its own window and failed for a
        # reason that had nothing to do with cancel. Measured 2026-08-13.
        wait_for(stamp, "transcribed", 120)
        logs = journal_since(stamp)
        # Two checks lived here — "live caption updates while speaking" and
        # "live caption grows" — counting `preview +Ns Nch` lines in the log.
        # The caption was removed 2026-08-13, so those lines no longer exist and
        # the checks could only ever fail. What replaces them is the property
        # that actually matters now: while the mic is open NOTHING decodes.
        # A stray preview line would mean the partial loop came back.
        check("end-to-end", "nothing decodes while recording",
              "preview +" not in logs,
              "no partial decodes in the log for a 54s dictation")
        final = [ln for ln in logs.splitlines() if "transcribed" in ln]
        check("end-to-end", "long dictation transcribes", bool(final),
              spoken_result(final[-1])[:56] if final else "no result")

        # 4. cancel throws the audio away
        #
        # `journalctl --since` resolves to ONE SECOND. wait_for above returns the
        # instant scenario 3's `transcribed` is printed, and the three lines
        # between there and here take microseconds — so this window opened in the
        # same second as that line and contained it, and the check failed for a
        # reason that has nothing to do with cancel. Raising scenario 3's timeout
        # (2026-08-13) fixed a different instance of the same confusion and left
        # this one. Wait out the second instead.
        time.sleep(1.2)
        stamp = time.strftime("%Y-%m-%d %H:%M:%S")
        sock_cmd("start")
        time.sleep(1)
        loop.play(BENCH / "hi/mix1_16k.wav")
        sock_cmd("cancel")
        time.sleep(4)
        logs = journal_since(stamp)
        check("end-to-end", "cancel discards the recording",
              "cancelled" in logs and "transcribed" not in logs, "nothing delivered")


# ── system ────────────────────────────────────────────────────────────────────
def test_system(vd) -> None:
    for tool in ("parecord", "wtype", "wl-copy", "notify-send", "whisper-server", "hyprctl"):
        check("system", f"{tool} present", shutil.which(tool) is not None)

    groups = subprocess.run(["id", "-nG"], capture_output=True, text=True).stdout.split()
    check("system", "user can read input devices", "input" in groups)

    active = subprocess.run(["systemctl", "--user", "is-active", "vox"],
                            capture_output=True, text=True).stdout.strip()
    check("system", "service running", active == "active", active)
    enabled = subprocess.run(["systemctl", "--user", "is-enabled", "vox"],
                             capture_output=True, text=True).stdout.strip()
    check("system", "starts at login", enabled == "enabled", enabled)

    status = sock_cmd("status")
    check("system", "control socket answers", "state" in status, status.get("state", status))

    cfg = tomllib.loads(CONFIG.read_text())
    src = (SHARE / "voxd.py").read_text()
    import re
    used = (set(re.findall(r'cfg\[["\']([a-z_]+)["\']\]', src)) |
            set(re.findall(r'cfg\.get\(["\']([a-z_]+)["\']', src)))
    defaults = set(re.findall(r'^\s+"([a-z_]+)":', src, re.M))
    check("system", "no unused config keys", not (set(cfg) - used), sorted(set(cfg) - used) or "clean")
    check("system", "every key has a default", not (used - defaults), sorted(used - defaults) or "clean")

    for name in ("ggml-hinglish-q5_0.bin", "silero_vad.onnx"):
        check("system", f"model {name}", (SHARE / "models" / name).exists())

    rules = (HOME / ".config/hypr/windowrules.conf").read_text()
    check("system", "overlay unblurred in hyprland", "namespace vox" in rules)

    for cmd in (["status"], ["model"], ["doctor"]):
        rc = subprocess.run([str(HOME / ".local/bin/vox")] + cmd,
                            capture_output=True, text=True).returncode
        check("system", f"vox {cmd[0]}", rc == 0, f"exit {rc}")

    pid = subprocess.run(["systemctl", "--user", "show", "-p", "MainPID", "--value", "vox"],
                         capture_output=True, text=True).stdout.strip()
    rss = 0
    try:
        for line in open(f"/proc/{pid}/status"):
            if line.startswith("VmRSS"):
                rss = int(line.split()[1]) / 1024
    except Exception:
        pass
    check("system", "daemon idles small", 0 < rss < 120, f"{rss:.0f} MB")


def test_polish() -> None:
    # The polish pass, checked against a fixed string rather than through a
    # dictation — the scenarios above run with it off so their assertions
    # stay about the words, not the formatting. This is the part that can
    # actually break silently: the local agy rotator not running, the model
    # name going stale, or the prompt drifting into answering instead of
    # cleaning.
    try:
        import importlib.machinery
        vx = importlib.machinery.SourceFileLoader(
            "voxd_polish", str(SHARE / "voxd.py")).load_module()
        pol = vx.Polish(vx.DEFAULTS)
        raw = ("mereko teen cheez chahiye ek to markdown format doosra point wise "
               "aur teesra ye ki mera hinglish waisa hi rahe")
        out = pol.run(raw)
        check("polish", "rotator answers", out != raw and len(out) > 20, f"{len(out)} chars")
        check("polish", "keeps Hinglish romanised",
              "मैं" not in out and "chahiye" in out.lower(),
              "no Devanagari, no translation")
        check("polish", "formats a spoken list as bullets", out.count("\n-") >= 2,
              f"{out.count(chr(10) + '-')} bullets")
        check("polish", "never shortens into a summary", len(out) >= len(raw) * 0.5,
              f"{len(raw)} -> {len(out)} chars")
    except Exception as exc:
        check("polish", "rotator answers", False, f"{type(exc).__name__}: {exc}")


def main() -> int:
    print(f"\033[1mvox selftest\033[0m — {time.strftime('%Y-%m-%d %H:%M')}")
    if not (BENCH / "hi/mix1_16k.wav").exists():
        print(f"missing test audio under {BENCH}", file=sys.stderr)
        return 2
    vd = load_daemon()

    phase("unit")
    test_gesture(vd); test_vocabulary(vd); test_chunking(vd)
    test_audio_ctx(vd); test_trimming(vd); test_meter(vd)
    phase("speech detection")
    test_detection(vd)
    phase("engines")
    test_engines(vd)
    phase("end to end")
    test_end_to_end()
    phase("polish")
    test_polish()
    phase("system")
    test_system(vd)

    passed = sum(1 for *_x, s, _d in ((r[0], r[1], r[2], r[3]) for r in results) if s == PASS)
    failed = [r for r in results if r[2] == FAIL]
    skipped = [r for r in results if r[2] == SKIP]
    print(f"\n\033[1m{passed} passed, {len(failed)} failed, {len(skipped)} skipped"
          f"  ({time.time() - _t0:.0f}s)\033[0m")
    for layer, name, _s, detail in failed:
        print(f"  \033[31mFAILED\033[0m  {layer}/{name}  {detail}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
