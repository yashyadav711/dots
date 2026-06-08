#!/usr/bin/env bash
# Super+Enter: open kitty and run tmux-init.sh inside it (create-or-attach nHQ).
# All tmux logic runs inside the terminal so TTY is properly wired.
# Win+T = plain kitty (unchanged).
exec kitty --class kitty-tmux -e /home/yash/.config/hypr/tmux-init.sh
