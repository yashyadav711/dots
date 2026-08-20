# NHQ Fleet Kit — Director↔team comms (v2)

Local agent-fleet layer around the `claude` CLI. Rides Yash's Claude subscription
(no API key, no new billing). Real files in `~/Github/dots/bin/`, symlinked into
`~/.local/bin/`. State lives under `~/.nhq-fleet/`.

## Commands

| Command | What it does |
|---|---|
| `nhq-spawn <agent> "<task>"` | Spawn (or **reuse**) a `fleet-<agent>` tmux session running interactive `claude`, send the task + FLEET PROTOCOL footer. Prints `watch:`/`talk:`/`await:` lines. |
| `nhq-tell <agent\|session> "<msg>"` | Send a message into a live agent (mid-task redirect). Resolves an agent to an exact **pane** by its tmux window/pane label — see "Who is who" below. Bumps the activity clock. |
| `nhq-await <session> [--timeout S] [--watch]` | **Block until the agent reports**, print the report, exit 0. Director's missing return path. A still-running poll exits **0** with `STILL-RUNNING` (re-arm — NOT a failure); only a crashed session exits 3 (`GONE`). `--watch` = detached poller that survives the 10-min harness cap. |
| `nhq-done <agent> "<result>"` | THE CALLBACK an agent runs when finished: drops a per-session done-marker (the `nhq-await` signal) + appends to Director's inbox + desktop toast. |
| `nhq-fleet [--no-reap]` | Dashboard of all `fleet-*` sessions with true state. Runs an opportunistic reap pass unless `--no-reap`. |
| `nhq-kill <session\|agent>` | Retire a session (kill tmux + clean state files). Agent name kills all its sessions. |
| `nhq-reap [--dry-run]` | RAM-aware reaper: kill DEAD sessions and IDLE-too-long ones. |
| `nhq-browser <start\|stop\|status\|url\|login\|backup\|unlock\|install>` | The **shared browser**: one Chromium holding one permanent logged-in profile, CDP on `127.0.0.1:9222`. Agents attach; they never launch their own. |
| `nhq-secret <get\|add\|totp\|login\|list\|rm>` | The **shared vault**: one KeePassXC database, master password sealed to this machine's TPM. Any agent reads it with no prompt. |
| `nhq-web-on` / `nhq-web-off` / `nhq-web` | The **NetrunnersHQ website** (dashboard, LAN inbox, agent dispatch) on `127.0.0.1:3900` (claimed from the nhq-port pool). Unit lives in the netrunnersHQ repo; `nhq-web` prints status. |

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

## Who is who — agents are identified by PANE LABEL, never session name

Read this before writing anything that messages another agent.

Yash runs the whole fleet as **windows inside one hand-made tmux session**. On
2026-08-20 that session was called `nHQ`, holding window `nHQ-agentic-os`
(Director) and window `envy` (NV). **`nHQ` is Director's own name**, so anything
that resolves an agent from the session name delivers NV's mail to Director —
which is exactly the bug that was fixed that day, after a dictated message to NV
landed in Director's pane.

So: **`nhq-tell` owns the name→pane lookup, and nothing else may keep its own
copy.** It canonicalises aliases through `fleet-registry.json` (`nv`/`nn`/`vv` →
envy, `dir`/`nhq` → director, `build` → builder), matches them against each
pane's window name and pane title, and prints an exact pane target:

```bash
nhq-tell --where nv          # -> nHQ:2.1   (the window labelled `envy`)
nhq-tell --where director    # -> nHQ:1.1   (the window labelled `nHQ-agentic-os`)
nhq-tell nv "check the browser daemon"
```

Four separate copies of that rule had drifted apart before the fix — `nhq-tell`,
`nhq-msg`, `nhq-inbox` and the netrunnersHQ dashboard, whose hardcoded map pointed
`director` at a session called `omp-envy`. If you need to reach an agent, shell
out to `nhq-tell`. Never build a session map.

**`hub` is not the channel for a tmux seat.** `hub`/subagent messaging only knows
omp's own spawned subagents; a fleet seat like NV, Director or Builder is a tmux
session, so `hub send NV …` returns *"Unknown agent NV"*. Reach seats with
`nhq-tell`. (Confirmed live 2026-08-20: Director hit exactly this on the rule's
first real use — the rule was right, the reflex to try `hub` was the bug.)

## The shared browser (`nhq-browser`)

One long-lived headless Chromium owns one permanent profile at
`~/.nhq-browser/profile` and publishes the DevTools Protocol on
`127.0.0.1:9222`. **Every agent attaches as a client. No agent launches its own
browser.** Chromium allows exactly one process per profile directory (the
Singleton lock), so per-agent browsers are impossible — and a browser launched
per task starts logged out every time.

```bash
nhq-browser status     # live? version, tabs, PSS memory, profile size, bind addr
nhq-browser url        # -> http://127.0.0.1:9222   (all an agent needs)
nhq-browser login      # hands the profile to a real window for a human login
```

How to attach, by agent type:

| Agent | How |
|---|---|
| omp (NV, Director, Builder) | browser tool with `app.cdp_url: "http://127.0.0.1:9222"` |
| Claude Code / Cursor / Codex | `npx @playwright/mcp --cdp-endpoint http://127.0.0.1:9222` |
| Playwright directly | `chromium.connectOverCDP('http://127.0.0.1:9222')` |
| anything, no library | `curl -X PUT 'http://127.0.0.1:9222/json/new?<url>'` |

**Rules that are not optional** (each one has already bitten a real agent):

1. **One persistent context, your own tab — but mind which API you are in.** The
   login lives in the browser's persistent (default) context; a context made with
   `newContext()` is incognito-like and starts **logged out**. How you reach it
   depends on the client, and this is where Director lost ~$1 on 2026-08-20:
   - **omp's browser tool is Puppeteer.** Use the `tab` helpers, or
     `await browser.pages()`. **`browser.contexts()` is Playwright-only** — here it
     is `undefined` and throws *"not a function"*, which reads like a broken
     browser rather than wrong code.
   - **A standalone Playwright script is where `contexts()[0]` is correct** — which
     is exactly what `nhq-secret login` uses internally, so the tool works while a
     hand-written Puppeteer call copying that line fails.
   - Never close a tab you did not open.
2. **Never select a tab by URL after a fill tool ran.** `nhq-secret login` opens
   its **own** tab, so there can be TWO tabs on `/login` — and the pre-existing
   empty one may come first. Attaching by URL substring grabs the empty tab and
   reads `pwLen 0` while the vault filled the *other* one correctly. That misreads
   as "the vault fill silently failed" — a false bug report against a working
   secret path, the worst false positive this component attracts. **Select by the
   FILLED field:** loop `browser.pages()`, evaluate `input[type=password].value.length`,
   take the one `> 0`. Then `bringToFront`, arm `waitForNavigation` BEFORE the
   click, and click the submit matching `/log ?in|sign ?in/i` — the label is
   "Login", and a naive first-button click hits "Continue with Google" instead.
3. **Never `kill -9` the browser.** Chromium batches cookie writes to disk on a
   ~30 s timer (measured: a cookie was absent from `Default/Cookies` at t=0 s and
   present at t=35 s). A hard kill destroys a login performed seconds earlier
   while the profile still looks healthy. Use `nhq-browser stop`.
4. **Treat the profile as credential material.** It is mode `700`, its cookies
   are effectively plaintext at rest (`--password-store=basic` uses a key
   hard-coded in Chromium), and it must never live in a synced folder. Do not log
   it into high-value accounts.

Full reference, including the threat model and the ops runbook, lives in the vault
at `~/Obsidian/nHQ/Reference/Agent Browser Automation/`. The tool and its systemd
unit live in `~/Github/nHQ/envy/browser/`.

## The shared vault (`nhq-secret`)

Credentials for the whole fleet live in one KeePassXC database whose master
password is sealed to this machine's TPM. **Any agent, spawned by anyone, can read
it with no password prompt and no setup** — that is the point. If Director spawns a
fresh agent to work on HeyDaddy, that agent reads the HeyDaddy test account and
logs in; nobody types anything.

```bash
nhq-secret list                       # what exists (paths only, never values)
nhq-secret get machine/openrouter     # one secret, bare, to stdout
nhq-secret user accounts/heydaddy-test
nhq-secret totp accounts/heydaddy-test
nhq-secret login accounts/heydaddy-test   # fills it into the SHARED browser
```

`login` **fills username + password into its own tab and stops there** — it does
NOT submit, by design. Its entire output is one line,
`filled username+password on <url> — tab left open, NOT submitted`, and it **never
echoes the secret**. That no-echo is deliberate; do not "improve" it into logging
what it filled. To finish the login, read rule 2 in the shared-browser section
above — select the tab by its FILLED password field, not by URL, then submit.
```

Use it in a command directly — the value never lands in shell history or in `ps`:

```bash
curl -H "Authorization: Bearer $(nhq-secret get machine/openrouter)" …
```

### Storing things

| Command | For |
|---|---|
| `printf '%s\n' "$v" \| nhq-secret add machine/<name>` | API keys, tokens (value on stdin, never argv) |
| `nhq-secret add accounts/<name> -u <user> --url <url>` | a website login |
| `nhq-secret gen accounts/<name> -u <user> --url <url>` | generate a strong password and store it |
| `nhq-secret totp-add accounts/<name> <seed>` | a 2FA seed — base32 or a whole `otpauth://` URI |
| `nhq-secret rm <path>` | purge (two passes — keepassxc's own `rm` only moves it to the Recycle Bin, where it stays readable) |

`machine/` is for machine credentials, `accounts/` is for human logins. The groups
are not decoration: **a read from `accounts/*` fires a Telegram alert naming the
agent that did it**, while `machine/*` reads stay quiet. Both land in
`~/.nhq-secret/audit.log`.

### Two things to know before you rely on it

1. **The tier gate is detection, not prevention.** Every agent runs as the same Unix
   user, so any of them can call `keepassxc-cli` directly and skip the tool
   entirely. `accounts/` buys a notification and an audit line — nothing stops a
   determined read, and the audit log only sees reads that went through
   `nhq-secret`.
2. **First read after a reboot costs ~6 s**, because that is what the TPM unseal
   measures on this laptop. It is then cached in RAM (`$XDG_RUNTIME_DIR`, tmpfs) and
   subsequent reads are ~200 ms. `nhq-secret lock` forgets it early.

Yash opens the same vault in the KeePassXC GUI with `nhq-secret password` — the
master password is a 64-char random nobody memorises, so that command is the only
way in. Design and threat model:
`envy/docs/superpowers/specs/2026-08-20-nhq-secret-design.md`.


## Tunables (env vars)

- `NHQ_STATE_DIR` — state dir (default `~/.nhq-fleet`).
- `NHQ_IDLE_KILL_MIN` — idle minutes before reap (default 20).
