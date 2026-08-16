// `/reload` — hot-reload the session without closing and reopening omp.
//
// Stolen from jcode, which had exactly this (`reload` in
// crates/jcode-app-core/src/server/debug_command_exec.rs:579 — rebuild, smoke-test,
// swap the symlink, keep the session alive). Ported to what omp actually needs:
// omp is not built from source here, so the thing worth reloading is Director's OWN
// operating layer — CLAUDE.md, .claude/rules/*, the context-loader injection, and the
// extensions themselves. All of those are read at session start, which is why editing
// them used to mean "restart the session and lose the conversation".
//
// `ctx.reload()` (ExtensionCommandContext) re-runs that startup path in place.
// Extension modules are imported with an `?mtime` cache-buster, so edited extension
// source is genuinely re-read rather than served from cache.
//
// Usage:  /reload            reload now
//         /reload --what     print what a reload does and does not pick up

type NotifyLevel = "info" | "warn" | "error";
type CommandContext = {
  ui: { notify(message: string, level?: NotifyLevel): void };
  reload(): Promise<void> | void;
};
type Pi = {
  registerCommand(
    name: string,
    spec: { description: string; handler: (args: string, ctx: CommandContext) => Promise<void> },
  ): void;
};

// MEASURED 2026-07-28 — and the first measurement was MISREAD, so note both.
//
// Observation: after editing `telegram-inbox.ts` and running /reload, the session still
// behaved like the old module. I concluded "reload does not re-import extensions" and
// wrote that here. WRONG. The real cause was version skew of my own making: I had already
// retired `nhq-tg drain` in the CLI while the extension still called it, so the freshly
// re-imported extension failed on a missing subcommand. Once the extension was switched to
// `peek`/`ack`, a /reload picked up the new code immediately and delivered two queued
// Telegram messages. `ctx.reload()` DOES re-import edited extensions, exactly as the
// `?mtime` cache-buster in omp://extension-loading.md advertises.
//
// Lesson worth keeping: one failed observation had two candidate explanations and I banked
// the wrong one without testing the other.
//
// MEASURED 2026-08-11 — reload re-imports extensions it ALREADY KNOWS; it does not
// discover a NEW extension file added mid-session. Test: moved `jump-back.ts` out,
// started omp, put it back, ran /reload — its chord did nothing and `/back` fell
// through to the built-in Background Jobs command. Restarting omp picked both up
// immediately. So: edited extension → /reload. Brand-new extension file → restart.
const WHAT = [
  "/reload re-runs the session startup path in place, keeping the conversation.",
  "",
  "PICKS UP:",
  "  · CLAUDE.md and .claude/rules/* (re-injected by the context-loader)",
  "  · ai/session-handoff.md (current block only, archive stays out)",
  "  · .omp/rules/* TTSR rules",
  "  · edited extension source (verified: re-imported via the ?mtime cache-buster)",
  "  · MCP servers (they re-initialise, so the tool inventory refreshes)",
  "",
  "DOES NOT change: the model, the provider, anything already said in the",
  "conversation, or pick up a BRAND-NEW extension file (that needs a restart).",
  "",
  "If a reloaded extension misbehaves, suspect version skew between it and any CLI",
  "or file it depends on — not the reload.",
].join("\n");

export default function reloadCommand(pi: Pi) {
  pi.registerCommand("reload", {
    description: "Reload config, rules, extensions and MCP in place — keeps the conversation",
    handler: async (args, ctx) => {
      if (args.trim() === "--what") {
        ctx.ui.notify(WHAT, "info");
        return;
      }
      ctx.ui.notify("Reloading config, rules and extensions…", "info");
      // Terminal for this handler frame: nothing after reload() is guaranteed to run.
      await ctx.reload();
    },
  });
}
