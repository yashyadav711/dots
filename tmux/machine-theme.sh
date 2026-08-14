#!/usr/bin/env bash
# machine-theme.sh — repaint the tmux status bar per machine, AFTER the theme is built.
#
# Why deferred instead of plain `set -g` in tmux.conf.local:
# the gpakosz base sources .tmux.conf.local early (to read tmux_conf_theme_* vars),
# then builds and applies the whole theme at the END of its load. Anything set
# directly in .tmux.conf.local is therefore overwritten a moment later — which is
# exactly what happened: rig's teal bar was applied and then clobbered back to the
# laptop's ember/crimson. Same trick his copy-mode helper already uses.
#
# Point: Yash reaches rig almost entirely through `ssh rig` / `rig` from the
# laptop, and once you are in a terminal the two boxes look identical. The bar
# says which machine you are on, matching that box's omp theme.
#
# Add a machine by adding a case. No case = the laptop's own theme, untouched.
set -uo pipefail

t() { tmux set -g "$@" 2>/dev/null; }
tw() { tmux setw -g "$@" 2>/dev/null; }

case "$(hostname -s 2>/dev/null)" in
  rig)
    # Teal, to match the nhq-rig omp theme. Deep teal ground, bright teal badge.
    t  status-style                 'fg=#d4d8e4,bg=#0b1f1d,none'
    t  status-left  '#[fg=#0b1f1d,bg=#2dd4bf,bold] ⛁ RIG #[fg=#2dd4bf,bg=#0b1f1d,nobold] #S '
    t  status-right '#[fg=#14b8a6,bg=#0b1f1d]%H:%M #[fg=#0b1f1d,bg=#2dd4bf,bold] GPU '
    t  pane-active-border-style     'fg=#2dd4bf'
    t  pane-border-style            'fg=#14384a'
    t  message-style                'fg=#0b1f1d,bg=#2dd4bf,bold'
    tw window-status-current-style  'fg=#0b1f1d,bg=#7fffd4,bold'
    ;;
  *)
    exit 0
    ;;
esac
