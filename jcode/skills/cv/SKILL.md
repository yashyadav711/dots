---
name: cv
description: Check vault — what Yash added/changed in the personal vault + new inline comments, then summarize and act
disable-model-invocation: true
---
Check the personal Obsidian vault for changes and comments (port of omp's /cv command).

Run these two commands:
1. `nhq-vault-changes` — notes Yash added/modified/deleted since the last check
2. `nhq-vault-comments --open` — new inline Document Comments

Then:
- Read the changed notes (the actual files) and summarize what changed, concisely.
- For each open comment: read its context and either answer/act on it or surface it as a decision for Yash.
- Personal vault scope ONLY — not work/fleet/repo files.
