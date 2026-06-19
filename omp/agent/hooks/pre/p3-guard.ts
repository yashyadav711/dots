// omp `tool_call` pre-hook — NHQ Protocol-3 (P3) commit/push/write gate.
//
// Ports NetrunnersHQ's P4 commit gate to omp's hook surface so that an omp fleet
// worker is governed by the SAME Protocol-3 policy it was under Claude Code. It does
// NOT re-implement the policy: every decision is delegated to the hardened bash gate
//   ~/Github/dots/bin/nhq-p3-guard   (`check` + `match-path` subcommands)
// which owns the p3-paths.json glob set and the D4 caller-tier rule. One source of
// truth — fix the policy once in the bash script, this hook inherits it. Zero drift.
//
// What it gates (the `tool_call` events a fleet worker can issue):
//   • bash `git commit …`  → delegate to `nhq-p3-guard check <repo> pretooluse`. If the
//     commit stages an auth/payments/PII/audit/security path without approval, the gate
//     denies (exit 1) and this hook BLOCKS with the gate's reason. Director-on-omp may
//     self-approve by prefixing `VFRAME_P3_OK=1` inline (the existing D4 token).
//   • bash `git push` / `git merge`  → BRANCHES-ONLY (D4): a fleet lane is HARD-blocked;
//     Director-direct is allowed. Integration to main is a human step.
//   • edit / write on a p3-paths.json glob  → omp-side hardening: catch the protected-path
//     MUTATION before it is even staged. Fleet HARD-blocked; Director allowed.
//
// Caller tier (anti-spoof): identity is read from the HOST process env — which a guarded
// worker CANNOT change via a command-inline `NHQ_AGENT=… cmd` (that env reaches only the
// command's own subprocess, never this hook). The NHQ driver marks the fleet host with
// `NHQ_FLEET=1`; the gate's own `check` re-derives the same tier from NHQ_AGENT/NHQ_SESSION.
//
// KNOWN GAP (omp-P0): the RPC `{type:"bash"}` command runs driver-side and never reaches
// this hook. That gap is closed P1-side by the driver's `assertSendableFrame()` lint — NOT
// here. This hook gates the model's tool calls only (its full, documented scope).
//
// Load: drop under ~/.omp/agent/hooks/pre/ (global, applies to subagents too) or pass
// --hook /path/to/this/file.ts. INERT until installed (see dots/bin/nhq-omp-hooks-install).

import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// The hardened bash gate. Override with NHQ_P3_GUARD_BIN (tests / non-standard checkout).
function guardBin(): string {
  const override = process.env.NHQ_P3_GUARD_BIN;
  if (override) return override;
  const local = join(homedir(), ".local/bin/nhq-p3-guard");
  if (existsSync(local)) return local;
  return join(homedir(), "Github/dots/bin/nhq-p3-guard");
}

// Tier of the caller. Fleet lanes are hard-blocked from P3 commits/pushes/writes; Director
// (the human governance point) is privileged. Mirrors nhq-p3-guard's `p3_caller_privileged`
// EXACTLY (empty NHQ_AGENT ⇒ Director/human), and adds the explicit NHQ_FLEET=1 marker the
// driver stamps on the fleet host so every worker is correctly fleet-tiered at runtime.
function isFleetCaller(): boolean {
  if (process.env.NHQ_FLEET === "1") return true;
  const session = process.env.NHQ_SESSION ?? "";
  if (session.startsWith("fleet-")) return true;
  const agent = (process.env.NHQ_AGENT ?? "").toLowerCase();
  return agent !== "" && agent !== "director";
}

// ── command shape detectors (ported from nhq-p3-guard's PreToolUse detection) ──
// Each tolerates inline env assignments and an `env`/`/usr/bin/env` wrapper before `git`.
const PREFIX = "(?:^|[;&|]|&&)\\s*(?:(?:[^\\s]*/)?env\\s+(?:[^\\s]+\\s+)*)?(?:[A-Za-z_]\\w*=[^\\s]*\\s+)*git\\s+";
const COMMIT_RE = new RegExp(PREFIX + "(?:[^|;&]*\\s)?commit(?:\\s|$)");
const PUSH_RE = new RegExp(PREFIX + "(?:[^|;&]*\\s)?push(?:\\s|$)");
const MERGE_RE = new RegExp(PREFIX + "(?:[^|;&]*\\s)?merge(?:\\s|$)");
const TOKEN_RE = /(?:^|\s)VFRAME_P3_OK=1(?:\s|$)/;
const DASH_C_RE = /\bgit\s+(?:-[^\s]+\s+)*-C\s+([^\s]+)/;
// Hashline section headers: `[path#TAG]` (TAG = four hex). Capture the path of each section.
const HASHLINE_PATH_RE = /\[([^\]\r\n]+?)#[0-9A-Fa-f]{4}\]/g;

// Narrow the fields we read off a thrown execFileSync error without trusting a shape.
function execErr(e: unknown): { status?: number; stdout: string; code?: string } {
  let status: number | undefined;
  let code: string | undefined;
  let stdout = "";
  if (e && typeof e === "object") {
    if ("status" in e && typeof e.status === "number") status = e.status;
    if ("code" in e && typeof e.code === "string") code = e.code;
    if ("stdout" in e && typeof e.stdout === "string") stdout = e.stdout;
  }
  return { status, stdout, code };
}

// Delegate the commit decision to the bash gate. Returns a block reason, or "" to allow.
// Fails CLOSED (blocks) when the gate binary itself cannot be invoked — a P3 commit must
// never slip through an unconfigured gate (mirrors nhq-p3-guard's "never commit blind").
//
// The delegated `check` derives its caller tier from NHQ_AGENT (it predates NHQ_FLEET). So
// when THIS hook has already concluded the caller is fleet (NHQ_FLEET=1 / fleet session),
// we propagate that by forcing NHQ_AGENT=fleet for the delegated call — otherwise an empty
// NHQ_AGENT would let `check` treat the fleet host as Director and honor an inline token.
function commitBlockReason(cmd: string, repo: string, fleet: boolean): string {
  const env = { ...process.env, VFRAME_P3_OK: TOKEN_RE.test(cmd) ? "1" : "" };
  const agent = (process.env.NHQ_AGENT ?? "").toLowerCase();
  if (fleet && (agent === "" || agent === "director")) env.NHQ_AGENT = "fleet";
  try {
    execFileSync(guardBin(), ["check", repo, "pretooluse"], { env, encoding: "utf8" });
    return ""; // exit 0 ⇒ ALLOW (no protected paths, or Director self-approved)
  } catch (e) {
    const { status, stdout, code } = execErr(e);
    if (status === 1) {
      const matched = stdout
        .split("\n")
        .filter((l) => l && !l.startsWith("P3:") && l.trim() !== "matched:")
        .join(" ")
        .trim();
      const verdict = (stdout.match(/P3:\s*(\S+)/) ?? [])[1] ?? "DENY";
      return `Protocol-3: this git commit is denied (${verdict})${matched ? ` — staged protected path(s): ${matched}` : ""}. Fleet lanes cannot commit auth/payments/PII/audit/security paths; escalate the decision to Yash.`;
    }
    return `Protocol-3 gate could not be evaluated (nhq-p3-guard ${code ?? "failed"}). Failing CLOSED: refusing the commit until the gate is reachable.`;
  }
}

// Ask the bash gate whether ANY of these paths is a protected p3 glob (reuses the exact
// p3_match_file matcher). exit 0 ⇒ protected (prints the match); 1 ⇒ none; 2 ⇒ no policy
// file (fail-closed: treat as protected). Returns the matched path, or "" if none.
function protectedPath(paths: string[]): string {
  if (paths.length === 0) return "";
  try {
    const out = execFileSync(guardBin(), ["match-path", ...paths], { encoding: "utf8" });
    return out.trim();
  } catch (e) {
    const { status, stdout } = execErr(e);
    if (status === 1) return ""; // explicitly none
    if (status === 2) return paths[0]; // no policy file ⇒ fail-closed (treat as protected)
    return stdout.trim() || paths[0]; // unknown failure ⇒ fail-closed
  }
}

function editPaths(input: string): string[] {
  const out: string[] = [];
  for (const m of input.matchAll(HASHLINE_PATH_RE)) out.push(m[1]);
  return out;
}

export default function (pi: HookAPI) {
  pi.on("tool_call", (event, ctx) => {
    const fleet = isFleetCaller();

    if (event.toolName === "bash") {
      const cmd = String(event.input?.command ?? "");
      if (!cmd) return;

      if (fleet && PUSH_RE.test(cmd)) {
        return {
          block: true,
          reason:
            "BLOCKED (BRANCHES ONLY): fleet lanes never `git push`. Commit to your task branch; integration to a remote/main is a human (Director/Yash) step.",
        };
      }
      if (fleet && MERGE_RE.test(cmd)) {
        return {
          block: true,
          reason:
            "BLOCKED (BRANCHES ONLY): fleet lanes never `git merge`. Keep work on your task branch; merges are a human (Director/Yash) step.",
        };
      }
      if (COMMIT_RE.test(cmd)) {
        const repo = (cmd.match(DASH_C_RE) ?? [])[1] ?? ctx?.cwd ?? process.cwd();
        const reason = commitBlockReason(cmd, repo, fleet);
        if (reason) return { block: true, reason: `BLOCKED — ${reason}` };
      }
      return;
    }

    if (event.toolName === "write") {
      const path = String(event.input?.path ?? "");
      if (!path) return;
      const hit = protectedPath([path]);
      if (hit && fleet) {
        return {
          block: true,
          reason: `BLOCKED (Protocol-3): writing the protected path '${hit}' (auth/payments/PII/audit/security). Fleet lanes cannot mutate P3 paths; escalate to Yash.`,
        };
      }
      return;
    }

    if (event.toolName === "edit") {
      const paths = editPaths(String(event.input?.input ?? ""));
      if (paths.length === 0) return;
      const hit = protectedPath(paths);
      if (hit && fleet) {
        return {
          block: true,
          reason: `BLOCKED (Protocol-3): editing the protected path '${hit}' (auth/payments/PII/audit/security). Fleet lanes cannot mutate P3 paths; escalate to Yash.`,
        };
      }
      return;
    }
  });
}
