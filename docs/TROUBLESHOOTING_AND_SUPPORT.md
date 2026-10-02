# Troubleshooting and Support

## 1. Support and escalation path

| Level | Who | How | Use for |
|---|---|---|---|
| 1 | The user | This guide and `CLIENT_USER_MANUAL.md` | Sign-in, editing, export questions |
| 2 | Operator / owner (`ebyron357`) | Direct contact agreed at handoff (recorded in `CLIENT_ACCESS_HANDOFF_TEMPLATE.md`) | Access changes, outages, data restore, provider keys |
| 3 | Engineering | GitHub issue in `ebyron357/agency-content-grants` with steps, time (UTC), URL and screenshot — **no passwords, keys or client content** | Reproducible defects and change requests |
| Vendor | Render support (dashboard), AI provider support | Platform or provider outages |

Security issues go privately to the owner, never in a public issue. Severity guide: **S1** service down or data at risk → owner immediately, consider rollback (runbook §6); **S2** a core workflow broken → same day; **S3** cosmetic or workaround available → next release.

## 2. Quick checks

1. `https://<production-url>/api/healthz` — `{"status":"ok","commit":"…"}` means the process is up and shows which commit is running.
2. `https://<production-url>/api/readyz` — `ready`, or which of `database`, `storage`, `configuration` failed.
3. Render → service → **Events** (last deploy) and **Logs** (search for `"level":50`).

## 3. Symptoms

| Symptom | Likely cause | Fix |
|---|---|---|
| "Incorrect password" on sign-in | Wrong password, or it was rotated | Get the current password from the owner (password manager) |
| "Too many sign-in attempts" | 5 failures from your IP in 15 minutes | Wait 15 minutes, then use the correct password |
| Signed out unexpectedly | Session older than 7 days, or `SESSION_SECRET` rotated | Sign in again |
| Site does not load / Render shows deploy failed | Build failed or readiness never passed | Render → Events → open the failed deploy logs. If `configuration` failed, a provider key or `ADMIN_PASSWORD` is missing; if `database`, check the Render database status; if `storage`, check the disk is attached at `/var/data`. Roll back if needed (runbook §6) |
| Brief outage during a deploy | Expected: services with a disk cannot do zero-downtime deploys | Wait about a minute |
| Generated text starts with `[DEMO OUTPUT …]` / dashboard says demo mode | No AI provider key configured | Owner sets `OPENAI_API_KEY` (or another provider key) in Render and redeploys |
| Generation fails with a provider error | Provider outage, quota or invalid key | Check the provider status/billing; replace the key; retry |
| Image upload rejected | Not JPEG/PNG/GIF/WebP, over 10 MB, missing alt text, or the section is locked/approved | Use a supported file with alt text; unlock or reopen the section |
| Video rejected | Only YouTube and Vimeo HTTPS links are accepted | Use a supported link |
| "Section is locked/approved" when editing | Section protected by Lock or Approve | Unlock or reopen the section in the editor |
| Export stays processing or fails | Large document or disk full | Retry; check Render disk usage; delete old exports |
| Image shows as broken after a restore | Database and disk restored to different times | Restore both to matching points (runbook §8) |
| Publishing to a real channel does nothing | Destination uses the `demo` provider, or `TYPEFULLY_API_KEY` not set | Connect a Typefully destination and set the key |
| Performance page is empty | No provider has reported metrics yet | Expected until real publishing analytics exist |
| Settings changes are rejected with "Admin access required" | Session not elevated | Settings → Security → enter the admin password → Unlock |
