import { spawn, execFile } from "node:child_process";
import { basename } from "node:path";

// Fires ONE desktop notification when omp has fully finished replying and is
// handing control back to you — not on every intermediate step.
//
// Uses `agent_end` (fires once when the whole agent run completes), NOT
// `turn_end` (which fires after every tool-loop turn: thinking, each tool call
// — that was the spam). Also skips firing when you've queued a follow-up
// message (you're clearly still here and more work is coming), and skips
// headless / sub-agent sessions.
//
// GATING (stolen from jcode's [notifications] block, adopted 2026-07-28):
//   turn_complete_min_secs = 120 · turn_complete_only_when_unfocused = true
// A ping is only useful if you walked away. A short turn you watched finish,
// or a long one you were staring at, does not need a toast. Both gates must
// pass. Env overrides: OMP_NOTIFY_MIN_SECS, OMP_NOTIFY_ALWAYS=1.

const MIN_SECS = Number(process.env.OMP_NOTIFY_MIN_SECS ?? 120);
const ALWAYS = process.env.OMP_NOTIFY_ALWAYS === "1";

// Window classes that mean "Yash is looking at the agent right now".
// The live Hyprland class on this box is `kitty-tmux`, not `kitty` — so match a
// prefix as well as the exact names, or the gate silently never fires (found by
// probing `hyprctl activewindow -j` instead of assuming, 2026-07-28).
const TERMINAL_CLASSES: Record<string, true> = {
  kitty: true,
  "kitty-tmux": true,
  "org.wezfurlong.wezterm": true,
  Alacritty: true,
  foot: true,
};
const TERMINAL_PREFIXES = ["kitty", "Alacritty", "foot", "wezterm"];

function isTerminalClass(cls: string): boolean {
  if (TERMINAL_CLASSES[cls] === true) return true;
  return TERMINAL_PREFIXES.some((p) => cls.startsWith(p));
}

/** True when the focused window is the terminal the agent runs in. Fail-open: on
 *  any error we report "not focused" so a broken probe never silences the ping. */
function terminalIsFocused(): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  try {
    execFile("hyprctl", ["activewindow", "-j"], { timeout: 1000 }, (err, stdout) => {
      if (err || !stdout) return resolve(false);
      try {
        const cls = JSON.parse(stdout)?.class;
        resolve(typeof cls === "string" && isTerminalClass(cls));
      } catch {
        resolve(false);
      }
    });
  } catch {
    resolve(false);
  }
  return promise;
}

function humanElapsed(secs: number): string {
  if (secs < 60) return `${Math.round(secs)}s`;
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return s ? `${m}m ${s}s` : `${m}m`;
}

export default function notifyOnDone(pi) {
  // Run start times, keyed per session so concurrent sessions don't collide.
  // A Map (not a Record) because keys are dynamic and entries are deleted.
  const startedAt = new Map<string, number>();
  const key = (ctx) => String(ctx?.sessionId ?? ctx?.cwd ?? "main");

  pi.on("before_agent_start", (_event, ctx) => {
    startedAt.set(key(ctx), Date.now());
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (!ctx?.hasUI) return; // skip print/headless/sub-agent sessions

    // If another message is already queued, more work is coming — stay quiet.
    try {
      if (typeof ctx.hasQueuedMessages === "function" && ctx.hasQueuedMessages()) return;
    } catch {
      /* if the guard isn't available, fall through and notify */
    }

    const k = key(ctx);
    const started = startedAt.get(k);
    startedAt.delete(k);

    let elapsed = Number.POSITIVE_INFINITY; // unknown start → don't suppress
    if (typeof started === "number") elapsed = (Date.now() - started) / 1000;

    if (!ALWAYS) {
      if (elapsed < MIN_SECS) return; // too short to have walked away from
      if (await terminalIsFocused()) return; // you are already watching it
    }

    const where = ctx?.cwd ? basename(ctx.cwd) : "omp";
    const body = Number.isFinite(elapsed) ? `${where} · ${humanElapsed(elapsed)}` : where;
    try {
      spawn(
        "notify-send",
        ["-a", "omp", "-u", "normal", "omp \u2014 done replying", body],
        { stdio: "ignore", detached: true },
      ).unref();
    } catch {
      /* never let a notification failure affect the agent */
    }
  });
}
