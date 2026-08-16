import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

/**
 * /cv — "check vault". Surfaces what Yash edited in the nHQ Obsidian vault since
 * the last check (via nhq-vault-changes) + any new inline comments (nhq-vault-comments),
 * then has Director review the changed notes. Personal/vault scope — not work/repo.
 */
export default function (pi: ExtensionAPI) {
  pi.registerCommand("cv", {
    description: "Check vault — what I edited since last check (+ new comments), then review",
    handler: async (_args, _ctx) => {
      await pi.sendUserMessage(
        [
          "/cv — **check vault**:",
          "1. Run `nhq-vault-changes` → list the notes I ADDED/MODIFIED/DELETED since your last check (newest first).",
          "2. Run `nhq-vault-comments --open` → surface any open inline comments I left (file · quoted text · my note).",
          "3. `read` the changed notes and give me a short, scannable summary of what actually changed in each, and act on / answer any comment I left.",
          "Personal vault scope only — do NOT pull in work/fleet/repo status.",
        ].join("\n"),
      );
    },
  });
}
