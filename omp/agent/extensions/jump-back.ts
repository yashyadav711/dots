import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

/**
 * jump-back — Ctrl+↑ takes you to your previous message. Press again, go further
 * back. Each stop shows that message at the top of the screen with the reply it
 * got underneath, so you land where you were in the conversation.
 *
 * Why it's a drawn view and not the terminal actually scrolling: omp keeps the
 * chat in the terminal's own native scrollback and, by design, "the renderer
 * cannot observe the terminal's scroll position"
 * (omp://tui-core-renderer.md) — omp can never move the terminal's viewport.
 * So "go back to that message" has to mean re-drawing that part of the
 * conversation ourselves. This reads the live branch via
 * `ctx.sessionManager.getBranch()` and paints it through
 * `ctx.ui.custom(..., { overlay: true })`, the same mount the built-in
 * autoresearch dashboard overlay uses.
 *
 * Keys (Ctrl+↑/↓ work too — the decoder ignores modifiers):
 *   up / k / p     your previous (older) message
 *   down / j / n   your next (newer) message
 *   PgUp / PgDn    scroll by a screen · wheel scrolls by two lines
 *   g / G          first / last message
 *   q / escape     close, back to the input box
 *
 * Your turns carry an accent gutter and a number (1..N, oldest first); the
 * assistant's prose sits dim underneath. Thinking blocks and tool calls are
 * never shown — this is "what did we say".
 *
 * NOTE: a brand-new extension file is only discovered at omp startup — `/reload`
 * re-imports extensions it already knows, it does not find new ones.
 *
 * Remap the opener in ~/.omp/agent/keybindings.yml if ctrl+up ever clashes.
 */

const CHORD = "ctrl+up";
const GUTTER = "▌";
const INDENT = "  ";

type Theme = { fg?: (name: string, text: string) => string };
type Tui = { requestRender?: () => void };

type CustomComponent = {
	render: (width: number) => string[];
	handleInput: (data: string) => void;
	invalidate: () => void;
	dispose: () => void;
};

type CustomFactory = (
	tui: Tui,
	theme: Theme,
	keybindings: unknown,
	done: (value: undefined) => void,
) => CustomComponent;

type Ctx = {
	hasUI?: boolean;
	ui?: {
		notify?: (message: string, level: string) => void;
		custom?: (factory: CustomFactory, options?: { overlay?: boolean }) => Promise<unknown>;
	};
	sessionManager?: { getBranch?: () => unknown };
};

type Part = { type?: string; text?: string };
type Msg = { role?: string; content?: unknown; customType?: string; display?: boolean };
type Entry = { message?: Msg; timestamp?: string } & Msg;

type Turn = { text: string; stamp: string; reply: string };
type Row = { kind: "head" | "text" | "reply" | "gap"; index: number; label?: string; stamp?: string; text?: string };
type Built = { rows: Row[]; anchors: number[]; stamps: string[] };

/**
 * `getBranch()` is an untyped runtime boundary that has carried three shapes
 * (bare array, `{ messages }`, `{ entries }`). Every field of `Entry` is
 * optional and every read below is guarded, so the cast cannot widen anything.
 */
function entriesOf(ctx: Ctx): Entry[] {
	const branch: unknown = ctx.sessionManager?.getBranch?.();
	if (Array.isArray(branch)) return branch as Entry[];
	if (!branch || typeof branch !== "object") return [];
	const bag = branch as { messages?: unknown; entries?: unknown };
	if (Array.isArray(bag.messages)) return bag.messages as Entry[];
	if (Array.isArray(bag.entries)) return bag.entries as Entry[];
	return [];
}

/** Theme is supplied by the host; never let a palette miss break the overlay. */
function paint(theme: Theme | undefined, name: string, text: string): string {
	try {
		const painted = theme?.fg?.(name, text);
		return typeof painted === "string" ? painted : text;
	} catch {
		return text;
	}
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const out: string[] = [];
	for (const part of content as Part[]) {
		if (typeof part === "string") out.push(part);
		else if (part?.type === "text" && typeof part.text === "string") out.push(part.text);
	}
	return out.join("\n");
}

function clock(iso: string | undefined): string {
	if (!iso) return "";
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) return "";
	const pad = (n: number): string => String(n).padStart(2, "0");
	return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** Wrap one source line to `width`, preserving its original indentation. */
function wrapLine(raw: string, width: number, indent: string): string[] {
	const expanded = raw.replace(/\t/g, "    ");
	const lead = /^\s*/.exec(expanded)?.[0] ?? "";
	const body = expanded.slice(lead.length);
	if (!body) return [""];

	const prefix = indent + lead;
	const room = Math.max(8, width - prefix.length);
	const out: string[] = [];
	let current = "";

	for (const word of body.split(/\s+/)) {
		if (!word) continue;
		const candidate = current ? `${current} ${word}` : word;
		if (candidate.length <= room) {
			current = candidate;
			continue;
		}
		if (current) out.push(prefix + current);
		let rest = word;
		while (rest.length > room) {
			out.push(prefix + rest.slice(0, room));
			rest = rest.slice(room);
		}
		current = rest;
	}

	if (current) out.push(prefix + current);
	return out.length ? out : [""];
}

function wrapBlock(text: string, width: number, indent: string): string[] {
	const out: string[] = [];
	for (const raw of text.replace(/\r/g, "").split("\n")) out.push(...wrapLine(raw, width, indent));
	// Collapse blank runs so a long reply stays navigable.
	return out.filter((line, idx) => line !== "" || out[idx - 1] !== "");
}

/** One entry per user turn, carrying the assistant prose that answered it. */
function turnsOf(ctx: Ctx): Turn[] {
	const turns: Turn[] = [];
	for (const entry of entriesOf(ctx)) {
		const msg: Msg = entry.message ?? entry;
		if (msg.role === "user") {
			// Injected context blocks are not something Yash typed.
			if (msg.customType !== undefined || msg.display === false) continue;
			const text = textOf(msg.content).trim();
			if (text) turns.push({ text, stamp: clock(entry.timestamp), reply: "" });
			continue;
		}
		if (msg.role !== "assistant") continue;
		const open = turns[turns.length - 1];
		if (!open) continue;
		const reply = textOf(msg.content).trim();
		if (reply) open.reply = open.reply ? `${open.reply}\n\n${reply}` : reply;
	}
	return turns;
}

function build(turns: Turn[], width: number): Built {
	const pad = String(turns.length).length;
	const rows: Row[] = [];
	const anchors: number[] = [];
	const stamps: string[] = [];

	turns.forEach((turn, index) => {
		if (rows.length) rows.push({ kind: "gap", index });
		anchors.push(rows.length);
		stamps.push(turn.stamp);
		rows.push({ kind: "head", index, label: String(index + 1).padStart(pad, " "), stamp: turn.stamp });
		for (const line of wrapBlock(turn.text, width, INDENT)) rows.push({ kind: "text", index, text: line });
		if (turn.reply) {
			rows.push({ kind: "gap", index });
			for (const line of wrapBlock(turn.reply, width, INDENT)) rows.push({ kind: "reply", index, text: line });
		}
	});

	return { rows, anchors, stamps };
}

/** Raw terminal bytes → a key name we can switch on. */
function keyOf(data: string): string {
	if (data === "\x1b" || data === "\x1b\x1b") return "escape";

	const wheel = /^\x1b\[<(\d+);\d+;\d+[Mm]$/.exec(data);
	if (wheel) {
		if (wheel[1] === "64") return "wheelUp";
		if (wheel[1] === "65") return "wheelDown";
		return "";
	}

	// kitty / CSI-u: printable keys arrive as <codepoint>;<mods>u
	const csiU = /^\x1b\[(\d+)(?::\d+)*(?:;(\d+))?(?::\d+)*u$/.exec(data);
	if (csiU) {
		const code = Number(csiU[1]);
		if (code === 27) return "escape";
		const mods = csiU[2] ? Number(csiU[2]) : 1;
		if (mods !== 1 && mods !== 2) return "";
		try {
			return String.fromCodePoint(code);
		} catch {
			return "";
		}
	}

	const csi = /^\x1b(?:\[|O)(\d*)(?:;\d+)*([A-Z~])$/.exec(data);
	if (csi) {
		switch (csi[2]) {
			case "A":
				return "up";
			case "B":
				return "down";
			case "C":
				return "right";
			case "D":
				return "left";
			case "H":
				return "home";
			case "F":
				return "end";
			case "~":
				if (csi[1] === "5") return "pageUp";
				if (csi[1] === "6") return "pageDown";
				if (csi[1] === "1" || csi[1] === "7") return "home";
				if (csi[1] === "4" || csi[1] === "8") return "end";
				return "";
			default:
				return "";
		}
	}

	return data.length === 1 ? data : "";
}

function makeViewer(ctx: Ctx): CustomFactory {
	return (tui, theme, _keybindings, done) => {
		const turns = turnsOf(ctx);
		let cache: Built | null = null;
		let cacheWidth = -1;
		let offset = 0;
		let active = turns.length - 1;

		const viewHeight = (): number => Math.max(4, Math.max(8, process.stdout.rows ?? 40) - 4);
		// Stop one screenful from the end so the view is never mostly blank.
		const maxOffset = (built: Built): number => Math.max(0, built.rows.length - viewHeight());

		const ensure = (width: number): Built => {
			if (!cache || cacheWidth !== width) {
				cache = build(turns, width);
				cacheWidth = width;
				offset = Math.min(cache.anchors[active] ?? 0, maxOffset(cache));
			}
			return cache;
		};

		const jump = (built: Built, to: number): void => {
			if (built.anchors.length === 0) return;
			active = Math.min(Math.max(0, to), built.anchors.length - 1);
			offset = Math.min(built.anchors[active] ?? 0, maxOffset(built));
		};

		// Scrolling detaches from the anchor, so re-derive which message we're on.
		const sync = (built: Built): void => {
			let found = -1;
			for (let i = 0; i < built.anchors.length; i += 1) {
				if ((built.anchors[i] ?? 0) <= offset) found = i;
			}
			active = found;
		};

		// Narrow terminals: keep the tail of the hint and sacrifice its head.
		const bar = (width: number, label: string, hint: string): string => {
			const head = label.length > width ? label.slice(0, width) : label;
			const room = Math.max(0, width - head.length);
			const tail = hint.length > room ? hint.slice(hint.length - room) : hint;
			const fill = Math.max(0, width - head.length - tail.length);
			return (
				paint(theme, "accent", head) +
				paint(theme, "borderMuted", "─".repeat(fill)) +
				paint(theme, "dim", tail)
			);
		};

		const draw = (row: Row): string => {
			if (row.kind === "gap") return "";
			if (row.kind === "reply") return row.text ? paint(theme, "dim", row.text) : "";
			if (row.kind === "text") return row.text ? paint(theme, "text", row.text) : "";
			const live = row.index === active;
			return (
				paint(theme, live ? "accent" : "borderMuted", `${GUTTER} `) +
				paint(theme, live ? "accent" : "muted", row.label ?? "") +
				(row.stamp ? paint(theme, "dim", `  ${row.stamp}`) : "")
			);
		};

		return {
			render(width: number): string[] {
				const inner = Math.max(20, width);
				const height = viewHeight();

				if (turns.length === 0) {
					const empty = paint(theme, "dim", `${INDENT}You haven't said anything in this session yet.`);
					const filler: string[] = [];
					while (filler.length < height - 1) filler.push("");
					return [bar(inner, " your messages ", " q close "), empty, ...filler];
				}

				const built = ensure(inner);
				if (offset > maxOffset(built)) offset = maxOffset(built);
				if (offset < 0) offset = 0;

				const stamp = active >= 0 ? (built.stamps[active] ?? "") : "";
				const hint = ` ${Math.max(1, active + 1)} / ${turns.length}${stamp ? ` · ${stamp}` : ""} `;
				const body = built.rows.slice(offset, offset + height).map(draw);
				while (body.length < height) body.push("");

				return [
					bar(inner, " your messages ", hint),
					...body,
					bar(inner, "", " ctrl+↑↓ jump · PgUp/PgDn scroll · g/G ends · q close "),
				];
			},

			handleInput(data: string): void {
				if (turns.length === 0) {
					done(undefined);
					return;
				}

				const built = ensure(cacheWidth > 0 ? cacheWidth : Math.max(20, process.stdout.columns ?? 100));
				const height = viewHeight();
				const max = maxOffset(built);
				const key = keyOf(data);

				if (key === "escape" || key === "q") {
					done(undefined);
					return;
				}

				if (key === "up" || key === "k" || key === "p") jump(built, active - 1);
				else if (key === "down" || key === "j" || key === "n") jump(built, active + 1);
				else if (key === "g" || key === "home") jump(built, 0);
				else if (key === "G" || key === "end") jump(built, turns.length - 1);
				else if (key === "wheelUp") {
					offset = Math.max(0, offset - 2);
					sync(built);
				} else if (key === "wheelDown") {
					offset = Math.min(max, offset + 2);
					sync(built);
				} else if (key === "pageUp") {
					offset = Math.max(0, offset - height);
					sync(built);
				} else if (key === "pageDown") {
					offset = Math.min(max, offset + height);
					sync(built);
				} else return;

				tui.requestRender?.();
			},

			invalidate(): void {
				cache = null;
				cacheWidth = -1;
			},

			dispose(): void {
				cache = null;
			},
		};
	};
}

async function openViewer(ctx: Ctx): Promise<void> {
	const custom = ctx.ui?.custom;
	if (!ctx.hasUI || typeof custom !== "function") return;
	await custom(makeViewer(ctx), { overlay: true });
}

export default function jumpBack(pi: ExtensionAPI): void {
	pi.registerShortcut(CHORD, {
		description: "Jump back through your messages",
		handler: (ctx: Ctx) => openViewer(ctx),
	});

	pi.registerCommand("back", {
		description: "Scroll back through your previous messages",
		handler: async (_args: unknown, ctx: Ctx) => {
			await openViewer(ctx);
		},
	});
}
