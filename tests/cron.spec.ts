import { test, expect } from "@playwright/test"
import { cleanupEnabled } from "../lib/crmCleanup.js"

const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://aytktpmqghhmhutawjtm.supabase.co"
const SECRET = process.env.SUPABASE_SECRET_KEY ?? ""

// The process-tasks cron ticks every 5 minutes and writes a cron_runs row at
// the start of every tick. 20 minutes = 4 missed ticks, comfortably past any
// single slow run but well inside "the crons are down".
const MAX_AGE_MS = 20 * 60_000

// The CRM's own cron health can't be reported by a Vercel cron — if Vercel
// crons stop firing, the reporter stops firing with them. This suite runs on
// GitHub Actions, outside that failure domain, so it can observe the outage.
test("process-tasks cron has ticked within 20 minutes", async () => {
  test.skip(!cleanupEnabled, "SUPABASE_SECRET_KEY unset — can't read cron_runs")

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/cron_runs?select=started_at&order=started_at.desc&limit=1`,
    {
      headers: {
        apikey: SECRET,
        Authorization: `Bearer ${SECRET}`,
      },
    },
  )
  expect(res.ok, `cron_runs query HTTP ${res.status}`).toBe(true)

  const rows = (await res.json()) as { started_at: string }[]
  expect(rows.length, "cron_runs is empty — the cron has never run").toBeGreaterThan(0)

  const lastStarted = Date.parse(rows[0].started_at)
  const ageMs = Date.now() - lastStarted
  const ageMin = Math.round(ageMs / 60_000)
  console.log(`[cron-liveness] last cron_runs.started_at = ${rows[0].started_at} (${ageMin}m ago)`)
  expect(
    ageMs,
    `last cron tick was ${ageMin} minutes ago (${rows[0].started_at}) — crons look down`,
  ).toBeLessThanOrEqual(MAX_AGE_MS)
})
