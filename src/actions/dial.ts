import { Action, action, DialDownEvent, TouchTapEvent } from "@elgato/streamdeck";

import { DisplayMode, renderDial } from "../render";
import type { UsageState } from "../usage";
import { UsageAction, UsageSettings } from "./usage-action";

/** Both windows on a Stream Deck + touch strip segment. Press the dial or tap the strip to flip left/used. */
@action({ UUID: "com.pixelchew.claude-usage.dial" })
export class CombinedDial extends UsageAction {
	protected override async draw(action: Action<UsageSettings>, state: UsageState | undefined, mode: DisplayMode): Promise<void> {
		if (action.isDial()) {
			await action.setFeedback({ canvas: renderDial(state, mode) });
		}
	}

	override async onDialDown(ev: DialDownEvent<UsageSettings>): Promise<void> {
		await this.toggle(ev.action);
	}

	override async onTouchTap(ev: TouchTapEvent<UsageSettings>): Promise<void> {
		await this.toggle(ev.action);
	}
}
