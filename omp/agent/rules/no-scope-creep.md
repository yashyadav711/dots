---
name: no-scope-creep
description: Scope-creep trip-wire when a fleet lane signals unrequested extra work mid-stream.
condition:
  - "\\b(?:[Ww]hile (?:i'?m|we'?re) at it|[Mm]ight as well|[Aa]lso (?:add|refactor|improve|clean up|rewrite)|[Bb]onus|[Nn]ice to have|[Aa]s a bonus|[Ss]ince i'?m here)\\b"
scope:
  - text
  - thinking
interruptMode: prose-only
---

# No scope creep — do exactly the assignment

You are signalling work beyond what the assignment asked for. Stop.

- Do **exactly** what the task specifies — no opportunistic refactors, extra
  validation, telemetry, or "while I'm at it" changes.
- If you noticed something genuinely worth doing, **note it in your `yield`
  summary** for the Director to triage — do not silently expand the change.
- A smaller, exactly-scoped diff is correct; a larger "helpful" one is a defect.

Re-read the assignment's acceptance criteria and continue only on what it named.
