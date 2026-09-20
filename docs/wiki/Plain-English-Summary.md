# Plain-English Summary

_Derived entirely from the code and documents in `ebyron357/agency-content-grants` at branch `claude/generate-repository-documentation`._

## What this is

This repository contains **Content Machine** (also called "Content OS" in the code): a web application that helps a marketing/content agency produce long-form written content — blog posts, articles, guides, manuals and reports — with AI assistance, while keeping a record of where the facts came from.

It is a normal web app: a browser dashboard, a server behind it, and a database that stores everything.

## What a user actually does with it

Based on the screens in `artifacts/content-os/src/pages` and the server routes in `artifacts/api-server/src/routes`:

1. **Log in.** Username and password (`/api/auth/login`).
2. **Set up a brand.** A "brand" holds the voice, audience profiles, approved facts and knowledge entries for one client (`brands`, `audience_profiles`, `brand_facts`, `brand_knowledge_entries` tables). The code calls this the "Brand Brain".
3. **Start a project.** A project is one piece of content. The user gives a topic, content type, purpose, audience, tone, reading level, required sections, subjects and words to avoid, and length (see the `projects` table columns in `lib/db/src/schema/projects.ts`).
4. **Let the pipeline run.** The system works through stages: research plan → sources → claims → outline → draft → quality check. Each stage is a real server route and a real AI call (`artifacts/api-server/src/lib/workflows/content-workflow.ts`). There is also an orchestration route that runs stages together (`routes/orchestration.ts`).
5. **Bring in evidence.** Users can upload PDFs as sources (`routes/sources.ts`, `routes/storage.ts`), and individual factual claims in the draft are tracked and verified against those sources (`claims` table, `verifyClaim`).
6. **Review and edit.** The draft is stored as sections with revision history (`documents`, `document_sections`, `section_revisions`), so edits can be reviewed and rolled back.
7. **Check quality.** An automated evaluation produces scores and a list of issues to fix (`quality_evaluations`, `quality_issues`).
8. **Export.** The finished document can be downloaded as a real Word (DOCX) or PDF file, or as HTML, Markdown or plain text (`artifacts/api-server/src/lib/exporters/index.ts`).
9. **Repurpose.** One long article can be turned into shorter assets for other channels, with presets and revision history (`repurposing_batches`, `repurposed_assets`, `repurposing_presets`).
10. **Schedule and publish.** Finished assets can be scheduled to social channels through a connected publishing account, with retry/attempt history (`publishing_destinations`, `scheduled_publications`, `publication_attempts`).
11. **Track performance.** The system pulls back engagement metrics on published posts and turns them into recommendations (`performance_snapshots`, `performance_recommendations`).
12. **Automate.** Other tools (n8n, Zapier, scripts) can drive the system with an API key and receive signed webhooks when things happen (`docs/automation-api.md`).

## Who it is for

- **Primary:** small-to-mid content/marketing agencies producing client content at volume, where the same team handles several brands and needs each brand's voice and approved facts kept separate.
- **Secondary:** in-house content teams that need an evidence trail (citations, claim verification, approvals) rather than raw AI output.
- **Operator/owner:** a single technical owner runs it; the app is designed to be self-hosted cheaply rather than sold as a large SaaS platform (see the affordability constraints recorded in `replit.md` and `docs/engineering-standards.md`).

## What makes it different from "just using ChatGPT"

- **Evidence first.** Sources, claims and verification are first-class database records, not an afterthought. The repository's governing rules (`AGENTS.md`) treat inventing unsupported facts as a failure condition.
- **Brand memory.** Each client's voice, audience and approved facts are stored and reused, so output is consistent across many pieces.
- **Whole workflow, not one prompt.** Research, outline, draft, edit, quality, export, repurpose, publish and measure are all in one place, with the record of every step.
- **Separation between users.** Every brand, project and document belongs to a user account, and the server checks ownership on every request (`artifacts/api-server/src/middleware/ownershipHelpers.ts`). One customer cannot see another's work.
- **Provider choice.** It can use OpenAI, Anthropic or Google models, chosen per pipeline stage, so it is not locked to one AI vendor (`artifacts/api-server/src/lib/ai/router.ts`).

## Honest status (as recorded in the repo)

`docs/PROJECT_STATUS.md` and `docs/GO_NO_GO_DECISION.md` state the current position:

- The source has been recovered from its original Replit home, stabilised, and merged into GitHub `main`.
- Automated checks pass: install, typecheck, 249 API tests, 10 frontend tests, database migrations, integration tests, and build.
- The project is in **active product closeout**, not finished. Rich-editor behaviour, image and video handling, and a verified production deployment are explicitly listed as outstanding.
- A product audit (`docs/content-os-audit.md`, dated 1 Aug 2026) found the backend strong and the frontend workflow too fragmented for an everyday writer. Note that this audit is partly out of date — it says there is no authentication or rate limiting, but both now exist in the code.

In plain terms: **the engine is built and tested; the driving experience is still being finished, and it has not yet been proven running in production.**
