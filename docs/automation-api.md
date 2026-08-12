# Automation & Webhook API

This document is the complete external contract for wiring Content Machine
into an external workflow tool (n8n, Zapier-via-HTTP, a cron job, or your own
script). It covers three things:

1. **API keys** — bearer-token authentication for programmatic callers.
2. **Action API** (`/api/automation/*`) — safe, idempotent endpoints an
   external tool calls to *do* things (create a project, request repurposing,
   schedule a publish).
3. **Webhooks** — signed HTTP callbacks Content Machine sends *to* your
   endpoint when something happens (a project moves stages, a repurposing
   batch finishes, a publish succeeds or fails).

No visual workflow editor exists inside Content Machine on purpose — this API
is the integration surface; the orchestration logic lives in your tool of
choice.

## 1. Authentication

Every `/api/automation/*` endpoint accepts either:

- A logged-in session cookie (for testing from the dashboard's own browser
  session), or
- `Authorization: Bearer <api key>` — the way any external tool should call it.

### Creating an API key

In the Content Machine dashboard: **Settings → Automation → API Keys → New
key**. Choose a name and one or more scopes:

| Scope | Grants |
|---|---|
| `read` | GET status lookups on projects/batches/publications |
| `projects:write` | `POST /automation/projects` |
| `repurposing:write` | `POST /automation/projects/:id/repurposing-batches` |
| `publishing:write` | `POST /automation/scheduled-publications` |

The raw key (`cmk_live_...`) is shown **exactly once** — copy it immediately.
Content Machine only ever stores a one-way hash; if you lose it, revoke it and
create a new one. A key can be revoked at any time from the same screen; a
revoked key stops working immediately.

```
Authorization: Bearer cmk_live_AbCdEf0123456789...
```

## 2. Action API

Base URL: `https://<your-content-machine-domain>/api/automation`

All `POST` endpoints **require** an `Idempotency-Key` header — see
[Idempotency](#idempotency) below. All endpoints require ownership: a request
can only read/act on brands, projects, batches, and publications the
authenticated user (the key's owner) owns.

### Create a project

```
POST /automation/projects
Authorization: Bearer cmk_live_...
Idempotency-Key: <opaque unique string, e.g. a UUID>
Content-Type: application/json

{
  "brandId": "brand_abc123",
  "title": "Q3 product launch announcement",
  "contentType": "blog_post",
  "topic": "New feature rollout",
  "purpose": "Announce the launch to existing customers"
}
```

`brandId`, `title`, and `contentType` are required; every other project field
(`tone`, `targetLength`, `intendedAudience`, etc.) is optional and matches the
dashboard's "New project" form. Returns `201` with the created project.

```
GET /automation/projects/:id
```

Returns the project's current state, including `workflowStage` (`assignment`
→ `sources` → `outline` → `drafting` → `quality` → ...). Poll this, or
subscribe to `project.workflow_stage_changed` (see [Events](#event-types)),
to know when it's ready for the next step.

### Request repurposing

```
POST /automation/projects/:id/repurposing-batches
Idempotency-Key: <unique string>

{
  "channels": ["twitter_thread", "linkedin_post"],
  "tone": "conversational",
  "cta": "Read the full post →"
}
```

The project must already have a document (i.e. it has progressed past
drafting). `channels` must be a non-empty array of known channel identifiers
(GET `/webhooks/event-types` doesn't list these — see the dashboard's
Repurpose tab for the current channel catalog, or ask your account for the
list). Returns `201` immediately with `status: "processing"`; generation runs
in the background.

```
GET /automation/repurposing-batches/:id
```

Poll until `status` is `"completed"`, `"partial"`, or `"failed"`; the response
includes the generated `assets` array once available. Or subscribe to
`repurposing.batch_completed`.

### Schedule a publication

```
POST /automation/scheduled-publications
Idempotency-Key: <unique string>

{
  "destinationId": "dest_xyz789",
  "sourceType": "document",
  "documentId": "doc_123",
  "scheduledFor": "2026-08-15T14:00:00Z"
}
```

- `sourceType` is `"document"` (the project's main draft — must have passed
  quality evaluation, i.e. `isPublicationReady: true`) or `"repurposed_asset"`
  (a specific channel asset from a repurposing batch — must be `isApproved:
  true`). Pass `documentId` or `repurposedAssetId` accordingly.
- Omit `scheduledFor` (or set it in the past) to publish immediately.
- The destination must already exist and belong to the same brand as the
  source content — create destinations from the dashboard's Distribution tab.

Returns `201` with the publication record. Poll `GET
/automation/scheduled-publications/:id` (`status`: `pending` → `published` /
`failed`), or subscribe to `publication.published` / `publication.failed`.

### Idempotency

Every `POST` action requires an `Idempotency-Key` header — any opaque string
unique to that logical action (a UUID is fine). If your workflow tool retries
a request (timeout, connection drop) with the **same key and the same request
body**, Content Machine replays the original response instead of creating a
second project/batch/publication. Reusing a key with a **different** body is
rejected with `422` (that's a bug in the caller, not a safe retry). While the
original request is still being processed, a retry gets `409` — wait and
retry again. Generate a fresh key per logical action; never reuse one key
across different actions.

## 3. Webhooks

Content Machine can push events to your endpoint as they happen, instead of
you polling. Deliveries follow the open [Standard
Webhooks](https://www.standardwebhooks.com/) specification — any existing
Standard Webhooks verification library works, and the reference
implementation below is only a few lines if you'd rather not add a
dependency.

### Registering a subscription

In the dashboard: **Settings → Automation → Webhooks → New subscription**.
Provide the URL your tool exposes (e.g. an n8n Webhook node's URL) and which
event types you want. A signing secret (`whsec_...`) is generated and shown
**once** — store it; it's needed to verify deliveries. You can rotate it at
any time (invalidates the old one) or pause/resume/delete the subscription.

Your URL must be a real, publicly resolvable `http://` or `https://` address.
`localhost`, private/internal network addresses (e.g. `192.168.x.x`,
`10.x.x.x`), and link-local/cloud-metadata addresses are rejected at
registration time — and, since DNS can change after registration, re-checked
on every delivery attempt too. If you're developing locally, expose your
receiver with a tunnel (e.g. `ngrok`) and register that public URL.

### Delivery format

Each delivery is an HTTP `POST` to your URL:

```
POST <your url>
content-type: application/json
webhook-id: whd_9f3a2b1c...
webhook-timestamp: 1755000000
webhook-signature: v1,base64signature==

{
  "id": "evt_7c2e1a...",
  "type": "project.workflow_stage_changed",
  "createdAt": "2026-08-12T05:00:00.000Z",
  "data": { "projectId": "...", "fromStage": "outline", "toStage": "drafting" }
}
```

`webhook-id` is the **delivery** id (stable across retries of the same
delivery — use it to dedupe if you ever process the same delivery twice).
`data` never contains secrets, API keys, tokens, or credentials of any kind —
that's a hard invariant, not just a convention.

### Verifying a signature

The signed content is `${webhook-id}.${webhook-timestamp}.${raw request body}`,
HMAC-SHA256'd with your secret (base64-decoded) and base64-encoded again. The
`webhook-signature` header is `v1,<that base64 value>` (it may contain
multiple space-separated `scheme,signature` pairs — check for any `v1,` match).

Node.js example:

```js
import { createHmac, timingSafeEqual } from "crypto";

function verify(secret, id, timestamp, rawBody, signatureHeader) {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");
  return signatureHeader.split(" ").some((scheme) => {
    const [version, sig] = scheme.split(",");
    if (version !== "v1" || !sig) return false;
    const a = Buffer.from(sig), b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}
```

In n8n: use a Function/Code node before your logic to read
`$request.headers['webhook-signature']`, `$request.headers['webhook-id']`,
`$request.headers['webhook-timestamp']`, and the raw body, and run the same
check (or use any community Standard Webhooks verification node).

Also reject a delivery whose `webhook-timestamp` is more than a few minutes
old, to guard against a captured request being replayed later.

### Event types

| Event | Fires when |
|---|---|
| `brand.created` | A new brand is created |
| `project.created` | A new project is created |
| `project.workflow_stage_changed` | A project moves to a new pipeline stage (`sources`, `outline`, `drafting`, `quality`, ...) |
| `document.quality_evaluated` | A document finishes automated quality evaluation |
| `repurposing.batch_completed` | A repurposing batch finishes (`completed`, `partial`, or `failed`) |
| `repurposing.asset_approved` | A single repurposed asset is approved |
| `publication.scheduled` | A publish is scheduled (immediate or future) |
| `publication.published` | A publish succeeds and is confirmed live |
| `publication.failed` | A publish fails permanently (all retries exhausted, or the platform rejected it) |

`GET /api/webhooks/event-types` returns this list programmatically, so a
dynamic UI (or your own tooling) never has to hardcode it.

### Retries and delivery history

A failed delivery (network error, timeout, or non-2xx response) is retried on
an exponential backoff: 30s, 2m, 10m, 1h, then 6h — five attempts total,
after which it's marked `failed` (terminal). Retries are always safe: a retry
resends the exact original payload with the exact original `webhook-id`, and
Content Machine's own side effects (the event itself) already happened
before the first delivery attempt, so a slow/duplicate delivery never repeats
your side of the integration's *cause* — only dedupe on your end if your own
webhook handler isn't itself idempotent.

Every attempt (success or failure, automatic or manually triggered) is
recorded — inspect it from **Settings → Automation → Webhooks → Deliveries**,
or via:

```
GET /api/webhooks/subscriptions/:id/deliveries   # per-subscription queue/history
GET /api/webhooks/deliveries/:id/attempts        # every attempt for one delivery
POST /api/webhooks/deliveries/:id/redeliver      # manually resend (e.g. after fixing your endpoint)
GET /api/webhooks/events                         # the durable internal event journal (independent of any subscription)
```

These five endpoints are session-authenticated (dashboard use), not part of
the bearer-token action API.

## 4. Example: a minimal n8n workflow

1. **Webhook node** — receives `project.workflow_stage_changed` deliveries.
   Set the node to respond immediately with `200` (Content Machine doesn't
   care about your response body, just the status code).
2. **Code node** — verify `webhook-signature` using the snippet above; abort
   (return an error) if it doesn't match.
3. **IF node** — branch on `{{$json.data.toStage}}`.
4. **HTTP Request node** — when `toStage === "quality"` and the document is
   publication-ready, call `POST
   https://<domain>/api/automation/scheduled-publications` with an
   `Authorization: Bearer` header (stored as an n8n credential) and a fresh
   `Idempotency-Key` (e.g. `{{$json.id}}-publish`, since `data.id`/event id is
   already unique per event) to schedule the publish automatically.

No Content Machine-specific n8n node is required — everything above is a
generic Webhook trigger + HTTP Request node, which is why no bespoke
integration node is planned (see
`docs/decisions/automation-webhook-foundation.md`).
