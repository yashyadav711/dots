#!/usr/bin/env bash
# The chime dunst plays on every notification.
#
# WHY NOT `aplay`: it was `aplay service-login.wav`, and aplay talks straight to
# ALSA — it bypasses PipeWire entirely, so the desktop volume, per-app volume and
# mute all did nothing to it. Every notification came out at full hardware level
# whatever the system was set to. `pw-play` goes through the normal graph, so it
# now behaves like every other sound on the machine.
#
# WHY THE FILE WAS RE-CUT: measured 2026-08-13, the original sat at -3.9 dBFS RMS
# with peak 1.000 — brick-walled, clipped, and 23-29 dB louder than the
# freedesktop chimes it sits beside (message.oga -26.7, message-new-instant.oga
# -33.3). Yash: "abhi kaafi boosted h". Re-cut to -24 dBFS RMS, a touch louder
# than the standard set so it still cuts through. Original kept at
# ~/.local/share/nhq-archive/service-login.wav.original.
#
# VOLUME knob below is the one to turn if -24 dBFS is still wrong; it is applied
# on top, so 0.5 halves it again without touching the file.
set -uo pipefail

SOUND="${NHQ_NOTIFY_SOUND:-$HOME/.config/dunst/service-login.wav}"
VOLUME="${NHQ_NOTIFY_VOLUME:-1.0}"

[ -r "$SOUND" ] || exit 0
exec pw-play --volume="$VOLUME" "$SOUND"
