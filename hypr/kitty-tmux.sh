#!/usr/bin/env bash
# Super+Enter: attach to nHQ session if it exists, create it with all 10 windows if not.
# Win+T = plain kitty (unchanged).
if tmux has-session -t nHQ 2>/dev/null; then
    exec kitty --class kitty-tmux -e tmux attach -t nHQ
fi
# First launch — create session with all named windows
tmux new-session -d -s nHQ -n PM   -c "$HOME/Github/product-manager"
tmux new-window  -t nHQ    -n envy  -c "$HOME"
tmux new-window  -t nHQ    -n fish  -c "$HOME"
tmux new-window  -t nHQ    -n mirror -c "$HOME/Github/mirror"
tmux new-window  -t nHQ    -n heydaddy -c "$HOME/Github/heydaddy"
tmux new-window  -t nHQ    -n dev   -c "$HOME/Github"
tmux new-window  -t nHQ    -n git   -c "$HOME/Github"
tmux new-window  -t nHQ    -n logs  -c "$HOME"
tmux new-window  -t nHQ    -n notes -c "$HOME"
tmux new-window  -t nHQ    -n scratch -c "$HOME"
tmux select-window -t nHQ:PM
exec kitty --class kitty-tmux -e tmux attach -t nHQ
