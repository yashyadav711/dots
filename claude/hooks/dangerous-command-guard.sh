#!/bin/bash
# PreToolUse hook: Block dangerous shell commands in Claude Code
# Intercepts irreversible commands and requires explicit approval before execution.
#
# Extracted from a production AI assistant system (jfdi.bot)
# Original concept adapted to use file-based single-use approval tokens.
#
# Install: Add to .claude/settings.json under hooks.PreToolUse
# Requires: jq; for the interactive approval prompt: rofi or zenity (optional).
#
# SECURITY MODEL (P4 hardening 2026-06-19, after two Security reviews):
#  • Approval is OUT-OF-BAND and synchronous: on a dangerous command the hook asks Yash
#    via an interactive rofi/zenity GUI prompt and blocks on his answer. There is NO
#    approval token in any file, JSON, or notification — so it cannot be read or forged
#    by the guarded agent (same-uid threat), and nothing leaks via `dunstctl history`
#    (round-2 N1: the old UUID-in-dunst scheme is GONE). With no GUI (headless/relay)
#    the gate fails CLOSED. A harness/test approver may be wired via NHQ_APPROVE_CMD
#    (the agent cannot inject it — its command-inline env never reaches this hook).
#  • Obscured commands can't slip through: `eval` blocked; interpreter -c/-e payloads
#    re-checked incl. a quote-stripped pass (C2); inline env-var prefixes (M2) AND a
#    leading `env`/`sudo env` wrapper (N3) are stripped + re-checked; `..` traversal in
#    a recursive rm is blocked (M1); reading the notification history is blocked (N1a).
#
# TESTABILITY: `check_dangerous` is a pure function; main runs only when EXECUTED
# (sourced-vs-executed guard at the bottom). Test/override env: NHQ_NOTIFY, NHQ_APPROVE_CMD.

# --- Configuration ---
NOTIFY="${NHQ_NOTIFY:-$HOME/.local/bin/nhq-notify}"
# NHQ_APPROVE_CMD (optional): an out-of-band approver this hook runs to ask Yash; exit 0
# = approve. Set ONLY by the harness/settings/tests — the guarded agent cannot inject it
# (its command-inline env affects the command, not this already-running hook process).
# When unset, an interactive rofi/zenity GUI prompt is used; with no GUI we fail CLOSED.

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

        # N3: strip a leading `[sudo] env [-i|-u VAR|-C dir|VAR=val …]` wrapper and re-check,
        # so `env RAILWAY_TOKEN=x railway up`, `env -i railway up`, `sudo env … railway up`
        # can't dodge the command-position anchors via the env(1) utility.
        # Each option is consumed as exactly one of: an arg-taking flag + its value
        # (-u/-C/-S…), a VAR=val assignment, or a no-arg flag (-i/-0/--…). Ordering the
        # arg-taking flags first stops `-i` from wrongly swallowing the command token.
        local enstripped
        enstripped="$(printf '%s' "$cmd" | sed -E 's/(^|[;&|(][[:space:]]*)(sudo[[:space:]]+)?env[[:space:]]+((-u|--unset|-C|--chdir|-S|--split-string|--block-signal)[[:space:]]+[^[:space:]]+[[:space:]]+|[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+|-[^[:space:]]+[[:space:]]+)*/\1/')"
        if [[ "$enstripped" != "$cmd" ]]; then
            local re; re="$(check_dangerous "$enstripped" $((depth + 1)))"
            [[ -n "$re" ]] && { echo "$re"; return 0; }
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

    # Read/flush the desktop notification history — could expose approval prompts or other
    # secrets shown to Yash (N1a defense-in-depth, even though the approval flow no longer
    # puts any token in a notification).
    if echo "$cmd" | grep -qiE '(^|[;&|(]|[[:space:]])dunstctl[[:space:]]+(history|close-all|history-pop)([[:space:]]|$)'; then
        echo "read or flush the desktop notification history (dunstctl)"
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

# request_approval <reason> <command> — obtain Yash's out-of-band approval.
# Returns 0 (approve) / non-zero (deny). NO token is written anywhere (N1): the approval
# is the human interaction itself, so it can't be read or forged by the same-uid agent.
request_approval() {
    local reason="$1" cmd="$2" choice prompt
    prompt="DANGEROUS — would $reason. Approve this command?"
    # Custom/automated approver (harness/settings/test only; the agent cannot inject it).
    if [[ -n "${NHQ_APPROVE_CMD:-}" ]]; then
        "$NHQ_APPROVE_CMD" "$reason" "$cmd"; return $?
    fi
    # Interactive GUI prompt on Yash's display — the agent cannot drive it and no token
    # lands in any readable store (default selection = Deny).
    if command -v rofi >/dev/null 2>&1 && [[ -n "${WAYLAND_DISPLAY:-}${DISPLAY:-}" ]]; then
        choice="$(printf 'Deny\nApprove (I understand the risk)\n' \
            | timeout 60 rofi -dmenu -i -no-custom -p "$prompt" 2>/dev/null)"
        [[ "$choice" == Approve* ]] && return 0 || return 1
    fi
    if command -v zenity >/dev/null 2>&1 && [[ -n "${WAYLAND_DISPLAY:-}${DISPLAY:-}" ]]; then
        timeout 60 zenity --question --title="Dangerous command" \
            --text="$prompt"$'\n\n'"$cmd" 2>/dev/null && return 0 || return 1
    fi
    # No interactive channel (headless / relay) → cannot obtain human approval → DENY.
    return 1
}

# --- Main hook logic (runs only when EXECUTED, not when sourced for testing) ---
main() {
    local INPUT TOOL_NAME COMMAND REASON
    INPUT=$(cat)
    TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

    [[ "$TOOL_NAME" != "Bash" ]] && exit 0

    COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
    [[ -z "$COMMAND" ]] && exit 0

    REASON=$(check_dangerous "$COMMAND")
    [[ -z "$REASON" ]] && exit 0   # Not dangerous, allow

    # Alert Yash. The notification carries NO approval token (N1: nothing to leak via
    # dunst history) — the real approval is the out-of-band prompt below.
    "$NOTIFY" blocked "🛑 Dangerous command needs approval" \
      "Would $REASON — answer the approval prompt on screen." 2>/dev/null || true

    # Synchronous out-of-band approval. The guarded agent can neither read nor answer it.
    if request_approval "$REASON" "$COMMAND"; then
        exit 0   # Yash approved → allow
    fi

    cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "BLOCKED: This command would $REASON. Approval is interactive (on Yash's screen) and cannot be granted from here — ask Yash to approve."
  }
}
EOF
    exit 0
}

# Run main only when executed directly; stay quiet when sourced (test harness).
if [[ "${BASH_SOURCE[0]:-$0}" == "${0}" ]]; then
    main
fi
