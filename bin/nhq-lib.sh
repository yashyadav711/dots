#!/usr/bin/env bash
# nhq-lib.sh — shared helpers for the NHQ Fleet Kit (sourced, not executed).
#
# Sourced by nhq-fleet / nhq-await / nhq-reap / nhq-kill via:
#   SELF="$(readlink -f "${BASH_SOURCE[0]}")"; source "$(dirname "$SELF")/nhq-lib.sh"
# (readlink -f resolves the ~/.local/bin symlink back to the real dots/bin dir,
# so the lib is always found beside the real script.)
#
# Single source of truth for: the state dir, marker/activity paths, and — most
# importantly — fleet session STATE detection, which v1 got wrong.
#
# Why the v1 heuristic was wrong: `tmux #{pane_current_command}` reports `fish`
# even while a claude agent is actively working, because claude keeps a persistent
# background shell whose process becomes the pane's foreground command. So we do
# NOT trust pane_current_command. Instead:
#   ALIVE   = a `claude`/`node` process exists in the pane_pid's descendant tree.
#   RUNNING = ALIVE *and* the pane shows claude's live work indicator
#             (the `(Ns · … tokens` timer or `esc to interrupt`).
#   IDLE    = ALIVE but no work indicator (claude at its own prompt, awaiting nhq-tell).
#   DEAD    = no claude in the tree (dropped to fish, or the pane is gone).

# Idempotent guard so multiple sources in one shell don't redefine.
[[ -n "${_NHQ_LIB_LOADED:-}" ]] && return 0
_NHQ_LIB_LOADED=1

NHQ_STATE_DIR="${NHQ_STATE_DIR:-$HOME/.nhq-fleet}"

# Minutes of IDLE before the reaper retires a session (RAM-aware; 7.5GB laptop).
NHQ_IDLE_KILL_MIN="${NHQ_IDLE_KILL_MIN:-20}"

nhq_ensure_state_dir() { mkdir -p "$NHQ_STATE_DIR" 2>/dev/null || true; }

nhq_marker()   { printf '%s/%s.done' "$NHQ_STATE_DIR" "${1:-}"; }
nhq_activity() { printf '%s/%s.activity' "$NHQ_STATE_DIR" "${1:-}"; }

# Record "this session did something just now" (spawn / tell / observed-running).
nhq_touch_activity() {
  local s="${1:-}"; [[ -z "$s" ]] && return 0
  nhq_ensure_state_dir
  : > "$(nhq_activity "$s")" 2>/dev/null || true
}

# Seconds since a session's last recorded activity (epoch-now - activity mtime).
# Prints a very large number if there is no activity file (treated as stale).
nhq_idle_seconds() {
  local f; f="$(nhq_activity "${1:-}")"
  if [[ -f "$f" ]]; then
    local m now; m=$(stat -c %Y "$f" 2>/dev/null || echo 0); now=$(date +%s)
    echo $(( now - m ))
  else
    echo 999999
  fi
}

# Does the pane_pid's descendant process tree contain a claude/node process?
# Dependency-free BFS over `ps --ppid` (no pstree needed).
nhq_pane_has_claude() {
  local pid="${1:-}"; [[ -z "$pid" ]] && return 1
  local queue="$pid" next cur comm kids k
  while [[ -n "$queue" ]]; do
    next=""
    for cur in $queue; do
      comm=$(ps -o comm= -p "$cur" 2>/dev/null | tr -d ' ')
      [[ "$comm" == "claude" || "$comm" == "node" ]] && return 0
      kids=$(ps -o pid= --ppid "$cur" 2>/dev/null)
      for k in $kids; do next="$next $k"; done
    done
    queue="$next"
  done
  return 1
}

# Echo the state of a fleet tmux session: RUNNING | IDLE | DEAD.
nhq_session_state() {
  local s="${1:-}"
  tmux has-session -t "$s" 2>/dev/null || { echo "DEAD"; return 0; }
  local pid; pid=$(tmux display-message -p -t "$s" '#{pane_pid}' 2>/dev/null || echo "")
  if ! nhq_pane_has_claude "$pid"; then echo "DEAD"; return 0; fi
  # claude is alive — busy or idle? Look for the live work indicator in the pane.
  local pane; pane=$(tmux capture-pane -p -t "$s" 2>/dev/null || echo "")
  if printf '%s' "$pane" | grep -qE 'esc to interrupt|\([0-9]+m? ?[0-9]*s · '; then
    echo "RUNNING"
  else
    echo "IDLE"
  fi
}

# Pretty colored badge for a state.
nhq_state_badge() {
  case "${1:-}" in
    RUNNING) echo "🟢 RUNNING (claude busy)" ;;
    IDLE)    echo "⚪ IDLE (claude alive, awaiting nhq-tell)" ;;
    DEAD)    echo "⚫ DEAD (no claude / at fish)" ;;
    *)       echo "❓ UNKNOWN" ;;
  esac
}
