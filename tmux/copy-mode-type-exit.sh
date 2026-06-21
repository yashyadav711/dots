#!/usr/bin/env bash
# Type-to-return for tmux vi copy-mode (sourced via run-shell from tmux.conf.local).
#
# Scrolling up drops you into vi copy-mode to browse/select with the MOUSE
# (wheel = scroll, click = position, drag = select + copy). The moment you START
# TYPING any normal text key, copy-mode exits back to the live prompt at the bottom
# and that key is sent — so you never get stuck; just type your command and it lands.
#
# Escape exits without typing; scrolling to the bottom auto-exits (-e); the right-click
# menu has Go To Bottom. This deliberately trades keyboard copy-mode navigation
# (hjkl / search / v-select) for type-to-exit, which suits a mouse-driven workflow.
#
# Idempotent — safe to re-run on every config reload.
for k in {a..z} {A..Z} {0..9}; do
  tmux bind -T copy-mode-vi "$k" send-keys -X cancel ';' send-keys -l "$k"
done
tmux bind -T copy-mode-vi Space send-keys -X cancel ';' send-keys -l ' '
