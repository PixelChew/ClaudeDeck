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
 * It borrows Claude Code's own sign-in (macOS Keychain, or ~/.claude/.credentials.json elsewhere). When the access
 * token has expired it renews it with the refresh token and writes the new pair straight back where it found it:
 * refresh tokens rotate, so skipping the write would sign Claude Code out. Tokens go to Anthropic's own endpoints and
 * nowhere else, and are never logged. Results land in the same snapshot file the bridge and mod write, so everything else is unchanged.
 */

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
/** Renew this long before the token actually expires. */
const EXPIRY_MARGIN_MS = 60_000;
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
		const token = await getAccessToken();
		if (!token) {
			// Cheap to check, so look again soon: signing in to Claude Code makes it appear.
			this.logger.warn("Live usage: no Claude Code sign-in found");
			return POLL_MS;
		}

		const res = await fetch(USAGE_URL, {
			headers: { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20", Accept: "application/json" },
			signal: AbortSignal.timeout(15_000)
		});
		if (res.status === 401 || res.status === 403 || res.status === 429) {
			// 401 despite a renewal attempt; try again later.
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

type Credentials = { claudeAiOauth?: { accessToken?: string; refreshToken?: string; expiresAt?: number; [key: string]: unknown }; [key: string]: unknown };

type Store = { creds: Credentials; save(creds: Credentials): Promise<void> };

const exec = promisify(execFile);

/** Reads Claude Code's stored sign-in, with a way to write it back to the same place. */
async function readStore(): Promise<Store | undefined> {
	if (process.platform === "darwin") {
		try {
			const { stdout } = await exec("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"]);
			const creds = JSON.parse(stdout) as Credentials;
			const { stdout: attrs } = await exec("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE]);
			const account = /"acct"<blob>="([^"]*)"/.exec(attrs)?.[1] ?? os.userInfo().username;
			return {
				creds,
				save: async (next) => {
					await exec("security", ["add-generic-password", "-U", "-s", KEYCHAIN_SERVICE, "-a", account, "-w", JSON.stringify(next)]);
				}
			};
		} catch {
			// Not in the Keychain; fall back to the file.
		}
	}
	const file = path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude"), ".credentials.json");
	try {
		const creds = JSON.parse(await fs.readFile(file, "utf8")) as Credentials;
		return {
			creds,
			save: async (next) => {
				const tmp = `${file}.${process.pid}.tmp`;
				await fs.writeFile(tmp, JSON.stringify(next), { mode: 0o600 });
				await fs.rename(tmp, file);
			}
		};
	} catch {
		return undefined;
	}
}

/** Claude Code's OAuth access token, renewed first if it has expired; undefined when it isn't signed in. */
async function getAccessToken(): Promise<string | undefined> {
	const store = await readStore();
	const oauth = store?.creds.claudeAiOauth;
	if (!store || !oauth?.accessToken) return undefined;
	if (typeof oauth.expiresAt !== "number" || oauth.expiresAt - EXPIRY_MARGIN_MS > Date.now() || !oauth.refreshToken) {
		return oauth.accessToken;
	}

	// Re-read right before writing so a renewal Claude Code did meanwhile isn't overwritten.
	const res = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify({ grant_type: "refresh_token", refresh_token: oauth.refreshToken, client_id: CLIENT_ID }),
		signal: AbortSignal.timeout(15_000)
	});
	if (!res.ok) {
		// Claude Code may have renewed it itself in the meantime.
		const again = (await readStore())?.creds.claudeAiOauth;
		if (again?.accessToken && again.accessToken !== oauth.accessToken) return again.accessToken;
		throw new Error(`token refresh HTTP ${res.status}`);
	}
	const body = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
	if (!body.access_token) throw new Error("token refresh returned no access token");

	const latest = await readStore();
	const next: Credentials = {
		...(latest?.creds ?? store.creds),
		claudeAiOauth: {
			...(latest?.creds.claudeAiOauth ?? oauth),
			accessToken: body.access_token,
			refreshToken: body.refresh_token ?? oauth.refreshToken,
			expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000
		}
	};
	await (latest ?? store).save(next);
	return body.access_token;
}
