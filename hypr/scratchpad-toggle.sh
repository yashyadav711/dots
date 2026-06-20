#!/usr/bin/env bash
# Super+S floating GUI scratchpad toggle (xed notepad on ~/scratchpad.md).
#
# A single persistent floating xed window editing ~/scratchpad.md. Unlike
# `togglespecialworkspace`, this does NOT pop an input-capturing special-workspace
# overlay, so the rest of the screen stays fully clickable while the scratchpad is
# open. It just hides/shows ONE floating window:
#
#   - visible on a real workspace  -> stash to special:scratchpadhidden (HIDE, persists)
#   - stashed in scratchpadhidden  -> pull to the current workspace + focus (SHOW)
#   - not running at all           -> spawn it, then pin it to the top-right corner
#
# xed is single-instance by default and its window class is always `xed`, so we
# (a) launch with `--standalone` to get an independent process that never merges its
# tab into the Super+Ctrl+Shift+S secret-clipboard xed, and (b) identify the
# scratchpad window by TITLE (it always contains "scratchpad.md") rather than class,
# so we never grab another xed window or spawn duplicates. The userprefs.conf
# windowrules float + size the window (reliable); placement is done here because
# GTK/xed re-centres floating windows at map time, which defeats a `move` rule.
set -euo pipefail

HIDDEN="special:scratchpadhidden"
NOTE="$HOME/scratchpad.md"
W=600          # window width  (matches the size windowrule)
H=240          # window height (matches the size windowrule)
MARGIN=20      # gap from the right edge
TOP=12         # gap below the top reserved area (waybar)

[ -f "$NOTE" ] || printf '# Scratchpad\n\n' > "$NOTE"

find_addr() {
  hyprctl clients -j | jq -r \
    'first(.[] | select(.class=="xed" and (.title | test("scratchpad\\.md"))) | .address) // empty'
}

place() { # $1 = window address -> pin to the top-right corner of the focused monitor
  local a="$1" mw mx my rt x y
  read -r mw mx my rt < <(hyprctl monitors -j | jq -r \
    'first(.[] | select(.focused)) | "\(.width) \(.x) \(.y) \(.reserved[1])"')
  x=$(( mx + mw - W - MARGIN ))
  y=$(( my + rt + TOP ))
  hyprctl dispatch resizewindowpixel "exact $W $H,address:$a" >/dev/null
  hyprctl dispatch movewindowpixel  "exact $x $y,address:$a" >/dev/null
}

addr=$(find_addr)

# Not running -> spawn a standalone floating xed, wait for it, then pin to corner.
if [ -z "$addr" ]; then
  xed --standalone "$NOTE" >/dev/null 2>&1 &
  for _ in $(seq 1 50); do
    addr=$(find_addr)
    [ -n "$addr" ] && break
    sleep 0.1
  done
  [ -n "$addr" ] && place "$addr"
  exit 0
fi

ws=$(hyprctl clients -j | jq -r --arg a "$addr" \
       'first(.[] | select(.address==$a) | .workspace.name) // empty')

if [ "$ws" = "$HIDDEN" ]; then
  # Stashed -> bring it to the current workspace, focus it, re-pin to corner (SHOW).
  cur=$(hyprctl activeworkspace -j | jq -r '.id')
  hyprctl dispatch movetoworkspacesilent "$cur,address:$addr"
  hyprctl dispatch focuswindow "address:$addr"
  place "$addr"
else
  # Visible -> stash it silently (HIDE; window/session persists).
  hyprctl dispatch movetoworkspacesilent "$HIDDEN,address:$addr"
fi
