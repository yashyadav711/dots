#!/usr/bin/env bash
# Super+Enter: create nHQ tmux session if absent, attach if present.
# -A = attach-or-create. Win+T = plain kitty (unchanged).
exec kitty --class kitty-tmux -e tmux new-session -A -s nHQ -n PM -c "$HOME/Github/product-manager"
