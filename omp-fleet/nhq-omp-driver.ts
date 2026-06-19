#!/usr/bin/env -S node --no-warnings
// ─────────────────────────────────────────────────────────────────────────────
// nhq-omp-driver — the NHQ Fleet v1 host controller (Phase P1).
//
// Architecture (locked decisions F1–F4, see kernel/BUILD-BLUEPRINTS-v1-omp.md):
//   F1  ONE persistent omp fleet-host process (`omp --mode rpc`); workers are
//       native `task` subagents inside it. This driver is a small daemon that
//       owns that host and exposes spawn/status/kill/observe over a unix socket.
//   F2  branch-only write-isolation + a driver lane-mutex: spawns are serialized
//       through the host (RPC default async is OFF → `task` runs synchronously,
//       one host turn at a time), which IS the per-repo single-writer mutex.
//   F3  this small Bun/TS driver over omp RPC; the bash front-door stays thin.
//   F4  single-credential: the host runs on the one Claude Max OAuth.
//
// HARD RULE (omp-P0 KNOWN GAP): the RPC `{type:"bash"}` / `abort_bash` commands
// run driver-side and bypass the agent `tool_call` guard hook. This driver MUST
// NEVER emit such a frame — ALL worker shell goes through the agent's gated
// `bash` TOOL. Enforced by `assertSendableFrame()` on the single send path.
//
// Runtime: idiomatic Bun/TS, but uses only cross-runtime APIs so it also runs on
// node (the bash launcher prefers `bun`, falls back to `node`).
// ─────────────────────────────────────────────────────────────────────────────

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import * as net from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ── Paths & config (all overridable for hermetic tests) ──────────────────────
const HOME = os.homedir();
const OMP_BIN = process.env.OMP_BIN || path.join(HOME, ".local/bin/omp");
const DRIVER_FILE = fileURLToPathSafe(import.meta.url);
const OMP_HOME = process.env.NHQ_OMP_HOME || path.join(HOME, ".nhq-omp");
const SOCK = process.env.NHQ_OMP_SOCK || path.join(OMP_HOME, "driver.sock");
const PIDFILE = path.join(OMP_HOME, "driver.pid");
const HOSTLOG = path.join(OMP_HOME, "host.log");
const DAEMONLOG = path.join(OMP_HOME, "daemon.log");
const REGISTRY =
  process.env.NHQ_REGISTRY ||
  path.join(path.dirname(DRIVER_FILE), "..", "bin", "fleet-registry.json");
const LEDGER =
  process.env.NHQ_LEDGER || path.join(HOME, "Github/nhq-agentic-os/ai/task-ledger.md");
const NOTIFY = process.env.NHQ_NOTIFY || path.join(HOME, ".local/bin/nhq-notify");

// ── The omp-P0 hard rule: RPC frame types the driver must NEVER emit ─────────
const FORBIDDEN_RPC_TYPES = new Set(["bash", "abort_bash"]);

export class DriverBashFrameError extends Error {
  constructor(type: string) {
    super(
      `omp-P0 GUARD: refused to emit RPC frame {type:"${type}"} — it runs ` +
        `driver-side and bypasses the tool_call guard hook. All worker shell ` +
        `MUST go through the agent's gated bash TOOL, never the RPC bash command.`,
    );
    this.name = "DriverBashFrameError";
  }
}

/** The single lint/guard the spec mandates: every host-bound frame passes here. */
export function assertSendableFrame(frame: { type?: unknown }): void {
  if (typeof frame?.type === "string" && FORBIDDEN_RPC_TYPES.has(frame.type)) {
    throw new DriverBashFrameError(frame.type);
  }
}

function fileURLToPathSafe(u: string): string {
  try {
    return new URL(u).pathname;
  } catch {
    return u;
  }
}

// ── small types ──────────────────────────────────────────────────────────────
interface RegistryAgent {
  name: string;
  repo: string;
  model?: string;
  role?: string;
  tools?: string[];
  agent_file?: string;
  aliases?: string[];
}
interface FleetResult {
  status: "done" | "blocked" | string;
  summary?: string;
  branch?: string;
  need?: string;
}
interface SpawnOutcome {
  ok: boolean;
  lane: string;
  agentId?: string;
  status?: string;
  summary?: string;
  branch?: string;
  need?: string;
  agentUrl?: string;
  resultPath?: string;
  tokens?: number;
  cost?: number;
  durationMs?: number;
  ledgerRow?: string;
  error?: string;
}

// ── registry ─────────────────────────────────────────────────────────────────
function loadRegistry(): Record<string, RegistryAgent> {
  const raw = JSON.parse(fs.readFileSync(REGISTRY, "utf8"));
  return raw.agents || {};
}
function resolveLane(lane: string): { key: string; agent: RegistryAgent } {
  const agents = loadRegistry();
  if (agents[lane]) return { key: lane, agent: agents[lane] };
  for (const [key, a] of Object.entries(agents)) {
    if (a.aliases?.includes(lane)) return { key, agent: a };
  }
  throw new Error(`unknown lane "${lane}" (not a key or alias in ${REGISTRY})`);
}
function resolveRepo(repo: string): string {
  return path.isAbsolute(repo) ? repo : path.join(HOME, repo);
}

// ── ledger writer (the surviving nhq-done behaviour; newest-first) ───────────
function san(s: string | undefined): string {
  return String(s ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\|/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}
function buildLedgerRow(o: {
  task: string;
  lane: string;
  name: string;
  model: string;
  durationMs?: number;
  tokens?: number;
  cost?: number;
  status: string;
  branch?: string;
  summary?: string;
}): string {
  const when = new Date()
    .toISOString()
    .slice(5, 10)
    .replace("-", "-"); // MM-DD
  const mins = o.durationMs ? Math.max(0, Math.round(o.durationMs / 60000)) : 0;
  const dur = o.durationMs
    ? mins >= 60
      ? `~${Math.floor(mins / 60)}h ${mins % 60}m`
      : `~${mins}m`
    : "—";
  const tok = o.tokens != null ? `${o.tokens} tok` : "— tok";
  const cost = o.cost != null ? `$${o.cost.toFixed(4)}` : "$—";
  const statusCell =
    o.status === "done" ? "✅ done" : o.status === "blocked" ? "🛑 blocked" : `🟡 ${o.status}`;
  const result = `${o.branch || "—"} · ${san(o.summary).slice(0, 200)}`;
  return (
    `| ${when} | ${san(o.task)} | relay | ${o.lane} | Director | ${san(o.name)} (fleet) | ` +
    `${san(o.model)} | ${dur} | ${tok} · ${cost} | ${statusCell} | agent-only | ${san(result)} |`
  );
}
/** Insert a row newest-first, mirroring nhq-done's awk logic exactly. */
function appendLedgerRow(row: string): void {
  if (!fs.existsSync(LEDGER)) {
    fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
    fs.writeFileSync(LEDGER, row + "\n");
    return;
  }
  const lines = fs.readFileSync(LEDGER, "utf8").split("\n");
  const firstRowIdx = lines.findIndex((l) => l.startsWith("| "));
  if (firstRowIdx >= 0) {
    lines.splice(firstRowIdx, 0, row);
  } else {
    const ledgerHdr = lines.findIndex((l) => l.startsWith("## Ledger"));
    if (ledgerHdr >= 0) lines.splice(ledgerHdr + 1, 0, "", row);
    else lines.push(row);
  }
  fs.writeFileSync(LEDGER, lines.join("\n"));
}
function fireNotify(type: string, title: string, body: string): void {
  try {
    if (!fs.existsSync(NOTIFY)) return;
    const c = spawn(NOTIFY, [type, title, body], { stdio: "ignore" });
    c.on("error", () => {});
    c.unref();
  } catch {
    /* notify is best-effort; never fail the callback */
  }
}

// ── RPC frame plumbing ───────────────────────────────────────────────────────
type Frame = Record<string, unknown> & { type?: string };
type FrameHandler = (f: Frame) => void;

// ── The fleet host: owns the `omp --mode rpc` child ──────────────────────────
class FleetHost {
  proc: ChildProcessWithoutNullStreams | null = null;
  cwd: string | null = null;
  sessionFile: string | null = null;
  model = "";
  #reqSeq = 0;
  #pending = new Map<string, { resolve: (f: Frame) => void }>();
  #handlers = new Set<FrameHandler>();

  isRunning(): boolean {
    return this.proc != null && this.proc.exitCode == null;
  }

  onFrame(h: FrameHandler): void {
    this.#handlers.add(h);
  }

  /** The ONLY path to stdin. Guards the omp-P0 forbidden frames. */
  send(frame: Frame): void {
    assertSendableFrame(frame);
    if (!this.proc) throw new Error("host not running");
    this.proc.stdin.write(JSON.stringify(frame) + "\n");
  }

  /** Send a command and await its correlated `response` frame. */
  async request(frame: Frame): Promise<Frame> {
    assertSendableFrame(frame);
    const id = `drv_${++this.#reqSeq}`;
    const { promise, resolve } = Promise.withResolvers<Frame>();
    this.#pending.set(id, { resolve });
    this.send({ ...frame, id });
    return promise;
  }

  async launch(cwd: string): Promise<void> {
    if (this.isRunning()) return;
    fs.mkdirSync(OMP_HOME, { recursive: true });
    const log = fs.openSync(HOSTLOG, "a");
    // Default: omp's own ~/.omp/agent/sessions (Director can inspect transcripts).
    // NHQ_OMP_SESSION_DIR redirects sessions+artifacts (used by the hermetic harness
    // to avoid littering the real agent home; auth/profile are untouched).
    const sessionDir = process.env.NHQ_OMP_SESSION_DIR;
    const ompArgs = ["--mode", "rpc", "--cwd", cwd, "--no-title"];
    if (sessionDir) ompArgs.push("--session-dir", sessionDir);
    const child = spawn(OMP_BIN, ompArgs, {
      stdio: ["pipe", "pipe", log],
      env: process.env,
    }) as ChildProcessWithoutNullStreams;
    this.proc = child;
    this.cwd = cwd;

    const ready = Promise.withResolvers<void>();
    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      let f: Frame;
      try {
        f = JSON.parse(line) as Frame;
      } catch {
        return;
      }
      if (f.type === "ready") ready.resolve();
      if (f.type === "response" && typeof f.id === "string") {
        const p = this.#pending.get(f.id);
        if (p) {
          this.#pending.delete(f.id);
          p.resolve(f);
        }
      }
      for (const h of this.#handlers) {
        try {
          h(f);
        } catch (e) {
          process.stderr.write(`frame handler error: ${(e as Error).message}\n`);
        }
      }
    });
    child.on("exit", () => {
      this.proc = null;
      this.cwd = null;
      this.sessionFile = null;
    });

    const timeout = setTimeout(() => ready.reject(new Error("omp host did not become ready in 30s")), 30000);
    try {
      await ready.promise;
    } finally {
      clearTimeout(timeout);
    }
    // Observe subagents; learn our session file (artifacts root).
    await this.request({ type: "set_subagent_subscription", level: "events" });
    const st = await this.request({ type: "get_state" });
    const data = (st.data || {}) as Record<string, unknown>;
    this.sessionFile = (data.sessionFile as string) || null;
    const m = data.model as { id?: string; name?: string } | undefined;
    this.model = m?.name || m?.id || "";
  }

  async shutdown(): Promise<void> {
    if (!this.proc) return;
    try {
      this.proc.stdin.end(); // stdin close → omp exits 0
    } catch {
      /* ignore */
    }
    const done = Promise.withResolvers<void>();
    const t = setTimeout(() => {
      try {
        this.proc?.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      done.resolve();
    }, 3000);
    this.proc.once("exit", () => {
      clearTimeout(t);
      done.resolve();
    });
    await done.promise;
  }
}

// ── live per-lane progress (the observe path) ────────────────────────────────
interface LaneState {
  lane: string;
  agentId?: string;
  repo: string;
  status: "spawning" | "running" | "completed" | "blocked" | "aborted" | "failed";
  tokens?: number;
  cost?: number;
  durationMs?: number;
  recentTool?: string;
  startedAt: number;
}

// ── The daemon: socket server + spawn orchestration ──────────────────────────
class Daemon {
  host = new FleetHost();
  lanes = new Map<string, LaneState>(); // by agentId
  #queue: Array<() => Promise<void>> = [];
  #busy = false;
  // The spawn currently mid-flight (host runs one turn at a time → sync mutex).
  #active: {
    lane: string;
    repo: string;
    task: string;
    name: string;
    model: string;
    agentId?: string;
    sessionFile?: string;
    yieldData?: FleetResult;
    finalProgress?: { tokens?: number; cost?: number; durationMs?: number };
    actualModel?: string;
    resolve: (o: SpawnOutcome) => void;
    settled: boolean;
  } | null = null;

  log(msg: string): void {
    try {
      fs.appendFileSync(DAEMONLOG, `${new Date().toISOString()} ${msg}\n`);
    } catch {
      /* ignore */
    }
  }

  routeFrame = (f: Frame): void => {
    const a = this.#active;
    if (f.type === "subagent_lifecycle") {
      const p = (f.payload || {}) as Record<string, unknown>;
      const id = p.id as string;
      const status = p.status as string;
      const sessionFile = p.sessionFile as string | undefined;
      if (a && status === "started" && !a.agentId) {
        a.agentId = id;
        a.sessionFile = sessionFile;
        const ls: LaneState = {
          lane: a.lane,
          agentId: id,
          repo: a.repo,
          status: "running",
          startedAt: Date.now(),
        };
        this.lanes.set(id, ls);
        this.log(`bound subagent ${id} → lane ${a.lane}`);
      }
      if (a && a.agentId === id && (status === "completed" || status === "aborted" || status === "failed")) {
        if (sessionFile) a.sessionFile = sessionFile;
        const ls = this.lanes.get(id);
        if (ls) ls.status = status as LaneState["status"];
        this.finalizeActive(status);
      }
    } else if (f.type === "subagent_progress") {
      const p = ((f.payload || {}) as Record<string, unknown>).progress as
        | Record<string, unknown>
        | undefined;
      if (p && a && a.agentId === (p.id as string)) {
        a.finalProgress = {
          tokens: p.tokens as number,
          cost: p.cost as number,
          durationMs: p.durationMs as number,
        };
        const mo = p.modelOverride as string[] | undefined;
        if (mo?.length) a.actualModel = mo[0];
        const ls = this.lanes.get(a.agentId);
        if (ls) {
          ls.tokens = p.tokens as number;
          ls.cost = p.cost as number;
          ls.durationMs = p.durationMs as number;
          const rt = (p.recentTools as Array<{ tool?: string }> | undefined)?.slice(-1)[0];
          if (rt?.tool) ls.recentTool = rt.tool;
        }
      }
    } else if (f.type === "subagent_event") {
      // Capture the typed yield directly from the event stream as a fallback to
      // reading agent://<id>.md from disk.
      const p = (f.payload || {}) as Record<string, unknown>;
      const ev = (p.event || {}) as Record<string, unknown>;
      if (
        a &&
        a.agentId === (p.id as string) &&
        ev.type === "tool_execution_end" &&
        ev.toolName === "yield"
      ) {
        const details = (ev.result as Record<string, unknown> | undefined)?.details as
          | Record<string, unknown>
          | undefined;
        if (details?.data) a.yieldData = details.data as FleetResult;
      }
    } else if (f.type === "agent_end") {
      // Backstop: host turn finished but no subagent ever bound → dispatch failed.
      if (a && !a.agentId && !a.settled) {
        this.finalizeActive("failed");
      }
    }
  };

  /** Read agent://<id> (the typed, schema-validated result) authoritatively. */
  readAgentResult(sessionFile?: string, fallback?: FleetResult): { url?: string; data?: FleetResult } {
    if (sessionFile) {
      const md = sessionFile.replace(/\.jsonl$/, ".md");
      try {
        const txt = fs.readFileSync(md, "utf8").trim();
        return { url: md, data: JSON.parse(txt) as FleetResult };
      } catch {
        /* fall through to the event-stream capture */
      }
    }
    return { url: sessionFile?.replace(/\.jsonl$/, ".md"), data: fallback };
  }

  finalizeActive(lifecycleStatus: string): void {
    const a = this.#active;
    if (!a || a.settled) return;
    a.settled = true;
    const { url, data } = this.readAgentResult(a.sessionFile, a.yieldData);
    const status = (data?.status as string) || (lifecycleStatus === "completed" ? "done" : lifecycleStatus);
    const fp = a.finalProgress || {};
    const row = buildLedgerRow({
      task: a.task,
      lane: a.lane,
      name: a.name,
      model: a.actualModel || a.model || this.host.model,
      durationMs: fp.durationMs,
      tokens: fp.tokens,
      cost: fp.cost,
      status,
      branch: data?.branch,
      summary: data?.summary || (lifecycleStatus !== "completed" ? `(${lifecycleStatus})` : ""),
    });
    let ledgerErr: string | undefined;
    try {
      appendLedgerRow(row);
    } catch (e) {
      ledgerErr = (e as Error).message;
    }
    // Toast (KEEP nhq-notify): done / needs-you depending on the typed status.
    if (status === "done") fireNotify("done", `Fleet: ${a.lane} finished`, (data?.summary || "").slice(0, 140));
    else if (status === "blocked")
      fireNotify("needs-you", `🔴 Fleet: ${a.lane} blocked`, (data?.need || data?.summary || "").slice(0, 140));
    else fireNotify("warden", `⚠️ Fleet: ${a.lane} ${status}`, (data?.summary || lifecycleStatus).slice(0, 140));

    this.log(`finalize lane=${a.lane} id=${a.agentId} status=${status} ledger=${ledgerErr ? "ERR:" + ledgerErr : "ok"}`);
    a.resolve({
      ok: status === "done" || status === "blocked",
      lane: a.lane,
      agentId: a.agentId,
      status,
      summary: data?.summary,
      branch: data?.branch,
      need: data?.need,
      agentUrl: a.agentId ? `agent://${a.agentId}` : undefined,
      resultPath: url,
      tokens: fp.tokens,
      cost: fp.cost,
      durationMs: fp.durationMs,
      ledgerRow: row,
      error: ledgerErr,
    });
    this.#active = null;
  }

  buildDispatcherPrompt(o: {
    agentName: string;
    id: string;
    role: string;
    repo: string;
    task: string;
  }): string {
    const context =
      `NHQ fleet lane "${o.id}". Working repository: ${o.repo}. ` +
      `Branch-only protocol: commit to a dedicated git branch; NEVER push or merge.`;
    return [
      "You are the NHQ fleet-host dispatcher. Perform EXACTLY ONE action: a single",
      "call to the `task` tool, then stop. Do NOT read files, plan, or use any other",
      "tool yourself — the subagent does the work.",
      "",
      "Call `task` with these parameters verbatim:",
      `- agent: ${JSON.stringify(o.agentName)}`,
      `- context: ${JSON.stringify(context)}`,
      "- tasks: a single item:",
      `    - id: ${JSON.stringify(o.id)}`,
      `    - role: ${JSON.stringify(o.role)}`,
      "    - assignment: the text between the markers below.",
      "",
      "-----ASSIGNMENT-----",
      o.task,
      "",
      `Operate only within ${o.repo}. Work on a dedicated git branch; NEVER push or`,
      "merge. When finished, call yield with an object matching",
      '{status:"done"|"blocked", summary:string, branch?:string, need?:string}.',
      "-----END ASSIGNMENT-----",
    ].join("\n");
  }

  async doSpawn(lane: string, task: string): Promise<SpawnOutcome> {
    const { key, agent } = resolveLane(lane);
    const repo = resolveRepo(agent.repo);
    if (!fs.existsSync(repo)) {
      return { ok: false, lane: key, error: `lane repo does not exist: ${repo}` };
    }
    // F2 lane-mutex / F1 single host: serialize through the host. Launch (or
    // relaunch when idle and rooted elsewhere) rooted at this lane's repo.
    if (this.host.isRunning() && this.host.cwd !== repo) {
      this.log(`host rooted at ${this.host.cwd}, lane needs ${repo} → relaunch (idle)`);
      await this.host.shutdown();
    }
    if (!this.host.isRunning()) {
      await this.host.launch(repo);
      this.host.onFrame(this.routeFrame);
      this.log(`host launched cwd=${repo} session=${this.host.sessionFile} model=${this.host.model}`);
    }

    const id = `${key}-${Date.now().toString(36)}`;
    const role = agent.role || "Fleet engineer";
    const model = agent.model || this.host.model;
    // Agent TYPE = lane key (== frontmatter name == file stem); registry `name`
    // is the ledger display only. Keeps `task agent:` aligned with discovery.
    const prompt = this.buildDispatcherPrompt({ agentName: key, id, role, repo, task });

    const { promise, resolve } = Promise.withResolvers<SpawnOutcome>();
    this.#active = {
      lane: key,
      repo,
      task,
      name: agent.name,
      model,
      resolve,
      settled: false,
    };
    this.log(`spawn lane=${key} agent=${agent.name} id-hint=${id}`);
    // prompt is ack'd immediately; completion arrives via subagent_lifecycle.
    await this.host.request({ type: "prompt", message: prompt });
    return promise;
  }

  /** Serialize spawns (sync host = one turn at a time). */
  enqueueSpawn(lane: string, task: string): Promise<SpawnOutcome> {
    const { promise, resolve } = Promise.withResolvers<SpawnOutcome>();
    const job = async () => {
      try {
        resolve(await this.doSpawn(lane, task));
      } catch (e) {
        resolve({ ok: false, lane, error: (e as Error).message });
      }
    };
    this.#queue.push(job);
    void this.#drain();
    return promise;
  }

  async #drain(): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    try {
      while (this.#queue.length) {
        const job = this.#queue.shift()!;
        await job();
      }
    } finally {
      this.#busy = false;
    }
  }

  async doKill(target: string): Promise<{ ok: boolean; detail: string }> {
    if (!this.host.isRunning()) return { ok: false, detail: "no host running" };
    // Sync host: abort the active turn (interrupts the running subagent).
    await this.host.request({ type: "abort" });
    const a = this.#active;
    if (a && (a.agentId === target || a.lane === target) && !a.settled) {
      this.finalizeActive("aborted");
    }
    return { ok: true, detail: `aborted ${target}` };
  }

  statusSnapshot(): Record<string, unknown> {
    return {
      hostRunning: this.host.isRunning(),
      hostCwd: this.host.cwd,
      hostModel: this.host.model,
      sessionFile: this.host.sessionFile,
      busy: this.#busy,
      queued: this.#queue.length,
      lanes: [...this.lanes.values()],
      active: this.#active
        ? { lane: this.#active.lane, agentId: this.#active.agentId }
        : null,
    };
  }

  // ── socket server ───────────────────────────────────────────────────────────
  start(): void {
    fs.mkdirSync(OMP_HOME, { recursive: true });
    try {
      if (fs.existsSync(SOCK)) fs.unlinkSync(SOCK);
    } catch {
      /* ignore */
    }
    const server = net.createServer((conn) => {
      const rl = createInterface({ input: conn });
      rl.on("line", (line) => {
        void this.handleRequest(line, conn);
      });
    });
    server.listen(SOCK, () => {
      fs.writeFileSync(PIDFILE, String(process.pid));
      this.log(`daemon listening on ${SOCK} pid=${process.pid}`);
      process.stdout.write(`nhq-omp-driver daemon up (pid ${process.pid}, sock ${SOCK})\n`);
    });
    const stop = () => void this.stop(server);
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  }

  async stop(server: net.Server): Promise<void> {
    this.log("daemon stopping");
    await this.host.shutdown();
    try {
      server.close();
    } catch {
      /* ignore */
    }
    try {
      if (fs.existsSync(SOCK)) fs.unlinkSync(SOCK);
      if (fs.existsSync(PIDFILE)) fs.unlinkSync(PIDFILE);
    } catch {
      /* ignore */
    }
    process.exit(0);
  }

  async handleRequest(line: string, conn: net.Socket): Promise<void> {
    let req: { cmd?: string; lane?: string; task?: string; target?: string };
    try {
      req = JSON.parse(line);
    } catch {
      conn.end(JSON.stringify({ ok: false, error: "bad request json" }) + "\n");
      return;
    }
    const reply = (obj: unknown) => {
      try {
        conn.end(JSON.stringify(obj) + "\n");
      } catch {
        /* ignore */
      }
    };
    try {
      switch (req.cmd) {
        case "ping":
          return reply({ ok: true, pid: process.pid });
        case "status":
          return reply({ ok: true, status: this.statusSnapshot() });
        case "spawn": {
          if (!req.lane || !req.task) return reply({ ok: false, error: "spawn needs lane + task" });
          const outcome = await this.enqueueSpawn(req.lane, req.task);
          return reply({ ok: outcome.ok, outcome });
        }
        case "kill": {
          if (!req.target) return reply({ ok: false, error: "kill needs target" });
          return reply(await this.doKill(req.target));
        }
        case "stop": {
          reply({ ok: true, stopping: true });
          await this.host.shutdown();
          try {
            if (fs.existsSync(SOCK)) fs.unlinkSync(SOCK);
            if (fs.existsSync(PIDFILE)) fs.unlinkSync(PIDFILE);
          } catch {
            /* ignore */
          }
          setTimeout(() => process.exit(0), 50);
          return;
        }
        default:
          return reply({ ok: false, error: `unknown cmd "${req.cmd}"` });
      }
    } catch (e) {
      return reply({ ok: false, error: (e as Error).message });
    }
  }
}

// ── client: connect to (or auto-start) the daemon, one request → one reply ───
function connect(): Promise<net.Socket> {
  const { promise, resolve, reject } = Promise.withResolvers<net.Socket>();
  const sock = net.connect(SOCK);
  sock.once("connect", () => resolve(sock));
  sock.once("error", (e) => reject(e));
  return promise;
}

async function ensureDaemon(): Promise<void> {
  try {
    const s = await connect();
    s.end();
    return;
  } catch {
    /* not up — start it */
  }
  fs.mkdirSync(OMP_HOME, { recursive: true });
  const out = fs.openSync(DAEMONLOG, "a");
  // Inherit the parent's runtime flags (e.g. --experimental-strip-types on
  // Node 22.6–23.5) so the detached daemon runs the .ts identically.
  const child = spawn(process.execPath, [...process.execArgv, DRIVER_FILE, "daemon"], {
    detached: true,
    stdio: ["ignore", out, out],
    env: process.env,
  });
  child.unref();
  // poll for the socket
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const s = await connect();
      s.end();
      return;
    } catch {
      await sleep(150);
    }
  }
  throw new Error("daemon did not come up within 15s (see " + DAEMONLOG + ")");
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

async function clientRequest(req: Record<string, unknown>): Promise<Record<string, unknown>> {
  await ensureDaemon();
  const sock = await connect();
  const { promise, resolve, reject } = Promise.withResolvers<Record<string, unknown>>();
  let buf = "";
  sock.setEncoding("utf8");
  sock.on("data", (d) => (buf += d));
  sock.on("end", () => {
    try {
      resolve(JSON.parse(buf.trim() || "{}"));
    } catch (e) {
      reject(e as Error);
    }
  });
  sock.on("error", reject);
  sock.write(JSON.stringify(req) + "\n");
  return promise;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function usage(): never {
  process.stderr.write(
    [
      "nhq-omp-driver — NHQ Fleet v1 host controller (P1)",
      "usage:",
      "  nhq-omp-driver daemon                 run the persistent host daemon (foreground)",
      "  nhq-omp-driver spawn <lane> \"<task>\"   spawn a lane worker; blocks; prints typed result",
      "  nhq-omp-driver status [--json]        host + lane snapshot",
      "  nhq-omp-driver kill <id|lane>         abort a running lane",
      "  nhq-omp-driver stop                   stop the daemon + host",
      "  nhq-omp-driver guard-selftest         prove the {type:bash} frame is refused",
    ].join("\n") + "\n",
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "daemon": {
      new Daemon().start();
      return; // keep the event loop alive
    }
    case "spawn": {
      const lane = rest[0];
      const task = rest.slice(1).join(" ");
      if (!lane || !task) usage();
      const res = await clientRequest({ cmd: "spawn", lane, task });
      const o = (res.outcome || {}) as SpawnOutcome;
      if (!res.ok && !o.lane) {
        process.stderr.write(`spawn failed: ${res.error || o.error || "unknown"}\n`);
        process.exit(1);
      }
      process.stdout.write(JSON.stringify(o, null, 2) + "\n");
      process.exit(o.ok ? 0 : 1);
    }
    case "status": {
      const res = await clientRequest({ cmd: "status" });
      if (rest.includes("--json")) {
        process.stdout.write(JSON.stringify(res.status ?? res, null, 2) + "\n");
      } else {
        const s = (res.status || {}) as Record<string, unknown>;
        process.stdout.write(
          `host: ${s.hostRunning ? "running" : "down"}  cwd=${s.hostCwd ?? "—"}  model=${s.hostModel ?? "—"}\n` +
            `queued=${s.queued ?? 0} busy=${s.busy ?? false}\n` +
            `lanes: ${JSON.stringify(s.lanes ?? [])}\n`,
        );
      }
      process.exit(0);
    }
    case "kill": {
      const target = rest[0];
      if (!target) usage();
      const res = await clientRequest({ cmd: "kill", target });
      process.stdout.write(JSON.stringify(res) + "\n");
      process.exit(res.ok ? 0 : 1);
    }
    case "stop": {
      try {
        const res = await clientRequest({ cmd: "stop" });
        process.stdout.write(JSON.stringify(res) + "\n");
      } catch {
        process.stdout.write('{"ok":true,"note":"daemon not running"}\n');
      }
      process.exit(0);
    }
    case "guard-selftest": {
      // Prove the omp-P0 hard rule: the send path refuses a {type:"bash"} frame.
      let refused = false;
      try {
        assertSendableFrame({ type: "bash", command: "echo pwned" });
      } catch (e) {
        refused = e instanceof DriverBashFrameError;
      }
      let refusedAbort = false;
      try {
        assertSendableFrame({ type: "abort_bash" });
      } catch (e) {
        refusedAbort = e instanceof DriverBashFrameError;
      }
      // And a legitimate frame passes.
      let promptOk = true;
      try {
        assertSendableFrame({ type: "prompt", message: "hi" });
      } catch {
        promptOk = false;
      }
      const ok = refused && refusedAbort && promptOk;
      process.stdout.write(
        JSON.stringify({ ok, refusedBash: refused, refusedAbortBash: refusedAbort, promptAllowed: promptOk }) + "\n",
      );
      process.exit(ok ? 0 : 1);
    }
    default:
      usage();
  }
}

void main();
