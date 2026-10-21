import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { SNAPSHOT_PATH, type RawWindow, type Snapshot } from "./usage";

/**
 * Opt-in "Live usage": polls the same usage endpoint the claude.ai usage screen uses, so the deck also follows usage
 * from chat, not only from Claude Code. It is undocumented, so it may change or stop working.
 *
 * It borrows Claude Code's own sign-in (macOS Keychain, or ~/.claude/.credentials.json elsewhere), only ever reads it,
 * and never refreshes it, so it can't sign Claude Code out. The token goes to api.anthropic.com and nowhere else, and
 * is never logged. Results land in the same snapshot file the bridge and mod write, so everything else is unchanged.
 */

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const KEYCHAIN_SERVICE = "Claude Code-credentials";
const POLL_MS = 2 * 60_000;
/** After a 429 or a failed sign-in, wait longer before asking again. */
const BACKOFF_MS = 10 * 60_000;

type Logger = { info(...args: unknown[]): void; warn(...args: unknown[]): void };

type ApiWindow = { utilization?: number | null; resets_at?: string | null } | null | undefined;

export class LiveUsage {
	#timer: NodeJS.Timeout | undefined;
	#enabled = false;

	constructor(
		private readonly logger: Logger,
		private readonly onUpdate: () => void
	) {}

	setEnabled(enabled: boolean): void {
		if (enabled === this.#enabled) return;
		this.#enabled = enabled;
		clearTimeout(this.#timer);
		this.#timer = undefined;
		this.logger.info(`Live usage ${enabled ? "on" : "off"}`);
		if (enabled) void this.#poll();
	}

	async #poll(): Promise<void> {
		if (!this.#enabled) return;
		const wait = await this.#fetchOnce().catch((err: unknown) => {
			this.logger.warn(`Live usage failed: ${err instanceof Error ? err.message : String(err)}`);
			return BACKOFF_MS;
		});
		if (this.#enabled) this.#timer = setTimeout(() => void this.#poll(), wait);
	}

	/** One request; resolves to how long to wait before the next. */
	async #fetchOnce(): Promise<number> {
		const token = await readAccessToken();
		if (!token) {
			this.logger.warn("Live usage: no Claude Code sign-in found");
			return BACKOFF_MS;
		}

		const res = await fetch(USAGE_URL, {
			headers: { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20", Accept: "application/json" },
			signal: AbortSignal.timeout(15_000)
		});
		if (res.status === 401 || res.status === 403 || res.status === 429) {
			// 401: the token expired; Claude Code renews it next time it runs, and we pick that up then.
			this.logger.warn(`Live usage: HTTP ${res.status}`);
			return BACKOFF_MS;
		}
		if (!res.ok) throw new Error(`HTTP ${res.status}`);

		const body = (await res.json()) as { five_hour?: ApiWindow; seven_day?: ApiWindow };
		const fiveHour = toWindow(body.five_hour);
		const sevenDay = toWindow(body.seven_day);
		if (!fiveHour && !sevenDay) throw new Error("response had no usage windows");

		let previous: Partial<Snapshot> = {};
		try {
			previous = JSON.parse(await fs.readFile(SNAPSHOT_PATH, "utf8"));
		} catch {
			// First write.
		}
		const snapshot: Snapshot = {
			updated_at: Math.floor(Date.now() / 1000),
			five_hour: fiveHour ?? previous.five_hour,
			seven_day: sevenDay ?? previous.seven_day
		};
		await fs.mkdir(path.dirname(SNAPSHOT_PATH), { recursive: true });
		const tmp = `${SNAPSHOT_PATH}.${process.pid}.tmp`;
		await fs.writeFile(tmp, JSON.stringify(snapshot));
		await fs.rename(tmp, SNAPSHOT_PATH);
		this.onUpdate();
		return POLL_MS;
	}
}

function toWindow(w: ApiWindow): RawWindow | undefined {
	if (!w || typeof w.utilization !== "number" || !w.resets_at) return undefined;
	const resetsAt = Date.parse(w.resets_at);
	if (!Number.isFinite(resetsAt)) return undefined;
	return { used_percentage: w.utilization, resets_at: Math.floor(resetsAt / 1000) };
}

/** Claude Code's OAuth access token, or undefined when it isn't signed in. */
async function readAccessToken(): Promise<string | undefined> {
	let raw: string | undefined;
	if (process.platform === "darwin") {
		try {
			const { stdout } = await promisify(execFile)("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"]);
			raw = stdout;
		} catch {
			// Not in the Keychain; fall back to the file.
		}
	}
	if (!raw) {
		const dir = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
		raw = await fs.readFile(path.join(dir, ".credentials.json"), "utf8").catch(() => undefined);
	}
	if (!raw) return undefined;
	try {
		const token = JSON.parse(raw)?.claudeAiOauth?.accessToken;
		return typeof token === "string" && token ? token : undefined;
	} catch {
		return undefined;
	}
}
