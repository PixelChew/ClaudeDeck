import type { UsageState, WindowState } from "./usage";

export type DisplayMode = "left" | "used";

/** How an action draws: which number it shows, and whether it drops the colours for plain white and grey. */
export type Style = { mode: DisplayMode; monotone: boolean };

const FONT = "Arial, Helvetica, sans-serif";
const BG = "#111111";
const TRACK = "#2a2a2a";
const ACCENT = "#d97757";
const MUTED = "#9a9a9a";
const STALE = "#ffb020";
const WARN = "#ff4d4f";

/** Snapshots older than this get an "Xh old" marker, since Claude Code only reports while you use it. */
const STALE_AFTER = 60 * 60;

export type WindowKind = "fiveHour" | "sevenDay";

const LABELS: Record<WindowKind, { long: string; short: string; dial: string }> = {
	fiveHour: { long: "5-HOUR", short: "5H", dial: "5-Hour" },
	sevenDay: { long: "WEEKLY", short: "WK", dial: "Week" }
};

/** Green while there's plenty left, amber when it's getting low, red when nearly out. */
export function colourFor(left: number, monotone = false): string {
	if (monotone) return "#ffffff";
	if (left >= 50) return "#3ddc84";
	if (left >= 20) return STALE;
	return WARN;
}

function labelColour(style: Style): string {
	return style.monotone ? "#cfcfcf" : ACCENT;
}

function staleColour(style: Style): string {
	return style.monotone ? MUTED : STALE;
}

/**
 * Outlined warning triangle with an exclamation mark, shown when the weekly window is on pace to run out before it
 * resets. (x, y) is the top-left of a size-wide box; the triangle's base sits at y + size.
 */
function warningIcon(x: number, y: number, size: number, style: Style): string {
	const colour = style.monotone ? "#ffffff" : WARN;
	const stroke = size * 0.11;
	// Inset by half the stroke so the outline stays inside the box.
	const i = stroke / 2;
	const top = y + size * 0.1 + i;
	const bottom = y + size - i;
	const h = bottom - top;
	const cx = x + size / 2;
	const triangle = `<path d="M${cx} ${top} L${x + size - i} ${bottom} L${x + i} ${bottom} Z" fill="none" stroke="${colour}" stroke-width="${stroke}" stroke-linejoin="round"/>`;
	const mark = `<line x1="${cx}" y1="${top + h * 0.36}" x2="${cx}" y2="${top + h * 0.64}" stroke="${colour}" stroke-width="${stroke}" stroke-linecap="round"/>` + `<circle cx="${cx}" cy="${top + h * 0.82}" r="${stroke * 0.6}" fill="${colour}"/>`;
	return triangle + mark;
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
export function renderWindowKey(kind: WindowKind, state: UsageState | undefined, style: Style): string {
	const { mode } = style;
	const win = state?.[kind];
	// With the warning icon in the top-right corner, the label shifts left to keep clear of it.
	let body = `<rect width="144" height="144" fill="${BG}"/>` + text(win?.runsOut ? 62 : 72, 22, 20, labelColour(style), LABELS[kind].long, "middle", "bold");

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
	const colour = colourFor(win.left, style.monotone);
	if (fraction > 0) {
		body += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${colour}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${(fraction * circumference).toFixed(2)} ${circumference.toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`;
	}

	const pct = percentText(win, mode);
	const stale = staleText(state);
	body += text(cx, stale ? cy + 8 : cy + 12, pct.length > 3 ? 28 : 34, "#ffffff", pct, "middle", "bold");

	// Top-right corner, beside the label: on pace to run out before the reset.
	if (win.runsOut) body += warningIcon(118, 5, 20, style);

	// Under the number, only when Claude Code hasn't reported for a while: how old the numbers are.
	if (stale) body += text(cx, cy + 28, 14, staleColour(style), stale);
	return svgUrl(144, 144, body);
}

/** warnValue: a smaller number size for a row that also carries the warning icon, where the row is too narrow for both. */
type RowSizes = { label: number; value: number; unit: number; bar: number; warnValue?: number };

/** Draws one labelled bar row; shared by the combined key and the dial. */
function row(kind: WindowKind, win: WindowState | undefined, style: Style, y: number, width: number, sizes: RowSizes, stale: string | undefined, label: "short" | "dial" = "short"): string {
	const { mode } = style;
	const pad = 10;
	const baseline = y + sizes.value;
	const barY = baseline + 6;
	let out = text(pad, baseline, sizes.label, labelColour(style), LABELS[kind][label], "start", "bold");

	if (!win) {
		out += text(width - pad, baseline, sizes.value, MUTED, "--", "end", "bold");
		out += bar(pad, barY, width - pad * 2, sizes.bar, 0, MUTED);
		return out;
	}

	// After the number, only when the numbers have gone stale: how old they are.
	const unit = stale ? `<tspan font-size="${sizes.unit}" font-weight="normal" fill="${staleColour(style)}"> ${stale}</tspan>` : "";
	// The warning sits just left of the number. SVG can't measure text, so the number's width is estimated from
	// Arial Bold's average digit width.
	const valueEnd = width - pad;
	let valueSize = sizes.value;
	if (win.runsOut) {
		valueSize = sizes.warnValue ?? sizes.value;
		const icon = Math.round(valueSize * 0.8);
		const valueWidth = percentText(win, mode).length * valueSize * 0.66;
		out += warningIcon(valueEnd - valueWidth - 6 - icon, baseline - icon, icon, style);
	}
	out += text(valueEnd, baseline, valueSize, "#ffffff", `${percentText(win, mode)}${unit}`, "end", "bold");
	out += bar(pad, barY, width - pad * 2, sizes.bar, (mode === "left" ? win.left : win.used) / 100, colourFor(win.left, style.monotone));
	return out;
}

/** 5H + weekly key: two stacked bars. 144x144. */
export function renderCombinedKey(state: UsageState | undefined, style: Style): string {
	const sizes = { label: 22, value: 28, unit: 13, bar: 14, warnValue: 23 };
	let body = `<rect width="144" height="144" fill="${BG}"/>`;
	if (!state) {
		return svgUrl(144, 144, body + emptyMessage(72, 66, 15, 12, style));
	}

	const stale = staleText(state);
	body += row("fiveHour", state.fiveHour, style, 14, 144, sizes, stale);
	body += row("sevenDay", state.sevenDay, style, 82, 144, sizes, stale);
	return svgUrl(144, 144, body);
}

/** 5H + weekly dial: Stream Deck + touch strip segment. 200x100. */
export function renderDial(state: UsageState | undefined, style: Style): string {
	const sizes = { label: 20, value: 26, unit: 14, bar: 11 };
	// No background fill, so the touch strip's own background shows through.
	let body = "";
	if (!state) {
		return svgUrl(200, 100, body + emptyMessage(100, 46, 15, 12, style));
	}

	const stale = staleText(state);
	body += row("fiveHour", state.fiveHour, style, 2, 200, sizes, stale, "dial");
	body += row("sevenDay", state.sevenDay, style, 51, 200, sizes, stale, "dial");
	return svgUrl(200, 100, body);
}

/** Shown before the bridge has written anything. */
function emptyMessage(x: number, y: number, titleSize: number, bodySize: number, style: Style): string {
	return text(x, y, titleSize, labelColour(style), "CLAUDE USAGE", "middle", "bold") + text(x, y + bodySize + 8, bodySize, MUTED, "waiting for Claude Code");
}
