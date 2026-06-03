#!/usr/bin/env bash
# Run-or-raise Sublime Text for Super+E:
# focus the existing Sublime window if one exists, otherwise launch it.
# Avoids spawning a new window every keypress.
if hyprctl clients -j | jq -e '.[] | select(.class=="sublime_text")' >/dev/null 2>&1; then
  hyprctl dispatch focuswindow 'class:^(sublime_text)$'
else
  subl
fi
