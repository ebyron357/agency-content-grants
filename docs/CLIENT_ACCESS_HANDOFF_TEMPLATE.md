# Client Access Handoff — template

Copy this into the client's handoff record (not into this repository) and fill it in at handoff. **Do not write the password here**; deliver it separately through a password-manager share.

| Field | Value |
|---|---|
| Client / organisation | |
| Handoff date (UTC) | |
| Production URL (also the login URL) | `https://…onrender.com` |
| How to sign in | Open the URL, enter the workspace password, choose **Sign in** (no username) |
| Password delivered via | Password-manager share to: ____ on ____ |
| People with access (names only) | |
| Workspace owner / administrator | Emmanuel Andre Byron (`ebyron357`) |
| Support contact and hours | |
| Escalation for outages | Owner → Render status / support |
| Deployed commit (`/api/healthz` → `commit`) | |
| Production smoke result and date | `RESULT: __ passed, 0 failed` on ____ |
| AI provider configured | OpenAI / Anthropic / Gemini (circle) — billed to: |
| Publishing destinations configured | demo (simulated) / Typefully |
| Backups | Render PostgreSQL PITR + monthly logical backup stored at: ____; daily disk snapshots |
| User manual | `docs/CLIENT_USER_MANUAL.md` |
| Known limitations explained | Shared single account; no in-app delete for projects/brands/sources/images; single instance with brief restart on deploys; demo mode without a provider key |
| Client acceptance | `docs/FINAL_CLIENT_ACCEPTANCE.md` signed on ____ by ____ |

After handoff, rotate the password if anyone outside the agreed list ever received it (`SECURITY_AND_ACCESS_HANDOFF.md` §3).
