import streamDeck from "@elgato/streamdeck";

import { CombinedDial } from "./actions/dial";
import { CombinedKey, FiveHourKey, WeeklyKey } from "./actions/keys";
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

streamDeck.connect();
