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

# The origin is pinned to the right edge and the scale runs the whole width from
# it. This was briefly the corner version, with the instrument packed into the
# right-hand end and the rest of the strip empty; Yash rejected that and asked
# for the full sweep — "hard right full sweep vaala sahi hai".
ORIGIN_INSET = 18.0

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
        self.smooth = 0.0
        self.phase = "warming"
        self.alpha = 0.0
        self.target_alpha = 1.0
        self.spin = 0.0
        self.busy = False
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
        # the jaw must not slam shut between syllables or the strip reads as "it
        # stopped hearing me" during ordinary speech.
        self.smooth = max(level, self.smooth * 0.82)

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

        # `smooth` IS the drawing now — the caliper reads it directly, where the
        # old bars read a history deque. So every phase has to drive it, and a
        # phase that drives nothing leaves the jaw frozen wherever the last
        # syllable left it. That is exactly what happened on the first run: the
        # red transcribing state held whatever width the last word had.
        if self.phase == "warming":
            # Breathing, not still. Amber at a fixed width is indistinguishable
            # from a hung overlay, and the model can take a second to load.
            self.smooth += (0.10 + 0.05 * (1 + math.sin(self.breathe)) / 2 - self.smooth) * 0.18
        elif self.phase == "transcribing":
            # A slow sweep, so a long decode looks like work rather than a hang.
            self.spin += 0.075
            self.smooth += (0.30 + 0.22 * math.sin(self.spin) - self.smooth) * 0.20
        elif self.phase == "done":
            # Settle flat: the job is finished, and a jaw still moving would say
            # otherwise.
            self.smooth *= 0.86
        else:
            # Recording. push_level does the work, but decay here too so a
            # stalled mic stream closes the jaw instead of freezing it open.
            self.smooth *= 0.97

        return not (self.target_alpha == 0.0 and self.alpha < 0.02)

    def ease_colour(self, dt: float) -> None:
        if self.fade_t >= 1.0:
            self.lab_now = self.lab_to
            return
        self.fade_t = min(1.0, self.fade_t + dt / FADE_S)
        e = 1.0 - (1.0 - self.fade_t) ** 4           # easeOutQuart
        self.lab_now = tuple(a + (b - a) * e for a, b in zip(self.lab_from, self.lab_to))

    def shade(self, v: float, alpha: float) -> tuple[float, float, float, float]:
        """The state colour, dimmed by loudness `v`. For the parts that MEASURE.

        Loudness moves lightness and chroma, NEVER hue. A green sliding toward
        yellow as you speak up looks cheap and fights the state colours.

        The floors matter more than the curve. They started at 0.22 chroma and
        Yash immediately caught what that costs: "jab wo chaaloo hota hai aur
        uske baad phir jab process hota hai, to uska color change hona chaahie
        na yaar. Wo color change nahi ho raha." He was right and the cause was
        mine — warming and transcribing both sit near silence, so at 22% chroma
        amber, green and red all arrived as the same washed grey. The state was
        being drowned by the level. Floors are 0.55 now, and the structural
        parts do not use this function at all; see `chrome`.
        """
        L, A, B = self.lab_now
        c = math.hypot(A, B)
        hue = math.atan2(B, A)
        v = max(0.0, min(1.0, v))
        lv = 0.52 + (L - 0.52) * (0.45 + 0.55 * v ** 1.5)
        cv = c * (0.55 + 0.45 * (v ** 1.2))
        return self._rgba(lv, cv, hue, alpha)

    def chrome(self, alpha: float) -> tuple[float, float, float, float]:
        """The state colour at full strength, whatever the microphone is doing.

        The bracket, the rail and the jaw are the STATUS display: amber means
        wait, green means speak, red means it is working them out. That has to be
        readable in silence — which is precisely when warming and transcribing
        happen — so it is deliberately not attenuated by level.
        """
        L, A, B = self.lab_now
        return self._rgba(L, math.hypot(A, B), math.atan2(B, A), alpha)

    def _rgba(self, L: float, c: float, hue: float, alpha: float):
        r, g, b = oklab_to_rgb((L, c * math.cos(hue), c * math.sin(hue)))
        if self.flash > 0.01:                        # capture beat, toward white
            f = self.flash
            r, g, b = (x + (1.0 - x) * f for x in (r, g, b))
        return r, g, b, alpha * self.alpha


class WaveStrip(Gtk.ApplicationWindow):
    """Bottom edge — a caliper anchored right, measuring the full width leftward."""

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

        # A vernier caliper anchored at the RIGHT EDGE, measuring the full width
        # of the monitor leftward. Chosen by Yash on 2026-08-13: "hard right full
        # sweep vaala sahi hai" — after the corner version, which packed the same
        # instrument into the right-hand end, looked wrong to him: "ye jo pichhe
        # vaali line hai na, ye actually tumko poore length par daalni padegi".
        #
        # So: the scale is the full width and never moves. The origin is pinned
        # at the right. The only thing that travels is the jaw, and it travels
        # leftward out of the origin as you get louder.
        #
        # Every dimension is a fraction of h, so WAVE_H can change without any
        # of this needing re-tuning.
        ox = w - ORIGIN_INSET
        cy = h * 0.54
        lv = 0.05 + s.smooth * 0.95              # never fully dead
        span = ox - 14.0

        def measure(v: float, a: float) -> None:
            cr.set_source_rgba(*s.shade(v, a))

        def status(a: float) -> None:
            cr.set_source_rgba(*s.chrome(a))

        def line(x0, y0, x1, y1, lw):
            cr.set_line_width(lw)
            cr.move_to(x0, y0)
            cr.line_to(x1, y1)
            cr.stroke()

        # The overlay brings its own floor. It floats over whatever is at the
        # bottom of the screen — on 2026-08-13 that was a terminal status line,
        # and hairlines over grey text are unreadable. Weighted to the right,
        # where the instrument is densest, and gone by the left edge.
        pad = cairo.LinearGradient(0, 0, ox, 0)
        pad.add_color_stop_rgba(0.00, 0, 0, 0, 0.0)
        pad.add_color_stop_rgba(0.55, 0, 0, 0, 0.13 * s.alpha)
        pad.add_color_stop_rgba(1.00, 0, 0, 0, 0.32 * s.alpha)
        cr.set_source(pad)
        cr.rectangle(0, 0, w, h)
        cr.fill()

        # Brackets at both ends. The right one is heavy — that is the anchor,
        # and it is the piece that carries the state colour at full strength.
        status(0.62 + 0.30 * lv)
        cr.set_line_width(2.6)
        cr.move_to(ox - 18, 6); cr.line_to(ox, 6)
        cr.line_to(ox, h - 6); cr.line_to(ox - 18, h - 6)
        cr.stroke()
        status(0.24)
        cr.set_line_width(1.6)
        cr.move_to(24, 6); cr.line_to(10, 6)
        cr.line_to(10, h - 6); cr.line_to(24, h - 6)
        cr.stroke()

        # The fixed scale: the full-length back line he asked for. It does not
        # move and it does not respond to the microphone; it is the ruler.
        n = 56
        sp = span / n
        for i in range(1, n + 1):
            x = ox - i * sp
            if x < 8:
                break
            major = i % 5 == 0
            u = i / n
            status((0.30 + 0.26 * (1 - u)) * (1.0 - 0.55 * u * u) + 0.05)
            line(x, cy - (15 if major else 8), x, cy, 2.2 if major else 1.4)

        # The vernier comb rides on the jaw. 55 teeth against the fixed 56 is the
        # vernier principle itself — the combs beat against each other, and where
        # they align is the reading.
        vn = 55
        vsp = (sp * n) / vn
        reach = lv * span * 0.92
        jx = ox - reach
        for i in range(vn + 1):
            x = jx + i * vsp
            if x > ox or x < 8:
                continue
            major = i % 5 == 0
            u = i / vn
            measure(lv, (0.9 if major else 0.5) * lv * (1.0 - 0.55 * u * u))
            line(x, cy, x, cy + (14 if major else 7), 2.4 if major else 1.5)

        # The measurement itself: a bracket at the travelling jaw and a run of
        # cells filling back to the origin. This is the part that sweeps out from
        # the right as you speak, and it is what makes the strip a meter rather
        # than a pattern.
        cr.set_line_width(2.4)
        measure(lv, 0.78 + 0.20 * lv)
        cr.move_to(jx + 10, cy - 16); cr.line_to(jx, cy - 16)
        cr.line_to(jx, cy + 16); cr.line_to(jx + 10, cy + 16)
        cr.stroke()

        cells = 26
        cw = reach / cells
        for i in range(cells):
            measure(lv, 0.18 + 0.58 * lv * (1 - i / cells * 0.7))
            cr.rectangle(jx + 4 + i * cw, cy - 4, max(1.4, cw - 2.6), 8)
            cr.fill()

        # The jaw face at the origin — the fixed end of the caliper.
        status(0.70 + 0.28 * lv)
        line(ox, cy - 24, ox, cy + 23, 3.0)

        # Scanlines, weighted right like the wash. Full-width at full strength
        # would be a permanent dark band across the bottom of the monitor.
        scan = cairo.LinearGradient(0, 0, ox, 0)
        scan.add_color_stop_rgba(0.0, 0, 0, 0, 0.0)
        scan.add_color_stop_rgba(1.0, 0, 0, 0, 0.18 * s.alpha)
        y = (s.breathe * 3.5) % 3.0
        cr.set_source(scan)
        while y < h:
            cr.rectangle(0, y, ox, 1.0)
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
