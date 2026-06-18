#!/bin/bash
# PreToolUse hook: Block dangerous shell commands in Claude Code
# Intercepts irreversible commands and requires explicit approval before execution.
#
# Extracted from a production AI assistant system (jfdi.bot)
# Original concept adapted to use file-based single-use approval tokens.
#
# Install: Add to .claude/settings.json under hooks.PreToolUse
# Requires: jq, sha256sum, uuidgen (or /proc/sys/kernel/random/uuid)
#
# SECURITY MODEL (P4 hardening 2026-06-19, post Security review):
#  • Approval is a RANDOM UUID shown ONLY in the desktop notification (Yash's screen).
#    The pending JSON the guarded agent can read holds ONLY sha256(uuid) — a commitment
#    it cannot reverse — so the agent can never mint its own approval (C1). SHA256 (L4).
#  • Obscured commands can't slip through: `eval` is blocked outright, and the payload
#    of an interpreter wrapper (bash -c / sh -c / python -c / …) is re-checked, including
#    a quote-stripped pass for nested quoting (C2).
#  • Inline env-var prefixes (RAILWAY_TOKEN=x railway up) are stripped + re-checked (M2);
#    `..` path-traversal in a recursive rm is blocked (M1).
#
# TESTABILITY: `check_dangerous` is a pure function. The stdin-reading main logic runs
# only when EXECUTED (sourced-vs-executed guard at the bottom). Env overrides for tests:
# CLAUDE_DANGEROUS_DIR, NHQ_NOTIFY.

# --- Configuration ---
DANGEROUS_DIR="${CLAUDE_DANGEROUS_DIR:-/tmp/claude-dangerous}"
PENDING_DIR="$DANGEROUS_DIR/pending"
APPROVED_DIR="$DANGEROUS_DIR/approved"
NOTIFY="${NHQ_NOTIFY:-$HOME/.local/bin/nhq-notify}"

sha256() { printf '%s' "$1" | sha256sum | cut -d' ' -f1; }

# --- Pattern matching ---
# Returns a human-readable reason if the command is dangerous, empty otherwise.
# $2 = recursion depth (internal; bounds the unwrap recursion).
check_dangerous() {
    local cmd="$1" depth="${2:-0}"

    # ── Unwrap obscured commands (C2 / M2) — bounded recursion ──────────────
    if [[ "$depth" -lt 6 ]]; then
        # eval: block outright. Legit agents don't need it; it defeats every pattern.
        if echo "$cmd" | grep -qiE '(^|[;&|(])[[:space:]]*eval([[:space:]]|$)'; then
            echo "run an obscured command via eval"
            return 0
        fi

        # M2: strip a run of inline VAR=val prefixes at command position and re-check, so
        # `RAILWAY_TOKEN=abc railway up` / `A=1 wipefs …` can't dodge command-position anchors.
        local stripped
        stripped="$(printf '%s' "$cmd" | sed -E 's/(^|[;&|(][[:space:]]*)([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)+/\1/g')"
        if [[ "$stripped" != "$cmd" ]]; then
            local rs; rs="$(check_dangerous "$stripped" $((depth + 1)))"
            [[ -n "$rs" ]] && { echo "$rs"; return 0; }
        fi

        # C2: only when an interpreter wrapper is present (so quoted text in a plain
        # command — echo "; railway up" — never false-fires).
        if echo "$cmd" | grep -qiE '(^|[;&|(]|[[:space:]])((bash|sh|zsh|dash|ksh|env)[[:space:]]+([^[:space:]]+[[:space:]]+)*-c([[:space:]]|$)|(python3?|perl|ruby|node)[[:space:]]+([^[:space:]]+[[:space:]]+)*-[ce]([[:space:]]|$))'; then
            # (a) re-check the -c/-e payload (dangerous cmd sits at the payload's start).
            local payload
            payload="$(printf '%s' "$cmd" | sed -nE 's/.*[[:space:]]-(c|e)[[:space:]]+(.*)/\2/p' | head -1)"
            if [[ -n "$payload" ]]; then
                payload="${payload#[\"\']}"; payload="${payload%[\"\']}"
                local rp; rp="$(check_dangerous "$payload" $((depth + 1)))"
                [[ -n "$rp" ]] && { echo "$rp (inside a -c wrapper)"; return 0; }
            fi
            # (b) quote-stripped pass exposes tokens hidden behind nested quotes, e.g.
            #     python3 -c "import os; os.system('wipefs -a /dev/sda')".
            local dq; dq="$(printf '%s' "$cmd" | tr "\"'" '  ')"
            if [[ "$dq" != "$cmd" ]]; then
                local rd; rd="$(check_dangerous "$dq" $((depth + 1)))"
                [[ -n "$rd" ]] && { echo "$rd (obscured by quoting)"; return 0; }
            fi
        fi
    fi

    # System reboot/shutdown
    if echo "$cmd" | grep -qiE '(^|[[:space:]])(reboot|shutdown|poweroff|halt)([[:space:]]|$)'; then
        echo "restart or shut down the system"
        return 0
    fi

    # Systemctl dangerous operations
    if echo "$cmd" | grep -qiE 'systemctl[[:space:]]+(restart|stop|reboot|poweroff|halt)([[:space:]]|$)'; then
        echo "stop or restart system services"
        return 0
    fi

    # Sudo reboot/shutdown
    if echo "$cmd" | grep -qiE '(^|[[:space:]])sudo[[:space:]]+(reboot|shutdown|poweroff|halt)([[:space:]]|$)'; then
        echo "restart or shut down the system with elevated privileges"
        return 0
    fi

    # --- Destructive rm guards ---
    # `rm` is dangerous only in command position (start, or after ; & | ( — optionally via
    # sudo) so a pattern quoted as TEXT inside another command's argument doesn't fire.
    local RM='(^|[;&|(])[[:space:]]*(sudo[[:space:]]+)?rm[[:space:]]+'
    local FL='(--?[a-zA-Z][a-zA-Z-]*[[:space:]]+)*'
    local RECUR='(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)[[:space:]]+'

    # M1: a recursive rm whose target traverses through `..` can't be reasoned about
    # safely (rm -rf /tmp/../home/yash/Github/x) — block any /.. in a recursive rm target.
    if echo "$cmd" | grep -qiE "${RM}${FL}${RECUR}.*/\.\.(/|[[:space:]]|'|\"|$)"; then
        echo "recursively delete through a .. path traversal"
        return 0
    fi

    # rm of the root directory itself: `rm [flags] /` (with/without recursion).
    if echo "$cmd" | grep -qiE "${RM}${FL}/+[[:space:]]*$"; then
        echo "delete the root directory"
        return 0
    fi

    # Recursive rm whose TARGET is genuinely dangerous: root, a whole top-level system
    # directory, or a root-level glob. A specific deep path is allowed; /tmp is allowed.
    if echo "$cmd" | grep -qiE "${RM}${FL}${RECUR}${FL}('|\")?(/+([[:space:]]|$)|/(etc|usr|bin|sbin|lib|lib64|boot|var|dev|proc|sys|root|home|opt|srv|run|mnt)/?([[:space:]]|$)|/+[^[:space:]]*[*?[])" \
       && ! echo "$cmd" | grep -qiE "${RM}${FL}${RECUR}${FL}('|\")?/tmp"; then
        echo "recursively delete the root, a top-level system directory, or a root-level glob"
        return 0
    fi

    # Recursive rm whose TARGET is the home directory itself or a glob under home.
    if echo "$cmd" | grep -qiE "${RM}${FL}${RECUR}${FL}('|\")?(~|\\\$HOME)((/+)?([[:space:]]|$)|/+[^[:space:]]*[*?[])"; then
        echo "recursively delete the home directory or a home-level glob"
        return 0
    fi

    # Recursive rm of an ENTIRE project tree: a direct child of a Github/ dir.
    if echo "$cmd" | grep -qiE "${RM}${FL}${RECUR}${FL}('|\")?([^[:space:]'\"]*/)?Github/[^/[:space:]'\"]+/?([[:space:]'\"]|\$)"; then
        echo "recursively delete an entire Github project tree"
        return 0
    fi

    # Recursive rm of a bare top-level glob: `rm -rf *`.
    if echo "$cmd" | grep -qiE "${RM}${FL}${RECUR}${FL}('|\")?[*]+([[:space:]]|$)"; then
        echo "recursively delete everything matched by a bare glob"
        return 0
    fi

    # Kill all processes
    if echo "$cmd" | grep -qiE '(^|[[:space:]])kill[[:space:]]+(-9[[:space:]]+)?-1([[:space:]]|$)'; then
        echo "kill all processes"
        return 0
    fi

    # Force kill with pkill -9
    if echo "$cmd" | grep -qiE '(^|[[:space:]])pkill[[:space:]]+-9[[:space:]]+'; then
        echo "force kill processes"
        return 0
    fi

    # Format filesystem
    if echo "$cmd" | grep -qiE '(^|[[:space:]])mkfs'; then
        echo "format a filesystem"
        return 0
    fi

    # Erase filesystem signatures with wipefs (command-position-anchored).
    if echo "$cmd" | grep -qiE '(^|[;&|(])[[:space:]]*(sudo[[:space:]]+)?wipefs([[:space:]]|$)'; then
        echo "erase filesystem signatures with wipefs"
        return 0
    fi

    # Direct disk write with dd (… of=/dev/sdX). Command-position-anchored.
    if echo "$cmd" | grep -qiE '(^|[;&|(])[[:space:]]*(sudo[[:space:]]+)?dd[[:space:]]+.*of=/dev/'; then
        echo "write directly to a disk device with dd"
        return 0
    fi

    # pacman cascade remove: -R with the recursive-deps flag (-Rns, -Rs …).
    if echo "$cmd" | grep -qiE '(^|[;&|(])[[:space:]]*(sudo[[:space:]]+)?pacman[[:space:]]+(-[a-zA-Z]+[[:space:]]+)*-R[a-z]*s'; then
        echo "cascade-remove packages with pacman -R...s (can break the system)"
        return 0
    fi

    # Railway infra mutation: up / deploy / down / delete / remove.
    if echo "$cmd" | grep -qiE '(^|[;&|(])[[:space:]]*railway[[:space:]]+(up|deploy|down|delete|remove)([[:space:]]|$)'; then
        echo "mutate Railway infrastructure (railway up/deploy/down)"
        return 0
    fi

    # Supabase destructive DB ops: db push / db reset.
    if echo "$cmd" | grep -qiE '(^|[;&|(])[[:space:]]*supabase[[:space:]]+db[[:space:]]+(push|reset)([[:space:]]|$)'; then
        echo "push or reset the Supabase database schema"
        return 0
    fi

    # Destructive git: reset --hard
    if echo "$cmd" | grep -qiE '(^|[[:space:]])git[[:space:]]+reset[[:space:]]+--hard([[:space:]]|$)'; then
        echo "destroy uncommitted changes with git reset --hard"
        return 0
    fi

    # Destructive git: clean -f (unless --dry-run)
    if echo "$cmd" | grep -qiE '(^|[[:space:]])git[[:space:]]+clean[[:space:]]+-[a-zA-Z]*f' && ! echo "$cmd" | grep -qiE 'git[[:space:]]+clean[[:space:]]+.*--dry-run'; then
        echo "permanently remove untracked files with git clean -f"
        return 0
    fi

    # Destructive git: force push (--force, -f, OR --force-with-lease)
    if echo "$cmd" | grep -qiE '(^|[[:space:]])git[[:space:]]+push[[:space:]]+.*(--force(-with-lease)?([[:space:]=]|$)|-f([[:space:]]|$))'; then
        echo "force push and potentially destroy remote history"
        return 0
    fi

    # Destructive git: stash drop/clear
    if echo "$cmd" | grep -qiE '(^|[[:space:]])git[[:space:]]+stash[[:space:]]+(drop|clear)([[:space:]]|$)'; then
        echo "permanently delete stashed changes"
        return 0
    fi

    # Not dangerous
    return 1
}

# --- Main hook logic (runs only when EXECUTED, not when sourced for testing) ---
main() {
    mkdir -p "$PENDING_DIR" "$APPROVED_DIR" 2>/dev/null

    local INPUT TOOL_NAME
    INPUT=$(cat)
    TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
    SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')

    [[ "$TOOL_NAME" != "Bash" ]] && exit 0

    COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
    [[ -z "$COMMAND" ]] && exit 0

    # Cleanup stale tokens (pending: 5 min, approved: 60s)
    find "$PENDING_DIR" -type f -mmin +5 -delete 2>/dev/null
    find "$APPROVED_DIR" -type f -mmin +1 -delete 2>/dev/null

    local REASON
    REASON=$(check_dangerous "$COMMAND")
    [[ -z "$REASON" ]] && exit 0   # Not dangerous, allow

    # Approval scheme (C1): a per-block random UUID, shown ONLY in the notification.
    # The pending JSON holds sha256(uuid) — a commitment the agent can't reverse. An
    # approved file is valid iff sha256(its name) == the stored commitment.
    local CMDHASH PENDING_FILE COMMIT
    CMDHASH="$(sha256 "${SESSION_ID}:${COMMAND}")"
    PENDING_FILE="$PENDING_DIR/$CMDHASH.json"

    if [[ -f "$PENDING_FILE" ]]; then
        COMMIT="$(jq -r '.commitment // empty' "$PENDING_FILE" 2>/dev/null)"
        local af
        for af in "$APPROVED_DIR"/*; do
            [[ -f "$af" ]] || continue
            if [[ -n "$COMMIT" && "$(sha256 "$(basename "$af")")" == "$COMMIT" ]]; then
                rm -f "$af" "$PENDING_FILE"     # single-use; consume both
                exit 0                          # APPROVED → allow
            fi
        done
        # pending exists, no matching approval → still blocked (reuse the commitment).
    else
        # First block for this command: mint a UUID, store ONLY its sha256 commitment.
        local UUID
        UUID="$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null)"
        COMMIT="$(sha256 "$UUID")"
        cat > "$PENDING_FILE" <<PENDING_EOF
{
  "cmdhash": "$CMDHASH",
  "session_id": "$SESSION_ID",
  "command": $(echo "$COMMAND" | jq -Rs .),
  "reason": "$REASON",
  "commitment": "$COMMIT",
  "timestamp": $(date +%s)
}
PENDING_EOF
        # The UUID appears ONLY here (Yash's screen) — never on stdout, never in the JSON.
        "$NOTIFY" blocked "🛑 Dangerous command BLOCKED" \
          "Would $REASON. To approve, run:  touch $APPROVED_DIR/$UUID" 2>/dev/null || true
    fi

    # Deny — the reason for the agent must NOT reveal the approval token.
    cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "BLOCKED: This command would $REASON. A one-time approval code was sent to Yash's desktop notification — it is NOT readable from here. Ask Yash to approve."
  }
}
EOF
    exit 0
}

# Run main only when executed directly; stay quiet when sourced (test harness).
if [[ "${BASH_SOURCE[0]:-$0}" == "${0}" ]]; then
    main
fi
