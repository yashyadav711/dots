#!/usr/bin/env bash
# Super+Enter: open a terminal that uses tmux.
#   - No tmux server yet   -> open kitty running a fresh tmux session.
#   - tmux already running  -> boxed chooser; ONE keypress (no Enter):
#        [1] jump to the existing tmux terminal and open a new window there
#        [2] start a NEW tmux session here on the current desktop
# Plain kitty (no tmux) lives on Super+T.
# Box uses ANSI bright-cyan (palette index 96) so it follows the active HyDE theme.

if tmux ls >/dev/null 2>&1; then
  kitty --class kitty-chooser -e bash -c '
C="\033[1;96m"; R="\033[0m"
bar=$(printf "=%.0s" $(seq 1 42))
line() { printf " ${C}|%-40s|${R}\n" "$1"; }
clear
printf "\n ${C}%s${R}\n" "$bar"
line ""
line "  tmux is running. choose:"
line ""
line "   [1]  jump to it  +  new window"
line "   [2]  new session here"
line ""
line "  (any other key cancels)"
printf " ${C}%s${R}\n\n" "$bar"
printf " ${C}>${R} "
read -rsn1 choice
echo
case "$choice" in
  1) hyprctl dispatch focuswindow "class:^(kitty-tmux)$"; sleep 0.15; tmux new-window ;;
  2) setsid kitty --class kitty-tmux -e tmux new-session >/dev/null 2>&1 & ;;
  *) : ;;
esac
'
else
  exec kitty --class kitty-tmux -e tmux new-session
fi
