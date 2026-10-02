# Data Lifecycle and Offboarding

What data Content Machine holds, who owns it, and how to export, delete and hand it over. Backup and restore mechanics are in [`DEPLOYMENT_AND_RECOVERY_RUNBOOK.md`](DEPLOYMENT_AND_RECOVERY_RUNBOOK.md) §7–8.

## 1. Ownership and classification

All workspace content belongs to the owner (`ebyron357`) or the client the owner operates it for. Treat it as **confidential business content**. The product is not designed for regulated data (health, payment card, government ID); do not store such data in it.

## 2. Data inventory

| Data | Stored in | Created by |
|---|---|---|
| Brands, audience profiles, brand facts, brand knowledge | PostgreSQL | Users |
| Projects (briefs), research plans, sources (metadata and extracted text), claims, outlines | PostgreSQL | Users and AI generation |
| Documents, sections, section revisions, quality evaluations | PostgreSQL | Users and AI generation |
| Image and video records (alt text, captions, embed URLs) | PostgreSQL | Users |
| Image files | Disk `/var/data/uploads/images` | Users |
| Source PDF files | Disk `/var/data/uploads/sources` | Users |
| Export files (DOCX, PDF, HTML, Markdown, TXT) | Disk `/var/data/exports` + export records in PostgreSQL | Users |
| Repurposed assets, publications, performance metrics | PostgreSQL | Users and publishing providers |
| API keys (hashes), webhook subscriptions and delivery history | PostgreSQL | Admin |
| Sessions, sign-in rate-limit counters, activity log | PostgreSQL | System |
| Application logs | Render logs (retention per Render plan) | System |

Data sent to the AI provider for generation is governed by that provider's terms; nothing is sent when no provider key is set.

## 3. Export

| Need | How |
|---|---|
| One document | Project → **Export** tab → choose DOCX, PDF, HTML, Markdown or TXT → **Export** → Download. Exports include an evidence register when the project has sources or claims |
| Repurposed assets | Project → **Repurpose** → copy each asset |
| Everything (complete handover) | 1) Render → database → **Recovery** → create and download a logical backup (`pg_restore`-compatible directory archive). 2) Render → service → **Shell**: `tar czf /tmp/content-machine-files.tgz -C /var/data .` and download it. Together these are the full workspace |
| Programmatic | Automation API (`docs/automation-api.md`) with a `read` key |

## 4. Deletion

In the UI you can delete outline sections, brand facts and brand knowledge entries, revoke API keys and delete webhook subscriptions, and reject sources. **Projects, brands, sources and images have no delete button in this release**; the operator deletes them through the API with a signed-in session:

```bash
BASE=https://<production-url>
curl -sc jar -H 'Content-Type: application/json' \
  -d "{\"password\":\"$ADMIN_PASSWORD\"}" "$BASE/api/auth/login"   # password from the password manager
curl -sb jar -X DELETE "$BASE/api/projects/<project-id>"     # 204
curl -sb jar -X DELETE "$BASE/api/brands/<brand-id>"         # 204 once the brand has no projects
curl -sb jar -X POST "$BASE/api/auth/logout"; rm jar
```

Project and brand IDs are in the browser address bar (`/projects/<id>`, `/brands/<id>`) or from `GET /api/projects` and `GET /api/brands`.

| Scope | How | What is removed |
|---|---|---|
| Outline section, brand fact, knowledge entry | Delete button in the UI | That record |
| An image | `DELETE /api/media/images/<id>` | Database record and file on disk |
| A source | `DELETE /api/sources/<id>` (or **Reject** in the UI to exclude it without deleting) | Source record and stored PDF |
| A document project | `DELETE /api/projects/<id>` | Project and everything under it in the database (document, sections, revisions, outline, research plan, sources, claims, export records) and its files on disk: inline images, uploaded source PDFs and generated exports |
| A brand | `DELETE /api/brands/<id>` after its projects are deleted (the database refuses while projects reference it) | Brand, audience profiles, facts and knowledge |
| An API key / webhook | Settings → Automation → Revoke / Delete | Key or subscription |
| The whole workspace | Decommission (runbook §11): delete the Render service, disk and database after taking any required final backup | All data. Render PITR and disk snapshots expire on Render's retention schedule; logical backups held outside Render must be deleted separately |

Deletion is immediate and cannot be undone except by restoring a backup.

## 5. Retention

No automatic deletion of user content. Sessions expire after 7 days and are pruned every 15 minutes. Recommended: delete exports that are no longer needed, keep monthly logical backups for 12 months unless the client requires otherwise, and delete off-platform backups when a client relationship ends.

## 6. User offboarding

1. Rotate `ADMIN_PASSWORD` and `SESSION_SECRET` (signs everyone out; see `SECURITY_AND_ACCESS_HANDOFF.md` §3).
2. Revoke API keys the person created; remove them from the Render team and GitHub if applicable.
3. Share the new password with the remaining users.
4. Update the access register.

## 7. Client offboarding

1. Agree the handover format (complete export per §3, or per-document exports).
2. Produce the export, verify it opens (`pg_restore --list` on the backup; open a sample of files), and deliver it through an encrypted channel.
3. Obtain written confirmation of receipt.
4. Delete the workspace data (§4, whole workspace) or the client's brands and projects if the workspace continues for others.
5. Revoke any client-specific provider keys, Typefully accounts and webhooks.
6. Record the date, what was delivered and what was deleted in `docs/PROJECT_STATUS.md`.
