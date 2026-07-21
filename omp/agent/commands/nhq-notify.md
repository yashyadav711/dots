---
description: Execute a task and privately notify Yash only when it blocks, fails, or completes.
---

Execute `$ARGUMENTS` using the normal workflow. Do not notify when work starts or while it progresses.

- If progress cannot continue without Yash's decision, call `nhq-bot notify --event blocked` with a short title and the blocker plus required decision; then report the block.
- If the task reaches an unrecoverable failure, call `nhq-bot notify --event failed` with the failure and relevant evidence; then report the failure.
- Only after the task's required verification succeeds, call `nhq-bot notify --event completed` with the outcome and concrete verification evidence.

Include `--agent` and `--runtime` when known. Never include credentials, tokens, raw logs, PII, or private values in a notification. A `nhq-bot` delivery failure is additional evidence; it does not turn a failed task into a success.