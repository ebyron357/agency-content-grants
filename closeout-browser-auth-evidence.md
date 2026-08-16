# Authenticated browser QA evidence

Date: 2026-08-16 UTC

## Local setup

- Frontend: `http://localhost:5173/`
- API: `http://localhost:8080/`
- Database: disposable local PostgreSQL database `content_machine_test`
- Authentication: isolated test password, not a production credential

## Verified observations

1. The unauthenticated login screen renders with the Content OS brand, clear welcome hierarchy, labelled password field, visible focus styling, and an actionable sign-in button.
2. The browser initially exposed a development-only proxy mismatch because Vite defaulted to API port 3000 while the API server defaults to 8080. The Vite config was corrected to use 8080 unless `API_PORT` is explicitly set.
3. After restarting the frontend with the corrected proxy, the isolated test password authenticated successfully.
4. The authenticated shell loaded the Content OS navigation and New Content creation route without a runtime error.
5. The New Content page exposed the topic field, eight content-type choices, brand selector, advanced options, and Generate Content action.

## Remaining browser QA

A complete click-through of generation, project editor, media insertion, quality review, and export remains to be performed in the authenticated session. The integration suite separately completed the full deterministic generation and export workflow with 38 passed and 0 failed.

## Creation and editor verification

6. The authenticated New Content form accepted the topic and seeded brand.
7. Generate Content navigated to a project detail route and completed the deterministic demo workflow without a runtime error.
8. The project detail screen rendered the six generated sections, workflow tabs, approve/re-draft controls, edit mode selector, rich-text toolbar, media insertion controls, quality tab, repurpose tab, and export tab.
9. The editor visibly rendered generated section content and a structured demo claim-verification result.

## Rich media verification

10. The Insert video embed dialog clearly stated that only YouTube and Vimeo HTTPS links are accepted.
11. An approved YouTube HTTPS URL was accepted and inserted into the section.
12. The editor rendered the persisted YouTube player embed and exposed a Save action without a runtime error.

## Export verification

13. The authenticated Export tab exposed Markdown, HTML, plain text, DOCX, and PDF format choices.
14. A Markdown export completed in-browser, displayed `All validation checks passed`, showed a completed status, and exposed a Download link.
