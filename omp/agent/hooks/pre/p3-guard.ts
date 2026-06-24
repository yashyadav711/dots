// omp `tool_call` pre-hook — NHQ Protocol-3 (P3) commit/push/write gate.
//
// Ports NetrunnersHQ's P4 commit gate to omp's hook surface so that an omp fleet
// worker is governed by the SAME Protocol-3 policy it was under Claude Code. It does
// NOT re-implement the policy: every decision is delegated to the hardened bash gate
//   ~/Github/dots/bin/nhq-p3-guard   (`check` + `match-path` subcommands)
// which owns the p3-paths.json glob set and the D4 caller-tier rule. One source of
// truth — fix the policy once in the bash script, this hook inherits it. Zero drift.
//
// What it gates (the `tool_call` events a fleet worker can issue) — this is the EARLY signal
// layer; the HARD controls live OUT-OF-BAND in the driver (a `.git/hooks/pre-commit` backstop
// that runs on the real staged set, and a stripped push remote), so a detection miss here is
// non-fatal:
//   • bash `git commit …`  → the git SUBCOMMAND is detected ROBUSTLY (normalized for
//     `command`, absolute `/usr/bin/git`, `${IFS}`, `sh -c '…'`/`eval`, leading-newline, and
//     inline-env / `env`-wrapper prefixes — P2-03) and delegated to `nhq-p3-guard check`. For
//     a FLEET lane the EFFECTIVE commit set is evaluated (cached ∪ tracked working-tree changes
//     vs HEAD), so `commit -a` / `commit <pathspec>` — which stage only when git runs (P2-02
//     TOCTOU) — are caught here too, and a fleet `--no-verify` (which would skip the pre-commit
//     backstop) is refused. Director may self-approve inline with `VFRAME_P3_OK=1`.
//   • bash `git push` / `git merge`  → BRANCHES-ONLY: a fleet lane is HARD-blocked (robust
//     subcommand detection — P2-01). The driver ALSO strips the push remote out-of-band so a
//     push is impossible regardless of phrasing. Fleet `git remote`/`git config` mutations that
//     would re-arm push or disable a hook (remote url / pushurl / core.hooksPath) are blocked.
//   • edit / write / ast_edit on a p3-paths.json glob → omp-side hardening: catch the
//     protected-path MUTATION before it is staged. Fleet HARD-blocked; Director allowed (P2-04).
//
// LIMIT (P2-04, by design): a bash file write (`sed -i`, `printf >`, `tee`, `python -c`) to a
// protected path CANNOT be path-gated here — it is opaque shell. The HARD control for those is
// the commit-gate backstop: the pre-commit hook re-evaluates the real staged set post-staging.
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

// ── git command normalization (P2-01 / P2-03) ────────────────────────────────
// Robust subcommand detection, NOT a single mega-regex: we find the git SUBCOMMAND invoked
// anywhere in the (recursively unwrapped) command. This defeats the reviewed evasions —
// `command git push`, `/usr/bin/git push`, `git${IFS}push`, `sh -c 'git push'`, `eval '…'`, a
// leading-newline segment, and inline-env / `env`-wrapper prefixes. It is the EARLY signal; the
// HARD controls are the driver-installed pre-commit backstop + the stripped push remote.
const TOKEN_RE = /(?:^|\s)VFRAME_P3_OK=1(?:\s|$)/;
const DASH_C_RE = /\bgit\s+(?:-[^\s]+\s+)*-C\s+([^\s]+)/;
// Hashline section headers: `[path#TAG]` (TAG = four hex). Capture the path of each section.
const HASHLINE_PATH_RE = /\[([^\]\r\n]+?)#[0-9A-Fa-f]{4}\]/g;

const IFS_RE = /\$\{IFS[^}]*\}|\$IFS\b/g;            // ${IFS}, ${IFS%??}, $IFS → a separator
const SEG_RE = /[\n;&|()`]+/;                         // shell command-segment boundaries
const ENV_ASSIGN_RE = /^[A-Za-z_]\w*=/;               // VAR=val command-position prefix
const RUNNER_PREFIX = new Set(["sudo", "command", "exec", "builtin", "nohup", "time"]);
const ENV_ARG_FLAGS = new Set(["-u", "--unset", "-C", "--chdir", "-S", "--split-string"]);
const GIT_ARG_OPTS = new Set(["-C", "--git-dir", "--work-tree", "-c", "--namespace", "--exec-path", "--super-prefix"]);
// `sh -c '…'` / `bash -c "…"` / `eval '…'` — capture the quoted payload to re-scan.
const INTERP_RE = /(?:^|[\s;&|(`])(?:eval|(?:[^\s'"]*\/)?(?:sh|bash|zsh|dash|ksh|ash))(?:\s+-[A-Za-z]+)*\s+(['"])([\s\S]*?)\1/g;

function basenameOf(t: string): string {
  const i = t.lastIndexOf("/");
  return i >= 0 ? t.slice(i + 1) : t;
}

// The git subcommand invoked by ONE already-segmented simple command (or "").
function segGitSub(seg: string): string {
  const tok = seg.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tok.length) {
    const t = tok[i];
    if (ENV_ASSIGN_RE.test(t)) { i++; continue; }     // VAR=val
    const b = basenameOf(t);
    if (RUNNER_PREFIX.has(b)) { i++; continue; }       // sudo/command/exec/builtin/…
    if (b === "env") {                                 // env [opts] [VAR=val] …
      i++;
      while (i < tok.length) {
        const a = tok[i];
        if (ENV_ASSIGN_RE.test(a)) { i++; continue; }
        if (ENV_ARG_FLAGS.has(a)) { i += 2; continue; } // arg-taking flag swallows its value
        if (a.startsWith("-")) { i++; continue; }
        break;
      }
      continue;
    }
    break;
  }
  if (i >= tok.length || basenameOf(tok[i]) !== "git") return "";  // matches /usr/bin/git too
  i++;
  while (i < tok.length) {                             // skip git GLOBAL options to the subcommand
    const o = tok[i];
    if (GIT_ARG_OPTS.has(o)) { i += 2; continue; }     // -C dir, -c k=v, --git-dir d, …
    if (o.startsWith("-")) { i++; continue; }          // -p, --no-pager, --bare, …
    break;
  }
  return i < tok.length ? tok[i] : "";
}

// All git subcommands invoked anywhere in `cmd`, after unwrapping ${IFS} and interpreter
// (`sh -c '…'` / `eval '…'`) payloads. Bounded recursion defeats nested wrappers.
function gitSubcommands(cmd: string, depth = 0): Set<string> {
  const found = new Set<string>();
  if (depth > 6 || !cmd) return found;
  const s = cmd.replace(IFS_RE, " ");
  for (const seg of s.split(SEG_RE)) {
    const sub = segGitSub(seg);
    if (sub) found.add(sub);
  }
  INTERP_RE.lastIndex = 0;
  for (const m of s.matchAll(INTERP_RE)) {
    for (const sub of gitSubcommands(m[2], depth + 1)) found.add(sub);
  }
  return found;
}

// A fleet `--no-verify` (or `-n` / clustered `-an`) on a commit would SKIP the pre-commit
// backstop — refuse it from fleet lanes.
function commitHasNoVerify(cmd: string): boolean {
  const s = cmd.replace(IFS_RE, " ");
  if (/(?:^|\s)--no-verify(?:\s|$)/.test(s)) return true;
  for (const t of s.split(/\s+/)) if (/^-[A-Za-z]*n[A-Za-z]*$/.test(t)) return true;
  return false;
}

// A fleet git command that would re-arm push or disable a backstop hook (defends the driver's
// out-of-band controls): `git remote add/set-url/…` or `git config …(pushurl|url|hooksPath)`.
function tampersWithGuards(cmd: string, subs: Set<string>): boolean {
  const s = cmd.replace(IFS_RE, " ");
  if (subs.has("remote") && /\bremote\s+(?:-[A-Za-z]+\s+)*(?:add|set-url|set-head|set-branches|rm|remove|rename|prune|update)\b/.test(s)) return true;
  if (subs.has("config") && /(?:core\.)?hooksPath|\.pushurl\b|\.url\b|pushurl/i.test(s)) return true;
  return false;
}

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
// Fails CLOSED (blocks) when the gate binary itself cannot be invoked. When `effective` is set
// (fleet lanes) the gate evaluates the EFFECTIVE commit set (cached ∪ tracked working-tree
// changes vs HEAD) so `-a`/pathspec commits are caught at PreToolUse time too.
function commitBlockReason(cmd: string, repo: string, fleet: boolean, effective: boolean): string {
  const env = { ...process.env, VFRAME_P3_OK: TOKEN_RE.test(cmd) ? "1" : "" };
  const agent = (process.env.NHQ_AGENT ?? "").toLowerCase();
  if (fleet && (agent === "" || agent === "director")) env.NHQ_AGENT = "fleet";
  if (effective) env.NHQ_P3_EFFECTIVE = "1";
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
      return `Protocol-3: this git commit is denied (${verdict})${matched ? ` — protected path(s): ${matched}` : ""}. Fleet lanes cannot commit auth/payments/PII/audit/security paths; escalate the decision to Yash.`;
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
      const subs = gitSubcommands(cmd);

      if (fleet && (subs.has("push") || subs.has("merge"))) {
        const what = subs.has("push") ? "push" : "merge";
        return {
          block: true,
          reason:
            `BLOCKED (BRANCHES ONLY): fleet lanes never \`git ${what}\`. Commit to your task ` +
            `branch; integration to a remote/main is a human (Director/Yash) step. The push ` +
            `remote is also stripped out-of-band, so this is impossible regardless of phrasing.`,
        };
      }
      if (fleet && tampersWithGuards(cmd, subs)) {
        return {
          block: true,
          reason:
            "BLOCKED (Protocol-3): fleet lanes cannot reconfigure git remotes or hooks " +
            "(remote url / pushurl / core.hooksPath) — that would re-arm push or disable the " +
            "pre-commit backstop. Escalate to Yash.",
        };
      }
      if (subs.has("commit")) {
        if (fleet && commitHasNoVerify(cmd)) {
          return {
            block: true,
            reason:
              "BLOCKED (Protocol-3): fleet lanes cannot `git commit --no-verify` — that would " +
              "skip the pre-commit P3 backstop. Commit normally; a protected-path commit is a " +
              "human (Director/Yash) decision.",
          };
        }
        const repo = (cmd.match(DASH_C_RE) ?? [])[1] ?? ctx?.cwd ?? process.cwd();
        // Fleet lanes get the EFFECTIVE-set evaluation (defeats the -a/pathspec TOCTOU).
        const reason = commitBlockReason(cmd, repo, fleet, fleet);
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

    // P2-04: ast_edit is a first-class mutating tool — gate its resolved target paths too.
    if (event.toolName === "ast_edit") {
      const raw = event.input?.paths;
      const paths = Array.isArray(raw) ? raw.map((p) => String(p)) : [];
      if (paths.length === 0) return;
      const hit = protectedPath(paths);
      if (hit && fleet) {
        return {
          block: true,
          reason: `BLOCKED (Protocol-3): ast_edit on the protected path '${hit}' (auth/payments/PII/audit/security). Fleet lanes cannot mutate P3 paths; escalate to Yash.`,
        };
      }
      return;
    }
  });
}
