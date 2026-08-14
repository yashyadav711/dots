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

# Directory that holds this lib (and fleet-registry.json beside it). Resolved
# through the ~/.local/bin symlink so the registry is found next to the REAL file.
NHQ_LIB_DIR="${NHQ_LIB_DIR:-$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]:-$0}")")" && pwd)}"

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
      # claude/node = Claude Code / omp harness; jcode* = jcode harness (2026-07-19)
      [[ "$comm" == "claude" || "$comm" == "node" || "$comm" == jcode* ]] && return 0
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
  # 'esc to interrupt' + '(Ns ·' = Claude Code/omp; '(Esc to cancel)' = jcode TUI.
  local pane; pane=$(tmux capture-pane -p -t "$s" 2>/dev/null || echo "")
  if printf '%s' "$pane" | grep -qE 'esc to interrupt|Esc to cancel|\([0-9]+m? ?[0-9]*s · '; then
    echo "RUNNING"
  else
    echo "IDLE"
  fi
}

# Pretty colored badge for a state (base 3 + the P2 derived states).
nhq_state_badge() {
  case "${1:-}" in
    RUNNING) echo "🟢 RUNNING (claude busy)" ;;
    IDLE)    echo "⚪ IDLE (claude alive, awaiting nhq-tell)" ;;
    DEAD)    echo "⚫ DEAD (no claude / at fish)" ;;
    BLOCKED) echo "🔴 BLOCKED (agent needs a human gate)" ;;
    STALLED) echo "🟠 STALLED (no progress past stall_min)" ;;
    GHOST)   echo "👻 GHOST (reported, session lingering)" ;;
    ORPHAN)  echo "🟣 ORPHAN (committed work, never called nhq-done)" ;;
    *)       echo "❓ UNKNOWN" ;;
  esac
}

# ── P1 · Fleet registry + .meta accessors ──────────────────────────────────
# Single source of truth for the agent roster. The old hardcoded `case "$AGENT"`
# rosters (nhq-spawn/nhq-fleet/nhq-reap/nhq-agent-name) all collapse onto these.
# Registry path is overridable via $NHQ_REGISTRY; otherwise it sits beside this lib.

# Path to a session's .meta record (the P1 per-session state file).
nhq_meta() { printf '%s/%s.meta' "$NHQ_STATE_DIR" "${1:-}"; }

# Path to the active fleet-registry.json ($NHQ_REGISTRY overrides).
nhq_registry() { printf '%s' "${NHQ_REGISTRY:-$NHQ_LIB_DIR/fleet-registry.json}"; }

# Canonicalize a spawn token (key OR alias, case-insensitive) → registry key.
# Unknown / empty token → "" (never a junk value).
nhq_agent_canon() {
  local tok; tok="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"
  [[ -z "$tok" ]] && { printf ''; return 0; }
  jq -r --arg t "$tok" '
    .agents | to_entries
    | map(select(.key == $t or ((.value.aliases // []) | index($t))))
    | (.[0].key // "")
  ' "$(nhq_registry)" 2>/dev/null || printf ''
}

# Read a scalar field of a registry KEY (already canonical). "" if absent.
nhq_agent_field() {
  local key="${1:-}" field="${2:-}"
  [[ -z "$key" || -z "$field" ]] && { printf ''; return 0; }
  jq -r --arg k "$key" --arg f "$field" '.agents[$k][$f] // ""' "$(nhq_registry)" 2>/dev/null || printf ''
}

# Absolute repo dir for a token (canon → $HOME/<repo>). "" if unknown.
nhq_agent_repo() {
  local key; key="$(nhq_agent_canon "${1:-}")"
  [[ -z "$key" ]] && { printf ''; return 0; }
  local rel; rel="$(nhq_agent_field "$key" repo)"
  [[ -z "$rel" ]] && { printf ''; return 0; }
  printf '%s/%s' "$HOME" "$rel"
}

# ── remote agents ─────────────────────────────────────────────────────────────
# An agent whose registry entry has a "host" lives on ANOTHER machine (rig is the
# GPU box). Everything in the fleet — nhq-spawn, nhq-tell, nhq-fleet — drives
# tmux, which is inherently local, so the only sane way to reach a remote agent
# is to run the SAME command over ssh on the machine that owns its tmux server.
#
# Design: no logic is duplicated per tool. A tool calls nhq_remote_dispatch as
# its first act; if the target agent is remote the call is re-executed there and
# the tool exits with the remote status. Local agents fall straight through and
# nothing changes.
#
# Requires key-based ssh to the host — a password prompt would break every
# non-interactive path, so nhq_remote_check says so plainly instead of hanging.

# Host for a token; "" when the agent is local.
nhq_agent_host() {
  local k; k="$(nhq_agent_canon "${1:-}")"
  [[ -z "$k" ]] && { printf ''; return 0; }
  nhq_agent_field "$k" host
}

# 0 if <host> is reachable with keys, non-interactively.
nhq_remote_check() {
  local host="${1:?}"
  ssh -o BatchMode=yes -o ConnectTimeout=6 -o StrictHostKeyChecking=accept-new \
      "$host" true 2>/dev/null
}

# 0 if <host> names THIS machine. Without this, an agent whose host is its own
# box dispatches to itself forever: the registry travels with the repo, so on rig
# the "rig" agent also reads host=rig, and the remote nhq-spawn tried to ssh onward
# to "rig" again. The visible symptom was a bogus "key-based ssh failed" coming
# from the FAR side, which reads exactly like a missing key.
nhq_is_self_host() {
  local host="${1:-}"; [[ -z "$host" ]] && return 1
  local short; short="$(hostname -s 2>/dev/null || hostname 2>/dev/null)"
  [[ "$host" == "$short" || "$host" == "$short".* ]] && return 0
  [[ "$host" == "$(hostname -f 2>/dev/null)" ]] && return 0
  return 1
}

# nhq_remote_dispatch <agent-token> <tool-name> "$@"
# Re-runs <tool-name> with the original arguments on the agent's host, then exits
# with the remote status. Returns 1 (caller continues) when the agent is local.
nhq_remote_dispatch() {
  local token="${1:-}" tool="${2:-}"; shift 2 || true
  local host; host="$(nhq_agent_host "$token")"
  [[ -z "$host" ]] && return 1          # local agent — caller continues normally

  # Already on the agent's own machine: this IS the local case.
  nhq_is_self_host "$host" && return 1

  # Belt and braces: even if a hostname is renamed or an ssh alias disagrees with
  # `hostname -s`, one hop is all that can ever happen.
  if [[ -n "${NHQ_REMOTE_HOP:-}" ]]; then
    printf '%s: refusing a second remote hop (already dispatched from %s).\n' \
      "$tool" "$NHQ_REMOTE_HOP" >&2
    printf '  the registry host for "%s" (%s) does not match this box (%s).\n' \
      "$token" "$host" "$(hostname -s 2>/dev/null)" >&2
    exit 5
  fi

  if ! nhq_remote_check "$host"; then
    printf '%s: agent "%s" lives on host "%s" but key-based ssh to it failed.\n' \
      "$tool" "$token" "$host" >&2
    printf '  fix: ssh-copy-id %s    (a password prompt cannot work here)\n' "$host" >&2
    exit 4
  fi

  # Quote every argument so the remote shell sees exactly what we passed. The
  # remote login shell may be fish, so invoke bash explicitly, and set PATH:
  # a non-interactive ssh command sources no rc files, hence no ~/.local/bin.
  local q="" a
  for a in "$@"; do q+=" $(printf '%q' "$a")"; done
  # -tt: force a pty even when our own stdin is not a terminal. nhq-spawn drives
  # tmux on the far side and needs one; without it ssh warns and the remote tool
  # runs without a controlling terminal.
  # shellcheck disable=SC2029
  ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -tt "$host" \
    "bash -lc 'export NHQ_REMOTE_HOP=$(hostname -s 2>/dev/null); export PATH=\$HOME/.local/bin:\$PATH; exec $tool$q'"
  exit $?
}

# Canonical display name / default model / stall threshold for a token. "" if unknown.
nhq_agent_name()      { local k; k="$(nhq_agent_canon "${1:-}")"; [[ -z "$k" ]] && { printf ''; return 0; }; nhq_agent_field "$k" name; }
nhq_agent_model()     { local k; k="$(nhq_agent_canon "${1:-}")"; [[ -z "$k" ]] && { printf ''; return 0; }; nhq_agent_field "$k" model; }
nhq_agent_stall_min() { local k; k="$(nhq_agent_canon "${1:-}")"; [[ -z "$k" ]] && { printf ''; return 0; }; nhq_agent_field "$k" stall_min; }

# Resolve a fleet session name (fleet-<token>-<slug>) → registry KEY. The slug may
# contain dashes, so match the longest accepted token (key or alias) that sits right
# after "fleet-" at a "-" / end boundary — never a naive split-on-dash. "" if unknown.
nhq_session_agent() {
  local s="${1:-}" rest tok key
  [[ "$s" == fleet-* ]] || { printf ''; return 0; }
  rest="${s#fleet-}"
  while IFS=$'\t' read -r tok key; do
    [[ -z "$tok" ]] && continue
    if [[ "$rest" == "$tok" || "$rest" == "$tok"-* ]]; then
      printf '%s' "$key"; return 0
    fi
  done < <(jq -r '
    [ .agents | to_entries[] | .key as $k | ([$k] + (.value.aliases // []))[] | {t: ., k: $k} ]
    | sort_by(-(.t | length))[]
    | "\(.t)\t\(.k)"
  ' "$(nhq_registry)" 2>/dev/null)
  printf ''
}

# ── P2 · 7-state resolver (marker-driven; P3 writes .stalled/.blocked, zero more
# lib edits) ────────────────────────────────────────────────────────────────
# Seconds a `.done` marker stays "fresh" enough to read an IDLE session as a
# lingering GHOST card (vs a long-dead leftover). Overridable.
NHQ_GHOST_FRESH_SEC="${NHQ_GHOST_FRESH_SEC:-900}"

# Is marker file $1 present AND newer than $2 seconds (default the ghost window)?
nhq_marker_fresh() {
  local f="${1:-}" win="${2:-$NHQ_GHOST_FRESH_SEC}"
  [[ -f "$f" ]] || return 1
  local m now; m=$(stat -c %Y "$f" 2>/dev/null || echo 0); now=$(date +%s)
  [[ $(( now - m )) -le "$win" ]]
}

# Did the session's repo advance past the base_commit captured in .meta at spawn?
# 0 (true) only when .meta has a base_commit + repo and HEAD differs from it.
nhq_session_has_new_commit() {
  local s="${1:-}" meta base repo head
  meta="$(nhq_meta "$s")"
  [[ -f "$meta" ]] || return 1
  base="$(jq -r '.base_commit // ""' "$meta" 2>/dev/null)"
  repo="$(jq -r '.repo // ""' "$meta" 2>/dev/null)"
  [[ -z "$base" || -z "$repo" || ! -d "$repo" ]] && return 1
  head="$(git -C "$repo" rev-parse HEAD 2>/dev/null || echo "")"
  [[ -n "$head" && "$head" != "$base" ]]
}

# Full fleet state on top of nhq_session_state's RUNNING|IDLE|DEAD:
#   .blocked present                    → BLOCKED  (P3 producer; read here)
#   .stalled present                    → STALLED  (P3 producer; read here)
#   IDLE & fresh .done                  → GHOST    (reported, card lingering — relay C16)
#   IDLE & new commit & no .done        → ORPHAN   (silent-complete — relay C4)
#   else                                → base
# Marker checks come first so a producer marker wins over the live base.
nhq_session_state_full() {
  local s="${1:-}"
  [[ -f "$NHQ_STATE_DIR/$s.blocked" ]] && { echo "BLOCKED"; return 0; }
  [[ -f "$NHQ_STATE_DIR/$s.stalled" ]] && { echo "STALLED"; return 0; }
  local base; base="$(nhq_session_state "$s")"
  if [[ "$base" == "IDLE" ]]; then
    if nhq_marker_fresh "$(nhq_marker "$s")"; then echo "GHOST"; return 0; fi
    if [[ ! -f "$(nhq_marker "$s")" ]] && nhq_session_has_new_commit "$s"; then
      echo "ORPHAN"; return 0
    fi
  fi
  echo "$base"
}
