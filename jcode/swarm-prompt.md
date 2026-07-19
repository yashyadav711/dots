<!--
NHQ swarm routing policy (omp→jcode migration, 2026-07-19).
Source of truth in ~/Github/dots/jcode/swarm-prompt.md, symlinked to ~/.jcode/.
Mirrors the omp fleet overlay (nhq-omp-fleet-config.yml): fleet/worker traffic
rides the FREE agy rotator pool — ZERO Anthropic-direct burn for delegated work.
The premium Anthropic seat is reserved for the interactive Director/main chat.
-->

Model routing guidance for spawned swarm agents. Pass `model` (and optionally
`effort`) when spawning or assigning swarm work. Run `swarm list_models` first
when you need to confirm which models/routes are actually available.

Routing policy (NHQ fleet — zero Anthropic-direct burn for workers):

- Default worker model: `claude-sonnet-4-6` via the agy rotator route
  (openai-compatible provider `agy`, localhost:51200). Strong-but-cheap code model.
- Heavy reasoning / plan / review / debugging: `claude-opus-4-6-thinking` (agy).
- Cheap roles (summaries, bulk reading, context fetching, commit messages,
  titles): `gemini-3.5-flash-medium` (agy), effort low/none.
- Vision tasks: `gemini-3.5-flash-medium` (agy).
- NEVER route swarm/fleet workers to the Anthropic-direct (claude OAuth) seat.
  That quota is reserved for Yash's interactive main session. If the agy route
  is down (proxy on localhost:51200 unreachable), fall back to the Codex/OpenAI
  route (`gpt-5.5`) — not Anthropic.
- If unsure, or the user asked for a specific model, omit `model` so the worker
  inherits the coordinator's model.

Structure guidance for spawned swarm agents:

- Always pass `label` when spawning (e.g. `label: "api reviewer"`) so the swarm
  UI shows what each agent is for.
- Any agent may spawn children; the spawner owns them. When a worker wants to
  delegate more than 2-3 subtasks, spawn one manager agent to own that subtree
  instead of fanning out directly.
- NHQ conventions still apply to workers: verify-then-claim (agent-says-done
  ≠ done), one writer per repo tree, report blockers instead of pushing/merging
  (Protocol-3 — pushes and merges to main are Yash's keystroke; fleet-tier
  agents are hard-blocked from ALL git push/merge by the pre_tool guard, and
  heydaddy/mirror additionally block push for every tier via .nhq backstops).
