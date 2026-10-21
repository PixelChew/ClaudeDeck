#!/usr/bin/env node
// Installs the status-line bridge: copies it to ~/.claude/ and points Claude Code's statusLine at it.
// An existing statusLine is kept by chaining it (its output still shows), and settings.json is backed up first.
//
//   node bridge/install.mjs            install / update
//   node bridge/install.mjs --remove   restore the previous statusLine

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const claudeDir = path.join(os.homedir(), ".claude");
const settingsPath = path.join(claudeDir, "settings.json");
const target = path.join(claudeDir, "streamdeck-usage-bridge.mjs");
const source = path.join(path.dirname(fileURLToPath(import.meta.url)), "statusline-bridge.mjs");
const previousPath = path.join(claudeDir, "streamdeck-usage-previous-statusline.json");
const MARKER = "streamdeck-usage-bridge.mjs";

// The old statusLine is kept in its own file, not settings.json, so Claude Code never sees an unknown setting.
const readPrevious = () => (fs.existsSync(previousPath) ? JSON.parse(fs.readFileSync(previousPath, "utf8")) : undefined);

fs.mkdirSync(claudeDir, { recursive: true });

let settings = {};
if (fs.existsSync(settingsPath)) {
	settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
	fs.copyFileSync(settingsPath, `${settingsPath}.bak-streamdeck`);
}

const current = settings.statusLine;
const installed = current?.command?.includes(MARKER);

if (process.argv.includes("--remove")) {
	if (!installed) {
		console.log("Bridge isn't installed; nothing to do.");
		process.exit(0);
	}
	const previous = readPrevious();
	if (previous) {
		settings.statusLine = previous;
	} else {
		delete settings.statusLine;
	}
	fs.rmSync(previousPath, { force: true });
	fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
	console.log("Restored your previous status line.");
	process.exit(0);
}

fs.copyFileSync(source, target);

// Use the absolute path to node and the script so it works the same from Git Bash, PowerShell, zsh, etc.
// Forward slashes keep Windows paths shell-safe.
const quote = (p) => `"${p.replace(/\\/g, "/")}"`;
let command = `${quote(process.execPath)} ${quote(target)}`;

const previous = installed ? readPrevious() : current;
if (previous?.type === "command" && previous.command) {
	command += ` --chain ${JSON.stringify(previous.command)}`;
	fs.writeFileSync(previousPath, JSON.stringify(previous, null, 2) + "\n");
}

settings.statusLine = { ...(previous ?? {}), type: "command", command };
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");

console.log(`Bridge copied to ${target}`);
console.log(`statusLine set in ${settingsPath}${previous ? " (your old status line is chained, so it still shows)" : ""}`);
console.log("Send one message in Claude Code, then check ~/.claude/streamdeck-usage.json exists.");
