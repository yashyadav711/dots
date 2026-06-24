// omp `tool_call` pre-hook — NHQ dangerous-command guard.
//
// Ports NetrunnersHQ's hardened Claude-Code P4 guard to omp so that omp-yolo is as
// safe as Claude-Code-yolo. It does NOT re-implement any patterns: it delegates to the
// SAME bash engine Claude Code uses —
//   ~/Github/dots/claude/hooks/dangerous-command-guard.sh  ::  check_dangerous
// — which is a pure, sourceable function. Zero pattern drift between the two harnesses:
// fix a pattern once in the .sh, both agents inherit it.
//
// Contract (docs/hooks): a `tool_call` handler that returns { block: true, reason }
// refuses the call before bash ever runs; `reason` is surfaced to the model as the tool
// error. First block wins. We gate the `bash` tool only.
//
// Load: drop under ~/.omp/agent/hooks/pre/ (global) or .omp/hooks/pre/ (project), or
// pass --hook /path/to/this/file.ts. Confirm with `omp -p '/extensions'`.

import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// The hardened bash guard. Override with NHQ_GUARD_PATH (tests / non-standard checkout).
const GUARD =
  process.env.NHQ_GUARD_PATH ??
  join(homedir(), "Github/dots/claude/hooks/dangerous-command-guard.sh");

// Probe the guard in a way that FAILS CLOSED (P2-06): a missing/moved/unreadable guard, or a
// guard whose `check_dangerous` won't load, exits with a distinct non-zero code so it can NEVER
// be mistaken for "command is safe" (the old `|| true` swallowed exactly that into an allow).
//   exit 0  → ran: stdout is the danger reason (block) or empty (allow)
//   91/92/93 → guard unreachable / unsourceable / function missing → caller fails CLOSED
const PROBE =
  '[ -f "$1" ] || exit 91; ' +
  'source "$1" 2>/dev/null || exit 92; ' +
  'declare -F check_dangerous >/dev/null 2>&1 || exit 93; ' +
  'check_dangerous "$2" 2>/dev/null; exit 0';

// Internal sentinel: the guard could not be evaluated → fail CLOSED.
const FAIL_CLOSED = "\u0000FAILCLOSED";

// Returns the guard's human-readable reason if `command` is dangerous, "" if safe, or the
// FAIL_CLOSED sentinel if the guard itself could not be evaluated. The command is passed as an
// argv element ($2) — NEVER interpolated into the shell — so checking it can't execute it.
function dangerReason(command: string): string {
  try {
    const out = execFileSync("bash", ["-c", PROBE, "_", GUARD, command], { encoding: "utf8", timeout: 5000 });
    return out.trim();
  } catch (e) {
    const status = e && typeof e === "object" && "status" in e && typeof e.status === "number" ? e.status : undefined;
    process.stderr.write(`[nhq-guard] FAILING CLOSED — dangerous-command guard unreachable (${GUARD}); exit=${status ?? "spawn-error"}\n`);
    return FAIL_CLOSED;
  }
}

export default function (pi: HookAPI) {
  // P2-06: verify the guard exists at hook init. If absent we shout once; every bash call then
  // fails CLOSED below (the per-call PROBE re-checks, so a guard that vanishes later is caught).
  if (!existsSync(GUARD)) {
    process.stderr.write(`[nhq-guard] guard script ABSENT at hook init (${GUARD}); bash calls will fail CLOSED until restored.\n`);
  }
  pi.on("tool_call", (event) => {
    if (event.toolName !== "bash") return;
    const cmd = String(event.input?.command ?? "");
    if (!cmd) return;
    const reason = dangerReason(cmd);
    if (reason === FAIL_CLOSED) {
      return {
        block: true,
        reason:
          `BLOCKED by NHQ dangerous-command guard (FAIL-CLOSED): the guard script could not be ` +
          `loaded (missing/unreadable at ${GUARD}). Refusing the command until the guard is ` +
          `reachable — a destructive command must never slip through an unconfigured guard.`,
      };
    }
    if (reason) {
      return {
        block: true,
        reason: `BLOCKED by NHQ dangerous-command guard: this would ${reason}. This is an irreversible/destructive operation; it cannot be auto-approved from an agent session.`,
      };
    }
  });
}
