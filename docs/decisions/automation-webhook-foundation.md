# Decision: Automation & Webhook Foundation — delivery approach and auth model

Per `docs/engineering-standards.md`, recorded before building.

## User problem

Power users and agencies running Content Machine for multiple brands want to wire it
into their own workflows — e.g. "when a repurposing batch finishes, post the drafts
into our Slack for approval" or "when I add a row to this sheet, create a Content
Machine project" — without waiting for Content Machine to build a bespoke integration
for every tool they use. Today there is no way for an external system to (a) find out
that something happened inside Content Machine, or (b) trigger a Content Machine action
without impersonating a logged-in browser session. Both are required before a tool like
n8n can be the orchestrator standards step 4 already names as the target shape
("Automation foundation — Content Machine exposes events/actions; n8n... is the
external orchestrator, not built into Content Machine").

## Step 2/3: does anything in Content Machine already solve this?

- `logActivity()` (`artifacts/api-server/src/lib/activity.ts`) writes a human-readable
  audit trail (`activity_log`) for the in-app "Recent Activity" feed. It has no event
  *type* taxonomy, no payload schema, no subscriber concept, and nothing external can
  read it without a session cookie. It's the right injection point to hook new event
  emission alongside (same call sites), not a webhook system itself.
- No API-key/bearer auth exists anywhere in the codebase — `requireAuth`
  (`artifacts/api-server/src/middleware/requireAuth.ts`) checks `req.session.authenticated`
  only. A machine caller has no way to authenticate without holding a live browser
  session cookie, which is unworkable for a scheduled n8n workflow.
- Nothing resembling webhook delivery, retry, or signing exists in this repo.

Conclusion: extend `logActivity`'s call sites with a parallel, typed event emission,
but the delivery/auth/idempotency machinery must be built new.

## Step 4: evaluate vetted webhook-delivery infrastructure before building custom

Standards step 4 explicitly lists "webhook delivery" as commodity infrastructure to
evaluate, not build by default. Candidates considered:

- **svix (self-hosted `svix-server`)** — the most credible open-source option
  (Apache-2.0, purpose-built, implements the emerging **Standard Webhooks** open
  spec it co-authored). Rejected for this phase on **operating cost/ops burden**: it
  ships as a separate Rust service plus its own Postgres/Redis-backed queue
  infrastructure, run as an additional always-on process next to the existing
  Express/Postgres stack. This repo has no container/multi-service deployment story
  (see `replit.md` — single Node process per artifact, one Postgres database) and
  every other "engine" here (Content Distribution, Content Performance) already
  runs its retry/backoff logic in-process against the same Postgres database rather
  than adding new infrastructure. Standing up a second stateful service to deliver
  what is, at current scale, a low-volume stream of lifecycle events fails the
  "affordability is a hard constraint" test in `engineering-standards.md` — it is not
  proportionate to the problem yet. Revisit if delivery volume or reliability needs
  ever outgrow a single-process dispatcher (see "What would trigger revisiting this").
- **svix.com hosted SaaS** — rejected for the same reason plus a recurring per-seat
  cost with no free self-serve tier suitable at this project's unproven usage volume,
  and it would mean brand/project webhook *payload content* flowing through a
  third-party's infrastructure — a privacy question worth avoiding when the in-process
  option costs nothing extra to run.
- **Queue-based outbox via a hosted broker (e.g. SQS, a managed Redis queue)** —
  rejected as a new paid dependency + new failure mode (a queue outage now blocks
  delivery) for a problem the existing claim/fencing-token pattern already solves
  in-process, at zero marginal infrastructure cost.

**Decision: build the delivery/retry mechanism in-process (custom), but adopt the
open, vetted [Standard Webhooks](https://www.standardwebhooks.com) specification for
the wire format instead of inventing a bespoke signature scheme.** This is the
"integrate the standard, build the transport" middle path standards step 6(c)
describes: nothing free-standing fits the actual requirement at this scale, but the
*protocol* svix open-sourced is free to adopt with zero infrastructure cost and gives
every subscriber (n8n's built-in "Respond to Webhook"/generic HTTP trigger, or any
Standard-Webhooks-compatible verification library) a wire format they can already
verify without bespoke Content Machine documentation. Concretely: `webhook-id`,
`webhook-timestamp`, and `webhook-signature: v1,<base64 hmac>` headers, secret
formatted as `whsec_<base64>`, signed content `{id}.{timestamp}.{body}` — see
`lib/webhooks/signing.ts` and `docs/automation-api.md`.

Delivery retry/backoff and safe-redelivery reuse the exact claim + fencing-token
pattern already proven by the Content Distribution Engine
(`docs/decisions/content-distribution-provider.md`, `publishing-workflow.ts`) rather
than inventing a new concurrency model — an in-process `setInterval` scheduler
(matching `lib/publishing/scheduler.ts` and `lib/performance/scheduler.ts`, the only
two background-job patterns already in this codebase) claims due deliveries with an
atomic `UPDATE ... WHERE status = 'pending' AND (claimed_at IS NULL OR claimed_at <
now() - interval)`, so a scheduler tick and a manual "redeliver" click can never
double-send the same delivery row concurrently.

## Auth model: API keys, not OAuth or session reuse

n8n's generic HTTP node authenticates with header-based credentials (bearer token or
API key), not by holding a browser session. Building a full OAuth2 authorization-code
flow for a single-tenant-per-login product with no third-party app registry would add
real complexity (client registration, consent screens, token refresh) with no
corresponding benefit here — every "user" of the automation API is the same account
holder who already has a Content Machine login. **Decision: a scoped, revocable,
per-user API key (`cmk_live_<random>`), sent as `Authorization: Bearer <key>`,
verified against a stored one-way hash (never the raw key) — the same
`timingSafeEqual` discipline already used for admin-password comparison in
`routes/auth.ts`.** Session cookies remain the only auth path for the human-facing
dashboard; API keys are additive, not a replacement.

## Idempotency: reuse a well-known pattern, not a new invention

External workflow tools retry on timeout by design (n8n included) — a create-project
or schedule-publication action must not double-create when replayed. Standards step 2
found no existing idempotency mechanism in this codebase to extend. Rather than
inventing a new concurrency primitive, this borrows the widely-used **Stripe
idempotency-key pattern** (claim-first-insert on `(userId, endpoint, idempotencyKey)`,
replay the stored response on an exact repeat, reject a key reused with a different
body) — a documented, well-understood approach with no new dependency, consistent
with "build custom only where needed" since the pattern itself, not a library, is
what's being reused.

## Out of scope for this phase

- A visual workflow editor or built-in automation builder inside Content Machine —
  explicitly out of scope per the task; n8n (or any HTTP-capable tool) is the
  orchestrator.
- Native n8n/Zapier community nodes — the plain HTTP + Standard Webhooks contract is
  documented instead (`docs/automation-api.md`); a dedicated node package can be built
  later against the same stable contract without any server-side change.
- OAuth2/third-party app authorization — API keys cover the actual current need (one
  account holder automating their own workflows).

## What would trigger revisiting this

- Webhook delivery volume grows enough that in-process `setInterval` dispatch
  measurably competes with request-serving capacity on the same Node process —
  revisit self-hosting `svix-server` (or an equivalent queue-backed worker) at that
  point; the Standard Webhooks wire format is unchanged either way, so no subscriber
  ever needs to re-integrate.
- A real third-party integration marketplace (multiple external apps acting on behalf
  of different Content Machine accounts) becomes a requirement — that is the point
  API keys stop being sufficient and an OAuth2 authorization flow is justified.
