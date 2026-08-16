import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { appendFileSync } from "node:fs";

/**
 * voice-capture — appends every verbatim user message to the canonical voice corpus.
 *
 * Capture event: `before_agent_start`.
 *   Empirically (verified with `omp -p`), the extension-only `input` event does NOT
 *   fire in headless/print mode, whereas `before_agent_start` fires once per user
 *   prompt and carries the raw text verbatim in `event.prompt` — in BOTH interactive
 *   and headless modes. At `before_agent_start` the user entry is not yet in
 *   `getBranch()`, so `event.prompt` is the reliable verbatim source.
 *
 * Subagent exclusion: `before_agent_start` also fires for spawned task/subagent
 *   sessions (hasUI=false) whose `prompt` is the assignment, not Yash's voice. We
 *   seed `processInteractive` from `session_start`: once any session with a UI is
 *   seen, the process is interactive, and we only capture the main (hasUI=true)
 *   session — subagents are skipped. In a fully headless process (no UI ever), we
 *   capture the headless main prompt.
 */

const VOICE_FILE = "/home/yash/Github/nhq-agentic-os/ai/yash-voice.md";

function localTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/**
 * Skip pasted blobs + leaked subagent assignments so the voice corpus stays
 * signal, not noise. Filters on STRUCTURAL markers (not length alone) so genuine
 * long voice run-ons are still captured.
 */
function looksLikeNoise(body: string): boolean {
  // Leaked relay/assignment templates (# Target / # Change / # Acceptance / # Contract).
  if (/^#{1,3}\s+(Target|Change|Acceptance|Goal|Constraints|Contract)\b/m.test(body) &&
      /^#{1,3}\s+(Acceptance|Contract|Change|Constraints)\b/m.test(body)) return true;
  // Agent STATUS-RETURN blobs / task notifications pasted into the prompt.
  if (/STATUS RETURN|<task-notification|<task-result|<system-notice/.test(body)) return true;
  // WhatsApp paste: [HH:MM, D/M/YYYY] Name: ... timestamps.
  if (/\[\d{1,2}:\d{2},?\s*\d{0,2}\/?\d{0,2}\/?\d{0,4}\]/.test(body)) return true;
  // Giant multi-line paste backstop (not a genuine voice run-on).
  if (body.length > 8000 && body.split("\n").length > 40) return true;
  return false;
}

export default function voiceCapture(pi: ExtensionAPI) {
  // Process-level: true once any session with a live UI is observed (interactive run).
  let processInteractive = false;
  // Re-fire guard: suppress mechanical duplicates (auto-retry / restart) of the same
  // prompt within a short window without dropping genuine re-sends seconds apart.
  let lastBody = "";
  let lastAt = 0;

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.hasUI) processInteractive = true;
  });

  pi.on("before_agent_start", async (event, ctx) => {
    try {
      // Capture the main session only: in an interactive process, skip subagents
      // (hasUI=false). In a fully headless process, capture the headless main prompt.
      if (ctx.hasUI) {
        processInteractive = true;
      } else if (processInteractive) {
        return; // subagent within an interactive process
      }

      if (!event || typeof event !== "object" || !("prompt" in event)) return;
      const raw = event.prompt;
      if (typeof raw !== "string") return;
      const body = raw.trim();
      if (body.length === 0) return; // skip empty messages
      if (looksLikeNoise(body)) return; // skip pasted blobs / leaked assignments

      const now = Date.now();
      if (body === lastBody && now - lastAt < 5000) return; // mechanical re-fire
      lastBody = body;
      lastAt = now;

      let sessionName = "";
      try {
        const name = pi.getSessionName();
        if (typeof name === "string") sessionName = name;
      } catch {
        // session name is best-effort
      }

      const header = `\n--- ${localTimestamp(new Date(now))} | cwd: ${ctx.cwd} | session: ${sessionName || "-"} ---\n`;
      appendFileSync(VOICE_FILE, `${header}${body}\n`);
    } catch {
      // Never block or fail a turn because of voice capture.
    }
  });
}
