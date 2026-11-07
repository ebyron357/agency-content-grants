# Self sign-up and the setup wizard

**Status:** built and tested, **switched off**. Self sign-up stays off until the owner sets the settings in §6. While it is off nothing changes: every signed-out address (including `/` and `/signup`) shows the sign-in page with no sign-up link and no landing page, and every sign-up route answers 404 and writes nothing.

**One sign-up system.** This merges two pieces of work: the public landing page and sign-up screen from PR #63 (with the warm charcoal and coral look) and the email-verified sign-up, abuse limits, setup wizard and checklist from PR #65. There is one sign-up endpoint (`POST /api/auth/signup` in `routes/signup.ts`); #63's first version, which created an account and signed in at once without checking the email address, was replaced by it. The switch is `SELF_SIGNUP_ENABLED=true`; `SELF_SERVE_SIGNUP=on`, the name #63 used, works the same (§6). The setup wizard and the getting-started checklist work in every workspace whether sign-up is on or off.

Requested by the owner on 6 November 2026 in a Claude conversation, as week-2 work in the plan "Grant Platform: End-to-End Build, Cost, Pricing and Launch Plan" (https://claude.ai/artifact/DmfQjHPGYNHgpzq3nxZTVH, build map, week 2: "Self sign-up and onboarding wizard, from EIN to first match").

## 1. User guide

### Create an account (when sign-up is on)

1. Visit grantcrest.co. The landing page explains GrantCrest. Type your work email and choose **Get my matches**, or choose **Start free** (top right). From the sign-in page (**Log in**), **Create an account** goes to the same form.
2. Enter your name, your organization's name, your work email (already filled in if you typed it on the landing page) and a password (at least 12 characters, not repetitive, and not containing the part of your email before the @).
3. Choose **Create account**. GrantCrest sends a confirmation link to your email and shows **Check your email**. Open the link within 24 hours. Nothing is created until you open it.
4. The link signs you in to your new workspace as its **owner** and opens the setup wizard; afterwards the workspace opens on **Get started**.

If you already have an account, you get an email with a sign-in link instead. The screen says the same thing either way, so nobody can use the form to find out who has an account.

### Get started (the first-run checklist)

A workspace you signed up for opens on **Get started** until you hide it. It lists the next four steps and ticks each one off as you do it:

1. **Set up your organization** (the setup wizard).
2. **Review your first matches.**
3. **Start your first application.**
4. **Invite your team** (Settings).

**Hide this checklist** hides it (and **Show on sign-in again** brings it back); the page stays at `/get-started` and the wizard at `/onboarding`. Grant Studio has a **Get started** button, and an empty Grant Studio offers **Set up with your EIN**.

### The setup wizard (`/onboarding`)

1. **Your organization.** Choose **Yes, look it up** and enter your EIN (12-3456789), or **No, or not on IRS records yet** for a business, a government body or a new nonprofit.
2. **Confirm details.** With an EIN, GrantCrest shows what ProPublica's copy of the IRS records says: legal name, address, state, cause (NTEE), tax-exempt status and latest revenue. **Nothing is used until you tick it.** Correct anything that is wrong. Without an EIN you type your details yourself.
3. **Focus areas.** Pick the causes you work on. Suggestions follow your NTEE cause; you can add your own.
4. **First matches.** Your first matched federal and state opportunities and up to three foundations to research. **Matches are guidance, not an eligibility decision.** Foundation suggestions come from past giving in tax filings; they are funding history, never an open call.

If the EIN is not found, or the lookup cannot be reached, the wizard says so in plain words and offers **Enter details yourself**.

## 2. How sign-up works

| Step | What happens |
|---|---|
| `POST /api/auth/signup` `{ name, organizationName, email, password }` | Checks the form, then stores a **pending sign-up** (`pending_signups`: email, name, organization, scrypt password hash, SHA-256 hash of a 32-byte random token, 24-hour expiry) and emails the link `APP_BASE_URL/signup/verify#token=…`. The token is in the URL fragment, so it never reaches a server log. Answer: **202** with the same message whatever happened. |
| An email that already has an account | No pending row; that address gets a "you already have an account" email with a sign-in link. Same 202 answer, same work (one password hash, one email). |
| `POST /api/auth/signup/verify` `{ token }` | In one transaction: claims the pending row (single use, unexpired), creates the workspace principal, a **client** workspace (`created_via = 'self_signup'`), the member, and an **owner** membership. Then signs the person in (session regenerated, a `member_sessions` row with method `signup`). **201.** An expired, used or made-up link is a 404 with a plain message. |
| `GET /api/auth/me` (signed out) | Includes `signupOpen`: the web app shows the landing page at `/`, the form at `/signup` and the **Create an account** link on the sign-in page only when it is `true`. Never says why it is off. |
| `GET /api/auth/signup/status` | `{ enabled }`, the same value, for API callers. |

**Fits the existing model.** The new person is an ordinary member with the `owner` role in an ordinary client workspace: the same roles, permissions, two-factor settings (the owner can require two-factor in Settings), sessions and tenant isolation as an invited owner. The operator's agency workspace is untouched.

**Audit log.** Each verified sign-up writes `workspace_created` and `member_joined` to the activity log, and `billing_trial_started` when a trial starts. The wizard writes `grant_applicant_created` with how many looked-up facts were confirmed.

**Billing.** With billing on (`docs/BILLING.md`), a new workspace starts the 14-day trial through the existing `startTrial(workspaceId, plan)`, on `SELF_SIGNUP_TRIAL_PLAN` (default `starter`). If the trial cannot start, the workspace is still created and its owner can start one in Settings, Billing. With billing off there are no limits and no trial.

## 3. Abuse protection

- **Off unless switched on** (§6). A typo in the flag leaves it off.
- **Rate limits.** Stored in PostgreSQL (`PgRateLimitStore`), so they hold across restarts and instances: **10 sign-up requests an hour per IP address**; **3 an hour per email address from any IP** (keyed by a hash of the address, counted whether or not it has an account, so the limit reveals nothing); **20 failed link attempts per 15 minutes per IP**. In memory per server process: **30 EIN lookups per 10 minutes per workspace**.
- **No account enumeration:** the same answer, status and amount of work for new and existing addresses; a conflict found only at verification time (an account created in between) answers 409 to the person holding the link, who already proved they own the address.
- **Hidden field:** the form has a field people cannot see. A bot that fills it gets the normal answer and nothing is stored or sent.
- **Nothing before verification:** no member, workspace or session exists until the emailed link is opened. Pending rows older than a week are deleted on the next sign-up.
- **Email errors** are logged without the provider's response body (it can echo the address) and answer 503 "try again".

## 4. Email (pluggable)

The app had no email path before this change. `artifacts/api-server/src/lib/email/transport.ts` chooses one with `EMAIL_PROVIDER`:

- `resend`: Resend's HTTP API (`POST https://api.resend.com/emails`), with `RESEND_API_KEY` and `EMAIL_FROM`. One `fetch` call, no SDK, 10-second timeout.
- `log`: writes the message, link included, to the server log. For local development only; **refused when `NODE_ENV=production`**.
- unset: no email, so self sign-up stays off.

Another provider (Postmark, SES, SMTP) is one more `EmailTransport` in the same file. Tests capture messages with `setEmailTransportForTests`.

## 5. EIN lookup (ProPublica Nonprofit Explorer API v2)

- `GET https://projects.propublica.org/nonprofits/api/v2/organizations/{ein}.json`, no key, 8-second timeout (`lib/onboarding/propublica.ts`).
- **Terms:** the API page (checked 7 November 2026) says "Usage constitues agreement to our Data Terms of Use" (sic) and states no request limit. The wizard shows "Organization data from ProPublica Nonprofit Explorer (IRS filings)" and every saved fact names the source, the EIN, the retrieval date and the ProPublica profile URL. **The owner should read ProPublica's Data Terms of Use before switching sign-up on in production** (§6). `NONPROFIT_LOOKUP_DISABLED=true` turns the lookup off; the wizard then offers manual entry only.
- **Cache:** `nonprofit_lookups` (shared public reference data, no workspace data). Found: 30 days. Unknown EIN: 1 day. Failures (timeout, outage, error status) are never cached. Only the fields below are kept, not the raw response.
- **Fields used:** name, address, city, state, ZIP, NTEE code, subsection (501(c)(3) or other), total revenue from the latest filing with data (else the master file), and that tax year.
- **Unconfirmed until confirmed.** Each looked-up value is saved in the organization's fact library as a fact with its source. It is marked confirmed (by the person, now) only when they ticked it and kept the value as recorded. A value they did not tick is **never written into the profile**; a value they typed themselves is theirs. The server checks this against the cached record, not against what the browser sends.

## 6. Owner actions to switch sign-up on

Nothing below has been done. Do **not** change `render.yaml`; add the variables in the Render dashboard.

1. **Choose an email provider.** The built-in option is Resend (https://resend.com). Create an account, verify the sending domain (for example `grantcrest.co`, with the DNS records Resend gives), and create an API key with sending access only. Resend has a free tier; check its current limits and price before launch. Another provider needs a small code change (§4).
2. **Set, in Render (API service):**
   - `EMAIL_PROVIDER=resend`
   - `RESEND_API_KEY=<the key>` (secret; never paste it into chat or commit it)
   - `EMAIL_FROM=GrantCrest <hello@grantcrest.co>` (an address on the verified domain)
   - `APP_BASE_URL=https://<the app's public address>` (no trailing slash; the link is `APP_BASE_URL/signup/verify#token=…`)
   - optional `SELF_SIGNUP_TRIAL_PLAN=starter|pro|agency` (the plan a new workspace's trial uses when billing is on)
3. **Read ProPublica's Data Terms of Use** (linked from https://projects.propublica.org/nonprofits/api). If they do not suit, set `NONPROFIT_LOOKUP_DISABLED=true`.
4. **Switch it on:** `SELF_SIGNUP_ENABLED=true`. `SELF_SERVE_SIGNUP=on` (the name PR #63 documented) is accepted as the same switch, so if it is already set in Render it keeps working; there is no need to set both. Either one still needs steps 1 and 2: without an email provider and `APP_BASE_URL` sign-up stays off. The server log says "Self sign-up is on" at start, or names (never values) the settings still missing.
5. To switch it off again, remove both variables (or set `SELF_SIGNUP_ENABLED` to anything but `true` and `SELF_SERVE_SIGNUP` to anything but `on`). Pending sign-ups simply expire; workspaces already created stay.

## 7. Where things are

| Piece | Where |
|---|---|
| Migration (`0037`) | `lib/db/drizzle/0037_self_signup_onboarding.sql`: `workspaces.created_via`, `workspaces.onboarding_dismissed_at`, `pending_signups`, `nonprofit_lookups` |
| Schema | `lib/db/src/schema/onboarding.ts`, `lib/db/src/schema/workspaces.ts` |
| Switch (`signupFlag`) and email text | `artifacts/api-server/src/lib/signup/config.ts` |
| Email transport | `artifacts/api-server/src/lib/email/transport.ts` |
| Sign-up routes | `artifacts/api-server/src/routes/signup.ts` (public, before `requireAuth`) |
| Wizard and checklist routes | `artifacts/api-server/src/routes/onboarding.ts`: `GET /onboarding`, `GET /onboarding/lookup/:ein`, `POST /onboarding/organization` (`grants.write`), `PUT /onboarding/dismissed` (`grants.write`) |
| Lookup, cache, focus areas | `artifacts/api-server/src/lib/onboarding/` |
| Matching (reused) | `GET /grants/applicants/:id/matches`, `GET /grants/applicants/:id/foundation-suggestions` |
| Screens | `artifacts/content-os/src/pages/Landing.tsx`, `Signup.tsx`, `SignupVerify.tsx`, `GetStarted.tsx`, `Onboarding.tsx`; which one a signed-out visitor sees is decided in `App.tsx` (`AuthGate`) |
| Tests | `routes/signup.integration.test.ts`, `routes/onboarding.integration.test.ts`, `lib/onboarding/onboarding.unit.test.ts`, `content-os/src/__tests__/Signup.test.tsx`, `content-os/e2e/onboarding.spec.ts` (landing, sign-up, check-your-email, confirmation, wizard), and `/get-started` and `/onboarding` in `e2e/accessibility.spec.ts` |

## 8. Limits of this change

- The verification email is plain text. Branded HTML email is later work.
- No CAPTCHA. The rate limits, hidden field and email verification are the protection; a CAPTCHA provider would be an owner decision (a third-party service).
- The "under 5 minutes" target is measured with fixtures (synthetic organization, cached lookup, seeded opportunities): the API path and the browser path are each asserted to take well under a minute of system time. A real person's time depends on reading and typing, and real matches depend on which opportunities are loaded.
