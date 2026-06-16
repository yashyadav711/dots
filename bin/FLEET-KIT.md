# NHQ Fleet Kit — Director↔team comms (v2)

Local agent-fleet layer around the `claude` CLI. Rides Yash's Claude subscription
(no API key, no new billing). Real files in `~/Github/dots/bin/`, symlinked into
`~/.local/bin/`. State lives under `~/.nhq-fleet/`.

## Commands

| Command | What it does |
|---|---|
| `nhq-spawn <agent> "<task>"` | Spawn (or **reuse**) a `fleet-<agent>` tmux session running interactive `claude`, send the task + FLEET PROTOCOL footer. Prints `watch:`/`talk:`/`await:` lines. |
| `nhq-tell <session> "<msg>"` | Send a message into a live session (mid-task redirect). Bumps the activity clock. |
| `nhq-await <session> [--timeout S]` | **Block until the agent reports**, print the report, exit 0. Director's missing return path. Timeout → exit 124. |
| `nhq-done <agent> "<result>"` | THE CALLBACK an agent runs when finished: drops a per-session done-marker (the `nhq-await` signal) + appends to Director's inbox + desktop toast. |
| `nhq-fleet [--no-reap]` | Dashboard of all `fleet-*` sessions with true state. Runs an opportunistic reap pass unless `--no-reap`. |
| `nhq-kill <session\|agent>` | Retire a session (kill tmux + clean state files). Agent name kills all its sessions. |
| `nhq-reap [--dry-run]` | RAM-aware reaper: kill DEAD sessions and IDLE-too-long ones. |

`nhq-lib.sh` is a sourced helper (not a command) — single source of truth for the
state dir, marker/activity paths, and state detection. Scripts source it via
`readlink -f` of their own path, so it resolves through the `~/.local/bin` symlink.

## The Director loop (how to use it)

```bash
# Director, right after spawning, runs nhq-await in the background (harness
# run_in_background) so it gets a REAL completion notification:
nhq-spawn heydaddy "Add retry cap to the upload queue"
#   await:  nhq-await fleet-heydaddy-add-retry-cap-to-t   <- copy this line
nhq-await fleet-heydaddy-add-retry-cap-to-t   # blocks; prints the report; exits 0
```

The agent, when done, runs `nhq-done heydaddy "..."` (baked into its footer). That
drops `~/.nhq-fleet/<session>.done`, which `nhq-await` is watching — it unblocks,
prints the report, exits 0, and Director's harness fires the notification.

## State detection (the v1 bug, fixed)

v1 read `tmux #{pane_current_command}` to decide WORKING vs IDLE. That is **wrong**:
claude keeps a persistent background shell whose process becomes the pane's
foreground command, so `pane_current_command` reports `fish` even while claude is
actively working — v1 false-reported "IDLE/done" mid-task.

v2 detection (`nhq_session_state`):
- **⚫ DEAD** — no `claude`/`node` process in the pane_pid's descendant tree (dropped to fish / gone).
- **🟢 RUNNING** — claude alive **and** the pane shows its live work indicator (the `(Ns · … tokens` timer or `esc to interrupt`).
- **⚪ IDLE** — claude alive but no work indicator (at its own prompt, awaiting `nhq-tell`).

ALIVE is a process-tree walk (robust); RUNNING vs IDLE is pane-content (the live
timer only renders while claude works).

## Persistence + reuse + RAM policy

- Spawned sessions are **persistent**: interactive claude stays idle-at-prompt after
  a task (talkable for the next `nhq-tell`). A trailing `exec fish` keeps the tmux
  pane alive even if claude crashes (shows DEAD, inspectable) instead of vanishing.
- `nhq-spawn` **reuses** a live `fleet-<agent>` session (prefers IDLE, falls back to
  RUNNING) by sending the task via `nhq-tell` — never a duplicate claude.
- **RAM-aware reaping** (7.5GB laptop): `nhq-reap` kills DEAD sessions immediately and
  IDLE sessions idle longer than `NHQ_IDLE_KILL_MIN` (default 20 min). RUNNING
  sessions are never killed (each reap pass refreshes their activity clock).
  "Activity" = spawn / tell / observed-RUNNING. `nhq-fleet` runs a reap pass on every
  invocation, so frequent dashboard checks keep idle RAM at zero with no daemon.

### Optional: hands-off reaping via a systemd user timer

`nhq-fleet`'s opportunistic reap covers normal use. For fully hands-off reaping
(reap even when nobody runs `nhq-fleet`), install a user timer:

```ini
# ~/.config/systemd/user/nhq-reap.service
[Unit]
Description=NHQ Fleet idle reaper
[Service]
Type=oneshot
ExecStart=%h/.local/bin/nhq-reap
```
```ini
# ~/.config/systemd/user/nhq-reap.timer
[Unit]
Description=Run NHQ Fleet reaper every 5 min
[Timer]
OnBootSec=5min
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
```
```bash
systemctl --user daemon-reload && systemctl --user enable --now nhq-reap.timer
```

## Tunables (env vars)

- `NHQ_STATE_DIR` — state dir (default `~/.nhq-fleet`).
- `NHQ_IDLE_KILL_MIN` — idle minutes before reap (default 20).
