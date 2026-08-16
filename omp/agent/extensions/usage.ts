import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { execFile } from "node:child_process";

/**
 * usage — shows live Claude (Anthropic Max) plan usage REMAINING as a status
 * segment, e.g. "claude 5h 96% · 7d 91%".
 *
 * Source of truth is Anthropic's own OAuth usage endpoint (the same data
 * Claude Code's /usage shows), fetched by the `nhq-usage` CLI which caches the
 * response for 60s — so refreshing every turn never hammers the API.
 *
 * Updates once at session start only (the number barely moves within a session,
 * and this avoids re-fetching on every reply), sitting in the status line
 * alongside the clock + token-usage segments.
 */

const BIN = `${process.env.HOME}/.local/bin/nhq-usage`;

function segment(): Promise<string> {
  const { promise, resolve } = Promise.withResolvers<string>();
  execFile(BIN, ["--segment"], { timeout: 8000 }, (err, stdout) => {
    const out = (stdout ?? "").trim();
    resolve(out || (err ? "claude usage n/a" : ""));
  });
  return promise;
}

export default function usage(pi: ExtensionAPI): void {
  const stamp = async (ctx: { ui: { setStatus(key: string, value: string): void } }): Promise<void> => {
    const value = await segment();
    if (value) ctx.ui.setStatus("usage", value);
  };

  pi.on("session_start", async (_event, ctx) => stamp(ctx));
}
