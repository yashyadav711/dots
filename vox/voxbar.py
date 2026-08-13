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
# 34. The caliper is drawn as its TOP HALF only — the datum line sits on the
# bottom edge of the screen and every tooth grows up out of it, so the lower
# comb that used to hang below the line is gone. Yash: "sirf upper half neeche
# wala line k hata do, half se hi bottom touch hoga laptop ka." Half the
# instrument needs a little over half the height.
#
# Every dimension below is a fraction of h, so this number can move again
# without any of the drawing needing to be re-tuned.
WAVE_H = 34
FPS = 60

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
    """Bottom edge — the top half of a caliper, growing up out of the screen edge."""

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

        # A vernier caliper, cut in half lengthways. The datum line lies ON the
        # bottom edge of the screen and everything grows up out of it — Yash,
        # 2026-08-13: "sirf upper half neeche wala line k hata do, half se hi
        # bottom touch hoga laptop ka."
        #
        # The two combs used to be separated by sitting on opposite sides of the
        # datum, which is how a real caliper reads. With only the top half there
        # is no opposite side, so they are separated by WEIGHT instead: the fixed
        # scale is short and dim, the vernier comb that rides the jaw is tall and
        # bright. Same information, one side of the line.
        #
        # Origin is the centre and the jaws open symmetrically, which is what
        # "Heavy" is — the right-anchored full sweep this replaced put the origin
        # at the edge and swept one way.
        cx = w / 2.0
        base = float(h)                          # the screen's own bottom edge
        lv = 0.05 + s.smooth * 0.95              # never fully dead
        jaw_max = cx * 0.88
        open_ = lv * jaw_max

        def measure(v: float, a: float) -> None:
            cr.set_source_rgba(*s.shade(v, a))

        def status(a: float) -> None:
            cr.set_source_rgba(*s.chrome(a))

        def tick(x: float, up: float, lw: float) -> None:
            cr.set_line_width(lw)
            cr.move_to(x, base - up)
            cr.line_to(x, base)
            cr.stroke()

        # The overlay brings its own floor: it floats over whatever is at the
        # bottom of the screen, and hairlines over a terminal's status text are
        # unreadable. Centred like the instrument, gone by both edges.
        pad = cairo.LinearGradient(0, 0, w, 0)
        pad.add_color_stop_rgba(0.00, 0, 0, 0, 0.0)
        pad.add_color_stop_rgba(0.50, 0, 0, 0, 0.26 * s.alpha)
        pad.add_color_stop_rgba(1.00, 0, 0, 0, 0.0)
        cr.set_source(pad)
        cr.rectangle(0, 0, w, h)
        cr.fill()

        # The datum: a hairline along the very bottom, running the full width.
        # It is the one thing always visible, so it carries the state colour at
        # full strength rather than being dimmed by the microphone.
        rail = cairo.LinearGradient(0, 0, w, 0)
        c0 = s.chrome(0.0)
        c1 = s.chrome(0.55 + 0.35 * lv)
        rail.add_color_stop_rgba(0.00, *c0)
        rail.add_color_stop_rgba(0.14, *c1)
        rail.add_color_stop_rgba(0.86, *c1)
        rail.add_color_stop_rgba(1.00, *c0)
        cr.set_source(rail)
        cr.rectangle(0, base - 1.6, w, 1.6)
        cr.fill()

        # Fixed scale — the ruler. Short, dim, and it does not answer to the
        # microphone; it is the thing being measured against.
        main = 40
        sp = jaw_max / main
        for i in range(main + 1):
            d = jaw_max - i * sp
            u = d / cx
            major = i % 5 == 0
            status((0.20 + 0.26 * (1 - u)) * (1.0 - 0.5 * u * u) + 0.05)
            for x in (cx + d, cx - d):
                tick(x, 13 if major else 7, 2.2 if major else 1.4)

        # Vernier comb — 39 teeth against the fixed 40, which is the vernier
        # principle itself: the two combs beat against each other and where they
        # line up is the reading. Tall and bright so it reads over the ruler.
        vn = 39
        vsp = (sp * main) / vn
        for i in range(vn + 1):
            lo = i * vsp
            major = i % 5 == 0
            for sgn in (1, -1):
                x = cx + sgn * (open_ + lo)
                if x < 2 or x > w - 2:
                    continue
                u = abs(x - cx) / cx
                measure(lv, (0.95 if major else 0.58) * lv * (1.0 - 0.55 * u * u))
                tick(x, 26 if major else 15, 2.6 if major else 1.6)

        # The jaw faces: where the measurement is actually taken. Full height,
        # so the two of them frame the reading.
        for sgn in (1, -1):
            measure(lv, 0.62 + 0.36 * lv)
            tick(cx + sgn * open_, h - 2, 3.0)

        # Origin mark, so the eye knows what this is measured from.
        status(0.30 + 0.5 * lv)
        tick(cx, h - 4, 1.8)

        # Scanlines, centred with the rest and kept light — full strength across
        # the width would be a permanent dark band along the bottom of the
        # monitor rather than an overlay.
        scan = cairo.LinearGradient(0, 0, w, 0)
        scan.add_color_stop_rgba(0.00, 0, 0, 0, 0.0)
        scan.add_color_stop_rgba(0.50, 0, 0, 0, 0.16 * s.alpha)
        scan.add_color_stop_rgba(1.00, 0, 0, 0, 0.0)
        y = (s.breathe * 3.5) % 3.0
        cr.set_source(scan)
        while y < h - 2:
            cr.rectangle(0, y, w, 1.0)
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
