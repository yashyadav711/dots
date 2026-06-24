---
name: protocol3-paths
description: "ADVISORY / defense-in-depth ONLY (not a security control): Protocol-3 mid-stream reminder when a fleet lane writes auth / payment / PII-shaped content. The HARD gate is the p3-guard hook + pre-commit backstop."
condition:
  - "([Pp]assword|[Ss]ecret|[Aa]pi[_-]?[Kk]ey|[Aa]pi[Kk]ey|[Cc]lient[_-]?[Ss]ecret|[Pp]rivate[_-]?[Kk]ey|[Aa]ccess[_-]?[Tt]oken|[Bb]earer |[Oo][Aa]uth|[Cc]redential|[Ss]tripe|[Nn]owpayments|sk-[A-Za-z0-9]{6}|sk-ant-)"
scope:
  - tool:edit
  - tool:write
interruptMode: tool-only
---

# Protocol-3 — STOP, this is sensitive content

You are writing **credential / payment / PII-shaped content** (a password, API key,
secret, token, Stripe/payment, OAuth, or similar) into a file. This is the Protocol-3
(P3) protected class.

- Fleet lanes are **hard-blocked** from committing P3 paths (the `p3-guard` hook
  enforces this at commit time) and from editing/writing the protected-path globs.
- Writing a secret or credential is almost never what your assignment asked for. If
  the task genuinely requires it, **stop** and `yield`
  `{status:"blocked", need:"<the exact P3 decision required from Yash>"}`.
- Never hardcode a real secret. If you reached this by scope drift, back out.

This reminder is ADVISORY / defense-in-depth ONLY — it is a model-context nudge an adversarial
worker can simply ignore, so the THREAT MODEL must NOT count it as a security control (P2-08).
The HARD controls are the `p3-guard` hook's path-block (incl. ast_edit) and the driver-installed
pre-commit commit backstop. It fires on sensitive CONTENT because omp's TTSR cannot yet path-gate
edit/write streams — so it complements, never replaces, the path-based hook.
