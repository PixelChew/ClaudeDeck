import streamDeck from "@elgato/streamdeck";

import { CombinedDial } from "./actions/dial";
import { CombinedKey, FiveHourKey, WeeklyKey } from "./actions/keys";
import { LiveUsage } from "./live-usage";
import { UsageSource } from "./usage";

streamDeck.logger.setLevel("info");

const source = new UsageSource();
const actions = [new FiveHourKey(source), new WeeklyKey(source), new CombinedKey(source), new CombinedDial(source)];

for (const action of actions) {
	streamDeck.actions.registerAction(action);
}

const redrawAll = (): void => {
	for (const action of actions) {
		action.redraw().catch((err) => streamDeck.logger.error("Redraw failed", err));
	}
};

// New numbers from Claude Code -> redraw immediately. Otherwise tick every 30s so countdowns and resets stay current.
source.onChange(redrawAll);
source.start(5000);
setInterval(redrawAll, 30_000);

// Opt-in "Live usage" (a plugin-wide setting, ticked in any action's settings) also polls the claude.ai usage endpoint.
type GlobalSettings = { liveUsage?: boolean };
const live = new LiveUsage(streamDeck.logger, () => void source.refresh(true));
streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev) => live.setEnabled(ev.settings.liveUsage === true));

streamDeck.connect().then(async () => {
	const settings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
	live.setEnabled(settings.liveUsage === true);
});
