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
import { homedir } from "node:os";
import { join } from "node:path";

// The hardened bash guard. Override with NHQ_GUARD_PATH (tests / non-standard checkout).
const GUARD =
  process.env.NHQ_GUARD_PATH ??
  join(homedir(), "Github/dots/claude/hooks/dangerous-command-guard.sh");

// Returns the guard's human-readable reason if `command` is dangerous, else "".
// The command is passed as an argv element ($2) — NEVER interpolated into the shell —
// so the act of checking a command can't itself execute it. `|| true` makes the wrapper
// exit 0 regardless of check_dangerous's return code, so we read the verdict purely from
// stdout: a reason ⇒ block, empty ⇒ allow.
function dangerReason(command: string): string {
  try {
    const out = execFileSync(
      "bash",
      ["-c", 'source "$1" 2>/dev/null; check_dangerous "$2" 2>/dev/null || true', "_", GUARD, command],
      { encoding: "utf8", timeout: 5000 },
    );
    return out.trim();
  } catch (e: any) {
    // Real spawn failure (no bash, guard file gone). Parity with CC: a missing/broken
    // guard does not exist to block, so we fail OPEN rather than brick every command —
    // but we shout to stderr so the gap is visible. (Documented as a known gap.)
    process.stderr.write(
      `[nhq-guard] guard invocation failed (${GUARD}): ${e?.message ?? e}\n`,
    );
    return String(e?.stdout ?? "").trim();
  }
}

export default function (pi: HookAPI) {
  pi.on("tool_call", (event) => {
    if (event.toolName !== "bash") return;
    const cmd = String(event.input?.command ?? "");
    if (!cmd) return;
    const reason = dangerReason(cmd);
    if (reason) {
      return {
        block: true,
        reason: `BLOCKED by NHQ dangerous-command guard: this would ${reason}. This is an irreversible/destructive operation; it cannot be auto-approved from an agent session.`,
      };
    }
  });
}
