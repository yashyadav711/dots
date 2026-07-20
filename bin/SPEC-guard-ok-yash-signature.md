# SPEC — make the NHQ P3 guard `ok - Yash` signature-aware

**Owner:** envy. **Requested by:** Director (Yash governance decision 2026-07-20, `governance-ok-yash-signature-2026-07-20`).
**Priority:** internal-infra Protocol-3 (the guard IS the safety control) — implement carefully, selftest exhaustively, do NOT weaken any existing block.

## Background / governance
Yash's new governance: **Director holds ALL keystrokes** (prod `dev→main` push/merge, prod deploys, P3-path commits); Yash no longer runs commands by hand. His approval for any gated action = typing the exact phrase **`ok - Yash`** in chat = his **digital signature**.

Current guard reality (verified in source):
- `nhq-p3-guard` — prod P3-path commits (heydaddy/mirror on `main`, scope `p3`) currently let a **Director-tier caller SELF-APPROVE with a bare inline `VFRAME_P3_OK=1`** (PreToolUse) — i.e. Director can approve a prod P3 commit with **zero proof Yash actually approved**. Fleet tier is hard-blocked. Dev/feature = `none` scope = ungated.
- `nhq-jcode-pretool` — the fleet push/merge block fires ONLY for fleet-tier callers; **Director is NOT blocked from `git push`/`git merge` to main at all** (ungated).

**The gap this spec closes:** replace Director's unprovable self-approve on PROD gates with a **verifiable, audited, single-use `ok - Yash` approval token**. Without the token, prod P3 commits AND Director's prod-main push/merge are BLOCKED (a real safety net against an accidental/unapproved/hallucinated prod action). Everything non-prod stays exactly as today.

## Deliverables

### 1. NEW `nhq-approve` (bash, in `~/Github/dots/bin`, symlink to `~/.local/bin`)
Writes / verifies / consumes an approval token. Token store: **`~/.nhq-approval.json`**, `chmod 600`, a JSON array of grants.

Grant shape: `{ "repo": "<basename>", "target": "main", "granted_at": <epoch>, "expires_at": <epoch>, "nonce": "<random>", "consumed": false }`.

Subcommands:
- `nhq-approve grant --repo <r> --target <branch> [--ttl <mins, default 30>]` — append a fresh unconsumed grant. Prints the nonce. (Director calls this ONLY after seeing the literal `ok - Yash` in chat.)
- `nhq-approve verify --repo <r> --target <branch>` — exit 0 if a matching, unexpired, unconsumed grant exists; exit 1 otherwise. Does NOT consume.
- `nhq-approve consume --repo <r> --target <branch>` — verify + mark the matching grant `consumed:true` (single-use); exit 0 on success, 1 if none.
- `nhq-approve list` / `nhq-approve clear` — inspect / wipe.
Robust to a missing/empty/corrupt store (treat as "no grants"). Use `jq`.

### 2. MODIFY `nhq-p3-guard`
In `p3_evaluate`, scope `p3` (heydaddy/mirror prod), matched P3 paths, privileged Director caller (PreToolUse):
- Replace the bare `P3_TOKEN==1` self-approve with: **call `nhq-approve consume --repo <repo-basename> --target <branch>`**. If it succeeds → `P3_VERDICT="ALLOW(yash-signature-token)"`, audit `allow`, return 0. If it fails → `P3_VERDICT="DENY(no-yash-signature)"`, audit `deny`, return 1, with a deny-reason instructing: "obtain Yash's `ok - Yash` signature; Director then runs `nhq-approve grant --repo <r> --target <b>` before the commit."
- KEEP UNCHANGED: fleet hard-block (`DENY(fleet-hard-block)`), the `precommit`-mode no-self-approve, firststone whole-repo block, `none`-scope immediate allow, no-policy-file fail-closed.
- Resolve `<repo-basename>` + `<branch>` from the same `P3_GIT_ARGS`/`p3_scope` context already computed (do NOT re-parse the command string for identity).

### 3. MODIFY `nhq-jcode-pretool`
Add a **Director-tier prod push/merge gate** (distinct from the existing fleet block, which stays):
- When the Bash command is a real `git push` or `git merge` (reuse/adapt the existing quoted-span-stripped regex) AND the caller is Director-tier (NOT fleet) AND the target repo (resolve via `git -C <cwd> ...` origin/toplevel, same logic as `p3_scope`) is a scoped prod repo (heydaddy/mirror) AND the action targets `main`/`master` (current branch is main OR the push refspec/merge names main) → require `nhq-approve verify --repo <r> --target main`; if absent → `exit 2` with reason "prod push/merge needs Yash's `ok - Yash` signature (nhq-approve grant …)". If present → allow (do NOT consume here; the commit-gate consumes; a push with no new P3 commit still needs the signature for the release action — so verify, don't consume, at push time).
- **Fail SAFE, not over-gate:** a Director push to a NON-main branch (dev/feat), or to a non-scoped repo, must pass untouched. Be conservative parsing "targets main" — if genuinely ambiguous on a scoped repo prod push, fail closed (require token), but NEVER gate dev/feature pushes.

## Constraints / frozen behavior
- Do NOT touch `p3-paths.json` policy, the exclusion self-protection, the scope logic, or any DENY path other than swapping Director's prod self-approve → token.
- Non-prod (dev/feature/internal repos) MUST stay fully autonomous — no new friction.
- `--no-verify` at the git pre-commit layer remains the deliberate manual human escape (unchanged).

## Acceptance / selftest (REQUIRED — extend the existing selftest or add one)
Provide a runnable selftest proving:
1. Director prod P3 commit WITHOUT a token → DENY(no-yash-signature).
2. `nhq-approve grant` then Director prod P3 commit → ALLOW(yash-signature-token), and the grant is now `consumed`.
3. A second commit reusing the same grant → DENY (single-use).
4. Expired grant (ttl in the past) → DENY.
5. Fleet-tier prod P3 commit (even with a token) → still DENY(fleet-hard-block).
6. Dev/feature commit (scope none) → ALLOW(out-of-scope), no token needed.
7. Director push to `dev` / a feat branch → NOT gated (passes).
8. Director push to scoped-repo `main` without token → blocked; with a valid token → allowed.
Report the selftest output verbatim in your `nhq-done` report. Commit to a branch in the appropriate repo (dots) — do NOT push. Flag any `[SELF-MONITOR: …]`.
