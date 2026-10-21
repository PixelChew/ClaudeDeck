import { Action, DidReceiveSettingsEvent, SingletonAction, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";

import type { DisplayMode, Style } from "../render";
import type { UsageSource, UsageState } from "../usage";

export type UsageSettings = {
	display?: DisplayMode;
	monotone?: boolean;
};

/**
 * Shared plumbing for every usage action: caches each visible instance's settings, and redraws all of them whenever
 * the snapshot changes or the clock ticks. Subclasses only decide how to draw.
 */
export abstract class UsageAction extends SingletonAction<UsageSettings> {
	#settings = new Map<string, UsageSettings>();

	constructor(protected readonly source: UsageSource) {
		super();
	}

	protected abstract draw(action: Action<UsageSettings>, state: UsageState | undefined, style: Style): Promise<void>;

	protected mode(id: string): DisplayMode {
		return this.#settings.get(id)?.display ?? "used";
	}

	protected style(id: string): Style {
		return { mode: this.mode(id), monotone: this.#settings.get(id)?.monotone === true };
	}

	async redraw(): Promise<void> {
		const state = this.source.state();
		await Promise.all(this.actions.map((action) => this.draw(action, state, this.style(action.id))));
	}

	/** Press / tap: flip between "% left" and "% used", and re-read the snapshot in case it just changed. */
	protected async toggle(action: Action<UsageSettings>): Promise<void> {
		const settings: UsageSettings = { ...this.#settings.get(action.id), display: this.mode(action.id) === "left" ? "used" : "left" };
		this.#settings.set(action.id, settings);
		await action.setSettings(settings);
		await this.source.refresh(true);
		await this.draw(action, this.source.state(), this.style(action.id));
	}

	override async onWillAppear(ev: WillAppearEvent<UsageSettings>): Promise<void> {
		this.#settings.set(ev.action.id, ev.payload.settings);
		await this.draw(ev.action, this.source.state(), this.style(ev.action.id));
	}

	override onWillDisappear(ev: WillDisappearEvent<UsageSettings>): void {
		this.#settings.delete(ev.action.id);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<UsageSettings>): Promise<void> {
		this.#settings.set(ev.action.id, ev.payload.settings);
		await this.draw(ev.action, this.source.state(), this.style(ev.action.id));
	}
}
