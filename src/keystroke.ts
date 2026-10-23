import { execFile } from "node:child_process";
import { platform } from "node:os";

const MAC_KEY_CODES: Record<string, number> = {
	space: 49, return: 36, enter: 36, tab: 48, escape: 53, esc: 53, delete: 51, backspace: 51, capslock: 57,
	left: 123, right: 124, down: 125, up: 126,
	f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111,
};

const WIN_KEYS: Record<string, string> = {
	space: " ", return: "{ENTER}", enter: "{ENTER}", tab: "{TAB}", escape: "{ESC}", esc: "{ESC}", delete: "{DEL}", backspace: "{BS}",
	left: "{LEFT}", right: "{RIGHT}", up: "{UP}", down: "{DOWN}", capslock: "{CAPSLOCK}",
};

type Parsed = { mods: Set<string>; key: string };

/** Parses "ctrl+alt+space" style accelerators (case-insensitive; cmd/command/meta/win/super are all "cmd"). */
export function parseShortcut(text: string): Parsed | undefined {
	const parts = text.toLowerCase().split("+").map((p) => p.trim()).filter(Boolean);
	const key = parts.pop();
	if (!key) return undefined;
	const mods = new Set<string>();
	for (const part of parts) {
		const mod = { control: "ctrl", option: "alt", command: "cmd", meta: "cmd", win: "cmd", super: "cmd" }[part] ?? part;
		if (!["ctrl", "alt", "shift", "cmd"].includes(mod)) return undefined;
		mods.add(mod);
	}
	return { mods, key };
}

function run(file: string, args: string[]): Promise<void> {
	return new Promise((resolve, reject) => execFile(file, args, { windowsHide: true, timeout: 10_000 }, (err) => (err ? reject(err) : resolve())));
}

/** Presses a keyboard shortcut system-wide. macOS needs Accessibility permission for Stream Deck; Windows has no prompt. */
export async function sendShortcut(text: string): Promise<void> {
	const parsed = parseShortcut(text);
	if (!parsed) throw new Error(`Unrecognised shortcut "${text}"`);
	const { mods, key } = parsed;

	if (platform() === "win32") {
		const f = /^f([1-9]|1[0-2])$/.test(key) ? `{${key.toUpperCase()}}` : undefined;
		const body = f ?? WIN_KEYS[key] ?? (key.length === 1 ? key.replace(/[+^%~(){}[\]]/, (c) => `{${c}}`) : undefined);
		if (body === undefined) throw new Error(`Unsupported key "${key}"`);
		const prefix = (mods.has("ctrl") ? "^" : "") + (mods.has("alt") ? "%" : "") + (mods.has("shift") ? "+" : "");
		const send = `${prefix}${prefix && body.length > 1 && !body.startsWith("{") ? `(${body})` : body}`;
		await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
			`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${send.replace(/'/g, "''")}')`]);
		return;
	}

	const using = [mods.has("cmd") && "command down", mods.has("ctrl") && "control down", mods.has("alt") && "option down", mods.has("shift") && "shift down"].filter(Boolean).join(", ");
	const code = MAC_KEY_CODES[key];
	if (code === undefined && key.length !== 1) throw new Error(`Unsupported key "${key}"`);
	const action = code !== undefined ? `key code ${code}` : `keystroke "${key.replace(/["\\]/g, "\\$&")}"`;
	await run("osascript", ["-e", `tell application "System Events" to ${action}${using ? ` using {${using}}` : ""}`]);
}

/** Opens a URL with the OS default handler (claude:// is registered by the Claude desktop app on both platforms). */
export function openUrl(url: string): Promise<void> {
	return platform() === "win32" ? run("cmd.exe", ["/c", "start", "", url]) : run("open", [url]);
}
