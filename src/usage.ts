import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Where the status-line bridge (bridge/statusline-bridge.mjs) writes its snapshot.
 * Override with the CLAUDE_USAGE_SNAPSHOT environment variable if you need to.
 */
export const SNAPSHOT_PATH = process.env.CLAUDE_USAGE_SNAPSHOT ?? path.join(os.homedir(), ".claude", "streamdeck-usage.json");

/** One rate-limit window as Claude Code reports it: percent used (0-100) and reset time (Unix seconds). */
export type RawWindow = {
	used_percentage: number;
	resets_at: number;
};

/** The file the bridge writes. */
export type Snapshot = {
	updated_at: number;
	five_hour?: RawWindow;
	seven_day?: RawWindow;
};

/** A window resolved against the current time. */
export type WindowState = {
	used: number;
	left: number;
	/** Seconds until reset, or undefined when the window already reset. */
	resetsIn: number | undefined;
	/** True when the reset time has passed, so the window is fresh. */
	reset: boolean;
};

export type UsageState = {
	fiveHour: WindowState | undefined;
	sevenDay: WindowState | undefined;
	/** Seconds since Claude Code last reported numbers. */
	age: number;
};

export function resolveWindow(raw: RawWindow | undefined, now: number): WindowState | undefined {
	if (!raw || typeof raw.used_percentage !== "number" || typeof raw.resets_at !== "number") {
		return undefined;
	}

	// Claude Code drops a window once it resets, so a past resets_at means the window is full again.
	if (raw.resets_at <= now) {
		return { used: 0, left: 100, resetsIn: undefined, reset: true };
	}

	const used = clamp(raw.used_percentage, 0, 100);
	return { used, left: 100 - used, resetsIn: raw.resets_at - now, reset: false };
}

export function resolveSnapshot(snapshot: Snapshot | undefined, now: number): UsageState | undefined {
	if (!snapshot) {
		return undefined;
	}

	return {
		fiveHour: resolveWindow(snapshot.five_hour, now),
		sevenDay: resolveWindow(snapshot.seven_day, now),
		age: Math.max(0, now - snapshot.updated_at)
	};
}

/**
 * Polls the snapshot file and caches the last good read. Polling a tiny file every few seconds is cheaper and far
 * more reliable across macOS and Windows than fs.watch, which misses atomic rename-over writes.
 */
export class UsageSource {
	#snapshot: Snapshot | undefined;
	#mtimeMs = 0;
	#timer: NodeJS.Timeout | undefined;
	#listeners = new Set<() => void>();

	constructor(private readonly file = SNAPSHOT_PATH) {}

	get snapshot(): Snapshot | undefined {
		return this.#snapshot;
	}

	state(now = Date.now() / 1000): UsageState | undefined {
		return resolveSnapshot(this.#snapshot, now);
	}

	onChange(listener: () => void): void {
		this.#listeners.add(listener);
	}

	start(intervalMs = 5000): void {
		if (this.#timer) {
			return;
		}

		void this.refresh();
		this.#timer = setInterval(() => void this.refresh(), intervalMs);
	}

	/** Re-reads the file if it changed (or always, when forced). Returns true when new data was loaded. */
	async refresh(force = false): Promise<boolean> {
		try {
			const stat = await fs.stat(this.file);
			if (!force && stat.mtimeMs === this.#mtimeMs) {
				return false;
			}

			const parsed = JSON.parse(await fs.readFile(this.file, "utf8")) as Snapshot;
			if (typeof parsed?.updated_at !== "number") {
				return false;
			}

			this.#mtimeMs = stat.mtimeMs;
			this.#snapshot = parsed;
			this.#listeners.forEach((listener) => listener());
			return true;
		} catch {
			// Missing file (bridge not set up yet) or a half-written read; keep the last good snapshot.
			return false;
		}
	}
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
