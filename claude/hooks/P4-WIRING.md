# P4 Safety — wiring guide (Director applies on the human-gated P4 merge)

All P4 enforcement logic ships as testable dots/bin tools + this dots/claude/hooks
guard. Nothing here is auto-wired into the live harness — Director reviews the diff
(security-control code) and wires the hooks below on merge.

## 0. Prereq — symlink the new bins
`install.sh` already links them; on this machine after merge:
```
for c in nhq-audit nhq-audit-verify nhq-ctx nhq-econ nhq-handoff nhq-p3-guard mcp-write-guard; do
  ln -sfn ~/Github/dots/bin/$c ~/.local/bin/$c
done
```
Siblings `p3-paths.json` + `routing-policy.json` stay in `dots/bin` (sibling-resolved).

## 1. Dangerous-command guard (already wired, widened in place)
`dots/claude/hooks/dangerous-command-guard.sh` is the existing PreToolUse Bash hook.
This phase widened `check_dangerous` (rm -rf of a whole ~/Github project, railway
up/deploy/down, supabase db push/reset, pacman -R…s, wipefs, dd of=/dev/, git push
--force-with-lease) and made it sourceable for the selftest. No settings.json change
needed — it's the same hook path.

## 2. P3 commit gate — `nhq-p3-guard`
Two ways to wire (use either or both):

**A. PreToolUse (harness-level, catches `git commit` in Bash):** add to the relevant
`settings.json` → `hooks.PreToolUse` a matcher on `Bash` pointing at:
`~/.local/bin/nhq-p3-guard` (no args — it reads the hook JSON on stdin and emits a
deny decision for a protected-path commit without approval).

**B. git pre-commit (per repo):**
```
ln -sfn ~/.local/bin/nhq-p3-guard <repo>/.git/hooks/pre-commit-nhq
printf '#!/bin/sh\nexec ~/.local/bin/nhq-p3-guard pre-commit\n' > <repo>/.git/hooks/pre-commit
chmod +x <repo>/.git/hooks/pre-commit
```
D4 behavior: Director-direct (NHQ_AGENT unset or canon==director, NOT in a fleet-*
session) may self-approve with `VFRAME_P3_OK=1` (logged to audit). Fleet/relay agents
are HARD-blocked. Protected globs live in `dots/bin/p3-paths.json` (override:
`NHQ_P3_PATHS`).

## 3. Railway MCP gate — `mcp-write-guard`
Add to `settings.json` → `hooks.PreToolUse` a matcher (`mcp__.*railway.*` or `*`)
pointing at `~/.local/bin/mcp-write-guard` (reads hook JSON, self-filters). D3 tiered:
irreversible (`remove_service`/`remove_volume`/`delete_domain`/`remove_bucket`/
`delete_project`) → DENY unless `VFRAME_MCP_OK=1`; routine (`deploy`/`set_variables`/…)
→ allowed + logged; reads → silent allow.

## 4. Audit v2 — `nhq-audit` + post_tool_use.js
The hash-chained, agent-stamped, secret-scrubbed appender + verifier ship as
`dots/bin/nhq-audit` (append) and `dots/bin/nhq-audit-verify` (tamper check).
Replace `~/Github/nhq-agentic-os/.claude/hooks/post_tool_use.js` with the drop-in at
`dots/claude/hooks/pm-post_tool_use.audit-v2.js` (Director's pm-hooks lane). It adds
the `agent` field, Bash-command logging (scrubbed), and delegates to `nhq-audit` for
the chain — falling back to a safe v1 append if `nhq-audit` is not yet on PATH.
Verify anytime: `nhq-audit-verify` (rc 0 = intact, rc 1 = tamper).
```
cp ~/Github/dots/claude/hooks/pm-post_tool_use.audit-v2.js \
   ~/Github/nhq-agentic-os/.claude/hooks/post_tool_use.js
```
NOTE: the existing 126KB of v1 lines have no `h` field — the chain begins at the first
v2 line; legacy lines are tolerated before the chain starts (an unchained line AFTER it
fails verification, which is the insert-tamper signal).
