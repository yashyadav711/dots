#!/usr/bin/env bash
# mic-gain.sh — put the boost back on the denoised mic after pipewire restarts.
#
# WHY A GAIN AT ALL: rnnoise strips the room but does not amplify, and the HP
# Envy 13's internal mic already peaks around -12.5 dB with ALSA Capture and
# Internal Mic Boost both maxed — there is no headroom left in hardware.
#
# WHY NOT A SECOND FILTER NODE: an earlier two-node graph (rnnoise -> builtin
# gain) crashed pipewire outright — `unknown output port rnnoise:Out`, because
# that port name does not exist on `noise_suppressor_mono` — and took
# pipewire-pulse and wireplumber down with it, then hit systemd's start limit so
# nothing came back on its own. Single-node graph plus this script is the safe
# shape. Do not "tidy" it back into the filter graph.
#
# WHY A SCRIPT AND NOT AN INLINE ExecStart: the lookup needs awk inside sh inside
# a systemd unit line, and the quoting was wrong twice. A file has no quoting
# problem.
#
# Closes a TODO from 2026-07-04 that read "not persistent — resets on the next
# pipewire/wireplumber restart".
set -uo pipefail

GAIN="${VOX_MIC_GAIN:-2.5}"
LIMIT="${VOX_MIC_GAIN_LIMIT:-3.0}"
NAME="${VOX_MIC_SOURCE:-rnnoise_source}"

# The filter-chain node is created asynchronously, so a restart can reach this
# before the source exists. Wait rather than fail.
for _ in $(seq 30); do
  id=$(pactl list short sources 2>/dev/null | awk -v n="$NAME" '$2==n {print $1; exit}')
  if [ -n "${id:-}" ]; then
    wpctl set-volume "$id" "$GAIN" -l "$LIMIT" && {
      echo "$NAME (id $id) gain -> $GAIN (limit $LIMIT)"
      exit 0
    }
    echo "found $NAME (id $id) but wpctl refused the volume" >&2
    exit 1
  fi
  sleep 0.5
done

echo "$NAME never appeared — is dots/pipewire/99-input-denoising.conf linked into ~/.config/pipewire/pipewire.conf.d/ ?" >&2
exit 1
