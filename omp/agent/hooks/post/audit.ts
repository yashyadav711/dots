// omp `tool_result` / `turn_end` post-hook — NHQ audit feed + secret redaction.
//
// The omp analogue of Claude Code's `pm-post_tool_use.audit-v2.js`: it feeds the SAME
// hash-chained, agent-stamped, secret-scrubbed audit.jsonl that governance already trusts,
// by delegating every append to the single source of truth
//   ~/Github/dots/bin/nhq-audit append …
// (which scrubs the command, computes the chain hash, and locks the append window). This
// hook NEVER re-implements the chain format — it only decides WHAT to record and stamps WHO.
//
// Two jobs, both on the post-execution surface:
//   1. AUDIT  — every mutating tool call (bash command, edit, write) appends one chained,
//      agent-stamped line. A `turn_end` marker delimits each agent turn in the chain.
//   2. REDACT — secret-looking values in tool OUTPUT are masked before the model sees them.
//      ADVISORY / best-effort ONLY — NOT a security control (P2-07): it is trivially evadable
//      (split across chunks, isError results, non-text chunks, custom encodings). It reduces
//      accidental key leakage into context; it does NOT defend against a motivated worker.
//
// Agent stamp: the omp session/agent id (the canonical per-session identity, derived from
// the active session file), falling back to the driver-injected NHQ_AGENT lane name, then
// "omp". `nhq-audit verify` proves no edit/delete/reorder of the produced chain.
//
// Load: ~/.omp/agent/hooks/post/ (global) or --hook. INERT until installed.

import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";
import { execFileSync } from "node:child_process";
import { connect } from "node:net";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";

function auditBin(): string {
  const override = process.env.NHQ_AUDIT_BIN;
  if (override) return override;
  const local = join(homedir(), ".local/bin/nhq-audit");
  if (existsSync(local)) return local;
  return join(homedir(), "Github/dots/bin/nhq-audit");
}

// The omp session/agent id stamps the audit line. The session file basename is the canonical
// per-session identity (== the `agent://<id>` id for a subagent); fall back to the lane name.
function agentStamp(ctx: unknown): string {
  if (ctx && typeof ctx === "object" && "sessionManager" in ctx) {
    const sm = ctx.sessionManager;
    if (sm && typeof sm === "object" && "getSessionFile" in sm) {
      const getter = sm.getSessionFile;
      if (typeof getter === "function") {
        const file = getter.call(sm);
        if (typeof file === "string" && file) return basename(file).replace(/\.jsonl?$/, "");
      }
    }
  }
  return process.env.NHQ_AGENT ?? "omp";
}

// Hashline section headers: `[path#TAG]` (TAG = four hex). Capture each section's path.
const HASHLINE_PATH_RE = /\[([^\]\r\n]+?)#[0-9A-Fa-f]{4}\]/g;
function firstEditPath(input: string): string {
  const m = HASHLINE_PATH_RE.exec(input);
  HASHLINE_PATH_RE.lastIndex = 0;
  return m ? m[1] : "";
}

interface AuditArgs {
  tool: string;
  agent: string;
  bucket?: string;
  file?: string;
  cmd?: string;
  session?: string;
}

// P2-05: the HMAC key that makes the chain unforgeable lives in the nhq-omp-driver process,
// NOT in this host's env (the worker bash inherits the host env). So when a driver is present
// we ROUTE the append to its socket sink: the driver stamps the lane identity (ignoring any
// agent we pass) and HMAC-keys the line with its key. Standalone (Claude-Code / no driver) we
// append directly to an UNKEYED chain — unchanged behavior. Both paths are best-effort.
function driverSock(): string {
  const explicit = process.env.NHQ_OMP_SOCK;
  if (explicit) return explicit;
  const home = process.env.NHQ_OMP_HOME || join(homedir(), ".nhq-omp");
  return join(home, "driver.sock");
}

function appendDirect(a: AuditArgs): void {
  const args = ["append", "--tool", a.tool, "--agent", a.agent];
  if (a.session) args.push("--session", a.session);
  if (a.bucket) args.push("--bucket", a.bucket);
  if (a.file) args.push("--file", a.file);
  if (a.cmd) args.push("--cmd", a.cmd);
  try {
    execFileSync(auditBin(), args, { stdio: "ignore", timeout: 5000 });
  } catch {
    /* defense-in-depth: a broken audit binary must not break the agent loop */
  }
}

// Best-effort, never-throwing append. Routes through the driver's keyed sink when present.
function appendAudit(a: AuditArgs): void {
  const sock = driverSock();
  if (existsSync(sock)) {
    try {
      const c = connect(sock);
      let routed = false;
      c.on("error", () => {
        try { c.destroy(); } catch { /* */ }
        if (!routed) appendDirect(a); // stale socket / dead daemon → don't lose the line
      });
      c.on("connect", () => {
        routed = true;
        try {
          c.write(JSON.stringify({ cmd: "audit", tool: a.tool, bucket: a.bucket, file: a.file, acmd: a.cmd }) + "\n");
          c.end();
        } catch { /* best-effort */ }
      });
      return;
    } catch {
      /* fall through to a direct append */
    }
  }
  appendDirect(a);
}

// ── secret redaction (tool OUTPUT) — ADVISORY / defense-in-depth ONLY (P2-07) ─────────────
// Mask common credential shapes so a tool result does not ACCIDENTALLY carry a live secret
// into context. This is NOT a security control: it is best-effort and trivially evadable.
const SECRET_PATTERNS: RegExp[] = [
  /\bsk-ant-[A-Za-z0-9_-]{16,}/g, // Anthropic
  /\b(?:sk|pk)-[A-Za-z0-9]{20,}/g, // OpenAI / Stripe
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g, // GitHub fine-grained PAT
  /\bAKIA[A-Z0-9]{16}\b/g, // AWS access key id
  /\bAIza[A-Za-z0-9_-]{20,}/g, // Google API key
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
];
const KV_SECRET_RE =
  /\b([A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|APIKEY|API_KEY|PRIVATE_KEY)[A-Za-z0-9_]*)(\s*[=:]\s*)["']?[^\s"']+/gi;
const BEARER_RE = /\b(Bearer\s+)[A-Za-z0-9._-]+/gi;

function redactText(text: string): string {
  let out = text;
  for (const p of SECRET_PATTERNS) out = out.replace(p, "[REDACTED]");
  out = out.replace(KV_SECRET_RE, (_m, key: string, sep: string) => `${key}${sep}[REDACTED]`);
  out = out.replace(BEARER_RE, (_m, pre: string) => `${pre}[REDACTED]`);
  return out;
}

interface TextChunk {
  type: string;
  text: string;
}
function isTextChunk(c: unknown): c is TextChunk {
  return !!c && typeof c === "object" && "type" in c && c.type === "text" && "text" in c && typeof c.text === "string";
}

export default function (pi: HookAPI) {
  pi.on("tool_result", (event, ctx) => {
    const agent = agentStamp(ctx);
    const session = agent;
    const tool = event.toolName;

    // 1. AUDIT the mutating tool calls.
    if (tool === "bash") {
      const cmd = String(event.input?.command ?? "");
      if (cmd) appendAudit({ tool: "bash", agent, session, bucket: "bash", cmd });
    } else if (tool === "write") {
      const file = String(event.input?.path ?? "");
      if (file) appendAudit({ tool: "write", agent, session, bucket: "write", file });
    } else if (tool === "edit") {
      const file = firstEditPath(String(event.input?.input ?? ""));
      if (file) appendAudit({ tool: "edit", agent, session, bucket: "write", file });
    } else if (tool === "ast_edit") {
      // P2-04: ast_edit is a first-class mutating tool — audit its target paths too.
      const raw = event.input?.paths;
      const file = Array.isArray(raw) && raw.length ? String(raw[0]) : "";
      if (file) appendAudit({ tool: "ast_edit", agent, session, bucket: "write", file });
    }

    // 2. REDACT secrets from successful tool output before the model sees it.
    if (event.isError) return;
    const content = event.content;
    if (!Array.isArray(content)) return;
    let changed = false;
    const redacted = content.map((chunk) => {
      if (!isTextChunk(chunk)) return chunk;
      const next = redactText(chunk.text);
      if (next !== chunk.text) changed = true;
      return { ...chunk, text: next };
    });
    if (changed) return { content: redacted };
  });

  // A turn-boundary marker keeps the chain delimited per agent turn (governance signal).
  pi.on("turn_end", (_event, ctx) => {
    const agent = agentStamp(ctx);
    appendAudit({ tool: "turn", agent, session: agent, bucket: "turn-end" });
  });
}
