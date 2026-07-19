---
name: recap
description: Beautiful short-but-complete English recap of everything done this session
disable-model-invocation: true
---
Produce a clear, beautifully-formatted English recap of EVERYTHING accomplished in this session so far. Look back over the whole session and summarize what actually happened — short but complete, nothing important dropped.

Format (clean and scannable):
- Open with a one-line **🎯 headline** — the single biggest outcome of the session, in a `>` blockquote.
- Group the work into labelled sections, each with an emoji anchor + bold title (e.g. **🎙️ Voice**, **⚙️ Infra**, **📄 Docs**). Show only sections that actually have work.
- Under each: tight bullets stating what was DONE (the outcome/result, not the activity), with exact file paths, IDs, commits, or commands where they matter.
- Add a **✅ Point-by-point** section: list EACH thing the user asked for this session as its own item, in plain English, each with three tight parts — **Asked:** what they wanted · **Did:** what you actually changed (exact files / commands / IDs) · **Check:** the exact command or action the user runs to verify it works.
- Close with a short **📍 Status / Next** line: what's pending, what needs the user, or "all done".

Rules:
- Plain English, concise — lead with results, not narration.
- Files are truth: recap only what genuinely happened this session; never invent.
- Short enough to read in ~20 seconds, complete enough to lose nothing.
- Web-safe styling: bold + emoji only — no LaTeX, no color codes, no math.


