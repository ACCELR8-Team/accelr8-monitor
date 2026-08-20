import { test, expect } from "@playwright/test"
import crypto from "node:crypto"
import { purgeCalendlyInvitee, cleanupEnabled, MONITOR_CALENDLY_EMAIL } from "../lib/crmCleanup.js"

const CRM_URL = process.env.CRM_URL ?? "https://accelr8-crm.vercel.app"
const WEBHOOK_SECRET = process.env.CALENDLY_WEBHOOK_SECRET ?? ""

// Signs the payload the way Calendly does: HMAC-SHA256 over `${t}.${rawBody}`
// keyed by the webhook secret, sent as `Calendly-Webhook-Signature:
// t=<unix_ts>,v1=<hex_hmac>`. Matches the CRM's fail-closed verification in
// /api/triggers/call-booked.
function sign(rawBody: string): string {
  const t = Math.floor(Date.now() / 1000)
  const v1 = crypto.createHmac("sha256", WEBHOOK_SECRET).update(`${t}.${rawBody}`).digest("hex")
  return `t=${t},v1=${v1}`
}

// End-to-end probe of the Calendly → CRM booking hook: a correctly-signed
// synthetic invitee.created must be accepted. The invitee email matches no
// CRM row, so the route creates a person (stage=interview, source=calendly)
// and enqueues an interview_prep task — both removed in the finally below,
// same write-then-clean pattern as the application-form test.
test("call-booked webhook accepts a signed invitee.created", async () => {
  test.skip(
    !WEBHOOK_SECRET,
    "CALENDLY_WEBHOOK_SECRET unset — Calendly probe SKIPPED, webhook signature path is UNMONITORED until the secret is added to the Actions env",
  )
  test.skip(!cleanupEnabled, "SUPABASE_SECRET_KEY unset — can't clean up the probe row, so skipping the write")

  // Sweep any leftover row from a prior crashed run before posting.
  await purgeCalendlyInvitee()

  const start = new Date(Date.now() + 24 * 60 * 60 * 1000)
  const end = new Date(start.getTime() + 30 * 60_000)
  const rawBody = JSON.stringify({
    event: "invitee.created",
    payload: {
      email: MONITOR_CALENDLY_EMAIL,
      name: "Monitor Calendlyprobe",
      first_name: "Monitor",
      last_name: "Calendlyprobe",
      text_reminder_number: null,
      questions_and_answers: [],
      scheduled_event: {
        name: "Accelr8 Intro Call (monitor probe)",
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        location: { type: "google_conference", join_url: "https://meet.google.com/monitor-probe" },
      },
    },
  })

  try {
    const res = await fetch(`${CRM_URL}/api/triggers/call-booked`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Calendly-Webhook-Signature": sign(rawBody),
      },
      body: rawBody,
    })
    const body = await res.text()
    expect(res.ok, `HTTP ${res.status} from call-booked: ${body.slice(0, 300)}`).toBe(true)

    const json = JSON.parse(body) as { ok?: boolean; created?: boolean; personId?: string }
    expect(json.ok, `call-booked returned 2xx but not ok: ${body.slice(0, 300)}`).toBe(true)
    console.log(`[calendly-probe] accepted — created=${json.created} personId=${json.personId}`)
  } finally {
    // Always clean up — even if the assertion above failed.
    const purged = await purgeCalendlyInvitee().catch(() => ({ persons: 0 }))
    console.log(`[calendly-probe] cleaned up ${purged.persons} persons rows`)
  }
})
