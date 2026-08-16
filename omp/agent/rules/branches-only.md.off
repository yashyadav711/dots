---
name: branches-only
description: "ADVISORY / defense-in-depth ONLY (not a security control): BRANCHES-ONLY reminder when a fleet lane forms git push or merge intent mid-stream. The HARD gate is the p3-guard hook + the driver's out-of-band push disable."
condition:
  - "\\bgit\\s+(?:-[^\\s]+\\s+)*(?:push|merge)\\b"
scope:
  - text
  - thinking
  - tool:bash
interruptMode: always
---

# BRANCHES ONLY — no push, no merge

You appear to be about to `git push` or `git merge`. Fleet lanes **never** do either.

- Commit your work to your dedicated task branch and stop there.
- Pushing to a remote, or merging into `main`/an integration branch, is a **human**
  (Director / Yash) step — it is intentionally outside your authority.
- The `p3-guard` hook hard-blocks push/merge from fleet lanes AND the driver strips the push
  remote out-of-band; this rule is just the early warning. Do not try to route around it
  (no `--no-verify`, no alternate remotes — both are themselves blocked).

This reminder is ADVISORY / defense-in-depth ONLY — a model-context nudge, NOT a security control
(P2-08). Finish on your branch and report via `yield`.
