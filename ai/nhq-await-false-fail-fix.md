# Fix: nhq-await long-poll reads as FAILED — investigation + fix

**Branch:** `fix/nhq-await-no-false-fail` (dots) · branches-only, NOT pushed/merged
**Date:** 2026-06-17 · Envy (fleet task from Director via /tmp/task-failure-investigation.md)

## The complaint
Yash flagged that "a lot of tasks showed FAILED this session." Director's hypothesis:
the FAILED cards are `nhq-await` background watchers hitting the harness's 10-min
background-Bash timeout cap while watching 30–45 min Fleet tasks — they get killed /
exit 124 (= shown as "failed"), even though the underlying agent work succeeded.

## Evidence gathered (task classification)

| Background task / agent callback | Outcome | Classification |
|---|---|---|
| envy — fleet kit build (21:10Z) | nhq-done landed in inbox | ✅ SUCCESS |
| envy — agent-name fix (21:23Z), branch fix/agent-name-detection | landed | ✅ SUCCESS |
| envy — fleet-kit-v2 build (22:32Z), branch feat/fleet-kit-v2 | landed | ✅ SUCCESS |
| envy — fleet-kit-v2 merge→main (22:37Z) | landed | ✅ SUCCESS |
| mirror — smoke A/B/C (22:25–28Z) | 3 callbacks landed | ✅ SUCCESS |
| heydaddy — CI-recovery (22:48Z), branch fix/ci-recovery | landed; merged via PR #61 (5658e1e) | ✅ SUCCESS |
| heydaddy — prod web deploy (23:23Z), release/prod-ci-admin | landed; deploy 5718b18d healthy | ✅ SUCCESS |
| The "FAILED" cards Yash saw | the `nhq-await` watchers themselves, killed at the 10-min harness cap | ⏱ COSMETIC-TIMEOUT |

**No real work was lost.** Every `nhq-done` callback is present in
`~/Github/product-manager/ai/fleet-inbox.md`. The early relay hang's CI-recovery work
was fully redone via the Fleet Kit and **merged via PR #61** (`5658e1e` "Merge pull
request #61 from yashyadav711/fix/ci-recovery") — commits `d4349a1`, `5b70e98`,
`8502503` all landed; engine PR branches then merged dev to inherit the frontend CI fix.
heydaddy prod web deploy `5718b18d` went out and verified healthy (/admin, /admin/safety,
/login all 200). The FAILED cards were the **watchers**, not the work.

## Root cause
`nhq-await` default timeout is **1500s (25 min)** but the harness background-Bash cap is
**600000ms (10 min)**. So when Director runs `nhq-await` via `run_in_background` to watch
a long Fleet task, the harness SIGTERM-kills the watcher at 10 min — *before* nhq-await
ever reaches its own timeout branch. A killed bg process renders as a **FAILED card**.
Even nhq-await's own timeout path exited **124**, which also renders as failed. So both
the harness-kill and the self-timeout produced false-failure signals while the agent
work was succeeding underneath.

## The fix (implemented in bin/nhq-await)
Make a still-running poll a *clean, non-failure* signal that Director re-arms:

1. **Self-timeout fits UNDER the harness cap.** Default timeout 1500→**540s (9 min)**, so
   nhq-await self-exits cleanly *before* the harness 10-min kill.
2. **Own-timeout now exits 0** (was 124) with a machine-parseable
   `NHQ-AWAIT-STATUS: STILL-RUNNING` line → a timed-out poll no longer shows as failed;
   Director reads STILL-RUNNING and re-invokes nhq-await (re-arm).
3. **SIGTERM/SIGINT trap** → if the harness (or anything) hard-kills the watcher anyway
   (e.g. a caller passed a longer `--timeout`), the trap prints STILL-RUNNING and exits 0.
   Belt-and-suspenders: a harness-cap kill becomes a clean re-arm, never a failure.
4. **Genuine outcomes stay distinguishable** via a stable final `NHQ-AWAIT-STATUS:` tag
   AND exit code:
   - `REPORTED`  — exit 0  — agent called nhq-done; report printed (real completion).
   - `STILL-RUNNING` — exit 0 — own-timeout/kill; re-arm (NOT a failure).
   - `GONE` — exit **3** — session crashed/killed with no report (a REAL failure; still
     shows as failed, correctly).
   - `ERROR` — exit 1 — bad usage.
5. **`--watch` detached mode** (opt-in survival path): forks a `setsid`-detached poller
   that outlives the harness cap, writes the report to `~/.nhq-fleet/<session>.await-result`
   and fires a toast on completion/GONE; foreground returns immediately with
   `NHQ-AWAIT-STATUS: WATCHING` (exit 0). For true hands-off waits longer than 10 min.

## Status
- [x] Evidence gathered, classification table, no-work-lost confirmed
- [x] Root cause confirmed
- [x] nhq-await rewritten (exit-0 STILL-RUNNING + under-cap default + SIGTERM trap + status tags + --watch)
- [x] Tested (bash -n, marker-report path, self-timeout path, GONE path, status tags)
- [x] FLEET-KIT.md updated (re-arm loop + exit/status contract)
- [x] envy brain updated (LOG.md, NOTES.md)
- [x] reported via nhq-done envy (callback in fleet-inbox.md)
