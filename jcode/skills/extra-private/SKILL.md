---
name: extra-private
description: Maximum privacy POSTURE — no agent-written files/git; keep-or-delete prompt at close
disable-model-invocation: true
---
For the REST of this session, operate in EXTRA-PRIVATE mode (stricter than `/private`).

- Everything in `/private` applies (no delegation / relay / agy, nothing to shared / synced / remote surfaces).
- YOU write **NOTHING** to disk or git — no files, logs, commits, or notes. Keep your work in the conversation only.
- If something genuinely MUST be written, put it in `/tmp`, tell Yash it exists, and TRACK every path.
- **ON CLOSE** (Yash says closing / ending / "log things"): if anything was written, ASK Yash to either (a) keep it somewhere he names or (b) delete it, then act. If nothing was written, say so.

⚠️ **HONEST LIMIT — state this, never hide it:** this command only governs what *you* write. It CANNOT make the jcode session transcript ephemeral — jcode auto-saves sessions under `~/.jcode/sessions/` by default. Never imply the transcript is not on disk.

Confirm with: "🕶️ Extra-private posture on — I write nothing to disk/git and will ask before anything persists. Note: the jcode transcript itself still saves to disk."


