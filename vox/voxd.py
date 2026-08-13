#!/usr/bin/env python3
"""vox — system-wide push-to-talk dictation for Wayland.

Double-tap a bare modifier (Alt by default) anywhere on the desktop to start
recording; double-tap again to stop. The finished text is typed into whatever
window has focus and copied to the clipboard.

While you speak, a click-through overlay sits at the bottom of the screen: a
waveform that pulses from the centre outward, with a live partial transcript
underneath it. The partial preview and the final text are deliberately separate
— nothing is typed into your editor until you stop talking.

The double-tap gesture is a faithful port of Orca's ModifierDoubleTapDetector:
300 ms from the first release to the second press, bare modifier only,
auto-repeat and chords break the gesture.

Stdlib only, except the speech engine, which is imported lazily so the daemon
idles at a few MB and only pays for the model while it is being used.
"""

from __future__ import annotations

import ctypes
import gc
import json
import math
import os
import selectors
import signal
import socket
import struct
import subprocess
import sys
import threading
import time
import tomllib
import wave
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path

HOME = Path.home()
STATE_DIR = Path(os.environ.get("XDG_RUNTIME_DIR", "/tmp")) / "vox"
SHARE_DIR = HOME / ".local/share/vox"
CONFIG_PATH = HOME / ".config/vox/config.toml"
VOCAB_PATH = HOME / ".config/vox/vocabulary.toml"
SOCKET_PATH = STATE_DIR / "vox.sock"
OVERLAY_PATH = SHARE_DIR / "voxbar.py"
LAYER_SHELL_SO = "/usr/lib/libgtk4-layer-shell.so"

SAMPLE_RATE = 16000
# Above this clip length a shortened encoder context makes the decoder loop —
# see WhisperServerEngine._audio_ctx for the measurements.
# 0 disables the encoder-window shrink — see WhisperServerEngine._audio_ctx
# for the sweep that retired it on 2026-08-13.
SHRINK_CTX_MAX_SEC = 0.0
# Waveform meter. Bars start moving this far above the room's own noise floor,
# and reach full height this much above that — 34 dB is roughly the range
# between a whisper at arm's length and a normal voice at the microphone.
FLOOR_HEADROOM_DB = 4.0
# The scale's top is measured per-speaker now (see Vox._meter), so there is no
# fixed span any more — only a floor under how narrow it may collapse, which is
# what stops a silent room from turning a stray tick into a full-height bar.
MIN_SPAN_DB = 18.0
# ...and an ABSOLUTE gate under that, because the relative scale is not enough.
# Measured 2026-08-13: the denoiser puts this room at about -69 dBFS, so a tap
# on the desk at -47 sits 22 dB above the floor and, against an 18 dB span,
# pinned the bar to full — in silence. Yash: "main abhi kuchh bol bhi nahi raha
# hoon ... khud hi chale ja raha hai."
#
# -50 comes from his own speech, not from taste: across the bench clips a
# 50 ms block of speech runs -28 to -48 dBFS at the median and -14 to -23 at the
# 90th percentile, so a gate here removes the room and every quiet transient in
# it while leaving even the quietest syllable intact. Swept -70/-58/-54/-50/-46:
# -46 starts eating speech, -50 does not.
SILENCE_GATE_DB = -50.0
CHUNK_SEC = 0.05
CHUNK_BYTES = int(SAMPLE_RATE * CHUNK_SEC) * 2   # 16-bit mono

# ── linux input ───────────────────────────────────────────────────────────────
EVENT = struct.Struct("llHHi")  # struct input_event on 64-bit
EV_KEY = 0x01
KEY_UP, KEY_DOWN, KEY_REPEAT = 0, 1, 2

MODIFIER_BY_CODE = {
    42: "Shift", 54: "Shift",
    29: "Ctrl", 97: "Ctrl",
    56: "Alt", 100: "Alt",
    125: "Super", 126: "Super",
}

# Apps whose paste shortcut is Ctrl+Shift+V rather than Ctrl+V.
TERMINALS = ("kitty", "foot", "alacritty", "wezterm", "ghostty", "xterm",
             "konsole", "gnome-terminal", "orca-ide", "stably-orca")


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ── config ────────────────────────────────────────────────────────────────────
DEFAULTS: dict = {
    "modifier": "Alt",
    "double_tap_window_ms": 300,
    "idle_unload_sec": 300,
    "max_record_sec": 300,
    "min_record_sec": 0.35,
    "source": "",                  # pulse/pipewire source name; "" = system default
    "threads": 4,
    "trailing_space": True,
    "notify": True,
    "output": "paste",             # paste | type | clipboard
    "terminal_classes": TERMINALS,
    "copy_to_clipboard": True,
    "overlay": True,
    "partial_window_sec": 12.0,    # only re-decode this much tail, to bound CPU
    "engine": "whisper",
    "type_delay_ms": 0,
    "type_chunk_chars": 300,
    "type_chunk_pause_ms": 120,
    "parakeet_dir": str(HOME / ".config/orca/speech-models/parakeet-tdt-0.6b-v3-int8"),
    "whisper_model": str(SHARE_DIR / "models/ggml-hinglish-q5_0.bin"),
    "whisper_lang": "en",
    "whisper_port": 8127,
    "vad_model": str(SHARE_DIR / "models/silero_vad.onnx"),
    "vad_threshold": 0.4,
    # Second pass — see class Polish for the measurements behind these numbers.
    "polish": True,
    "polish_min_chars": 220,
    "polish_model": "gemini-3-flash",
    "polish_url": "http://127.0.0.1:51200/v1/chat/completions",
    "polish_timeout_sec": 25.0,
    "modifier_english": "Ctrl",
}


def load_config() -> dict:
    cfg = dict(DEFAULTS)
    if CONFIG_PATH.exists():
        try:
            cfg.update(tomllib.loads(CONFIG_PATH.read_text()))
        except Exception as exc:          # a broken config must not kill dictation
            log(f"config error, using defaults: {exc}")
    return cfg


class Vocabulary:
    """Literal post-transcription fixes for what the model reliably gets wrong.

    Whisper's initial-prompt biasing was tried and dropped: a 508-character
    keyword list made decoding 30% slower AND less accurate — "Helmet" came out
    as "Helpet" on a clip it had previously got right. Deterministic
    replacements cost nothing and never damage a word they were not aimed at.
    """

    def __init__(self, path: Path = VOCAB_PATH):
        self.rules: list[tuple[object, str]] = []
        if not path.exists():
            return
        try:
            data = tomllib.loads(path.read_text())
        except Exception as exc:
            # LOUD, not just logged. One duplicate key — easy to add, since the
            # file is grouped by topic and the same word can plausibly belong to
            # two groups — makes tomllib refuse the whole document, and every
            # rule in it silently stops firing. Happened while adding names on
            # 2026-08-13: "netrunners hq" was already there, and all 85 rules
            # went dead with one line in the journal that nobody reads.
            log(f"vocabulary error, ignoring it: {exc}")
            try:
                Desktop().notify("⚠️ vox vocabulary band hai",
                                 f"{path.name} parse nahi hui — koi fix apply nahi hoga. "
                                 f"{exc}", "critical")
            except Exception:
                pass
            return

        import re  # noqa: PLC0415
        # Longest first, so "hey daddy" wins over a bare "daddy" rule.
        for src, dst in sorted(data.get("fix", {}).items(), key=lambda kv: -len(kv[0])):
            src = str(src).strip()
            if not src:
                continue
            # Words are joined by whitespace OR punctuation, not whitespace
            # alone. Whisper inserts commas and full stops wherever it hears a
            # pause, so a two-word rule written `"hey daddy"` silently stopped
            # matching the moment it decoded "hey, daddy" — which is most of the
            # time. Measured 2026-08-13 on a real dictation: the HeyDaddy rule
            # had been in this file for weeks and had never once fired on speech.
            pattern = (r"\b" + r"[\s,.;:!?\-\u2013\u2014]+".join(
                re.escape(w) for w in src.split()) + r"\b")
            self.rules.append((re.compile(pattern, re.IGNORECASE), str(dst)))
        log(f"vocabulary: {len(self.rules)} fixes")

    def apply(self, text: str) -> str:
        if not text:
            return text
        for pattern, replacement in self.rules:
            def sub(m, replacement=replacement):
                # Keep the original capitalisation when the fix is lowercase,
                # so a sentence-initial "Yah" becomes "Ye", not "ye".
                found = m.group(0)
                if found[:1].isupper() and replacement[:1].islower():
                    return replacement[:1].upper() + replacement[1:]
                return replacement
            text = pattern.sub(sub, text)
        return text


# ── double-tap detector (port of Orca's ModifierDoubleTapDetector) ────────────
@dataclass
class DoubleTapDetector:
    window_ms: float = 300.0
    phase: str = "idle"                  # idle | down1 | armed
    tracked: str | None = None
    deadline: float = 0.0
    held: set[int] = field(default_factory=set)

    def reset(self) -> None:
        self.phase = "idle"
        self.tracked = None

    def feed(self, code: int, value: int, now: float) -> str | None:
        """Return the modifier token on a completed double tap, else None."""
        modifier = MODIFIER_BY_CODE.get(code)

        if modifier is not None:
            if value == KEY_DOWN:
                self.held.add(code)
            elif value == KEY_UP:
                self.held.discard(code)

        if modifier is None:                        # any real key breaks it
            if value in (KEY_DOWN, KEY_REPEAT):
                self.reset()
            return None

        if {MODIFIER_BY_CODE[c] for c in self.held if c != code} - {modifier}:
            self.reset()                            # chorded with another modifier
            return None

        if value == KEY_REPEAT:                     # held down, not tapped
            self.reset()
            return None

        if value == KEY_DOWN:
            if self.phase == "armed" and self.tracked == modifier and now <= self.deadline:
                self.reset()
                return modifier
            self.phase, self.tracked = "down1", modifier
            return None

        if self.phase == "down1" and self.tracked == modifier:
            self.phase = "armed"
            self.deadline = now + self.window_ms / 1000.0
        elif self.phase == "armed" and self.tracked == modifier:
            self.reset()
        return None


# ── keyboard watcher ──────────────────────────────────────────────────────────
class KeyWatcher(threading.Thread):
    """Reads every keyboard event device and fires on the configured double tap."""

    daemon = True

    def __init__(self, bindings: dict[str, str], window_ms: float, on_trigger):
        """`bindings` maps a modifier token ("Alt") to an engine key ("whisper")."""
        super().__init__(name="keywatcher")
        self.bindings = bindings
        self.on_trigger = on_trigger
        self.detector = DoubleTapDetector(window_ms=window_ms)
        self.sel = selectors.DefaultSelector()
        self.fds: dict[str, int] = {}

    @staticmethod
    def keyboards() -> list[str]:
        out: list[str] = []
        try:
            text = Path("/proc/bus/input/devices").read_text()
        except OSError:
            return out
        for chunk in text.split("\n\n"):
            handlers = [ln for ln in chunk.splitlines() if ln.startswith("H: Handlers=")]
            if not handlers or "kbd" not in handlers[0]:
                continue
            out += [f"/dev/input/{t}" for t in handlers[0].split("=", 1)[1].split()
                    if t.startswith("event")]
        return sorted(set(out))

    def _sync_devices(self) -> None:
        want = set(self.keyboards())
        for path in want - set(self.fds):
            try:
                fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
            except OSError as exc:
                log(f"cannot open {path}: {exc}")
                continue
            self.fds[path] = fd
            self.sel.register(fd, selectors.EVENT_READ, path)
            log(f"watching {path}")
        for path in set(self.fds) - want:
            self._drop(path)

    def _drop(self, path: str) -> None:
        fd = self.fds.pop(path, None)
        if fd is None:
            return
        try:
            self.sel.unregister(fd)
        except (KeyError, ValueError):
            pass
        try:
            os.close(fd)
        except OSError:
            pass
        log(f"dropped {path}")

    def run(self) -> None:
        self._sync_devices()
        if not self.fds:
            log("FATAL: no readable keyboard devices — is the user in the 'input' group?")
        last_scan = time.monotonic()
        while True:
            for key, _ in self.sel.select(timeout=1.0):
                try:
                    data = os.read(key.fd, EVENT.size * 64)
                except BlockingIOError:
                    continue
                except OSError:
                    self._drop(key.data)               # unplugged
                    continue
                now = time.monotonic()
                for off in range(0, len(data) - EVENT.size + 1, EVENT.size):
                    _, _, etype, code, value = EVENT.unpack_from(data, off)
                    if etype != EV_KEY:
                        continue
                    hit = self.detector.feed(code, value, now)
                    engine = self.bindings.get(hit) if hit else None
                    if engine:
                        try:
                            self.on_trigger(engine)
                        except Exception as exc:
                            log(f"trigger error: {exc}")
            if time.monotonic() - last_scan > 3.0:      # hotplug
                self._sync_devices()
                last_scan = time.monotonic()


POLISH_SYSTEM = """You clean up raw Hinglish speech-to-text and format it for reading.

LANGUAGE — never break these:
1. KEEP Hinglish exactly as spoken. Romanised Hindi stays romanised. NEVER translate to English, NEVER convert to Devanagari.
2. Fix ONLY what the transcriber got wrong: punctuation, capitalisation, proper nouns, and mis-hearings that are obvious from context.
3. Do not add, remove, summarise, answer or reword anything the speaker actually said. Every point he made must survive.

FORMAT — make it presentable Markdown:
4. When he lists things, describes steps, or moves through separate items, write them as `-` bullet points. One idea per bullet.
5. When he is telling a story or making a single continuous argument, leave it as prose in paragraphs. Do not force bullets onto flowing speech.
6. Use `**bold**` for names, tools and numbers that matter. Use a `## heading` only if he clearly moved to a new topic.
7. Keep his voice. This is his message being tidied, not rewritten into a report.

Return only the formatted text, nothing else."""


class Polish:
    """Second pass: hand the transcript to a small model to punctuate and paragraph it.

    WHY IT EXISTS: whisper writes one long run-on line. On a two-minute dictation
    that is a wall of text, and the mis-hearings that survive the vocabulary are
    exactly the ones only context can catch — "mic bilkul mere munh se" came back
    as "main ek bilkul mere munh se", which no literal rule could ever fix.

    WHY ON EVERYTHING: re-measured 2026-08-13 against the local agy rotator, the
    round trip is 3-4 s and FLAT — 33 characters and 277 characters both land
    there, because it is transport bound rather than length bound. An earlier
    note here said 6-8 s and concluded short lines were not worth it; that was
    wrong on both counts. A one-line reply is precisely where a missing capital
    or a mangled word is obvious, and it is fixed for the same 3 s a paragraph
    costs. See `wanted` for the numbers and for the two gates that came off.

    WHY THE LOCAL ROTATOR: `localhost:51200` is the agy router already running on
    this box. Zero quota across 8 accounts, no auth, and no process to start.
    Going through the `agy` CLI instead costs 14-16 s of startup alone — measured
    — which would have doubled the wait for nothing.

    IT FAILS OPEN, ALWAYS. Any error, any timeout, any empty reply and the raw
    transcript is delivered unchanged. A dictation must never be lost to a
    cleanup step that is, by definition, optional.
    """

    def __init__(self, cfg: dict):
        self.enabled = bool(cfg.get("polish", True))
        # No polish_min_sec fallback. Nothing reads it any more, and the
        # selftest is right to fail a cfg.get for a key with no default — a
        # half-removed knob is worse than either keeping it or deleting it.
        self.min_chars = int(cfg.get("polish_min_chars", 0))
        self.model = str(cfg.get("polish_model", "gemini-3-flash"))
        self.url = str(cfg.get("polish_url", "http://127.0.0.1:51200/v1/chat/completions"))
        self.timeout = float(cfg.get("polish_timeout_sec", 12.0))

    def wanted(self, text: str) -> bool:
        """Should the second pass run? By default: yes, on everything.

        Two gates have been tried here and both were mine and both were wrong.
        First 25 seconds of audio, reasoned from usage stats; Yash overruled it,
        he wanted every line cleaned up. Then, when he reported the whole thing
        felt slow, 220 characters of transcript — on the belief that the pass
        cost 6-8 s and left short text unchanged. Timed against his own lines on
        2026-08-13, both halves were false:

             33 chars ->  34  in 4.3 s   "porti" -> "Poori", capital, full stop
             74 chars ->  91  in 3.3 s   spelling, punctuation, bold emphasis
            277 chars -> 288  in 3.7 s   punctuation and capitals

        3-4 s, flat, and short lines are where it shows MOST: a one-line reply
        is exactly where a missing capital and a mangled word are obvious. He
        caught the regression within minutes — "choti line sahi se nhi ari h".

        The slowness he actually hit was a 38 s dictation, where 6.8 s of decode
        on four threads is the floor and the cleanup rides on top of it. Gating
        the cleanup was treating the symptom at the wrong end.

        So the knob stays, defaulted off. Nothing here decides for him.
        """
        return self.enabled and len(text.strip()) >= self.min_chars

    def run(self, text: str) -> str:
        import urllib.request  # noqa: PLC0415
        body = json.dumps({
            "model": self.model,
            "messages": [{"role": "system", "content": POLISH_SYSTEM},
                         {"role": "user", "content": text}],
            "stream": False,
        }).encode()
        req = urllib.request.Request(self.url, data=body,
                                     headers={"Content-Type": "application/json"})
        t0 = time.time()
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            data = json.loads(resp.read())
        out = (data["choices"][0]["message"]["content"] or "").strip()
        took = time.time() - t0

        # Guard against a model that decides to answer instead of clean. A reply
        # under half the input length is not a cleanup, it is a summary — and a
        # summary silently replacing his words is worse than no polish at all.
        if not out or len(out) < len(text) * 0.5:
            log(f"polish rejected in {took:.1f}s "
                f"({len(text)} chars in, {len(out)} out) — keeping raw")
            return text
        log(f"polished in {took:.1f}s ({len(text)} -> {len(out)} chars)")
        return out


class SpeechDetector:
    """Silero VAD, run in-process, purely to answer 'is anyone talking'.

    Energy thresholds were tried first and are not good enough: a mic with a
    lively idle floor measures room tone as speech, and whisper answers silence
    by inventing words — fifteen seconds of an empty room reliably came back as
    `"Haan."`

    whisper.cpp's own `--vad` was tried second and rejected. RE-MEASURED
    2026-08-13 against this exact model, because the option is tempting every
    time someone reads the help text — it now needs a GGML VAD model
    (`ggml-silero-v5.1.2.bin`, kept beside the others; the ONNX one here is for
    sherpa and whisper-server refuses it with "bad magic"):

        clip                 no VAD              --vad
        5 s of room tone     "Haan."  (invented)  ""        <- VAD wins
        1.2 s "Kya?"         "Kya?"               ""        <- VAD LOSES
        4.7 s sentence       correct, 2.1 s       correct, 1.8 s
        11.7 s, mostly pad   correct, 1.8 s       correct, 1.8 s

    So the original verdict holds, and now with numbers: `--vad` does kill the
    empty-room hallucination, but it eats short utterances whole — "theek hai",
    "haan", "next" come back as nothing. And it buys no speed, because whisper
    processes a 30 s window either way.

    Running silero here instead gets both: `has_speech` has a shape test below
    1.5 s specifically so short commands survive, and whisper is simply never
    handed a clip with no voice in it. Do not "simplify" this by switching to
    `--vad`.
    """

    def __init__(self, cfg: dict):
        raw = cfg.get("vad_model", "")
        path = Path(raw).expanduser() if raw else None
        self.path = str(path) if path and path.exists() else ""
        self.threshold = float(cfg.get("vad_threshold", 0.5))
        self.vad = None
        self.lock = threading.Lock()
        if not self.path:
            log("WARNING: no VAD model — falling back to an energy check")

    def _load(self):
        if self.vad is not None or not self.path:
            return self.vad
        import sherpa_onnx  # noqa: PLC0415
        config = sherpa_onnx.VadModelConfig()
        config.silero_vad.model = self.path
        config.silero_vad.threshold = self.threshold
        config.silero_vad.min_speech_duration = 0.05
        config.silero_vad.min_silence_duration = 0.10
        config.sample_rate = SAMPLE_RATE
        config.num_threads = 1
        self.vad = sherpa_onnx.VadModel.create(config)
        log(f"VAD loaded ({Path(self.path).name}, threshold {self.threshold})")
        return self.vad

    def speech_seconds(self, samples) -> float:
        """Seconds of actual voice in this audio."""
        with self.lock:
            try:
                vad = self._load()
            except Exception as exc:
                log(f"VAD unavailable ({exc}) — using energy fallback")
                self.path = ""
                vad = None
            if vad is None:
                return Vox._energy_speech_seconds(samples)
            window = vad.window_size()
            if samples.size < window:
                return 0.0
            vad.reset()
            voiced = 0
            for start in range(0, samples.size - window + 1, window):
                if vad.is_speech(samples[start:start + window]):
                    voiced += 1
            return voiced * window / SAMPLE_RATE

    def has_speech(self, samples, need: float = 0.25) -> bool:
        """Is it worth waking the transcriber for this audio?

        Silero needs roughly a second of context before it will commit, so it
        reports nothing at all for a half-second clip — measured: 0.5 s and
        0.8 s of genuine speech both scored 0.00. Rejecting those would throw
        away short commands like "haan" or "next".

        So below 1.5 s a different test decides: speech has *shape* — loud
        syllables against quiet gaps — while room tone, hum and fan noise sit at
        one flat level. Comparing the loudest frames against the typical frame
        separates them without needing the VAD's context.
        """
        import numpy as np  # noqa: PLC0415
        duration = len(samples) / SAMPLE_RATE
        if self.speech_seconds(samples) >= need:
            return True
        if duration >= 1.5:
            return False

        frame = SAMPLE_RATE // 50
        usable = samples.size - samples.size % frame
        if usable < frame * 5:
            return False
        rms = np.sqrt((samples[:usable].reshape(-1, frame) ** 2).mean(axis=1))
        loud, typical = float(np.percentile(rms, 90)), float(np.percentile(rms, 40))
        return loud > 0.008 and loud > typical * 3.0


# ── speech engines ────────────────────────────────────────────────────────────
class ParakeetEngine:
    """sherpa-onnx offline transducer — the model Orca ships.

    Measured on this laptop (i7-8550U, 4 threads): RTF 0.10, i.e. 11 s of audio
    decodes in 1.1 s, so re-decoding a rolling tail for the live preview is
    affordable.
    """

    name = "parakeet"

    def __init__(self, cfg: dict):
        self.dir = Path(cfg["parakeet_dir"]).expanduser()
        self.threads = int(cfg["threads"])
        self.rec = None
        self.lock = threading.Lock()

    def available(self) -> tuple[bool, str]:
        need = ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"]
        missing = [f for f in need if not (self.dir / f).exists()]
        return (not missing, f"missing in {self.dir}: {missing}" if missing else "ok")

    def load(self) -> None:
        with self.lock:
            if self.rec is not None:
                return
            import sherpa_onnx  # noqa: PLC0415 — deliberately lazy
            t0 = time.time()
            d = self.dir
            self.rec = sherpa_onnx.OfflineRecognizer.from_transducer(
                encoder=str(d / "encoder.int8.onnx"),
                decoder=str(d / "decoder.int8.onnx"),
                joiner=str(d / "joiner.int8.onnx"),
                tokens=str(d / "tokens.txt"),
                num_threads=self.threads,
                sample_rate=SAMPLE_RATE,
                feature_dim=80,
                decoding_method="greedy_search",
                provider="cpu",
                model_type="nemo_transducer",
                debug=False,
            )
            log(f"model loaded in {time.time() - t0:.2f}s")

    def unload(self) -> None:
        with self.lock:
            if self.rec is None:
                return
            self.rec = None
        gc.collect()
        try:
            ctypes.CDLL("libc.so.6").malloc_trim(0)   # actually hand RAM back
        except Exception:
            pass
        log("model unloaded")

    @property
    def loaded(self) -> bool:
        return self.rec is not None

    def transcribe(self, samples, sample_rate: int = SAMPLE_RATE) -> str:
        self.load()
        with self.lock:
            rec = self.rec
            if rec is None:
                return ""
            stream = rec.create_stream()
            stream.accept_waveform(sample_rate, samples)
            rec.decode_stream(stream)
            return (stream.result.text or "").strip()


class WhisperServerEngine:
    """whisper.cpp behind its own HTTP server, so the model stays resident.

    `whisper-cli` reloads the model on every invocation, which would add a
    fixed load cost to every partial. `whisper-server` keeps it in memory, and
    unloading is just killing the process — which returns the RAM cleanly.

    Measured on this laptop with Whisper-Hindi2Hinglish-Swift q5_0 (a
    whisper-base fine-tune): RTF ~0.20, i.e. ~2 s for a 10 s utterance.
    """

    name = "whisper"

    def __init__(self, cfg: dict):
        raw = cfg.get("whisper_model", "")
        self.model = str(Path(raw).expanduser()) if raw else ""
        self.lang = cfg.get("whisper_lang", "auto")
        self.threads = int(cfg["threads"])
        self.port = int(cfg.get("whisper_port", 8127))
        self.proc: subprocess.Popen | None = None
        self.lock = threading.Lock()

    def available(self) -> tuple[bool, str]:
        import shutil  # noqa: PLC0415
        if not self.model or not Path(self.model).exists():
            return False, f"whisper_model not found: {self.model!r}"
        if shutil.which("whisper-server") is None:
            return False, "whisper-server not on PATH (install whisper-cpp)"
        return True, "ok"

    def _alive(self, proc) -> bool:
        return proc is not None and proc.poll() is None

    def _spawn(self, port: int, threads: int, label: str):
        t0 = time.time()
        args = ["whisper-server", "-m", self.model, "-t", str(threads),
                "-bs", "1", "-l", self.lang,
                # -mc 0: do not carry text context between windows. whisper.cpp's
                # biggest hallucination mode is an error in one window feeding
                # the next and compounding, and dictation gains nothing from
                # that context anyway.
                #
                # Temperature fallback stays ON. Disabling it (`-nf`) tested
                # clean on short clips — identical output, 6% faster — and then
                # wrecked long ones: fallback is the escape hatch from a
                # repetition loop, and without it a 14.6 s window ground out
                # "Kya iska swaad achcha hai" over and over for 33 seconds.
                "-mc", "0",
                "--host", "127.0.0.1", "--port", str(port)]
        # `-nt` stays, and there is a known cost to it worth writing down.
        #
        # It zeroes every segment timestamp. `_infer` uses `start` to throw away
        # what whisper invents while transcribing the silence it pads every clip
        # out to 30 s with, so with `-nt` that guard can never fire — a dictation
        # can end "Wo sahi ho jaega. Hello." where nobody said Hello. This was
        # true from the first day; the caption's second server was the only
        # instance that ever had real timestamps.
        #
        # Removing `-nt` was tried on 2026-08-13 and is WORSE, measured, not
        # guessed: the end-to-end hinglish clip came back as "ayam. Helmet na
        # pahnane se…" — a spurious leading fragment on every decode. Trading a
        # rare invented tail for reliable leading garbage is a bad trade. Put it
        # back. The real fix is to bound the clip by VAD before the encoder sees
        # it, not to argue with whisper's padding afterwards.
        args.append("-nt")
        proc = subprocess.Popen(
            args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        deadline = time.time() + 30
        while time.time() < deadline:
            if proc.poll() is not None:
                raise RuntimeError(f"whisper-server ({label}) exited during startup")
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                    log(f"whisper-server [{label}] ready in {time.time() - t0:.2f}s")
                    return proc
            except OSError:
                time.sleep(0.2)
        proc.kill()
        raise TimeoutError(f"whisper-server ({label}) did not come up")

    def load(self) -> None:
        with self.lock:
            if not self._alive(self.proc):
                self.proc = self._spawn(self.port, self.threads, "final")

    # `load_preview` stood here: a SECOND whisper-server on port+1, ~70 MB, run
    # only so the live caption did not have to queue behind the final decode.
    # Removed 2026-08-13 with the caption itself. Measured after: one server
    # spawns per session ("whisper-server [final] ready in 0.41s"), not two.

    def unload(self) -> None:
        for attr, lock in (("proc", self.lock),):
            with lock:
                proc = getattr(self, attr)
                setattr(self, attr, None)
                if proc is None:
                    continue
                try:
                    proc.terminate()
                    proc.wait(timeout=3)
                except Exception:
                    proc.kill()
        log("whisper-server stopped")

    @property
    def loaded(self) -> bool:
        return self._alive(self.proc)

    def transcribe(self, samples, sample_rate: int = SAMPLE_RATE) -> str:
        """Full transcript, with whisper's invented padding removed.

        This goes through the segment path on purpose. Asking for plain text
        returns whatever whisper made up while transcribing the silence it pads
        every clip out to 30 s with — a real dictation ended `"Wo sahi ho jaega.
        Hello."` where nobody said Hello. The segment path knows where the audio
        actually ends, so that gets dropped.
        """
        segs = self._infer(samples, sample_rate, segments=True)
        return " ".join(text for _s, _e, text in segs).strip()

    # `transcribe_segments` was here. Its only caller was the live caption's
    # word-banking, so it went with it on 2026-08-13. `transcribe` still asks
    # _infer for segments — it joins them — it just no longer hands them out.

    def _infer(self, samples, sample_rate: int, segments: bool):
        import io  # noqa: PLC0415
        import urllib.request  # noqa: PLC0415
        import numpy as np  # noqa: PLC0415

        self.load()
        port, lock = self.port, self.lock

        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(sample_rate)
            w.writeframes((np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())

        fields = {"response_format": "verbose_json" if segments else "text"}
        ctx = self._audio_ctx(len(samples) / sample_rate)
        if ctx:
            fields["audio_ctx"] = str(ctx)

        boundary = "----voxform"
        parts = [
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; "
            f"filename=\"a.wav\"\r\nContent-Type: audio/wav\r\n\r\n".encode(),
            buf.getvalue(), b"\r\n",
        ]
        for key, value in fields.items():
            parts.append(f"--{boundary}\r\nContent-Disposition: form-data; "
                         f"name=\"{key}\"\r\n\r\n{value}\r\n".encode())
        parts.append(f"--{boundary}--\r\n".encode())

        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/inference", data=b"".join(parts),
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        )
        with lock:
            with urllib.request.urlopen(req, timeout=300) as resp:
                raw = resp.read().decode("utf-8", "replace")

        if not segments:
            return " ".join(raw.split()).strip()
        try:
            data = json.loads(raw)
        except ValueError:
            return []
        # Whisper pads every clip out to 30 s and cheerfully transcribes the
        # padding, so the last "segment" is usually invented. Anything that
        # starts at or past the real end of the audio is discarded.
        duration = len(samples) / sample_rate
        out = []
        for seg in data.get("segments", []):
            text = " ".join(str(seg.get("text", "")).split())
            start = float(seg.get("start", 0.0))
            if not text or start >= duration - 0.05:
                continue
            out.append((start, min(float(seg.get("end", 0.0)), duration), text))
        return out

    @staticmethod
    def _audio_ctx(duration: float, margin: float = 2.0) -> int:
        """Shrink the encoder window to just cover the speech — but only for
        genuinely short clips.

        Whisper always pads audio to a 30 s window and encodes all of it, so a
        3 s utterance otherwise pays the same as a 30 s one. Trimming the context
        makes those short clips roughly four times faster.

        The catch, and it is a bad one: past about five seconds a shortened
        context makes the decoder *degenerate*. Measured on one 43 s recording,
        with the model and flags this daemon actually uses:

            window   shrunk ctx              full ctx
            3.1 s    0.9 s  "Thik hai."      4.4 s  "Thank you."
            5   s    1.4 s  correct          4.7 s  correct
            9   s   25.1 s  "Acko acko acko  4.9 s  "Shaadi shuda, heroino
                             aLo.1 corona"          ko lekar dohra garta"
            14  s   17.4 s  wrong            5.4 s  correct

        That 25 s decode on a 9 s window is what froze the live caption for half
        a minute at a time: the model loops, and a looping decode runs to its
        token limit.

        OFF ENTIRELY since 2026-08-13. The 5 s cap above assumed the shrink was
        safe below it. Sweeping audio_ctx on one 4.7 s clip whose correct text is
        "Kya iska svaad achchha hai?" says otherwise:

            0 (full) correct 3.7s   224 correct 0.6s   512 correct
            192 garbled             256 repeats twice  640 truncated
            288 "K"                 320 truncated, 10.1s
            384/448 truncated       768 correct

        No rule, no monotonicity, and it changes with the input. Yash then
        reported it from the other end without knowing any of this — "agar main
        chhota sentence bolta hoon to uski quality zyada sahi nahi hai" — and
        short clips are the only ones the shrink ever touched.

        He also settled the trade himself: "mere ko koi dikkat nahi, tees second
        bhi wait karna pad jaaye, lekin badhiya tarike se output aaye." So a
        short clip now pays the flat ~4 s of a full window and is right, instead
        of taking ~1 s and being a coin toss. Set SHRINK_CTX_MAX_SEC above 0 to
        bring it back.
        """
        if duration > SHRINK_CTX_MAX_SEC or duration + margin >= 29.0:
            return 0                                  # 0 = full 30 s context
        return max(192, math.ceil((duration + margin) * 50 / 32) * 32)


ENGINES = {"parakeet": ParakeetEngine, "whisper": WhisperServerEngine}


# ── the on-screen overlay ─────────────────────────────────────────────────────
class OverlayProc:
    """Owns the voxbar child process. Never lets an overlay problem break dictation."""

    def __init__(self, enabled: bool):
        self.enabled = enabled and OVERLAY_PATH.exists()
        self.proc: subprocess.Popen | None = None
        self.lock = threading.Lock()

    def start(self) -> None:
        if not self.enabled:
            return
        with self.lock:
            self._stop_locked()
            env = dict(os.environ)
            # gtk4-layer-shell must be loaded before libwayland-client.
            env["LD_PRELOAD"] = LAYER_SHELL_SO
            env["GDK_BACKEND"] = "wayland"
            try:
                self.proc = subprocess.Popen(
                    ["/usr/bin/python3", str(OVERLAY_PATH)],   # GTK lives in system python
                    stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL, env=env,
                )
            except Exception as exc:
                log(f"overlay failed to start: {exc}")
                self.proc = None

    def send(self, **msg) -> None:
        with self.lock:
            proc = self.proc
            if proc is None or proc.stdin is None or proc.poll() is not None:
                return
            try:
                proc.stdin.write((json.dumps(msg) + "\n").encode())
                proc.stdin.flush()
            except (BrokenPipeError, ValueError, OSError):
                self.proc = None

    def finish(self, hold_sec: float = 1.6) -> None:
        """Leave the final text on screen for a beat, then fade out and exit."""
        def fade():
            self.send(phase="bye")
            threading.Timer(1.5, self.stop).start()
        timer = threading.Timer(hold_sec, fade)
        timer.daemon = True
        timer.start()

    def stop(self) -> None:
        with self.lock:
            self._stop_locked()

    def _stop_locked(self) -> None:
        proc, self.proc = self.proc, None
        if proc is None:
            return
        try:
            if proc.stdin:
                proc.stdin.close()
            proc.terminate()
            proc.wait(timeout=2)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass


# ── desktop plumbing ──────────────────────────────────────────────────────────
class Desktop:
    def __init__(self, cfg: dict):
        self.notify_on = bool(cfg["notify"])
        self.type_delay = int(cfg["type_delay_ms"])
        self.mode = cfg.get("output", "paste")
        self.always_copy = bool(cfg.get("copy_to_clipboard", True))
        self.chunk_chars = int(cfg.get("type_chunk_chars", 300))
        self.chunk_pause = int(cfg.get("type_chunk_pause_ms", 120))
        self.terminals = tuple(cfg.get("terminal_classes", TERMINALS))

    def notify(self, title: str, body: str = "", urgency: str = "normal", ms: int = 2500) -> None:
        if not self.notify_on:
            return
        subprocess.Popen(
            ["notify-send", "-a", "vox", "-u", urgency, "-t", str(ms),
             "-h", "string:x-canonical-private-synchronous:vox", title, body],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )

    def deliver(self, text: str) -> tuple[bool, str]:
        """Put the text where it belongs. Returns (ok, how)."""
        copied = self._copy(text)

        if self.mode == "clipboard":
            return (copied, "clipboard" if copied else "clipboard failed")

        if self.mode == "paste":
            if not copied:
                return False, "clipboard failed, kuch nahi bheja"
            ok, how = self._paste()
            if ok:
                return True, how
            log(f"paste failed ({how}) — typing instead")

        # wtype fires keystrokes as fast as the compositor accepts them. A long
        # burst overruns terminals and TUIs: they split it across submissions and
        # swallow the first characters of each burst. Send it in bites instead,
        # with a breath in between, and let the app catch up.
        for i, piece in enumerate(self._chunks(text)):
            if i:
                time.sleep(self.chunk_pause / 1000.0)
            cmd = ["wtype"]
            if self.type_delay:
                cmd += ["-d", str(self.type_delay)]
            cmd += ["--", piece]
            try:
                proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            except FileNotFoundError:
                return False, self._fallback_note("wtype not installed", copied)
            except subprocess.TimeoutExpired:
                return False, self._fallback_note("wtype timed out", copied)
            if proc.returncode != 0:
                return False, self._fallback_note(proc.stderr.strip() or "wtype failed", copied)
        return True, "typed + copied" if copied else "typed"

    def _chunks(self, text: str) -> list[str]:
        """Split on word boundaries, never mid-word, at most chunk_chars each."""
        limit = self.chunk_chars
        if limit <= 0 or len(text) <= limit:
            return [text]
        out, line = [], ""
        for word in text.split(" "):
            candidate = f"{line} {word}" if line else word
            if len(candidate) > limit and line:
                out.append(line + " ")
                line = word
            else:
                line = candidate
        if line:
            out.append(line)
        return out

    def _focused_class(self) -> str:
        """Ask Hyprland what has focus, so we send the right paste chord."""
        try:
            out = subprocess.run(["hyprctl", "activewindow", "-j"],
                                 capture_output=True, text=True, timeout=3).stdout
            return str(json.loads(out).get("class", "")).lower()
        except Exception:
            return ""

    def _paste(self) -> tuple[bool, str]:
        """Drop the whole thing in at once via the clipboard.

        `wtype` cannot deliver a paste chord that apps act on — three variants
        were tested against kitty and none worked. Hyprland's own `sendshortcut`
        does, because it injects the combo at the compositor. Verified against a
        terminal (Ctrl+Shift+V) and a GTK app (Ctrl+V).
        """
        klass = self._focused_class()
        terminal = any(t in klass for t in self.terminals)
        chord = "CTRL SHIFT, V" if terminal else "CTRL, V"
        try:
            proc = subprocess.run(
                ["hyprctl", "dispatch", "sendshortcut", f"{chord}, activewindow"],
                capture_output=True, text=True, timeout=5,
            )
        except Exception as exc:
            return False, str(exc)
        if proc.returncode != 0 or "ok" not in proc.stdout.lower():
            return False, (proc.stdout + proc.stderr).strip()[:80] or "sendshortcut failed"
        return True, f"pasted into {klass or 'window'}"

    def _copy(self, text: str) -> bool:
        try:
            subprocess.run(["wl-copy"], input=text, text=True, check=True, timeout=10)
            return True
        except Exception as exc:
            log(f"wl-copy failed: {exc}")
            return False

    @staticmethod
    def _fallback_note(why: str, copied: bool) -> str:
        return f"{why} — clipboard mein hai" if copied else f"{why}; clipboard bhi fail"


# ── the daemon ────────────────────────────────────────────────────────────────
class Vox:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.lock = threading.RLock()
        self.state = "idle"                   # idle | recording | transcribing
        self.desktop = Desktop(cfg)
        self.overlay = OverlayProc(bool(cfg["overlay"]))
        self.vocab = Vocabulary()
        self.polish = Polish(self.cfg)
        self.vad = SpeechDetector(cfg)
        # Both engines stay available; each gesture picks one. Neither loads a
        # model until it is actually used, and both unload on the idle timer.
        self.engines = {k: cls(cfg) for k, cls in ENGINES.items()}
        self.engine = self.engines.get(cfg["engine"], self.engines["parakeet"])

        self.rec_proc: subprocess.Popen | None = None
        self.chunks: list[bytes] = []
        self.chunks_lock = threading.Lock()
        self.stop_capture = threading.Event()
        self.reader: threading.Thread | None = None
        self.partial_thread: threading.Thread | None = None
        self.rec_started = 0.0
        self.peak_level = 0.0
        # Ten seconds of 100 ms block loudness; the room's noise floor is read
        # off it. Kept on the daemon so it is already warm for the next press.
        self.db_hist: deque[float] = deque(maxlen=100)

        self.unload_timer: threading.Timer | None = None
        self.cap_timer: threading.Timer | None = None
        self.last_text = ""
        self.last_partial = ""
        self.stats = {"sessions": 0, "words": 0}

        ok, why = self.engine.available()
        if not ok:
            log(f"WARNING: engine {self.engine.name} unavailable — {why}")

    # ── timers ───────────────────────────────────────────────────────────────
    def _cancel(self, attr: str) -> None:
        timer = getattr(self, attr)
        if timer is not None:
            timer.cancel()
            setattr(self, attr, None)

    def _arm_unload(self) -> None:
        self._cancel("unload_timer")
        secs = int(self.cfg["idle_unload_sec"])
        if secs <= 0:
            return
        self.unload_timer = threading.Timer(secs, self._unload_if_idle)
        self.unload_timer.daemon = True
        self.unload_timer.start()

    def _unload_if_idle(self) -> None:
        with self.lock:
            self.unload_timer = None
            if self.state != "idle":
                return
        for eng in self.engines.values():
            eng.unload()

    def unload_all(self) -> None:
        for eng in self.engines.values():
            eng.unload()

    # ── audio ────────────────────────────────────────────────────────────────
    def _audio_seconds(self) -> float:
        with self.chunks_lock:
            return sum(len(c) for c in self.chunks) / 2.0 / SAMPLE_RATE

    def _samples(self, tail_sec: float | None = None, from_sec: float = 0.0):
        import numpy as np  # noqa: PLC0415
        with self.chunks_lock:
            raw = b"".join(self.chunks)
        if from_sec > 0:
            skip = int(from_sec * SAMPLE_RATE) * 2
            raw = raw[skip:] if skip < len(raw) else b""
        if tail_sec is not None:
            keep = int(tail_sec * SAMPLE_RATE) * 2
            raw = raw[-keep:] if len(raw) > keep else raw
        if len(raw) % 2:
            raw = raw[:-1]
        return np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0

    @staticmethod
    def _energy_speech_seconds(samples) -> float:
        """Crude energy fallback, used only when the VAD model is missing.

        Whisper invents words when handed silence — 18 seconds of room tone
        reliably decodes as `"Hello."`, which is exactly the phantom text that
        kept appearing in the live caption. Its own guards do not help:
        `--suppress-nst` and `--no-speech-thold 0.8` were both tried and made no
        difference. The only fix is to never send it silence.

        The floor is absolute on purpose. Room tone sits near 0.0006 RMS and
        speech at 0.02–0.2, so 0.006 separates them with room to spare, and a
        relative term lets a quiet recording still register.
        """
        import numpy as np  # noqa: PLC0415
        frame = SAMPLE_RATE // 50                      # 20 ms
        usable = samples.size - samples.size % frame
        if usable < frame:
            return 0.0
        rms = np.sqrt((samples[:usable].reshape(-1, frame) ** 2).mean(axis=1))
        threshold = max(0.006, float(rms.max()) * 0.10)
        return float((rms > threshold).sum()) / 50.0

    @staticmethod
    def _trim_silence(samples, pad: float = 0.6, min_cut: float = 1.5):
        """Cut *long* stretches of dead air off the ends, and nothing else.

        Whisper hallucinates over silence — a recording left running produced
        `"you you you you…"` for five minutes of nothing, and 131 s of audio for
        11 s of speech.

        Deliberately timid: an aggressive version (8% of peak, 0.25 s padding)
        shaved a second or two off ordinary clips and wrecked one of them —
        "Babhoomi shaayad bandhu paas" became "Bangoli se banded bais". So a
        side is only trimmed when there is more than `min_cut` seconds of
        silence to remove, and even then 0.6 s of run-up is kept. Normal
        recordings come through untouched; only the pathological ones change.
        """
        import numpy as np  # noqa: PLC0415
        frame = SAMPLE_RATE // 50                      # 20 ms
        usable = samples.size - samples.size % frame
        if usable < frame * 25:                        # under half a second
            return samples
        rms = np.sqrt((samples[:usable].reshape(-1, frame) ** 2).mean(axis=1))
        peak = float(rms.max())
        if peak <= 0:
            return samples
        loud = np.flatnonzero(rms > max(peak * 0.03, 0.003))
        if loud.size == 0:
            return samples

        pad_frames = int(pad * 50)
        min_frames = int(min_cut * 50)
        first, last = int(loud[0]), int(loud[-1])
        start = (first - pad_frames) * frame if first > pad_frames + min_frames else 0
        tail = len(rms) - 1 - last
        end = (last + 1 + pad_frames) * frame if tail > pad_frames + min_frames else samples.size
        return samples[start:end]

    def _meter(self, db: float) -> float:
        """Map a block's loudness to a 0..1 bar height, scaled to his own voice.

        The first mapping was absolute — `(rms / 0.16) ** 0.6`. It only looked
        alive with lips on the microphone: speech from 40 cm drew 7 pixels of a
        32 pixel wave and 1.5 m drew 3, the same as the resting line.

        The second worked in dB above the room's own noise floor, which fixed
        distance. Then the denoiser landed on 2026-08-13 and broke it the other
        way: rnnoise takes the room down to near digital silence, so the floor
        fell to about -70 dB, every syllable measured 50+ dB above it, and with
        a fixed 28 dB span every bar pinned to full height. Yash: "agar main
        bolta rehta hoon to wo poora bhara hua hi dikhata rehta hai".

        So the TOP of the scale is measured too, not assumed. Floor is the tenth
        percentile of the last ten seconds, ceiling the ninetieth — his own
        quiet and his own loud, whatever the distance and whatever the mic. His
        normal speech then spans the full height and the shape of it shows.

        A percentile rather than a tracker on both ends, for the same reason as
        before: an asymmetric attack/decay floor can only crawl upward from its
        initial guess, so walking into a noisy room left it 15 dB too low and
        the bars sat at a third height on room tone alone. A percentile has no
        memory of a guess.
        """
        self.db_hist.append(db)
        ordered = sorted(self.db_hist)
        floor = ordered[len(ordered) // 10]
        ceil = ordered[min(len(ordered) - 1, (len(ordered) * 9) // 10)]

        # MIN_SPAN_DB stops the scale collapsing onto silence. Without it, ten
        # seconds of a quiet room makes floor and ceiling nearly equal and the
        # tiniest tick of noise reads as a full-height bar.
        #
        # SILENCE_GATE_DB is the part MIN_SPAN_DB could not cover. The scale is
        # relative to the room, and after the denoiser this room is at -69 dBFS,
        # so a desk tap 22 dB above that still filled the bar. Below the gate
        # nothing is drawn at all, whatever the relative maths says.
        span = max(ceil - (floor + FLOOR_HEADROOM_DB), MIN_SPAN_DB)
        above = db - max(floor + FLOOR_HEADROOM_DB, SILENCE_GATE_DB)
        if above <= 0.0:
            return 0.0
        return min(1.0, above / span) ** 0.7

    def _read_audio(self) -> None:
        """Pull raw PCM off parecord, feed the level meter, keep the buffer."""
        import numpy as np  # noqa: PLC0415
        proc = self.rec_proc
        if proc is None or proc.stdout is None:
            log("reader: no recorder process")
            return
        # Three blocks, not eight: the overlay already holds peaks with its own
        # fast-attack slow-release, so a longer average here only flattens them.
        recent: deque[float] = deque(maxlen=3)
        total = 0
        while not self.stop_capture.is_set():
            data = proc.stdout.read(CHUNK_BYTES)
            if not data:
                break
            total += len(data)
            with self.chunks_lock:
                self.chunks.append(data)
            block = np.frombuffer(data[: len(data) - len(data) % 2], dtype="<i2")
            if block.size:
                rms = float(np.sqrt(np.mean((block.astype(np.float32) / 32768.0) ** 2)))
                level = self._meter(20.0 * math.log10(rms + 1e-7))
                recent.append(level)
                self.peak_level = max(self.peak_level, level)
                self.overlay.send(level=round(sum(recent) / len(recent), 3))
        log(f"reader: {total} bytes ({total / 32000:.1f}s), peak level {self.peak_level:.3f}")
        if total == 0:
            err = b""
            if proc.stderr is not None:
                try:
                    err = proc.stderr.read() or b""
                except Exception:
                    pass
            log(f"reader: recorder produced nothing — {err.decode(errors='replace').strip()[:200]}")

    # `_partial_loop` and `_emit_partial` lived here until 2026-08-13.
    #
    # They ran a whisper decode every ~1.2 s while he was still speaking and
    # streamed the provisional words into the caption strip at the top of the
    # screen, banking each word once two passes agreed on it (UFAL-style
    # LocalAgreement). Both are gone with the caption: Yash asked for the
    # strip removed, and a decoder feeding a surface that no longer exists is
    # pure CPU burn taken from the mic at the exact moment it needs the
    # machine quiet. The transcript is produced once, when you stop talking.
    #
    # Full implementation is in git if live captioning is ever wanted back.

    # ── actions ──────────────────────────────────────────────────────────────
    def toggle(self, engine: str | None = None) -> None:
        with self.lock:
            state = self.state
        if state == "idle":
            self.start(engine)
        elif state == "recording":
            self.stop()
        else:
            self.desktop.notify("⏳ Ruko", "abhi likh raha hoon", ms=1200)

    def start(self, engine: str | None = None) -> None:
        with self.lock:
            if self.state != "idle":
                return
            self.state = "recording"
            if engine and engine in self.engines:
                self.engine = self.engines[engine]
        self._cancel("unload_timer")

        STATE_DIR.mkdir(parents=True, exist_ok=True)
        self.chunks, self.last_partial, self.peak_level = [], "", 0.0
        self.stop_capture.clear()

        cmd = ["parecord", "--raw", f"--rate={SAMPLE_RATE}", "--channels=1",
               "--format=s16le", "--latency-msec=50"]
        if self.cfg.get("source"):
            cmd += ["-d", str(self.cfg["source"])]
        try:
            self.rec_proc = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0,
            )
        except FileNotFoundError:
            with self.lock:
                self.state = "idle"
            self.desktop.notify("❌ parecord nahi mila", "pipewire-pulse install karo", "critical")
            return

        self.rec_started = time.monotonic()
        self.overlay.start()
        # Audio is already being captured, but the model may still be coming up.
        # Say so, and flip to "recording" the moment it is ready to hear you.
        self.overlay.send(phase="warming")

        self.reader = threading.Thread(target=self._read_audio, name="audio", daemon=True)
        self.reader.start()

        # Warm the model while he is still talking, so stop -> text feels instant.
        threading.Thread(target=self._prewarm, name="prewarm", daemon=True).start()

        cap = int(self.cfg["max_record_sec"])
        if cap > 0:
            self.cap_timer = threading.Timer(cap, self._cap_hit)
            self.cap_timer.daemon = True
            self.cap_timer.start()
        log("recording started")

    def _prewarm(self) -> None:
        """Load the model, then turn the waveform green.

        This used to fork a second whisper instance for the live caption and
        start the partial-decode thread. Both went with the caption strip on
        2026-08-13 — there is one model, it loads once, and the only thing the
        overlay needs to know is when it is listening.
        """
        try:
            self.engine.load()
        except Exception as exc:
            log(f"prewarm failed: {exc}")
        # Green either way: a failed prewarm still records, and leaving the bar
        # stuck amber would say "not ready" about a mic that is in fact open.
        self.overlay.send(phase="recording")

    def _cap_hit(self) -> None:
        log("max_record_sec reached — stopping")
        self.desktop.notify("⏱️ Time limit", "recording apne aap band", ms=2000)
        self.stop()

    def _end_capture(self) -> None:
        self._cancel("cap_timer")
        self.stop_capture.set()
        proc, self.rec_proc = self.rec_proc, None
        if proc is not None:
            try:
                proc.send_signal(signal.SIGINT)
                proc.wait(timeout=3)
            except Exception:
                proc.kill()
        if self.reader is not None:
            self.reader.join(timeout=2)
            self.reader = None

    def cancel(self) -> None:
        with self.lock:
            if self.state != "recording":
                return
            self.state = "idle"
        self._end_capture()
        self.chunks = []
        self.overlay.stop()
        self.desktop.notify("✖️ Cancel", "kuch nahi likha", ms=1500)
        log("cancelled")
        self._arm_unload()

    def stop(self) -> None:
        with self.lock:
            if self.state != "recording":
                return
            self.state = "transcribing"
        elapsed = time.monotonic() - self.rec_started
        self._end_capture()
        self.overlay.send(phase="transcribing")
        threading.Thread(target=self._finish, args=(elapsed,), name="stt", daemon=True).start()

    def _finish(self, elapsed: float) -> None:
        try:
            if elapsed < float(self.cfg["min_record_sec"]):
                log(f"abort: only {elapsed:.2f}s recorded")
                self.desktop.notify("🤏 Bahut chhota", "thoda lamba bolo", ms=1500)
                return

            raw_samples = self._samples()
            if raw_samples.size == 0:
                log("abort: empty audio buffer")
                self.desktop.notify("🔇 Kuch record nahi hua", "mic check karo", "critical")
                return
            samples = self._trim_silence(raw_samples)
            audio_s = samples.size / SAMPLE_RATE
            if samples.size < raw_samples.size:
                log(f"trimmed {(raw_samples.size - samples.size) / SAMPLE_RATE:.1f}s "
                    f"of silence -> {audio_s:.1f}s")
            speech_s = self.vad.speech_seconds(samples)
            if not self.vad.has_speech(samples):
                log(f"abort: no speech ({speech_s:.2f}s) in {audio_s:.1f}s of audio")
                self.desktop.notify("🔇 Kuch sunai nahi diya", "mic check karo", "critical", 4000)
                return

            t0 = time.time()
            text = self.vocab.apply(self.engine.transcribe(samples))
            took = time.time() - t0
            log(f"decoded {audio_s:.1f}s in {took:.2f}s "
                f"(rtf {took / max(audio_s, .01):.2f}): {text!r}")

            if not text:
                log(f"empty result for {audio_s:.1f}s of audio "
                    f"(speech {speech_s:.1f}s, peak {self.peak_level:.2f}) — "
                    f"VAD found nothing to transcribe")
                self.desktop.notify("🔇 Kuch samajh nahi aaya", f"{audio_s:.0f}s audio", ms=2500)
                return

            if self.polish.wanted(text):
                # Stay red and keep the light travelling: this is still work,
                # and going green then freezing would read as a hang.
                self.overlay.send(busy=True)
                try:
                    text = self.vocab.apply(self.polish.run(text))
                except Exception as exc:
                    log(f"polish failed ({exc}) — delivering the raw transcript")
                finally:
                    self.overlay.send(busy=False)

            # `transcribed` is logged HERE, after the polish, not after the
            # decode — it is the line everything else keys off as "this
            # dictation is finished". Logged before the polish it lied for the
            # 6-8 s the second pass takes, and the selftest's `wait_for
            # transcribed` returned into the middle of it, so the next scenario
            # started while this one was still working. Caught 2026-08-13 by the
            # cancel test failing for a reason that had nothing to do with cancel.
            log(f"transcribed {audio_s:.1f}s: {text!r}")

            # The overlay carries no words any more (the caption strip was
            # removed 2026-08-13), so `done` is purely the capture beat.
            self.overlay.send(phase="done")
            self.last_text = text
            out = text + (" " if self.cfg["trailing_space"] else "")
            ok, how = self.desktop.deliver(out)
            self.stats["sessions"] += 1
            self.stats["words"] += len(text.split())

            preview = text if len(text) <= 90 else text[:87] + "…"
            self.desktop.notify(("✅ " if ok else "📋 ") + preview,
                                f"{audio_s:.0f}s · {took:.1f}s · {how}",
                                "normal" if ok else "critical",
                                2500 if ok else 5000)
        except Exception as exc:
            log(f"transcribe error: {exc}")
            self.desktop.notify("❌ Error", str(exc)[:120], "critical", ms=5000)
        finally:
            self.overlay.finish()
            with self.lock:
                self.state = "idle"
            self._arm_unload()

    # ── introspection ────────────────────────────────────────────────────────
    def status(self) -> dict:
        return {
            "state": self.state,
            "engine": self.engine.name,
            "model_loaded": self.engine.loaded,
            "modifier": self.cfg["modifier"],
            "idle_unload_sec": self.cfg["idle_unload_sec"],
            "overlay": self.overlay.enabled,
            "sessions": self.stats["sessions"],
            "words": self.stats["words"],
            "last_text": self.last_text,
        }


# ── control socket ────────────────────────────────────────────────────────────
def serve(vox: Vox) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    SOCKET_PATH.unlink(missing_ok=True)
    srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    srv.bind(str(SOCKET_PATH))
    srv.listen(8)
    log(f"listening on {SOCKET_PATH}")

    actions = {
        "toggle": vox.toggle, "start": vox.start, "stop": vox.stop,
        "cancel": vox.cancel, "unload": vox.unload_all,
    }

    while True:
        conn, _ = srv.accept()
        with conn:
            try:
                raw = conn.recv(256).decode().strip()
                cmd, _, arg = raw.partition(":")      # e.g. "toggle:parakeet"
                if cmd == "quit":
                    conn.sendall(b'{"ok": true}\n')
                    break
                if cmd == "status":
                    reply = vox.status()
                elif cmd in ("toggle", "start"):
                    actions[cmd](arg or None)
                    reply = {"ok": True}
                elif cmd in actions:
                    actions[cmd]()
                    reply = {"ok": True}
                else:
                    reply = {"ok": False, "error": f"unknown command {raw!r}"}
                conn.sendall((json.dumps(reply) + "\n").encode())
            except Exception as exc:
                try:
                    conn.sendall((json.dumps({"ok": False, "error": str(exc)}) + "\n").encode())
                except OSError:
                    pass
    srv.close()
    SOCKET_PATH.unlink(missing_ok=True)


def main() -> int:
    if EVENT.size != 24:
        log(f"FATAL: unexpected input_event size {EVENT.size}")
        return 1

    cfg = load_config()
    vox = Vox(cfg)
    bindings = {cfg["modifier"]: cfg["engine"]}
    second = cfg.get("modifier_english", "")
    if second and second != cfg["modifier"]:
        bindings[second] = "parakeet"
    KeyWatcher(bindings, float(cfg["double_tap_window_ms"]), vox.toggle).start()

    def shutdown(*_):
        log("shutting down")
        try:
            vox.cancel()
            vox.overlay.stop()
            vox.unload_all()
        except Exception:
            pass
        SOCKET_PATH.unlink(missing_ok=True)
        os._exit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    log(f"vox ready — {' | '.join(f'{k}x2 -> {v}' for k, v in bindings.items())} "
        f"(engine={cfg['engine']}, unload after {cfg['idle_unload_sec']}s idle)")
    serve(vox)
    return 0


if __name__ == "__main__":
    sys.exit(main())
