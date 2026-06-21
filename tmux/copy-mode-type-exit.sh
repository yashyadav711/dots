#!/usr/bin/env bash
# tmux vi copy-mode UX (sourced via run-shell from tmux.conf.local, deferred after plugins
# so tmux-copycat doesn't clobber these).
#
#  - Scroll up to browse; click positions, drag selects — NEITHER jumps you to the bottom.
#  - Drag-release COPIES (clipboard + primary) but does NOT cancel copy-mode (no jump);
#    a stray micro-drag on a click therefore can't throw you back to the prompt.
#  - Start typing any normal key -> copy-mode exits to the live prompt AND the key is sent,
#    so you just type your command and it lands. Escape exits without typing; scroll-to-
#    bottom auto-exits (-e); right-click menu has Go To Bottom.
#
# Multi-command bindings need `\;`, which only parses in a sourced config (not `tmux bind`
# CLI), so we generate a file and source it. Idempotent.
GEN="$HOME/.cache/tmux-copy-type-exit.tmux"
{
  # type-to-return: every printable key exits copy-mode and is sent to the live pane
  for k in {a..z} {A..Z} {0..9}; do
    printf 'bind -T copy-mode-vi "%s" send-keys -X cancel \\; send-keys -l "%s"\n' "$k" "$k"
  done
  printf 'bind -T copy-mode-vi Space send-keys -X cancel \\; send-keys -l " "\n'
  # drag-select copies to clipboard + primary but STAYS in copy-mode (copy-pipe, NOT
  # copy-pipe-and-cancel) so a click / micro-drag never cancels and snaps to the bottom
  cat <<'EOS'
bind -T copy-mode-vi MouseDragEnd1Pane send -X copy-pipe "bash -c 'd=$(cat); printf %s \"$d\" | wl-copy; printf %s \"$d\" | wl-copy --primary'"
EOS
} > "$GEN"
tmux source-file "$GEN"
