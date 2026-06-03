#!/usr/bin/env bash
# Super+W run-or-raise for Firefox, home = workspace 2:
#  - if a Firefox window exists: jump to ITS workspace and focus it
#  - else: switch to workspace 2 and launch Firefox there (so it opens on 2 + takes you there)
# A windowrule (userprefs.conf) also pins any Firefox window to workspace 2.
if hyprctl clients -j | jq -e '.[] | select(.class=="firefox")' >/dev/null 2>&1; then
  hyprctl dispatch focuswindow 'class:^(firefox)$'
else
  hyprctl dispatch workspace 2
  firefox
fi
