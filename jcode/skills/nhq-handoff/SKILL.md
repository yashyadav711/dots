---
name: nhq-handoff
description: Write/refresh the durable NHQ session handoff (ai/session-handoff.md) then validate it
disable-model-invocation: true
---
Write or refresh the durable NHQ session handoff at `ai/session-handoff.md` so the NEXT session can fully restore context from this one file alone.

Use the NHQ handoff format — these required sections, each as a `##` / `###` heading:

- **Shipped / Done** — what was completed AND verified this session (exact file paths, commits, branches).
- **Open threads** — every carry-over thread, its current status, and the last action taken on it.
- **Pending / Blocked / Next** — what's queued, what needs Yash specifically, and the exact next-session agenda.

Rules:
- Files are truth — only state what you can verify (grep / read / git log), never from memory.
- This is the restore point: a fresh session reading ONLY this file must know exactly where to resume.
- Preserve still-relevant content already in the file; never silently drop an open item.
- After writing, run `nhq-handoff validate ai/session-handoff.md` and confirm it passes; fix any missing sections if it fails.
- This is the durable on-disk handoff ("our way"). It is SEPARATE from jcode's native `/handoff` skill (which compacts into a temp handoff doc). Run this to persist the doc; run `/handoff` after if you also want a fresh session carrying the summary.


