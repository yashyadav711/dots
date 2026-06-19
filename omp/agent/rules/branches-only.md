---
name: branches-only
description: BRANCHES-ONLY reminder when a fleet lane forms git push or merge intent mid-stream.
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
- The `p3-guard` hook hard-blocks push/merge from fleet lanes; this is the early
  warning. Do not try to route around it (no `--no-verify`, no alternate remotes).

Finish on your branch and report via `yield`.
