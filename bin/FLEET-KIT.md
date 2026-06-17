# NHQ Fleet Kit — Director↔team comms (v2)

Local agent-fleet layer around the `claude` CLI. Rides Yash's Claude subscription
(no API key, no new billing). Real files in `~/Github/dots/bin/`, symlinked into
`~/.local/bin/`. State lives under `~/.nhq-fleet/`.

## Commands

| Command | What it does |
|---|---|
| `nhq-spawn <agent> "<task>"` | Spawn (or **reuse**) a `fleet-<agent>` tmux session running interactive `claude`, send the task + FLEET PROTOCOL footer. Prints `watch:`/`talk:`/`await:` lines. |
| `nhq-tell <session> "<msg>"` | Send a message into a live session (mid-task redirect). Bumps the activity clock. |
| `nhq-await <session> [--timeout S] [--watch]` | **Block until the agent reports**, print the report, exit 0. Director's missing return path. A still-running poll exits **0** with `STILL-RUNNING` (re-arm — NOT a failure); only a crashed session exits 3 (`GONE`). `--watch` = detached poller that survives the 10-min harness cap. |
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

### Long tasks vs the 10-min harness cap (the "everything shows FAILED" fix)

The harness caps a background Bash command at **600000ms (10 min)**. A Fleet task can
run 30–45 min. The old `nhq-await` defaulted to a 25-min timeout, so the harness
SIGTERM-killed the watcher at 10 min — and a killed bg process renders as a **FAILED
card** even though the agent was succeeding underneath. That is why "a lot of tasks
showed FAILED" — the *watchers* failed, not the work.

`nhq-await` now treats a still-running poll as a clean re-arm signal, never a failure.
Parse the final `NHQ-AWAIT-STATUS:` line (and exit code) to route:

| Final line | Exit | Meaning | Director does |
|---|---|---|---|
| `NHQ-AWAIT-STATUS: REPORTED` | 0 | agent ran nhq-done; report printed | fire completion notification |
| `NHQ-AWAIT-STATUS: STILL-RUNNING` | 0 | own-timeout (9 min) or hard-kill | **re-arm: run `nhq-await` again** |
| `NHQ-AWAIT-STATUS: WATCHING` | 0 | `--watch` handed off to a detached poller | read `<session>.await-result` later |
| `NHQ-AWAIT-STATUS: GONE` | 3 | session crashed/killed, no report | **alert** — a real failure |
| `NHQ-AWAIT-STATUS: ERROR` | 1 | bad usage | fix the call |

Why it works: the default timeout is **540s (9 min)** — under the 10-min cap — so the
watcher self-exits cleanly *before* the harness kills it. A `SIGTERM`/`INT` trap is the
belt-and-suspenders: if anything hard-kills the watcher anyway, the trap still prints
`STILL-RUNNING` and exits 0. So Director's re-arm loop is simply:

```bash
# Director's poll loop for a long Fleet task (each call ≤ 9 min, under the cap):
while :; do
  out=$(nhq-await fleet-heydaddy-long-task)        # exits 0 in ≤ 9 min
  case "$out" in
    *"STATUS: REPORTED"*)      echo "$out"; break ;;   # done — has the report
    *"STATUS: GONE"*)          echo "agent died"; break ;;
    *"STATUS: STILL-RUNNING"*) : ;;                    # loop: re-arm
  esac
done
```

Or, for fully hands-off waits longer than 10 min, `nhq-await <session> --watch`
returns immediately and a `setsid`-detached poller (outside the harness process group,
so the cap can't reach it) writes the report to `~/.nhq-fleet/<session>.await-result`
and fires a toast on completion/GONE.

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
