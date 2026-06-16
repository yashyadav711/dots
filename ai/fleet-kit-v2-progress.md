# Fleet Kit v2 — progress (Envy)

Branch: `feat/fleet-kit-v2` (in ~/Github/dots) — branches only, no push.
Goal: make Director↔team comms reliable. 4 items from /tmp/fleet-kit-v2-spec.md.

## Status
- [x] Investigate current Fleet Kit + design detection
- [x] Item 1 — `nhq-await` (Director notification tool)
- [x] Item 2 — persistent + reuse sessions + `nhq-kill` + RAM-aware reaper
- [x] Item 3 — fix `nhq-fleet` RUNNING/IDLE/DEAD detection
- [x] Item 4 — end-to-end smoke test
- [x] Update envy brain (LOG.md + NOTES.md)

## Key design decisions
- State dir: `~/.nhq-fleet/` — `<session>.done` (report marker) + `<session>.activity` (last-activity epoch).
- Shared lib `bin/nhq-lib.sh` sourced by scripts (resolved via `readlink -f`) — DRY detection.
- Detection (the false-IDLE bug): `pane_current_command` is UNRELIABLE (reports `fish`
  even while claude works, because claude keeps a persistent shell child). Instead:
  - ALIVE = a `claude`/`node` process in the pane_pid's descendant tree (process-tree walk).
  - RUNNING = ALIVE + pane content shows the live timer `(Ns · … tokens` or `esc to interrupt`.
  - IDLE = ALIVE + no working marker. DEAD = no claude in tree (at fish / gone).
- nhq-done detects its own tmux session and writes `<session>.done`; nhq-await watches it
  with an mtime>=start guard (no cross-agent false trips).
