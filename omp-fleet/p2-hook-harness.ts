// p2-hook-harness — hermetic driver for the P2 safety hooks.
//
// The omp hooks are plain factory modules: `export default (pi) => pi.on(event, handler)`.
// This harness imports the real hook files, hands each a fake HookAPI that captures the
// registered handlers, then fires ONE synthetic event per invocation and prints the
// outcome as a single JSON line. That lets `nhq-fleet-p2-selftest` exercise the actual
// hook code paths (and their delegation to nhq-p3-guard / nhq-audit / the dangerous-command
// guard) WITHOUT a live omp/Claude-Max session — true hermetic coverage of the security code.
//
// Usage (scenario selected by argv[2]); identity/paths come from the env the harness sets:
//   node p2-hook-harness.ts p3-commit  <repo>
//   node p2-hook-harness.ts p3-push    <repo>
//   node p2-hook-harness.ts p3-merge   <repo>
//   node p2-hook-harness.ts p3-edit    <path>
//   node p2-hook-harness.ts p3-write   <path>
//   node p2-hook-harness.ts danger     <command>
//   node p2-hook-harness.ts audit-bash <command>
//   node p2-hook-harness.ts audit-edit <path>
//   node p2-hook-harness.ts redact     <text>
//   node p2-hook-harness.ts turn-end

import p3guard from "../omp/agent/hooks/pre/p3-guard.ts";
import dangerguard from "../omp/agent/hooks/pre/dangerous-command-guard.ts";
import audit from "../omp/agent/hooks/post/audit.ts";

interface ToolEvent {
  toolName: string;
  input?: Record<string, unknown>;
  content?: unknown[];
  isError?: boolean;
}
interface HookCtx {
  cwd?: string;
  hasUI: boolean;
  sessionManager: { getSessionFile: () => string };
}
type Handler = (event: ToolEvent, ctx: HookCtx) => unknown;
interface CapturedPi {
  on(event: string, handler: Handler): void;
}
type HookFactory = (pi: CapturedPi) => void;

function capture(factory: HookFactory): Map<string, Handler[]> {
  const handlers = new Map<string, Handler[]>();
  const pi: CapturedPi = {
    on(event, handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
  };
  factory(pi);
  return handlers;
}

function ctx(): HookCtx {
  const repo = process.env.HOOK_CWD || process.cwd();
  const session = process.env.FAKE_SESSION || "";
  return { cwd: repo, hasUI: false, sessionManager: { getSessionFile: () => session } };
}

interface BlockResult {
  block?: boolean;
  reason?: string;
}
function isBlock(r: unknown): r is BlockResult {
  return !!r && typeof r === "object" && "block" in r && r.block === true;
}

async function fireToolCall(handlers: Map<string, Handler[]>, event: ToolEvent): Promise<BlockResult | null> {
  for (const h of handlers.get("tool_call") ?? []) {
    const r = await Promise.resolve(h(event, ctx()));
    if (isBlock(r)) return r;
  }
  return null;
}

interface ContentResult {
  content?: unknown[];
}
function hasContent(r: unknown): r is ContentResult {
  return !!r && typeof r === "object" && "content" in r && Array.isArray(r.content);
}

async function fireToolResult(handlers: Map<string, Handler[]>, event: ToolEvent): Promise<ContentResult | null> {
  let last: ContentResult | null = null;
  for (const h of handlers.get("tool_result") ?? []) {
    const r = await Promise.resolve(h(event, ctx()));
    if (hasContent(r)) last = r;
  }
  return last;
}

async function fireTurnEnd(handlers: Map<string, Handler[]>): Promise<void> {
  for (const h of handlers.get("turn_end") ?? []) await Promise.resolve(h({ toolName: "" }, ctx()));
}

function chunkText(c: unknown): string {
  if (c && typeof c === "object" && "text" in c && typeof c.text === "string") return c.text;
  return "";
}

async function main(): Promise<void> {
  const [, , scenario, arg] = process.argv;
  const p3 = capture(p3guard);
  const danger = capture(dangerguard);
  const aud = capture(audit);

  switch (scenario) {
    case "p3-commit": {
      const r = await fireToolCall(p3, { toolName: "bash", input: { command: `git -C ${arg} commit -m "x"` } });
      console.log(JSON.stringify({ blocked: !!r, reason: r?.reason ?? "" }));
      break;
    }
    case "p3-push": {
      const r = await fireToolCall(p3, { toolName: "bash", input: { command: `git -C ${arg} push origin HEAD` } });
      console.log(JSON.stringify({ blocked: !!r, reason: r?.reason ?? "" }));
      break;
    }
    case "p3-merge": {
      const r = await fireToolCall(p3, { toolName: "bash", input: { command: `git -C ${arg} merge main` } });
      console.log(JSON.stringify({ blocked: !!r, reason: r?.reason ?? "" }));
      break;
    }
    case "p3-commit-token": {
      const r = await fireToolCall(p3, {
        toolName: "bash",
        input: { command: `VFRAME_P3_OK=1 git -C ${arg} commit --no-verify -m "x"` },
      });
      console.log(JSON.stringify({ blocked: !!r, reason: r?.reason ?? "" }));
      break;
    }
    case "p3-edit": {
      const r = await fireToolCall(p3, { toolName: "edit", input: { input: `[${arg}#A1B2]\nSWAP 1.=1:\n+x` } });
      console.log(JSON.stringify({ blocked: !!r, reason: r?.reason ?? "" }));
      break;
    }
    case "p3-write": {
      const r = await fireToolCall(p3, { toolName: "write", input: { path: arg, content: "x" } });
      console.log(JSON.stringify({ blocked: !!r, reason: r?.reason ?? "" }));
      break;
    }
    case "danger": {
      const r = await fireToolCall(danger, { toolName: "bash", input: { command: arg } });
      console.log(JSON.stringify({ blocked: !!r, reason: r?.reason ?? "" }));
      break;
    }
    case "audit-bash": {
      await fireToolResult(aud, { toolName: "bash", input: { command: arg }, content: [], isError: false });
      console.log(JSON.stringify({ appended: true }));
      break;
    }
    case "audit-edit": {
      await fireToolResult(aud, { toolName: "edit", input: { input: `[${arg}#A1B2]\nSWAP 1.=1:\n+x` }, content: [], isError: false });
      console.log(JSON.stringify({ appended: true }));
      break;
    }
    case "redact": {
      const r = await fireToolResult(aud, {
        toolName: "read",
        input: {},
        content: [{ type: "text", text: arg }],
        isError: false,
      });
      const out = r?.content?.map(chunkText).join("") ?? arg;
      console.log(JSON.stringify({ redacted: r !== null, text: out }));
      break;
    }
    case "turn-end": {
      await fireTurnEnd(aud);
      console.log(JSON.stringify({ appended: true }));
      break;
    }
    default:
      console.error(`unknown scenario: ${scenario}`);
      process.exit(2);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(3);
});
