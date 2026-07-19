---
name: prompt
description: Read prompt.md from the project root (Yash's scratchpad for long prompts) and carry out the instructions written there
disable-model-invocation: true
---

Yash keeps long prompts in a scratchpad file called `prompt.md` in the **project / root folder** (the current working directory), instead of typing them inline. He triggers this with a single quick line.

**Do this:**
1. Read the file `prompt.md` in the current working directory (the repo/root you're running from).
2. Treat its entire contents as Yash's prompt to you right now, and carry out those instructions.
3. If `` is non-empty, treat it as an extra note that scopes or refines what's in `prompt.md`.

If `prompt.md` does not exist or is empty, say so in one line instead of guessing.
