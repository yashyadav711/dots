# THIS MACHINE IS RIG (not the laptop)

Everything above is the shared rule set, pushed from the laptop by
`nhq-brain-push`. Do not edit it here — edits are overwritten on the next push;
change `~/.claude/CLAUDE.md` on the laptop, or this section in
`dots/brain/rig.md`.

You are on **rig**, Yash's GPU box (RTX 2070 8 GB, CachyOS). What follows is what is
true about *this machine*.

## What this box is for

A machine with a GPU, not a project. GPU/AI experiments, container work, and
anything that wants to run somewhere other than the laptop.

    labs/       one dir per experiment (see also ~/ai/labs, made by `newlab`)
    notes/      findings worth keeping — benchmarks, what fit in 8 GB, what died
    scripts/    throwaway automation that earned a name

## What is running here

| Thing | Where | Notes |
|---|---|---|
| ollama | system service | `qwen3:8b`, `qwen3:4b`; models in `/var/lib/ollama`, **not** `~/ai/ollama` — the daemon has its own user |
| agy rotator | user service, `:51200` | keyless OpenAI-compatible proxy over 13 Google accounts → Gemini + Claude at zero Anthropic quota |
| Open WebUI | container, `:80` | the chat UI Yash opens from his tablet at `http://192.168.31.171` |
| Open Terminal | container, `127.0.0.1:8000` | a **sandboxed** shell for the WebUI model — it cannot see this host's files |
| Playwright MCP | user service, `127.0.0.1:8931` | headless Chromium the WebUI model drives |
| omp session | `omp-rig` tmux, systemd user service | what `rig` from the laptop attaches to |

`nhq-newbox verify` checks every layer. `nhq-newbox verify ai` / `verify agy` narrow it.

## Things that will bite you

- **The login shell is fish.** Anything sent over ssh is parsed by fish unless you
  wrap it: `ssh rig 'bash -lc "…"'`. Inline `VAR=$(…)` fails with
  `fish: Unsupported use of '='`.
- **`~/.local/bin` shadows the distro node** with Hermes' bundled copy (v22 vs the
  system v26). Services must pin `PATH=/usr/bin:/usr/local/bin`.
- **This box holds real credentials**: 13 Google refresh tokens in
  `~/.pi-antigravity-rotator/accounts.json` and an Anthropic OAuth credential in
  `~/.omp/agent/agent.db`. Never print them, never copy them off the box, and be
  careful what you paste into a chat that may be shared.
- **SSH still accepts a five-character password.** Until that changes, treat this
  machine as the weakest link on the LAN and do not give it access to anything else.
- Three other drives hold Windows data and are **deliberately untouched**. Do not
  mount, format, or write to them.
- The GPU is power-capped at 150 W on a 185 W card, on purpose. Do not raise it.

## Reporting back

The laptop is Director. This box cannot ssh to it — deliberately — so mail is a
pull: write with `nhq-send-from-rig-to-laptop "…"` (or `nhq-msg send director "…"`)
and the laptop collects it within about two minutes. The conversation is readable at
`~/nhq-inter-comms.md`.

## Verify, do not remember

Every claim about this box should come from a command you just ran. State counts,
SHAs and health checks from output, and say **unknown** when you did not check.
