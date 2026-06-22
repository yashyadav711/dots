#!/usr/bin/env bash
# tmux vi copy-mode UX (sourced via run-shell from tmux.conf.local, deferred after plugins
# so tmux-copycat doesn't clobber these).
#
#  - Scroll up to browse; click positions, drag selects — NEITHER jumps you to the bottom
#    (drag-end uses copy-pipe, NOT copy-pipe-and-cancel, so a stray micro-drag can't cancel).
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
  # type-to-return: printable keys exit copy-mode + send the key — EXCEPT v/V/y (visual mode)
  for k in {a..z} {A..Z} {0..9}; do
    case "$k" in v|V|y) continue ;; esac
    printf 'bind -T copy-mode-vi "%s" send-keys -X cancel \\; send-keys -l "%s"\n' "$k" "$k"
  done
  printf 'bind -T copy-mode-vi Space send-keys -X cancel \\; send-keys -l " "\n'
  cat <<'EOS'
bind -T copy-mode-vi v send-keys -X begin-selection
bind -T copy-mode-vi V send-keys -X select-line
bind -T copy-mode-vi y send -X copy-pipe-and-cancel "bash -c 'd=$(cat); printf %s \"$d\" | wl-copy; printf %s \"$d\" | wl-copy --primary'"
bind -T copy-mode-vi MouseDragEnd1Pane send -X copy-pipe "bash -c 'd=$(cat); printf %s \"$d\" | wl-copy; printf %s \"$d\" | wl-copy --primary'"
EOS
} > "$GEN"
tmux source-file "$GEN"
