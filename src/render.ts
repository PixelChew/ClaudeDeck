import type { UsageState, WindowState } from "./usage";

export type DisplayMode = "left" | "used";

const FONT = "Arial, Helvetica, sans-serif";
const BG = "#111111";
const TRACK = "#2a2a2a";
const ACCENT = "#d97757";
const MUTED = "#9a9a9a";
const STALE = "#ffb020";

/** Snapshots older than this get an "Xh old" marker, since Claude Code only reports while you use it. */
const STALE_AFTER = 60 * 60;

export type WindowKind = "fiveHour" | "sevenDay";

const LABELS: Record<WindowKind, { long: string; short: string }> = {
	fiveHour: { long: "5-HOUR", short: "5H" },
	sevenDay: { long: "WEEKLY", short: "WK" }
};

/** Green while there's plenty left, amber when it's getting low, red when nearly out. */
export function colourFor(left: number): string {
	if (left >= 50) return "#3ddc84";
	if (left >= 20) return STALE;
	return "#ff4d4f";
}

/** 42m, 2h 14m, 3d 4h. */
export function formatDuration(seconds: number): string {
	const mins = Math.max(0, Math.floor(seconds / 60));
	if (mins < 60) return `${mins}m`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ${mins % 60}m`;
	return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function percentText(win: WindowState, mode: DisplayMode): string {
	return `${Math.round(mode === "left" ? win.left : win.used)}%`;
}

function resetText(win: WindowState): string {
	return win.reset || win.resetsIn === undefined ? "window reset" : `resets ${formatDuration(win.resetsIn)}`;
}

function staleText(state: UsageState): string | undefined {
	if (state.age < STALE_AFTER) return undefined;
	const hours = Math.floor(state.age / 3600);
	return hours < 24 ? `${hours}h old` : `${Math.floor(hours / 24)}d old`;
}

function svgUrl(width: number, height: number, body: string): string {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
	return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function text(x: number, y: number, size: number, fill: string, content: string, anchor = "middle", weight = "normal"): string {
	return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${content}</text>`;
}

function bar(x: number, y: number, width: number, height: number, fraction: number, fill: string): string {
	const filled = Math.max(0, Math.min(1, fraction)) * width;
	const r = height / 2;
	return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${r}" fill="${TRACK}"/>` + (filled > 0 ? `<rect x="${x}" y="${y}" width="${Math.max(filled, height)}" height="${height}" rx="${r}" fill="${fill}"/>` : "");
}

/** Single-window key: ring gauge with the percentage in the middle. 144x144. */
export function renderWindowKey(kind: WindowKind, state: UsageState | undefined, mode: DisplayMode): string {
	const win = state?.[kind];
	let body = `<rect width="144" height="144" fill="${BG}"/>` + text(72, 22, 15, ACCENT, LABELS[kind].long, "middle", "bold");

	const cx = 72;
	const cy = 76;
	const r = 38;
	const circumference = 2 * Math.PI * r;
	body += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${TRACK}" stroke-width="10"/>`;

	if (!state || !win) {
		body += text(cx, cy + 9, 28, MUTED, "--", "middle", "bold");
		body += text(72, 136, 12, MUTED, "use Claude Code");
		return svgUrl(144, 144, body);
	}

	const fraction = (mode === "left" ? win.left : win.used) / 100;
	const colour = colourFor(win.left);
	if (fraction > 0) {
		body += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${colour}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(fraction * circumference).toFixed(2)} ${circumference.toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`;
	}

	const pct = percentText(win, mode);
	body += text(cx, cy + 8, pct.length > 3 ? 22 : 26, "#ffffff", pct, "middle", "bold");

	// Inside the ring: "left"/"used", or how old the numbers are when Claude Code hasn't reported for a while.
	const stale = staleText(state);
	body += stale ? text(cx, cy + 22, 11, STALE, stale) : text(cx, cy + 22, 11, MUTED, mode);
	body += text(72, 136, 13, MUTED, resetText(win));
	return svgUrl(144, 144, body);
}

/** Draws one labelled bar row; shared by the combined key and the dial. */
function row(kind: WindowKind, win: WindowState | undefined, mode: DisplayMode, y: number, width: number, sizes: { label: number; value: number; reset: number }): string {
	const pad = 10;
	let out = text(pad, y + sizes.value - 4, sizes.label, ACCENT, LABELS[kind].short, "start", "bold");

	if (!win) {
		out += text(width - pad, y + sizes.value - 4, sizes.value, MUTED, "--", "end", "bold");
		out += bar(pad, y + sizes.value + 2, width - pad * 2, 9, 0, MUTED);
		return out;
	}

	const value = `${percentText(win, mode)}<tspan font-size="${sizes.reset}" font-weight="normal" fill="${MUTED}"> ${mode}</tspan>`;
	out += text(width - pad, y + sizes.value - 4, sizes.value, "#ffffff", value, "end", "bold");
	out += bar(pad, y + sizes.value + 2, width - pad * 2, 9, (mode === "left" ? win.left : win.used) / 100, colourFor(win.left));
	out += text(pad, y + sizes.value + 2 + 9 + sizes.reset + 2, sizes.reset, MUTED, resetText(win), "start");
	return out;
}

/** 5H + weekly key: two stacked bars. 144x144. */
export function renderCombinedKey(state: UsageState | undefined, mode: DisplayMode): string {
	const sizes = { label: 16, value: 20, reset: 12 };
	let body = `<rect width="144" height="144" fill="${BG}"/>`;
	if (!state) {
		return svgUrl(144, 144, body + emptyMessage(72, 66, 15, 12));
	}

	body += row("fiveHour", state.fiveHour, mode, 6, 144, sizes);
	body += row("sevenDay", state.sevenDay, mode, 72, 144, sizes);
	const stale = staleText(state);
	if (stale) body += text(134, 138, 11, STALE, stale, "end");
	return svgUrl(144, 144, body);
}

/** 5H + weekly dial: Stream Deck + touch strip segment. 200x100. */
export function renderDial(state: UsageState | undefined, mode: DisplayMode): string {
	const sizes = { label: 14, value: 16, reset: 11 };
	let body = `<rect width="200" height="100" fill="${BG}"/>`;
	if (!state) {
		return svgUrl(200, 100, body + emptyMessage(100, 46, 15, 12));
	}

	body += row("fiveHour", state.fiveHour, mode, 2, 200, sizes);
	body += row("sevenDay", state.sevenDay, mode, 51, 200, sizes);
	const stale = staleText(state);
	if (stale) body += text(190, 96, 11, STALE, stale, "end");
	return svgUrl(200, 100, body);
}

/** Shown before the bridge has written anything. */
function emptyMessage(x: number, y: number, titleSize: number, bodySize: number): string {
	return text(x, y, titleSize, ACCENT, "CLAUDE USAGE", "middle", "bold") + text(x, y + bodySize + 8, bodySize, MUTED, "waiting for Claude Code");
}
