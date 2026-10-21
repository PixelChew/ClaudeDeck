import { Action, action, KeyDownEvent } from "@elgato/streamdeck";

import { Style, renderCombinedKey, renderWindowKey } from "../render";
import type { UsageState } from "../usage";
import { UsageAction, UsageSettings } from "./usage-action";

abstract class UsageKey extends UsageAction {
	protected abstract image(state: UsageState | undefined, style: Style): string;

	protected override async draw(action: Action<UsageSettings>, state: UsageState | undefined, style: Style): Promise<void> {
		if (action.isKey()) {
			await action.setImage(this.image(state, style));
		}
	}

	override async onKeyDown(ev: KeyDownEvent<UsageSettings>): Promise<void> {
		await this.toggle(ev.action);
	}
}

/** Remaining usage in the rolling 5-hour window. */
@action({ UUID: "com.pixelchew.claude-usage.five-hour" })
export class FiveHourKey extends UsageKey {
	protected override image(state: UsageState | undefined, style: Style): string {
		return renderWindowKey("fiveHour", state, style);
	}
}

/** Remaining usage in the weekly (7-day) window. */
@action({ UUID: "com.pixelchew.claude-usage.weekly" })
export class WeeklyKey extends UsageKey {
	protected override image(state: UsageState | undefined, style: Style): string {
		return renderWindowKey("sevenDay", state, style);
	}
}

/** Both windows stacked on one key. */
@action({ UUID: "com.pixelchew.claude-usage.combined" })
export class CombinedKey extends UsageKey {
	protected override image(state: UsageState | undefined, style: Style): string {
		return renderCombinedKey(state, style);
	}
}
