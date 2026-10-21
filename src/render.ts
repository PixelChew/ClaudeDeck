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

function percentText(win: WindowState, mode: DisplayMode): string {
	return `${Math.round(mode === "left" ? win.left : win.used)}%`;
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
	let body = `<rect width="144" height="144" fill="${BG}"/>` + text(72, 22, 20, ACCENT, LABELS[kind].long, "middle", "bold");

	const cx = 72;
	const cy = 84;
	const r = 48;
	const circumference = 2 * Math.PI * r;
	body += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${TRACK}" stroke-width="12"/>`;

	if (!state || !win) {
		body += text(cx, cy + 12, 36, MUTED, "--", "middle", "bold");
		return svgUrl(144, 144, body);
	}

	const fraction = (mode === "left" ? win.left : win.used) / 100;
	const colour = colourFor(win.left);
	if (fraction > 0) {
		body += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${colour}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${(fraction * circumference).toFixed(2)} ${circumference.toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`;
	}

	const pct = percentText(win, mode);
	body += text(cx, cy + 10, pct.length > 3 ? 28 : 34, "#ffffff", pct, "middle", "bold");

	// Inside the ring: "left"/"used", or how old the numbers are when Claude Code hasn't reported for a while.
	const stale = staleText(state);
	body += stale ? text(cx, cy + 28, 14, STALE, stale) : text(cx, cy + 28, 14, MUTED, mode);
	return svgUrl(144, 144, body);
}

type RowSizes = { label: number; value: number; unit: number; bar: number };

/** Draws one labelled bar row; shared by the combined key and the dial. */
function row(kind: WindowKind, win: WindowState | undefined, mode: DisplayMode, y: number, width: number, sizes: RowSizes, stale: string | undefined): string {
	const pad = 10;
	const baseline = y + sizes.value;
	const barY = baseline + 6;
	let out = text(pad, baseline, sizes.label, ACCENT, LABELS[kind].short, "start", "bold");

	if (!win) {
		out += text(width - pad, baseline, sizes.value, MUTED, "--", "end", "bold");
		out += bar(pad, barY, width - pad * 2, sizes.bar, 0, MUTED);
		return out;
	}

	// The small word after the number is "left"/"used", or how old the numbers are when they've gone stale.
	const unit = stale ? `<tspan font-size="${sizes.unit}" font-weight="normal" fill="${STALE}"> ${stale}</tspan>` : `<tspan font-size="${sizes.unit}" font-weight="normal" fill="${MUTED}"> ${mode}</tspan>`;
	out += text(width - pad, baseline, sizes.value, "#ffffff", `${percentText(win, mode)}${unit}`, "end", "bold");
	out += bar(pad, barY, width - pad * 2, sizes.bar, (mode === "left" ? win.left : win.used) / 100, colourFor(win.left));
	return out;
}

/** 5H + weekly key: two stacked bars. 144x144. */
export function renderCombinedKey(state: UsageState | undefined, mode: DisplayMode): string {
	const sizes = { label: 22, value: 28, unit: 13, bar: 14 };
	let body = `<rect width="144" height="144" fill="${BG}"/>`;
	if (!state) {
		return svgUrl(144, 144, body + emptyMessage(72, 66, 15, 12));
	}

	const stale = staleText(state);
	body += row("fiveHour", state.fiveHour, mode, 14, 144, sizes, stale);
	body += row("sevenDay", state.sevenDay, mode, 82, 144, sizes, stale);
	return svgUrl(144, 144, body);
}

/** 5H + weekly dial: Stream Deck + touch strip segment. 200x100. */
export function renderDial(state: UsageState | undefined, mode: DisplayMode): string {
	const sizes = { label: 20, value: 26, unit: 14, bar: 11 };
	let body = `<rect width="200" height="100" fill="${BG}"/>`;
	if (!state) {
		return svgUrl(200, 100, body + emptyMessage(100, 46, 15, 12));
	}

	const stale = staleText(state);
	body += row("fiveHour", state.fiveHour, mode, 2, 200, sizes, stale);
	body += row("sevenDay", state.sevenDay, mode, 51, 200, sizes, stale);
	return svgUrl(200, 100, body);
}

/** Shown before the bridge has written anything. */
function emptyMessage(x: number, y: number, titleSize: number, bodySize: number): string {
	return text(x, y, titleSize, ACCENT, "CLAUDE USAGE", "middle", "bold") + text(x, y + bodySize + 8, bodySize, MUTED, "waiting for Claude Code");
}
