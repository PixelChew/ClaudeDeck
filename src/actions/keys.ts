import { Action, action, KeyDownEvent } from "@elgato/streamdeck";

import { DisplayMode, renderCombinedKey, renderWindowKey } from "../render";
import type { UsageState } from "../usage";
import { UsageAction, UsageSettings } from "./usage-action";

abstract class UsageKey extends UsageAction {
	protected abstract image(state: UsageState | undefined, mode: DisplayMode): string;

	protected override async draw(action: Action<UsageSettings>, state: UsageState | undefined, mode: DisplayMode): Promise<void> {
		if (action.isKey()) {
			await action.setImage(this.image(state, mode));
		}
	}

	override async onKeyDown(ev: KeyDownEvent<UsageSettings>): Promise<void> {
		await this.toggle(ev.action);
	}
}

/** Remaining usage in the rolling 5-hour window. */
@action({ UUID: "com.pixelchew.claude-usage.five-hour" })
export class FiveHourKey extends UsageKey {
	protected override image(state: UsageState | undefined, mode: DisplayMode): string {
		return renderWindowKey("fiveHour", state, mode);
	}
}

/** Remaining usage in the weekly (7-day) window. */
@action({ UUID: "com.pixelchew.claude-usage.weekly" })
export class WeeklyKey extends UsageKey {
	protected override image(state: UsageState | undefined, mode: DisplayMode): string {
		return renderWindowKey("sevenDay", state, mode);
	}
}

/** Both windows stacked on one key. */
@action({ UUID: "com.pixelchew.claude-usage.combined" })
export class CombinedKey extends UsageKey {
	protected override image(state: UsageState | undefined, mode: DisplayMode): string {
		return renderCombinedKey(state, mode);
	}
}
