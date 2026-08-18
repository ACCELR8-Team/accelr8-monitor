// Removes rows the monitor created while exercising write flows (e.g. the
// application-form submission test). Scoped strictly to the monitor's own
// test identity — deletes only rows whose email exactly matches.
//
// Needs SUPABASE_URL + SUPABASE_SECRET_KEY (the sb_secret_* key). If either
// is unset, cleanup is a no-op and the caller should treat the write test
// as skipped rather than run it (otherwise it leaves junk rows behind).

const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://aytktpmqghhmhutawjtm.supabase.co"
const SECRET = process.env.SUPABASE_SECRET_KEY ?? ""

export const cleanupEnabled = Boolean(SECRET)

// The email the application-form test submits with. Plus-addressed so it
// routes to pat@ but is unmistakably a monitor row.
export const MONITOR_APPLICANT_EMAIL = "monitor+apptest@joinaccelr8.com"

// The invitee email the Calendly-probe test posts with. Same plus-addressing
// scheme as the applicant email.
export const MONITOR_CALENDLY_EMAIL = "monitor+calendly@joinaccelr8.com"

async function deleteByEmail(table: string, email: string): Promise<number> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?email=eq.${encodeURIComponent(email)}`,
    {
      method: "DELETE",
      headers: {
        apikey: SECRET,
        Authorization: `Bearer ${SECRET}`,
        Prefer: "return=representation",
      },
    },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`cleanup ${table} ${res.status}: ${body.slice(0, 200)}`)
  }
  const rows = (await res.json()) as unknown[]
  return rows.length
}

// Remove every monitor test applicant row from both the legacy `people`
// table and the new `persons` table. Safe to call before AND after the
// test — calling before sweeps any leftover from a prior crashed run.
export async function purgeMonitorApplicant(): Promise<{ people: number; persons: number }> {
  if (!cleanupEnabled) return { people: 0, persons: 0 }
  const people = await deleteByEmail("people", MONITOR_APPLICANT_EMAIL)
  const persons = await deleteByEmail("persons", MONITOR_APPLICANT_EMAIL)
  return { people, persons }
}

// Remove the person row the call-booked webhook creates for the probe's
// invitee. Only `persons` is touched — the route never writes to `people`,
// and the `interview_prep` row it enqueues cascades on person delete
// (pipeline_tasks.person_id is ON DELETE CASCADE).
export async function purgeCalendlyInvitee(): Promise<{ persons: number }> {
  if (!cleanupEnabled) return { persons: 0 }
  const persons = await deleteByEmail("persons", MONITOR_CALENDLY_EMAIL)
  return { persons }
}
