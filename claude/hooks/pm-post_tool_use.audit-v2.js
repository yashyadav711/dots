#!/usr/bin/env node
/**
 * AUDIT v2 drop-in for  ~/Github/nhq-agentic-os/.claude/hooks/post_tool_use.js
 * (Director's pm-hooks lane — Director applies + commits this on the P4 merge.)
 *
 * Upgrades the v1 audit hook to the P4 contract:
 *   • agent field      — stamps NHQ_AGENT (which fleet agent triggered the call).
 *   • Bash logging     — logs Bash commands (secret-SCRUBBED by nhq-audit; the raw
 *                        value never reaches disk).
 *   • hash-chain       — delegates to `nhq-audit append`, the single source of truth
 *                        for the agent-stamped, hash-chained, scrubbed format.
 *                        Verify with `nhq-audit-verify`.
 *
 * SAFE BY DESIGN: if `nhq-audit` is not yet on PATH (i.e. before the dots P4 branch
 * is merged + symlinked), it falls back to a v1-style inline append so auditing
 * never silently breaks — but it omits the Bash command value in fallback, since
 * only nhq-audit can scrub it.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const LOG_FILE = path.join(process.cwd(), 'ai', 'state', 'audit.jsonl');
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);
const SENSITIVE_PREFIXES = [
  'ai/approvals/',
  'ai/specs/',
  '.claude/',
  'ai/PROJECT_PREFS.md',
  'ai/completed/COMPLETED_LOG.md'
];

let payload;
try {
  payload = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch (_) {
  process.exit(0);
}

const toolName = payload.tool_name || '';
const agent = process.env.NHQ_AGENT || null;
const session = payload.session_id || null;

let entry = null;

if (WRITE_TOOLS.has(toolName)) {
  const file = String((payload.tool_input || {}).file_path || '');
  if (!file) process.exit(0);
  const normalized = file.replace(/\\/g, '/');
  const rel = normalized.includes('/') && path.isAbsolute(normalized)
    ? path.relative(process.cwd(), normalized).replace(/\\/g, '/')
    : normalized;
  const sensitive = SENSITIVE_PREFIXES.find(p => rel.startsWith(p) || rel.includes(p));
  if (!sensitive) process.exit(0);
  entry = { tool: toolName, file: rel, bucket: sensitive, cmd: null };
} else if (toolName === 'Bash') {
  const cmd = String((payload.tool_input || {}).command || '');
  if (!cmd) process.exit(0);
  entry = { tool: 'Bash', file: null, bucket: 'bash', cmd };
} else {
  process.exit(0);
}

function appendViaNhqAudit() {
  const args = ['append', '--tool', entry.tool];
  if (session) args.push('--session', session);
  if (agent) args.push('--agent', agent);
  if (entry.bucket) args.push('--bucket', entry.bucket);
  if (entry.file) args.push('--file', entry.file);
  if (entry.cmd) args.push('--cmd', entry.cmd);
  execFileSync('nhq-audit', args, { stdio: 'ignore' });
}

function appendV1Fallback() {
  // No hash-chain, and never log an unscrubbed Bash command.
  const obj = {
    ts: new Date().toISOString(),
    agent,
    tool: entry.tool,
    file: entry.file,
    bucket: entry.bucket,
    session
  };
  if (entry.cmd) obj.cmd = '[omitted: nhq-audit unavailable to scrub]';
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.appendFileSync(LOG_FILE, JSON.stringify(obj) + '\n');
}

try {
  appendViaNhqAudit();
} catch (_) {
  try { appendV1Fallback(); } catch (_) { /* silent: audit is defense-in-depth */ }
}
