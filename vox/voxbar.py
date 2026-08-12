#!/usr/bin/env python3
"""voxbar — the on-screen dictation overlay. One strip: the waveform.

A single click-through Wayland layer-shell surface glued to the bottom edge —
the bottom half of a sun, bars growing straight up out of the screen.

Driven by newline-delimited JSON on stdin, one object per line:

    {"level": 0.42}            instantaneous mic level, 0..1
    {"phase": "recording"}     warming | recording | transcribing | done
    {"phase": "bye"}           fade out and exit
    {"busy": true}             a decode is in flight — light travels along the bars

A separate process on purpose: if the overlay dies, dictation keeps working.
Must be started with LD_PRELOAD=/usr/lib/libgtk4-layer-shell.so, otherwise GTK4
refuses to make the window a layer surface.

── Why there is no caption any more (2026-08-13) ────────────────────────────────
There used to be a second strip across the top of the screen, sized to cover
waybar, streaming the transcript as it was decoded. It is gone at Yash's call:
"usko complete hi hata do, sirf bottom wala waveform rahega."

It was the right thing to remove. Live captioning forced a decode every ~1.2 s
while he was still talking, so the machine was busiest exactly when the mic
needed to be clean — and the text it showed was provisional, so reading it while
speaking meant watching words rewrite themselves. The finished text arrives in
the editor a moment later anyway. Nothing was gained by showing a draft of it in
the corner of his eye.

So the waveform is now the ONLY thing on screen, which raises its job: it has to
answer "is it up yet", "can it hear me", "is it working" and "is it done" with
no words at all. That is what the four colours and the four motions below do.
"""

from __future__ import annotations

import json
import math
import sys
from collections import deque

import gi

gi.require_version("Gtk4LayerShell", "1.0")
from gi.repository import Gtk4LayerShell as LayerShell  # noqa: E402  (must precede Gtk)

gi.require_version("Gtk", "4.0")
from gi.repository import GLib, Gtk  # noqa: E402

import cairo  # noqa: E402

# ── geometry ─────────────────────────────────────────────────────────────────
# 36, up from 32 when the caption shared the screen. It is the only surface now,
# so it may be read at a glance from across the desk — but it still must not be
# a thing you look AT while dictating, so it stops well short of a status bar.
WAVE_H = 36
BAR_PITCH = 11.7      # spacing between bars; the count follows the width
BAR_W = 6.0
FPS = 60

# Four states, four colours. With no caption these are the entire status
# display, so they are picked to be unmistakable at the edge of vision rather
# than merely different: amber reads as wait, green as go, red as busy, and the
# white flash is a full-brightness event you cannot miss even peripherally.
WARMING = (0.98, 0.72, 0.25)     # amber  — model still coming up, hold on
READY   = (0.36, 0.95, 0.55)     # green  — loaded and listening, speak
BUSY    = (1.00, 0.32, 0.28)     # red    — working out what you said
DONE    = (0.85, 0.98, 0.92)     # near-white — captured, text is on its way


class State:
    """Everything the strip draws from, ticked once per frame."""

    def __init__(self) -> None:
        self.levels: deque[float] = deque([0.0], maxlen=256)
        self.smooth = 0.0
        self.phase = "warming"
        self.alpha = 0.0
        self.target_alpha = 1.0
        self.spin = 0.0
        self.busy = False
        self.shimmer = 0.0
        self.breathe = 0.0        # slow pulse while warming, so amber is not frozen
        self.flash = 0.0          # 1 -> 0 burst on `done`

    # ── incoming ─────────────────────────────────────────────────────────────
    def push_level(self, level: float) -> None:
        level = max(0.0, min(1.0, level))
        # Fast attack, slow release: a consonant should spike immediately, but
        # the bars must not collapse to nothing between syllables or the strip
        # reads as "it stopped hearing me" during ordinary speech.
        self.smooth = max(level, self.smooth * 0.82)
        self.levels.appendleft(self.smooth)

    def set_phase(self, phase: str) -> None:
        if phase == "done" and self.phase != "done":
            # One bright beat at the moment of capture. Without the caption
            # there is otherwise no instant that says "got it" — the bars would
            # simply stop, which is also what a crash looks like.
            self.flash = 1.0
        self.phase = phase
        if phase == "bye":
            self.target_alpha = 0.0

    # ── per frame ────────────────────────────────────────────────────────────
    def tick(self) -> bool:
        """Advance the animation. False once the overlay has faded out."""
        self.alpha += (self.target_alpha - self.alpha) * 0.25
        self.flash *= 0.88
        self.breathe = (self.breathe + 0.045) % (2 * math.pi)

        # A light travels along the bars whenever the model is mid-decode, so a
        # slow window looks like work happening rather than a frozen strip.
        self.shimmer = (self.shimmer + 0.035) % 1.0 if self.busy else 0.0

        if self.phase == "warming":
            # Breathing, not silent. Amber with flat bars is indistinguishable
            # from a hung overlay, and the model can take a second to load.
            self.levels.appendleft(0.10 + 0.06 * (1 + math.sin(self.breathe)) / 2)
        elif self.phase == "transcribing":
            self.spin += 0.09
            self.levels.appendleft(0.16 + 0.11 * math.sin(self.spin))
        elif self.phase == "done":
            # Settle flat: the job is finished, and a wave still moving would
            # suggest it is not.
            self.levels.appendleft(max(0.0, (self.levels[0] if self.levels else 0.0) * 0.82))

        return not (self.target_alpha == 0.0 and self.alpha < 0.02)

    @property
    def colour(self) -> tuple[float, float, float]:
        base = {"warming": WARMING, "recording": READY, "done": DONE}.get(self.phase, BUSY)
        if self.flash <= 0.01:
            return base
        # Blend toward white for the capture beat, then decay back.
        return tuple(c + (1.0 - c) * self.flash for c in base)


def rounded(cr: cairo.Context, x: float, y: float, w: float, h: float, r: float) -> None:
    r = min(r, w / 2.0, h / 2.0)
    cr.new_sub_path()
    cr.arc(x + w - r, y + r, r, -math.pi / 2, 0)
    cr.arc(x + w - r, y + h - r, r, 0, math.pi / 2)
    cr.arc(x + r, y + h - r, r, math.pi / 2, math.pi)
    cr.arc(x + r, y + r, r, math.pi, 1.5 * math.pi)
    cr.close_path()


class WaveStrip(Gtk.ApplicationWindow):
    """Bottom edge — the bottom half of a sun, bars growing up out of it."""

    def __init__(self, app: Gtk.Application, state: State):
        super().__init__(application=app)
        self.state = state
        self.set_decorated(False)
        # GTK4 puts a solid `.background` class on windows; drop it or the strip
        # renders as a grey plate over whatever is underneath.
        self.set_css_classes([])

        LayerShell.init_for_window(self)
        LayerShell.set_layer(self, LayerShell.Layer.OVERLAY)
        # Anchoring left AND right makes the compositor stretch the surface to
        # the full width of the monitor, whatever that is.
        for edge in (LayerShell.Edge.BOTTOM, LayerShell.Edge.LEFT, LayerShell.Edge.RIGHT):
            LayerShell.set_anchor(self, edge, True)
        LayerShell.set_margin(self, LayerShell.Edge.BOTTOM, 0)
        LayerShell.set_exclusive_zone(self, -1)        # never reserve space
        LayerShell.set_keyboard_mode(self, LayerShell.KeyboardMode.NONE)
        LayerShell.set_namespace(self, "vox")

        self.area = Gtk.DrawingArea()
        self.area.set_content_height(WAVE_H)
        self.area.set_hexpand(True)
        self.area.set_draw_func(self.draw)
        self.set_child(self.area)
        self.connect("realize", self._on_realize)

    def _on_realize(self, *_):
        # Empty input region -> clicks pass straight through to the app below.
        surface = self.get_surface()
        if surface is not None:
            try:
                surface.set_input_region(cairo.Region())
            except Exception:
                pass

    def draw(self, _area, cr: cairo.Context, w: int, h: int) -> None:
        cr.set_operator(cairo.OPERATOR_SOURCE)
        cr.set_source_rgba(0, 0, 0, 0)
        cr.paint()
        cr.set_operator(cairo.OPERATOR_OVER)
        s = self.state
        if s.alpha < 0.01:
            return

        cx, base = w / 2.0, float(h)
        colour = s.colour

        # Bar count follows the screen: edge to edge, always an odd number so
        # there is a true centre bar.
        half = max(6, int(w / BAR_PITCH) // 2)
        bars = half * 2 + 1
        pitch = w / bars
        if s.levels.maxlen < half + 1:
            s.levels = deque(s.levels, maxlen=half + 1)

        glow = cairo.RadialGradient(cx, base, 0, cx, base, w / 2.0)
        glow.add_color_stop_rgba(0.0, *colour, (0.18 + 0.22 * s.flash) * s.alpha)
        glow.add_color_stop_rgba(0.45, *colour, (0.07 + 0.10 * s.flash) * s.alpha)
        glow.add_color_stop_rgba(1.0, *colour, 0.0)
        cr.set_source(glow)
        cr.rectangle(0, 0, w, h)
        cr.fill()

        # Bars mirrored around the centre: the newest sample is the middle bar,
        # older ones ripple outward and fade into nothing at the rim.
        levels = list(s.levels)
        for i in range(-half, half + 1):
            d = abs(i)
            level = levels[d] if d < len(levels) else 0.0
            fade = math.cos((d / half) * (math.pi / 2)) ** 1.6
            a = fade * s.alpha
            if s.shimmer:
                # distance of this bar from the travelling highlight, wrapped
                pos = (i + half) / (2 * half)
                gap = abs(((pos - s.shimmer + 0.5) % 1.0) - 0.5)
                a *= 0.55 + 0.85 * math.exp(-(gap * 9.0) ** 2)
            if a <= 0.004:
                continue
            bar_h = max(2.0, level * WAVE_H * (0.45 + 0.55 * fade))
            cr.set_source_rgba(*colour, a)
            # Rounded on top, running off the bottom of the screen.
            rounded(cr, cx + i * pitch - BAR_W / 2.0, base - bar_h,
                    BAR_W, bar_h + BAR_W, BAR_W / 2.0)
            cr.fill()

        line = cairo.LinearGradient(0, 0, w, 0)
        line.add_color_stop_rgba(0.0, *colour, 0.0)
        line.add_color_stop_rgba(0.5, *colour, (0.30 + 0.45 * s.flash) * s.alpha)
        line.add_color_stop_rgba(1.0, *colour, 0.0)
        cr.set_source(line)
        cr.rectangle(0, base - 1.0, w, 1.0)
        cr.fill()


class App(Gtk.Application):
    def __init__(self):
        super().__init__(application_id="dev.nhq.voxbar")
        self.state = State()
        self.strip: WaveStrip | None = None

    def do_activate(self):
        self.strip = WaveStrip(self, self.state)
        self.strip.present()
        GLib.timeout_add(1000 // FPS, self._tick)
        channel = GLib.IOChannel.unix_new(sys.stdin.fileno())
        channel.set_flags(GLib.IOFlags.NONBLOCK)
        GLib.io_add_watch(channel, GLib.PRIORITY_DEFAULT,
                          GLib.IOCondition.IN | GLib.IOCondition.HUP, self.on_stdin)

    def _tick(self) -> bool:
        if not self.state.tick():
            self.quit()
            return False
        self.strip.area.queue_draw()
        return True

    def on_stdin(self, channel: GLib.IOChannel, condition: GLib.IOCondition) -> bool:
        if condition & GLib.IOCondition.HUP:
            self.quit()
            return False
        while True:
            try:
                status, line, _, _ = channel.read_line()
            except Exception:
                return True
            if status != GLib.IOStatus.NORMAL or not line:
                return True
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            if "level" in msg:
                self.state.push_level(float(msg["level"]))
            if "busy" in msg:
                self.state.busy = bool(msg["busy"])
            if "phase" in msg:
                self.state.set_phase(str(msg["phase"]))
            # `text` is accepted and ignored on purpose: an older voxd still
            # sends it, and a KeyError here would take the overlay down mid
            # sentence for a message that no longer has anywhere to go.


if __name__ == "__main__":
    sys.exit(App().run(None))
