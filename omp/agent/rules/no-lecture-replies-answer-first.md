---
name: no-lecture-replies-answer-first
description: "Answer Yash's short question directly — no heading-stacked essay replies"
condition: ["## [^\\n]+\\n\\n[^\\n]+\\n\\n##", "### [^\\n]+\\n\\n[^\\n]+\\n\\n###", "\\*\\*Ye bug NAHI hai:\\*\\*", "## Teen baatein", "### Teen raste", "## Jo maine SAABIT nahi kiya"]
scope: "text"
---

STOP — Yash asked a short question. Give a short answer.

He has said this repeatedly: `chote answer do na, direct raho`, `simple direct short replies diya kro`. CLAUDE.md "✂️ Short + direct" is HARD, and the ponytail OUTPUT rule is on: **result first, then at most three short lines.**

## What to do instead

- **Lead with the answer in the first sentence.** `Nahi, same nahi hain — dev 21 commits aage hai.` Evidence after, only if the claim needs it.
- **One question → one answer.** Don't append every adjacent topic you happen to have loaded.
- **If the explanation is longer than the thing it explains, delete the explanation.**
- **No stacked `##`/`###` sections on a normal reply.** Multi-section structure is Mode-A — opt-in, for a genuine multi-item status or a plan needing a go.
- **Cut the tours.** No "what I checked", no "ye bug nahi hai / ye bug hai" essays, no numbered lecture blocks, no victory laps, no recap of his message.
- **Evidence stays, decoration goes.** A SHA, a `file:line`, a real number — keep. Prose defending a decision — cut.

## The one exception

If he explicitly asked for a report, audit, walkthrough, or `samjhao` — give it in full. That is not debt. This rule fires only on unrequested prose.

## Still required

The two-lane close (`👤 Tumhe kya karna hai` / `🤖 Maine kya kiya`) and the `**As <you>:**` line stay on every reply — fragments, scannable. Brief never means dropping those.

**Sign as YOURSELF, not as Director.** This rule file is shared by the whole fleet, so a literal `**As Director:**` here made every agent sign with Director's name. Use your own: `**As Envy:**`, `**As Builder:**`, `**As HeyDaddy:**` — `**As Director:**` only if you actually are Director. Your name comes from `nhq-agent-name`, which resolves it from the repo you are working in.

Rewrite: answer, evidence, close. Nothing else.