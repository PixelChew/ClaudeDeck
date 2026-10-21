// Claude Code mod for the ClaudeDeck Stream Deck plugin: the same job as bridge/statusline-bridge.mjs, for sessions
// that never run a status line (the desktop app, IDE extensions). It writes the 5-hour and weekly windows to
// ~/.claude/streamdeck-usage.json whenever Claude Code reports them. No network, no tokens.

import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

type RawWindow = { used_percentage: number; resets_at: number }
type Snapshot = { updated_at: number; five_hour?: RawWindow; seven_day?: RawWindow }

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const { rateLimits } = await $.session.usage()
    await save($, rateLimits)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await save($, e.rateLimits)
    return next(e)
  })
}

async function save($: EngineInterface, limits: SessionRateLimit[]): Promise<void> {
  const fiveHour = toWindow(limits.find(l => l.kind === 'five_hour'))
  const sevenDay = toWindow(limits.find(l => l.kind === 'seven_day'))
  if (!fiveHour && !sevenDay) return

  const override = await $.env.get('CLAUDE_USAGE_SNAPSHOT')
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
  const file = override || `${home.replace(/\\/g, '/')}/.claude/streamdeck-usage.json`

  let previous: Partial<Snapshot> = {}
  try {
    previous = JSON.parse(await $.fs.read(file))
  } catch {
    // First run.
  }

  // Keep the last known window when one is missing from this report, like the status-line bridge does.
  const snapshot: Snapshot = {
    updated_at: Math.floor((await $.clock.now()) / 1000),
    five_hour: fiveHour ?? previous.five_hour,
    seven_day: sevenDay ?? previous.seven_day,
  }
  try {
    await $.fs.write(file, JSON.stringify(snapshot))
  } catch {
    // Never disturb the session over a write failure.
  }
}

function toWindow(limit: SessionRateLimit | undefined): RawWindow | undefined {
  const resetsAt = limit?.resetsAt ? Date.parse(limit.resetsAt) : NaN
  if (!limit || !Number.isFinite(resetsAt)) return undefined
  return { used_percentage: limit.percentUsed, resets_at: Math.floor(resetsAt / 1000) }
}
