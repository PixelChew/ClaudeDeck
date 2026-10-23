import streamDeck, { action, KeyDownEvent, SingletonAction } from "@elgato/streamdeck";

import { openUrl, sendShortcut } from "../keystroke";

type VoiceSettings = { shortcut?: string; delay?: number | string };

// The Claude desktop app has no claude:// route for voice. This is the closest supported path: a fresh chat (a real
// deep link, which also launches or focuses the app), then the user's own Claude voice/dictation hotkey.
const NEW_CHAT = "claude://claude.ai/new?surface=chat";

/** Opens Claude in a new chat and presses the voice / dictation hotkey configured in Claude's settings. */
@action({ UUID: "com.pixelchew.claude-usage.voice" })
export class VoiceKey extends SingletonAction<VoiceSettings> {
	override async onKeyDown(ev: KeyDownEvent<VoiceSettings>): Promise<void> {
		const { shortcut, delay } = ev.payload.settings;
		try {
			await openUrl(NEW_CHAT);
			if (shortcut?.trim()) {
				await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(Number(delay) || 1500, 0), 10_000)));
				await sendShortcut(shortcut);
			}
		} catch (err) {
			streamDeck.logger.error("Voice key failed", err);
			await ev.action.showAlert();
		}
	}
}
