#!/usr/bin/env bash
# Super+S floating GUI scratchpad toggle (gnome-text-editor on ~/scratchpad.md).
#
# A single persistent floating gnome-text-editor window editing ~/scratchpad.md. Unlike
# `togglespecialworkspace`, this does NOT pop an input-capturing special-workspace
# overlay, so the rest of the screen stays fully clickable while the scratchpad is
# open. It just hides/shows ONE floating window:
#
#   - visible on a real workspace  -> stash to special:scratchpadhidden (HIDE, persists)
#   - stashed in scratchpadhidden  -> pull to the current workspace + focus (SHOW)
#   - not running at all           -> spawn it, then pin it to the top-right corner
#
# gnome-text-editor is a single-instance GApplication; its window class is always
# `org.gnome.TextEditor`. We (a) launch with `--new-window` so the scratchpad gets its
# own dedicated window, and (b) identify that window by class + TITLE (always contains
# "scratchpad.md") so we never grab another Text Editor window or spawn duplicates. The
# userprefs.conf windowrules (matched by title) float + size the window; placement is
# done here because GTK re-centres floating windows at map time, defeating a `move` rule.
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
    'first(.[] | select(.class=="org.gnome.TextEditor" and (.title | test("scratchpad\\.md"))) | .address) // empty'
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

# Not running -> spawn a new floating gnome-text-editor window, wait for it, pin to corner.
if [ -z "$addr" ]; then
  gnome-text-editor --new-window "$NOTE" >/dev/null 2>&1 &
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
