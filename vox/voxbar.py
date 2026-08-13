#!/usr/bin/env python3
"""voxbar — the on-screen dictation overlay. A caliper in the bottom-right corner.

A single click-through Wayland layer-shell surface glued to the bottom edge. The
instrument sits in the right-hand end and measures leftward; the rest of the
strip is deliberately empty. Chosen by Yash on 2026-08-13 out of thirty-four
candidates (see waveform-options.html, built by build-waveform-page.sh) and then
out of three right-aligned readings of this one: "01", the corner gauge.

It replaced a full-width row of bars that scrolled right to left. That was wrong
twice over — it read as a chart recorder rather than a level, and it occupied
the whole monitor whether or not it had anything to say.

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
# 56, up from 36. The strip is now an instrument rather than a row of bars: it
# needs room for the bracket, the scale above the datum line and the vernier
# comb below it. 74 is what the prototype was judged at; 56 keeps every
# proportion (they are all fractions of h) while taking noticeably less screen.
WAVE_H = 56
FPS = 60

# The instrument lives in the right-hand end and the rest of the strip is left
# empty on purpose. Yash picked this out of three right-aligned readings of the
# design: "01" — the corner-gauge one. SPAN is how far the scale reaches back
# from the origin; it never spans the monitor, because the emptiness is the
# point.
ORIGIN_INSET = 18.0
SPAN_MAX = 430.0

# Four states, four colours. With no caption these are the entire status
# display, so they are picked to be unmistakable at the edge of vision rather
# than merely different: amber reads as wait, green as go, red as busy, and the
# white flash is a full-brightness event you cannot miss even peripherally.
WARMING = (0.98, 0.72, 0.25)     # amber  — model still coming up, hold on
READY   = (0.36, 0.95, 0.55)     # green  — loaded and listening, speak
BUSY    = (1.00, 0.32, 0.28)     # red    — working out what you said
DONE    = (0.85, 0.98, 0.92)     # near-white — captured, text is on its way


# ── colour ───────────────────────────────────────────────────────────────────
# sRGB <-> OKLab, from Björn Ottosson's reference implementation.
#
# WHY NOT JUST LERP THE RGB: green to red through sRGB passes through a muddy
# brown, which is exactly the transition this thing makes every time a sentence
# ends. OKLab is perceptually uniform so the path stays clean, and it is
# Cartesian, so unlike OKLCH it cannot take the long way round the hue circle.

def _s2l(c: float) -> float:
    return ((c + 0.055) / 1.055) ** 2.4 if c > 0.04045 else c / 12.92


def _l2s(c: float) -> float:
    return 1.055 * (c ** (1 / 2.4)) - 0.055 if c >= 0.0031308 else 12.92 * c


def rgb_to_oklab(rgb: tuple[float, float, float]) -> tuple[float, float, float]:
    r, g, b = (_s2l(x) for x in rgb)
    l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s = (0.0883024619 * r + 0.2817188376 * g + 0.9067466974 * b) ** (1 / 3)
    return (0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s)


def oklab_to_rgb(lab: tuple[float, float, float]) -> tuple[float, float, float]:
    L, A, B = lab
    l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
    m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
    s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3
    out = (4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
           -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
           -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)
    return tuple(max(0.0, min(1.0, _l2s(x))) for x in out)


LAB = {k: rgb_to_oklab(v) for k, v in
       {"warming": WARMING, "ready": READY, "busy": BUSY, "done": DONE}.items()}

# 180 ms, easeOutQuart: fast enough to feel like a response, slow enough that it
# is a transition and not a strobe.
FADE_S = 0.180


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
        # OKLab state colour, eased rather than switched. `lab_now` is what gets
        # drawn; the other two are the ends of the current 180 ms transition.
        self.lab_now = LAB["warming"]
        self.lab_from = LAB["warming"]
        self.lab_to = LAB["warming"]
        self.fade_t = 1.0

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
            # there is otherwise no instant that says "got it" — the strip would
            # simply stop, which is also what a crash looks like.
            self.flash = 1.0
        self.phase = phase
        want = LAB[{"warming": "warming", "recording": "ready",
                    "done": "done"}.get(phase, "busy")]
        if want != self.lab_to:
            self.lab_from, self.lab_to, self.fade_t = self.lab_now, want, 0.0
        if phase == "bye":
            self.target_alpha = 0.0

    # ── per frame ────────────────────────────────────────────────────────────
    def tick(self) -> bool:
        """Advance the animation. False once the overlay has faded out."""
        self.alpha += (self.target_alpha - self.alpha) * 0.25
        self.ease_colour(1.0 / FPS)
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

    def ease_colour(self, dt: float) -> None:
        if self.fade_t >= 1.0:
            self.lab_now = self.lab_to
            return
        self.fade_t = min(1.0, self.fade_t + dt / FADE_S)
        e = 1.0 - (1.0 - self.fade_t) ** 4           # easeOutQuart
        self.lab_now = tuple(a + (b - a) * e for a, b in zip(self.lab_from, self.lab_to))

    def shade(self, v: float, alpha: float) -> tuple[float, float, float, float]:
        """The state colour at loudness `v`.

        Loudness moves lightness and chroma, NEVER hue. A green that slid toward
        yellow as you spoke up would look cheap and would also fight the state
        colours, which are the only status display this thing has. Quiet is a
        dim, desaturated version of the same colour; loud is the colour at full
        strength. Exponents 1.5 and 1.2 are the perceptual mapping — linear
        looks flat at the bottom of the range.
        """
        L, A, B = self.lab_now
        c = math.hypot(A, B)
        h = math.atan2(B, A)
        v = max(0.0, min(1.0, v))
        lv = 0.42 + (L - 0.42) * (v ** 1.5)
        cv = c * (0.22 + 0.78 * (v ** 1.2))
        r, g, b = oklab_to_rgb((lv, cv * math.cos(h), cv * math.sin(h)))
        if self.flash > 0.01:                        # capture beat, toward white
            f = self.flash
            r, g, b = (x + (1.0 - x) * f for x in (r, g, b))
        return r, g, b, alpha * self.alpha


class WaveStrip(Gtk.ApplicationWindow):
    """Bottom-right corner — a caliper reading the microphone."""

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

        # A vernier caliper, anchored in the right-hand corner and measuring
        # back to the left. Chosen by Yash out of thirty-four candidates and
        # three right-aligned readings of this one, on 2026-08-13.
        #
        # The strip used to be bars, edge to edge. Two things were wrong with
        # that and this fixes both: it scrolled sideways like a chart recorder
        # ("sab right se left ke taraf hi ho ja rahi hai"), and it filled the
        # whole width whether or not it had anything to say. An instrument
        # sitting in one corner with the rest of the screen left alone is a
        # quieter thing to have on all day.
        #
        # Everything below is a fraction of h, so the design survives a change
        # of WAVE_H without being re-tuned.
        ox = w - ORIGIN_INSET
        cy = h * 0.54
        lv = 0.05 + s.smooth * 0.95              # never fully dead
        span = min(w - 40.0, SPAN_MAX)

        def rgba(v: float, a: float) -> None:
            cr.set_source_rgba(*s.shade(v, a))

        def stroke(x0, y0, x1, y1, lw, v, a):
            cr.set_line_width(lw)
            rgba(v, a)
            cr.move_to(x0, y0)
            cr.line_to(x1, y1)
            cr.stroke()

        # A backing wash under the instrument, fading out to the left.
        #
        # Not decoration. This surface floats over whatever happens to be at the
        # bottom of the screen, and the first screenshot on 2026-08-13 landed it
        # on a terminal status line — hairline ticks over grey text, unreadable.
        # The overlay cannot know what is underneath, so it brings its own floor.
        # It stops well short of a bar: transparent on the left, and never more
        # than a third opaque even under the readout.
        pad = cairo.LinearGradient(ox - span - 40, 0, ox, 0)
        pad.add_color_stop_rgba(0.00, 0, 0, 0, 0.0)
        pad.add_color_stop_rgba(0.55, 0, 0, 0, 0.14 * s.alpha)
        pad.add_color_stop_rgba(1.00, 0, 0, 0, 0.34 * s.alpha)
        cr.set_source(pad)
        cr.rectangle(0, 0, w, h)
        cr.fill()

        # The bracket. Two corners and air — never a closed box, which is the
        # difference between a HUD and a dialog.
        cr.set_line_width(2.6)
        rgba(0.6, 0.5 + 0.3 * lv)
        cr.move_to(ox - 18, 7)
        cr.line_to(ox, 7)
        cr.line_to(ox, h - 7)
        cr.line_to(ox - 18, h - 7)
        cr.stroke()

        # Fixed scale, marching left out of the origin, dying out well before
        # the left edge so the emptiness reads as intended rather than as a
        # surface that failed to paint.
        n = 30
        sp = span / n
        for i in range(1, n + 1):
            x = ox - 10 - i * sp
            if x < 6:
                break
            major = i % 5 == 0
            u = i / n
            stroke(x, cy - (15 if major else 8), x, cy,
                   2.2 if major else 1.4, 0.45,
                   (0.30 + 0.22 * (1 - u)) * (1 - u * 0.85) + 0.04)

        # The vernier comb rides outward on the jaw. 29 teeth against the fixed
        # 30 is the vernier principle itself: the two combs beat against each
        # other, and where they line up is the reading.
        vn = 29
        vsp = (sp * n) / vn
        reach = lv * span * 0.9
        for i in range(vn + 1):
            x = ox - 10 - reach + i * vsp
            if x > ox - 10 or x < 6:
                continue
            major = i % 5 == 0
            u = i / vn
            stroke(x, cy, x, cy + (14 if major else 7),
                   2.4 if major else 1.5, lv,
                   (0.9 if major else 0.5) * lv * (1 - u * 0.6))

        # The readout: a bracketed field of cells that fills as you get louder.
        # This is the part you can read from across the desk without looking at
        # it properly.
        bw = 34 + lv * 120
        bx = ox - 10 - bw
        cr.set_line_width(2.2)
        rgba(lv, 0.72 + 0.24 * lv)
        cr.move_to(bx + 9, cy - 15)
        cr.line_to(bx, cy - 15)
        cr.line_to(bx, cy + 15)
        cr.line_to(bx + 9, cy + 15)
        cr.stroke()

        # Lit against unlit has to be a big gap, not a shade. In the first
        # screenshot the quiet strip and the loud strip looked much the same,
        # because 0.09 against 0.35 is a difference you have to look for. An
        # unlit cell is now barely a ghost and a lit one is solid — the meter
        # should be readable from the corner of your eye, at speed.
        cells = 14
        cw = (bw - 12) / cells
        on = round(lv * cells)
        for i in range(cells):
            rgba(lv, 0.55 + 0.42 * lv if i < on else 0.055)
            cr.rectangle(bx + 7 + i * cw, cy - 4.5, max(1.6, cw - 2.4), 9)
            cr.fill()

        # The jaw face at the origin.
        stroke(ox - 10, cy - 22, ox - 10, cy + 21, 3.0, lv, 0.6 + 0.35 * lv)

        # Scanlines, but ONLY over the instrument and fading out to the left.
        # In the prototype they ran the full width, which is fine on a page with
        # a background; on a transparent overlay that is a permanent dark band
        # across the bottom of the monitor. Here they darken the corner the
        # instrument occupies and nothing else.
        left = max(0.0, bx - 60)
        scan = cairo.LinearGradient(left, 0, ox, 0)
        scan.add_color_stop_rgba(0.0, 0, 0, 0, 0.0)
        scan.add_color_stop_rgba(1.0, 0, 0, 0, 0.20 * s.alpha)
        y = (s.breathe * 3.5) % 3.0
        cr.set_source(scan)
        while y < h:
            cr.rectangle(left, y, ox - left, 1.0)
            y += 3.0
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
