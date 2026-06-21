#!/usr/bin/env bash
# Type-to-return for tmux vi copy-mode.
#
# Scrolling up drops you into vi copy-mode to browse/select with the MOUSE
# (wheel = scroll, click = position, drag = select + copy) WITHOUT jumping you anywhere.
# The moment you START TYPING any normal text key, copy-mode exits to the live prompt at
# the bottom and that key is sent — so you're never stuck; just type your command and it
# lands. Escape exits without typing; scroll-to-bottom auto-exits (-e); right-click menu
# has Go To Bottom.
#
# Why a generated file + source-file (not plain `tmux bind`): a multi-command binding
# needs `\;`, which only parses inside a sourced config — not as a `tmux bind` CLI arg.
# Why it must run AFTER plugins: tmux-copycat re-binds the copy-mode-vi letter keys at
# load and would clobber these; tmux.conf.local sources before tpm, so this is invoked
# deferred (see the run-shell in tmux.conf.local). Idempotent.
GEN="$HOME/.cache/tmux-copy-type-exit.tmux"
{
  for k in {a..z} {A..Z} {0..9}; do
    printf 'bind -T copy-mode-vi "%s" send-keys -X cancel \\; send-keys -l "%s"\n' "$k" "$k"
  done
  printf 'bind -T copy-mode-vi Space send-keys -X cancel \\; send-keys -l " "\n'
} > "$GEN"
tmux source-file "$GEN"
