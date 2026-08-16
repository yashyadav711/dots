import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * context-loader — injects per-project agent context at session start.
 *
 * Problem: an omp session boots "cold". Only the global ~/.claude/CLAUDE.md is
 *   auto-loaded; a project's own CLAUDE.md, its rulebook, and its restore/brain
 *   files are NEVER injected — so the agent has no persona or operating context.
 *
 * This loader knows about two NHQ projects and injects the right context based
 * on the session cwd:
 *   - ~/Github/nhq-agentic-os → Director (CLAUDE.md + .claude/rules/*.md + ai/session-handoff.md)
 *   - ~/Github/envy           → Envy (CLAUDE.md + store/MACHINE.md + store/TODO.md)
 *
 * Mechanism: the `before_agent_start` hook may RETURN a message; the runtime then
 *   calls `sessionManager.appendCustomMessageEntry(...)` (verified in the omp
 *   binary), placing the content into the agent's context for the turn. We return
 *   one consolidated context message with `attribution: "user"`.
 *
 * Subagent exclusion: seed `processInteractive` from `session_start`. In an
 *   interactive process we only act on the main (hasUI=true) session and skip
 *   spawned subagents (hasUI=false). In a fully headless process we still inject
 *   on the headless main prompt. Once-per-session via the `injected` flag.
 */

const HOME = "/home/yash";

// ── Director (nhq-agentic-os) paths ───────────────────────────────────────────
const DIRECTOR_ROOT = join(HOME, "Github/nhq-agentic-os");
const DIRECTOR_CLAUDE_MD = join(DIRECTOR_ROOT, "CLAUDE.md");
const DIRECTOR_RULES_DIR = join(DIRECTOR_ROOT, ".claude/rules");
const DIRECTOR_HANDOFF_MD = join(DIRECTOR_ROOT, "ai/session-handoff.md");

// ── Envy (laptop operator / infra) paths ──────────────────────────────────────
const ENVY_ROOT = join(HOME, "Github/envy");
const ENVY_CLAUDE_MD = join(ENVY_ROOT, "CLAUDE.md");
// Envy's brain files live in the envy repo's store/ dir. (The legacy ~/.claude/bt
// symlink → envy/store is from the decommissioned "bt" system — don't depend on it.)
const ENVY_STORE_DIR = join(ENVY_ROOT, "store");
const ENVY_BRAIN_FILES = [join(ENVY_STORE_DIR, "MACHINE.md"), join(ENVY_STORE_DIR, "TODO.md")];

// ── HeyDaddy Design Partner (design sandbox) paths ────────────────────────────
const DESIGN_ROOT = join(HOME, "Github/heydaddy-design");
const DESIGN_CLAUDE_MD = join(DESIGN_ROOT, "CLAUDE.md");
const DESIGN_CONTEXT_FILES = [
  join(DESIGN_ROOT, ".design-sync/conventions.md"),
  join(DESIGN_ROOT, "REDESIGN.md"),
];

function isUnder(cwd: string, root: string): boolean {
  if (typeof cwd !== "string" || cwd.length === 0) return false;
  return cwd === root || cwd.startsWith(`${root}/`);
}

function section(path: string): string {
  const body = readFileSync(path, "utf8");
  return `=== PROJECT CONTEXT: ${path} ===\n${body}`;
}

/**
 * The session handoff is an append-only log: a CURRENT block on top, then every
 * prior session tail under an `ARCHIVE` heading. Only the current block is
 * operating context — the archive is deep history to be read on demand.
 *
 * Injecting the whole file cost ~94KB, over half of the entire session-start
 * injection, and the brevity rules it carries lose against that volume
 * (measured in ai/jcode-steal-audit-2026-07-28.md). So cut at the archive
 * marker and leave a pointer to the rest.
 */
function handoffSection(path: string): string {
  const body = readFileSync(path, "utf8");
  const lines = body.split("\n");
  const cut = lines.findIndex((l) => /^#{1,3}\s*(?:📦\s*)?ARCHIVE\b/.test(l));
  if (cut < 0) return section(path);
  const head = lines.slice(0, cut).join("\n").trimEnd();
  const dropped = body.length - head.length;
  return (
    `=== PROJECT CONTEXT: ${path} ===\n${head}\n\n` +
    `> ⏳ **Archive not loaded.** ${dropped.toLocaleString()} chars of prior session tails ` +
    `sit below the ARCHIVE heading in \`${path}\`. Read that file directly when you need ` +
    `older history; it is deliberately not injected.`
  );
}

type RenderMode = "web" | "terminal";

/**
 * Parse omp's output mode from the process launch flags. The web omp client runs
 * the agent over the RPC protocol (`--mode rpc` / `rpc-ui`); ACP clients run via
 * the `acp` subcommand. The interactive terminal TUI is the default `text` mode.
 */
function parseOutputMode(argv: readonly string[]): string {
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (typeof a !== "string") continue;
    if (a === "--mode" && i + 1 < argv.length) {
      return String(argv[i + 1]).toLowerCase();
    }
    if (a.startsWith("--mode=")) return a.slice("--mode=".length).toLowerCase();
    if (i === 2 && a === "acp") return "acp"; // `omp acp` subcommand
  }
  return "text";
}

/**
 * Decide the reply RENDER MODE for this session. Default web-safe when ambiguous.
 */
function detectRenderMode(ctx: { hasUI: boolean }): RenderMode {
  // Stored preference wins over auto-detect, so "web mode from now on" persists
  // across launches (the per-session trigger only flips the current session).
  // Yash sets it by writing "web" or "terminal" to ~/.omp/agent/render-mode.pref;
  // delete the file to fall back to per-launch auto-detection.
  try {
    const pref = readFileSync(join(HOME, ".omp/agent/render-mode.pref"), "utf8").trim().toLowerCase();
    if (pref === "web" || pref === "terminal") return pref;
  } catch {
    // no stored preference — fall through to auto-detect
  }
  const mode = parseOutputMode(process.argv);
  if (mode === "rpc" || mode === "rpc-ui" || mode === "acp") return "web";
  if (ctx.hasUI && Boolean(process.stdout.isTTY)) return "terminal";
  return "web";
}

function directorRenderDirective(mode: RenderMode): string {
  if (mode === "terminal") {
    return (
      "🎨 RENDER MODE: terminal — this omp session renders in the TERMINAL TUI " +
      "(LaTeX renders). Per .claude/rules/replies.md RULE -5, style replies in " +
      "TERMINAL mode: NHQ-palette LaTeX \\textcolor/\\colorbox with restraint " +
      "(crimson headers, gold values, olive=running / red=blocked RUNNING table). " +
      "Reply STRUCTURE is unchanged. Yash can override with the `web mode` trigger."
    );
  }
  return (
    "🎨 RENDER MODE: web — this omp session renders in the WEB client (plain " +
    "markdown; LaTeX \\textcolor, $...$ math, and palette hashcodes render as " +
    "BROKEN RAW TEXT). Per .claude/rules/replies.md RULE -5, style ALL replies " +
    "WEB-SAFE: NO LaTeX color, NO $...$, NO hashcodes — convey emphasis with " +
    "**bold** + emoji + unicode rules (─), and status with emoji chips " +
    "(🟢 running / 🔴 blocked / 🟡 in-progress / ⏳ waiting). Reply STRUCTURE is " +
    "unchanged. Yash can override with the `terminal mode` trigger."
  );
}

/** Generic render note for Envy (its reply format is self-contained, not Director's). */
function genericRenderDirective(mode: RenderMode): string {
  if (mode === "terminal") {
    return "🎨 RENDER MODE: terminal — interactive TTY; copy-boxes + trees render. Reply per your own CLAUDE.md format.";
  }
  return (
    "🎨 RENDER MODE: web — plain markdown client; avoid LaTeX color / $...$ / hex " +
    "color codes (they render as raw text). Convey emphasis with **bold** + emoji. " +
    "Reply per your own CLAUDE.md format."
  );
}

// Rules that shape EVERY reply (identity / autonomy / Protocol-3 / principles / asking) —
// loaded in full at session start. The remaining task-specific rule files are replaced by
// RULES_INDEX below and pulled on demand (Light trim, Yash 2026-06-23).
//
// `replies.md` (33K) + `replies-formats.md` (11K) were dropped from this list on 2026-07-28.
// They are 44K of reply-FORMAT spec, and CLAUDE.md's "How you talk" section already carries
// the directives that must hold on every reply (lean-by-default, the Hinglish register, the
// threads discipline, the drift sentinel). Keeping the full spec always-loaded made the
// brevity rules fight 44K of ceremony — and lose; replies.md RULE 0 self-admits its
// "EVERY reply" wording kept overriding RULE -7. Diagnosis: ai/jcode-steal-audit-2026-07-28.md.
const ALWAYS_LOAD_RULES = [
  "core.md",
  "ethos.md",
  "questions.md",
];

// Compact index of the on-demand rule files. Director recognizes the trigger, then reads
// `.claude/rules/<name>.md` (or `rule://<name>`) BEFORE acting on that area. Keep this list
// in sync when a rule file is added/removed/renamed.
const RULES_INDEX = `## ON-DEMAND RULES — pulled when their area comes up (NOT loaded in full to save context)
The behavioral rules above (identity, autonomy, principles, asking) ARE loaded in full. The rule files below are NOT — recognize the trigger, then **read the path shown** BEFORE acting on that area. Paths are relative to \`~/Github/nhq-agentic-os/\`. (These were listed as \``rule://<name>`\` until 2026-08-16; that scheme maps to \`~/.omp/rules/*\`, which does not exist, so every entry was a dead link and the rules went unread for weeks. Real paths now.)
- `.claude/rules/replies.md` + `.claude/rules/replies-formats.md` — the full reply-format spec: the two reply modes, the threads table, the plan-before-task table, the WhatsApp/Julian 4-block, copy-box rules, the 🧭 NEXT box. PULL WHEN: producing a genuine multi-item status, a plan that needs a go, a Julian/WhatsApp reply, or any time you are unsure of a format. **Not loaded by default on purpose** — CLAUDE.md "How you talk" already carries what must hold on every reply (lean by default, the Hinglish register, threads discipline, the drift sentinel). Default to LEAN; reach for the spec only when the reply genuinely needs structure.
- `.claude/rules/relay.md` — delegation protocol (task tool + Fleet Kit), architect phase, build-verify, PR/merge, complete-spec template. PULL WHEN: delegating any build/fix, architect phase, reviewing/merging a PR.
- `.claude/rules/agents-teams.md` — the workforce (ops/scribe/feature-architect/qa/security/ux-design/upgrade-architect), parallel task-tool waves, coordination patterns. PULL WHEN: choosing/spawning an agent or team, planning parallel work.
- `.claude/rules/craft.md` — code/testing/security/git rules + tool-use hygiene + ponytail + graphify-first + skills-first. PULL WHEN: writing/reviewing code, running tests, any build/fix, before writing a code relay spec.
- `.claude/rules/brief-formats.md` — output templates: status / brief / calendar / git-status / plan-session / threads / retro / day-plan. PULL WHEN: any of those triggers fires (status, brief/gm, calendar, check, plan session, threads, /retro).
- `.claude/rules/day-plan.md` — the PROCEDURE behind a day plan (brief-formats has only the output shape). Phase 0 reconciles threads → GitHub issues → **the actual code** before anything reaches the plan; Phase 1 verifies what is DEPLOYED not merged; Phase 2 lane health (test a real generation, never a model list); Phase 3 ground every spec in code before writing a contract; Phase 4 the per-item table (agent · branch · time · P3 · needs-Yash · break risk) with BOTH sequential and parallel timings; Phase 5 deploy/merge guardrails; Phase 6 hands off to docs/playbooks/dev-workflows.md. PULL WHEN: "day plan" / "aaj ka day plan kro" / "plan the day", or producing the Orient's day-plan block. Skipping Phase 0 has twice put finished work in front of Yash (2026-07-29).
- `.claude/rules/ops-protocols.md` — NHQ status page rules, Julian workflow + feedback loop, session-start/restart checklist, gn/gm sync. PULL WHEN: NHQ status update, any Julian comms, session start/restart, gn/gm.
- `.claude/rules/triggers.md` — the full trigger/command index + each command's procedure. PULL WHEN: a message matches a trigger word (below) and you need its exact procedure.
- `.claude/rules/usage-modes.md` — the 4 quota modes (LOW/MED/HIGH/ULTRA), ccusage read, agy routing. PULL WHEN: deciding/stating a usage mode, reading quota, planning parallelism.
- `.claude/rules/model-overlays.md` — per-model behavior overlays to prepend to relay specs. PULL WHEN: spawning an agent / writing a relay spec / picking an engine.
- `.claude/rules/live-test-fix.md` — the live test-fix-deploy loop. PULL WHEN: "live test" / "/livetest" / live-testing mode.
- `.claude/rules/knowledge-okf.md` — the OKF knowledge bundle: what the repo KNOWS, distilled, so you can read concepts instead of grepping code. `okf/` holds 43 concept files; `nhq-okf` builds and validates them and `nhq-prep <repo>` fuses them into the graphify code graph. PULL WHEN: you need domain context on a repo, before any wide read.
- `.claude/rules/file-organization.md` — where things belong on disk: repos, worktrees, the vault, scratch paths, and what must never be left in a scratch dir. PULL WHEN: creating a file whose home is not obvious, filing something Yash handed over, or cleaning up.
- `.claude/rules/fleet-boxes.md` — the two machines: rig (RTX 2070 GPU box, 16 GB, Android build+test lab, ollama, agy rotator) and the 7.5 GB laptop. How to reach rig, what runs there, its security posture, and the measured fact that rig's rotator shares the SAME 13 accounts as the laptop's — it adds hardware, NOT quota. PULL WHEN: planning parallel/heavy work, picking where to run something, anything Android, reaching rig, or quoting lane capacity.

TRIGGER WORDS to recognize (then pull `.claude/rules/triggers.md` or `.claude/rules/brief-formats.md` for the procedure): status · brief · morning · gm · gn · good night · catch me up · calendar · tasks · todo · day plan · plan the day · aaj ka day plan kro · check · git status · check julian · julian feedback · go · update firefox bookmarks · improve · fix · upgrade nhq · /retest · persona test · live test · /livetest · log it · done · thread(s) · show threads · web mode · terminal mode · continue · resume · /retro · decision: · hello · hi · hey · yo · off work · session restart · closing · naya session · Director focus · aqm · commands · ? · help · rig · fleet · android · **private**

🔒 **PRIVATE SESSION (act immediately, do NOT wait to pull a rule):** if the FIRST + ONLY message of a fresh session is "private", this session is STRICTLY Yash↔Director — no one/nothing else. For the whole session: NEVER delegate to subagents/fleet/relay/agy or anything leaving the local box; NEVER write to or mention it in shared/synced/remote surfaces (NHQ status, netrunners-status, Julian comms, ai/ handoff·threads·logs, shared repos, synced vault) or any later session's handoff; keep artifacts in ~/private or /tmp (not git/Syncthing). Confirm once ("🔒 Private session — just us.") and proceed. Full rule: `.claude/rules/triggers.md`.`;

function buildDirectorContext(renderMode: RenderMode): string {
  const parts: string[] = [];
  try {
    parts.push(section(DIRECTOR_CLAUDE_MD));
  } catch {
    // skip if unreadable
  }
  for (const f of ALWAYS_LOAD_RULES) {
    try {
      parts.push(section(join(DIRECTOR_RULES_DIR, f)));
    } catch {
      // skip individual unreadable rule
    }
  }
  parts.push(RULES_INDEX);
  try {
    parts.push(handoffSection(DIRECTOR_HANDOFF_MD));
  } catch {
    // skip if unreadable
  }
  const preamble =
    "The following project context (Director persona, the every-reply rulebook, a " +
    "compact index of on-demand rules, and the session handoff) was auto-loaded for " +
    "this nhq-agentic-os session. Treat it as authoritative operating context and " +
    "follow it for the rest of this session. Rules listed in the ON-DEMAND index are " +
    "NOT loaded in full — read the named rule file before acting on that area.";
  return `${directorRenderDirective(renderMode)}\n\n${preamble}\n\n${parts.join("\n\n")}`;
}

function buildEnvyContext(renderMode: RenderMode): string {
  const parts: string[] = [];
  try {
    parts.push(section(ENVY_CLAUDE_MD));
  } catch {
    // skip if unreadable
  }
  for (const f of ENVY_BRAIN_FILES) {
    try {
      parts.push(section(f));
    } catch {
      // brain file optional — skip if missing
    }
  }
  const preamble =
    "You are Envy, the NetrunnersHQ laptop operator. The following is your " +
    "constitution (CLAUDE.md) + brain files (MACHINE.md, TODO.md), auto-loaded " +
    "for this session. Treat it as authoritative and follow it. You are running " +
    "as the parallel OPS pane beside a Director session — honor the 'Parallel " +
    "OPS-PANE mode' section (log ops to ai/envy-inbox.md, never touch Director's " +
    "living docs or the nhq-agentic-os git tree).";
  return `${genericRenderDirective(renderMode)}\n\n${preamble}\n\n${parts.join("\n\n")}`;
}

function buildDesignerContext(renderMode: RenderMode): string {
  const parts: string[] = [];
  try {
    parts.push(section(DESIGN_CLAUDE_MD));
  } catch {
    // skip if unreadable
  }
  for (const f of DESIGN_CONTEXT_FILES) {
    try {
      parts.push(section(f));
    } catch {
      // optional context file — skip if missing
    }
  }
  const preamble =
    "You are the HeyDaddy Design Partner. The following is your constitution " +
    "(CLAUDE.md) + the design-sync styling conventions + the produced redesign " +
    "language (REDESIGN.md), auto-loaded for this session. Treat it as " +
    "authoritative and follow it. You work ONLY in ~/Github/heydaddy-design " +
    "(never the product repo); design artifacts stay in this sandbox.";
  return `${genericRenderDirective(renderMode)}\n\n${preamble}\n\n${parts.join("\n\n")}`;
}

type Project = { root: string; build: (m: RenderMode) => string };

const PROJECTS: Project[] = [
  { root: DIRECTOR_ROOT, build: buildDirectorContext },
  { root: ENVY_ROOT, build: buildEnvyContext },
  { root: DESIGN_ROOT, build: buildDesignerContext },
];

export default function contextLoader(pi: ExtensionAPI) {
  // Process-level: true once any session with a live UI is observed.
  let processInteractive = false;
  // Single-shot guard: inject the project context only once per process/session.
  let injected = false;

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.hasUI) processInteractive = true;
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    try {
      // Main-session only: in an interactive process skip subagents (hasUI=false).
      // In a fully headless process (no UI ever) inject on the headless main prompt.
      if (ctx.hasUI) {
        processInteractive = true;
      } else if (processInteractive) {
        return; // subagent within an interactive process
      }

      if (injected) return; // once per session

      const project = PROJECTS.find((p) => isUnder(ctx.cwd, p.root));
      if (!project) return; // not a known NHQ project cwd — leave session untouched

      // Resume-safe: a resumed session already carries the project-context block
      // in its transcript. Re-injecting would duplicate the whole rulebook. If the
      // loaded history already has it, mark injected + skip. Any failure here falls
      // through to inject (the original fresh-start behavior) — never breaks startup.
      try {
        const branch: any = (ctx as any).sessionManager?.getBranch?.();
        const msgs: any[] = Array.isArray(branch)
          ? branch
          : (branch?.messages ?? branch?.entries ?? []);
        for (const m of msgs) {
          const ct = m?.customType ?? m?.message?.customType;
          const c = m?.content ?? m?.message?.content;
          const text =
            typeof c === "string"
              ? c
              : Array.isArray(c)
                ? c.map((x: any) => (typeof x === "string" ? x : (x?.text ?? ""))).join(" ")
                : "";
          if (ct === "project-context" || text.includes("auto-loaded for this")) {
            injected = true;
            return; // already present in this (resumed) session — don't duplicate
          }
        }
      } catch {
        // history unavailable — fall through and inject (fresh-start behavior)
      }

      const content = project.build(detectRenderMode(ctx));
      if (!content.trim()) return;

      injected = true;
      return {
        message: {
          customType: "project-context",
          content,
          display: false, // keep full context in-model, but don't dump the whole rulebook on screen (Yash: less scroll at load)
          attribution: "user" as const,
        },
      };
    } catch {
      // Never block or fail a turn because of context loading.
    }
  });
}
