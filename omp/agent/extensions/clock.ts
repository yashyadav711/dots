import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

/**
 * clock — shows the wall-clock time as a status segment in HH:MM:SS.
 *
 * Updates after every reply (turn_end) and once at session start, so the
 * status line carries the time the last reply landed — sitting alongside the
 * token-usage segment (the "↑… ↓… cache:…" line) shown after each reply.
 *
 * Frozen-between-turns by design: it stamps each reply's completion time.
 * To make it tick live every second, see the optional setInterval block below.
 */

function hhmmss(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export default function clock(pi: ExtensionAPI): void {
  // setStatus(key, value): key dedupes the segment, value is what renders.
  const stamp = (ctx: { ui: { setStatus(key: string, value: string): void } }): void => {
    ctx.ui.setStatus("clock", hhmmss());
  };

  pi.on("session_start", async (_event, ctx) => stamp(ctx));
  pi.on("turn_end", async (_event, ctx) => stamp(ctx));
}
