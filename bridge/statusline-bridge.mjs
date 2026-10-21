#!/usr/bin/env node
// Claude Code status-line bridge for the Claude Usage Stream Deck plugin.
//
// Claude Code pipes session JSON (including rate_limits for Pro/Max) into the status-line command on every update.
// This script saves the 5-hour and weekly windows to ~/.claude/streamdeck-usage.json for the plugin, then prints a
// status line. Pass --chain "<command>" to keep an existing status line: it gets the same JSON and its output is shown.
//
// No network, no tokens: it only reads what Claude Code already hands to status-line scripts.

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SNAPSHOT = process.env.CLAUDE_USAGE_SNAPSHOT ?? path.join(os.homedir(), ".claude", "streamdeck-usage.json");

const stdin = fs.readFileSync(0, "utf8");
let input = {};
try {
	input = JSON.parse(stdin);
} catch {
	// Not JSON (e.g. run by hand); fall through and just print.
}

const limits = input.rate_limits;
const isWindow = (w) => w && typeof w.used_percentage === "number" && typeof w.resets_at === "number";

if (limits && (isWindow(limits.five_hour) || isWindow(limits.seven_day))) {
	let previous = {};
	try {
		previous = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
	} catch {
		// First run.
	}

	// A window can be missing from one update (e.g. right after it resets); keep the last known value and let the
	// plugin work out from resets_at whether it has rolled over.
	const snapshot = {
		updated_at: Math.floor(Date.now() / 1000),
		five_hour: isWindow(limits.five_hour) ? pick(limits.five_hour) : previous.five_hour,
		seven_day: isWindow(limits.seven_day) ? pick(limits.seven_day) : previous.seven_day
	};

	try {
		fs.mkdirSync(path.dirname(SNAPSHOT), { recursive: true });
		const tmp = `${SNAPSHOT}.${process.pid}.tmp`;
		fs.writeFileSync(tmp, JSON.stringify(snapshot));
		fs.renameSync(tmp, SNAPSHOT);
	} catch {
		// Never break the status line over a write failure.
	}
}

const chainIndex = process.argv.indexOf("--chain");
if (chainIndex !== -1 && process.argv[chainIndex + 1]) {
	try {
		process.stdout.write(execSync(process.argv[chainIndex + 1], { input: stdin, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }));
	} catch {
		// Previous status line failed; show nothing rather than an error.
	}
} else {
	const parts = [];
	if (isWindow(limits?.five_hour)) parts.push(`5h ${Math.round(100 - limits.five_hour.used_percentage)}% left`);
	if (isWindow(limits?.seven_day)) parts.push(`wk ${Math.round(100 - limits.seven_day.used_percentage)}% left`);
	process.stdout.write([input.model?.display_name, ...parts].filter(Boolean).join(" · "));
}

function pick(w) {
	return { used_percentage: w.used_percentage, resets_at: w.resets_at };
}
