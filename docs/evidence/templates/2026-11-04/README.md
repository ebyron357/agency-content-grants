# Application templates evidence, 4 November 2026

These screenshots come from a local server on the demo database, with synthetic organizations. Each is 1280 px wide at 2x. The workspace template "Arts council application" was made by duplicating the built-in "Federal grant: nonprofit" template and then saved through the API.

| File | Shows |
|---|---|
| `34-templates-list.png` | Grant Studio → Templates. The workspace's own template appears with its rules and version, above the read-only built-in templates. Each template can be duplicated, and workspace templates can be archived |
| `35-template-editor.png` | The editor: name, description and the rules for when the template is used, then the sections with title, limit and guidance |
| `36-template-validation.png` | A save the server refused, with every problem listed and where it is |

The same behaviour is checked by `artifacts/content-os/e2e/templates.spec.ts` (with axe and a 390 px check) and `artifacts/api-server/src/routes/grant-templates.integration.test.ts`.
