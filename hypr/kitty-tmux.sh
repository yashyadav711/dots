#!/usr/bin/env bash
# Super+Enter: attach to nhq tmux session directly.
# Win+T = plain kitty (unchanged).
if tmux has-session -t nhq 2>/dev/null; then
    exec kitty --class kitty-tmux -e tmux attach -t nhq
else
    exec kitty --class kitty-tmux -e bash -c '
        tmux new-session -d -s nhq -n PM -c ~/Github/product-manager
        tmux attach -t nhq
    '
fi
