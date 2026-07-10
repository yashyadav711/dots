#!/usr/bin/env bash
# tmux vi copy-mode UX (sourced via run-shell from tmux.conf.local, deferred after plugins
# so tmux-copycat doesn't clobber these).
#
#  - Scroll up to browse. A plain click returns to the live app/input (cancel copy-mode +
#    forward the click), so omp regains its input box focus instead of leaving you parked in
#    scrollback. Drag still selects/copies via the copy-mode mouse path.
#  - VISUAL MODE kept ON: v = start selection, V = select line, arrows/mouse extend,
#    y = copy + return to prompt, Escape = cancel.
#  - Start typing any OTHER normal key -> copy-mode exits to the live prompt AND the key is
#    sent, so you just type your command and it lands. (Commands starting with v/V/y won't
#    auto-return — press Escape first.) Scroll-to-bottom auto-exits (-e); right-click menu
#    has Go To Bottom.
#
# Multi-command bindings need `\;`, which only parses in a sourced config (not `tmux bind`
# CLI), so we generate a file and source it. Idempotent.
GEN="$HOME/.cache/tmux-copy-type-exit.tmux"
{
  # type-to-return: printable keys exit copy-mode + send the key — BUT keep the
  # normal vi copy-mode/navigation keys intact so visual selection actually works.
  for k in {a..z} {A..Z}; do
    case "$k" in v|V|y|h|j|k|l|w|W|b|B|e|E|g|G|n|N|f|F|t|T) continue ;; esac
    printf 'bind -T copy-mode-vi "%s" send-keys -X cancel \\; send-keys -l "%s"\n' "$k" "$k"
  done
  cat <<'EOS'
bind -T copy-mode-vi 0 send-keys -X start-of-line
bind -T copy-mode-vi b send-keys -X previous-word
bind -T copy-mode-vi e send-keys -X next-word-end
bind -T copy-mode-vi f command-prompt -1 -p "(jump forward)" { send-keys -X jump-forward -- "%%" }
bind -T copy-mode-vi F command-prompt -1 -p "(jump backward)" { send-keys -X jump-backward -- "%%" }
bind -T copy-mode-vi g send-keys -X history-top
bind -T copy-mode-vi G send-keys -X history-bottom
bind -T copy-mode-vi h send-keys -X cursor-left
bind -T copy-mode-vi j send-keys -X cursor-down
bind -T copy-mode-vi k send-keys -X cursor-up
bind -T copy-mode-vi l send-keys -X cursor-right
bind -T copy-mode-vi n send-keys -X search-again
bind -T copy-mode-vi N send-keys -X search-reverse
bind -T copy-mode-vi q send-keys -X cancel
bind -T copy-mode-vi t command-prompt -1 -p "(jump to forward)" { send-keys -X jump-to-forward -- "%%" }
bind -T copy-mode-vi v send-keys -X begin-selection \; send-keys -X cursor-right
bind -T copy-mode-vi V send-keys -X select-line
bind -T copy-mode-vi w send-keys -X next-word
bind -T copy-mode-vi y send -X copy-pipe-and-cancel "wl-copy"
bind -T copy-mode-vi MouseUp1Pane send-keys -X cancel \; send-keys -M
bind -T copy-mode-vi MouseDragEnd1Pane send -X copy-pipe "bash -c 'd=$(cat); printf %s \"$d\" | wl-copy; printf %s \"$d\" | wl-copy --primary'"
EOS
} > "$GEN"
tmux source-file "$GEN"
