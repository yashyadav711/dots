#!/usr/bin/env bash
# Super+Enter: attach to nHQ tmux session directly.
# Win+T = plain kitty (unchanged).
if tmux has-session -t nHQ 2>/dev/null; then
    exec kitty --class kitty-tmux -e tmux attach -t nHQ
else
    exec kitty --class kitty-tmux -e bash -c '
        tmux new-session -d -s nHQ -n PM -c ~/Github/product-manager
        tmux attach -t nHQ
    '
fi
