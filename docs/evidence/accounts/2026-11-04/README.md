# Account security evidence, 4 November 2026

Screenshots from a local production build (`NODE_ENV=test` database, `MFA_ENCRYPTION_KEY` set), 1280 px wide at 2x, captured by a Playwright script that drives the real sign-in flow. All names, emails and organizations are synthetic.

| File | Shows |
|---|---|
| `25-two-factor-setup.png` | Settings → Team → Two-factor sign-in: the QR code drawn in the browser, the setup key grouped for typing, and the code field |
| `26-recovery-codes.png` | The 10 recovery codes shown once, with copy and download; continuing needs one of the two |
| `27-two-factor-sign-in.png` | The code step after a correct password, with the recovery-code option |
| `28-signed-in-browsers.png` | Where you're signed in: this browser and another, with workspace, IP, sign-in method and last activity, and sign out per browser or everywhere else |
| `29-audit-log.png` | The audit log, newest first, with the person on each entry, category filter, search and CSV export |
| `30-require-two-factor.png` | Members with their two-factor status, and the setting to require it for everyone |

The same flows are asserted in `artifacts/content-os/e2e/security.spec.ts` (with axe on each screen and a 390 px no-scroll check) and `artifacts/api-server/src/routes/account-security.integration.test.ts`.
