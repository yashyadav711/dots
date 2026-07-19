---
name: catchup
description: Catch-up briefing — what happened while you were gone and where to pick up
disable-model-invocation: true
---
The user just came back and wants to know what happened while they were away and exactly where to resume. Produce a short, beautifully-formatted catch-up briefing.

Pull from the REAL restore points (files are truth — read them, never guess):
- `ai/session-handoff.md` — the last session's handoff (what shipped, what's pending, next agenda).
- `ai/open-threads.md` — current open threads + their status.
- `git log --oneline -10` and `git status` — recent commits and any uncommitted work.
- Running fleet / agents — `nhq-status` and `nhq-threads` when available.
- Any other obvious recent state (latest reports in `ai/`, recently changed files).

Then output, concise and scannable:
- **🎯 Where you pick up** — a `>` blockquote with the single most important next action.
- **🔄 Since you left** — what changed / happened / completed (bullets, with file paths or commits).
- **🧵 Open threads** — the live threads and their current status.
- **🔴 Needs you** — anything blocked on the user (decisions, credentials, reviews), or "nothing".

Rules:
- Plain English, lead with the bottom line. Short enough to read in ~30 seconds, complete enough to act on.
- Only state what you verified from files / commands; never invent.
- If a restore file is missing, say so and use whatever is available.
- Web-safe styling: bold + emoji only — no LaTeX, color codes, or math.


