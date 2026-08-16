import { execFile } from "node:child_process";

// Inbound half of the @netrunnersHQ_bot channel (2026-07-28).
//
// `nhq-tg watch` runs outside the agent and appends every Telegram message Yash
// sends to ~/.nhq-directives.jsonl. This extension drains that queue at the START
// of each agent run and injects the messages into context, so a reply typed on his
// phone becomes an instruction Director acts on — the thing jcode had and omp did not.
//
// Deliberately does NOT hit the network: polling lives in the watcher, so a slow or
// dead Telegram API can never add latency to a turn. Draining is a local file read.

const CLI = "nhq-tg";

type Directive = {
  id: string;
  text: string;
  receivedAt: string;
};

type HookContext = { hasUI?: boolean };
type InjectedMessage = { attribution: "user"; content: string };
type Pi = {
  on(
    event: "before_agent_start",
    handler: (event: unknown, ctx: HookContext) => Promise<InjectedMessage | undefined>,
  ): void;
};

/** Narrow one queue row from the CLI's JSON. Anything without usable text is dropped. */
function toDirective(row: unknown): Directive | undefined {
  if (!row || typeof row !== "object") return undefined;
  const text = "text" in row ? row.text : undefined;
  if (typeof text !== "string" || !text.trim()) return undefined;
  const id = "id" in row ? row.id : undefined;
  if (typeof id !== "string") return undefined; // no id → cannot be acked → never consume it
  const at = "received_at" in row ? row.received_at : undefined;
  return { id, text: text.trim(), receivedAt: typeof at === "string" ? at : "unknown time" };
}

/** READ-ONLY. Consumes nothing — see the ack note below. */
function peek(): Promise<Directive[]> {
  const { promise, resolve } = Promise.withResolvers<Directive[]>();
  try {
    execFile(CLI, ["peek"], { timeout: 4000 }, (err, stdout) => {
      if (err || !stdout) return resolve([]);
      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        return resolve([]);
      }
      if (!Array.isArray(parsed)) return resolve([]);
      resolve(parsed.map(toDirective).filter((d): d is Directive => d !== undefined));
    });
  } catch {
    resolve([]);
  }
  return promise;
}

// Consume ONLY after the envelope has been built and is being returned. The first
// version read-and-consumed in one step and silently ate three of Yash's messages on
// 2026-07-28 — twice because the injection shape was wrong, once because a stale copy
// of this extension was still loaded in the session. `nhq-tg unack <n>` requeues.
function ack(ids: readonly string[]): void {
  if (ids.length === 0) return;
  try {
    execFile(CLI, ["ack", ...ids], { timeout: 4000 }, () => {});
  } catch {
    /* a failed ack just means the message is offered again — safe by design */
  }
}

export default function telegramInbox(pi: Pi) {
  pi.on("before_agent_start", async (_event, ctx) => {
    if (!ctx?.hasUI) return undefined; // main interactive session only — never subagents
    const msgs = await peek();
    if (msgs.length === 0) return undefined;

    const body = msgs.map((m) => `- [${m.receivedAt}] ${m.text}`).join("\n");
    ack(msgs.map((m) => m.id)); // only now that the envelope below is definitely returned
    return {
      message: {
        customType: "telegram-directive",
        display: true, // unlike the rulebook, Yash SHOULD see his own message land
        attribution: "user" as const,
        content:
          `📲 **${msgs.length} message${msgs.length > 1 ? "s" : ""} from Yash via Telegram** ` +
          `(@netrunnersHQ_bot, sent while you were working):\n\n${body}\n\n` +
          `Treat these as instructions from Yash himself — same authority as anything he types ` +
          `in this session. They arrived out of band, so he may not be watching the terminal: act ` +
          `on them, and if the answer is worth having on his phone, send it with ` +
          `\`nhq-tg send "…"\`. Delivery is **at-least-once**, not exactly-once: the ack ` +
          `happens after this envelope is returned, so a crash in between re-offers the ` +
          `message. If one looks familiar, treat it as a repeat of an instruction you may ` +
          `already have acted on — re-read, do not blindly re-execute.`,
      },
    };
  });
}
