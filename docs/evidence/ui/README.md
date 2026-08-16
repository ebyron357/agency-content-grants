# Content OS UI Evidence

## Exact build

| Field | Value |
|---|---|
| Repository | `https://github.com/ebyron357/agency-content-grants.git` |
| Branch | `manus/content-machine-closeout` |
| Application source SHA | `35b6e8b10eebccbcb50e3f8e852d17099797d123` |
| Environment | Isolated GitHub Actions local/test runtime: Vite frontend `http://localhost:5173/`, API `http://localhost:8080/`, disposable PostgreSQL, deterministic demo AI provider |
| Authentication | Isolated local/test password only; no production credentials; authentication was not bypassed |
| Data | Safe deterministic demo data generated through the real application |
| Capture method | Real Chromium browser rendering via Playwright |

## Screenshot manifest

| Screenshot filename | Screen / route | Viewport | Authentication | What it proves |
|---|---|---:|---|---|
| `01-login-desktop.png` | `/` | 1440×900 | signed out | Actual Content OS login screen. |
| `22-empty-state-desktop.png` | `/projects` | 1440×900 | authenticated test session | Important empty Projects state before deterministic demo data is seeded. |
| `02-dashboard-desktop.png` | `/dashboard` | 1440×900 | authenticated test session | Authenticated dashboard command center. |
| `03-sidebar-desktop.png` | `/dashboard` | 1440×900 | authenticated test session | Main application navigation/sidebar and active-state treatment. |
| `04-create-content-desktop.png` | `/create` | 1440×900 | authenticated test session | New Content creation screen. |
| `05-content-types-desktop.png` | `/create` | 1440×900 | authenticated test session | Supported content-type selection: Blog Post, Article, Guide, Manual, Report, White Paper, Newsletter, Ebook, SOP / Process. |
| `06-advanced-options-desktop.png` | `/create` | 1440×900 | authenticated test session | Advanced creation options expanded. |
| `50-generation-loading.png` | `/create` | 1440×900 | authenticated test session | Actual generation/loading state initiated by the real application. |
| `07-project-detail-desktop.png` | `/projects/dddc28bc-9162-4abf-b3c2-070d8cf48337?mode=quick` | 1440×900 | authenticated test session | Generated project detail and pipeline state. |
| `08-project-workflow-tabs-desktop.png` | `/projects/dddc28bc-9162-4abf-b3c2-070d8cf48337?mode=quick` | 1440×900 | authenticated test session | Overview, Research Plan, Sources, Claims, Outline, Editor, Quality, Repurpose, Export tabs. |
| `09-rich-editor-desktop.png` | `/projects/dddc28bc-9162-4abf-b3c2-070d8cf48337?mode=quick#editor` | 1440×900 | authenticated test session | Rich editor with deterministic generated prose visible. |
| `10-rich-editor-toolbar-desktop.png` | `/projects/dddc28bc-9162-4abf-b3c2-070d8cf48337?mode=quick#editor` | 1440×900 | authenticated test session | Rich-editor formatting toolbar. |
| `11-section-navigation-desktop.png` | `/projects/dddc28bc-9162-4abf-b3c2-070d8cf48337?mode=quick#editor` | 1440×900 | authenticated test session | Section navigation with generated sections and word counts. |
| `12-ai-edit-controls-desktop.png` | `/projects/dddc28bc-9162-4abf-b3c2-070d8cf48337?mode=quick#editor` | 1440×900 | authenticated test session | Re-draft, edit-mode selector, Apply Edit, Save/Approve controls. |
| `13-image-insertion-dialog-desktop.png` | `/projects/dddc28bc-9162-4abf-b3c2-070d8cf48337?mode=quick#editor` | 1440×900 | authenticated test session | Real image insertion dialog with raster guidance, alt text and caption fields. |
| `14-image-rendered-editor-desktop.png` | `/projects/dddc28bc-9162-4abf-b3c2-070d8cf48337?mode=quick#editor` | 1440×900 | authenticated test session | Uploaded test image rendered inside the real editor. |
| `15-video-insertion-dialog-desktop.png` | `/projects/dddc28bc-9162-4abf-b3c2-070d8cf48337?mode=quick#editor` | 1440×900 | authenticated test session | Real YouTube/Vimeo insertion dialog. |
| `16-video-rendered-editor-desktop.png` | `/projects/dddc28bc-9162-4abf-b3c2-070d8cf48337?mode=quick#editor` | 1440×900 | authenticated test session | Validated YouTube video rendered inside the real editor. |
| `17-quality-review-desktop.png` | `/projects/dddc28bc-9162-4abf-b3c2-070d8cf48337?mode=quick#quality` | 1440×900 | authenticated test session | Quality review/evaluation screen and publication-readiness state. |
| `18-repurpose-desktop.png` | `/projects/dddc28bc-9162-4abf-b3c2-070d8cf48337?mode=quick#repurpose` | 1440×900 | authenticated test session | Repurpose workflow in authenticated product. |
| `19-export-desktop.png` | `/projects/dddc28bc-9162-4abf-b3c2-070d8cf48337?mode=quick#export` | 1440×900 | authenticated test session | Export screen showing available formats. |
| `20-export-completed-desktop.png` | `/projects/dddc28bc-9162-4abf-b3c2-070d8cf48337?mode=quick#export` | 1440×900 | authenticated test session | Successful completed export state with validation and download action. |
| `21-settings-desktop.png` | `/settings` | 1440×900 | authenticated test session | Authenticated settings screen. |
| `30-dashboard-mobile.png` | `/dashboard` | 390×844 | authenticated test session | mobile dashboard responsive proof. |
| `31-create-mobile.png` | `/create` | 390×844 | authenticated test session | mobile Create Content responsive proof. |
| `32-project-detail-mobile.png` | `/projects/dddc28bc-9162-4abf-b3c2-070d8cf48337?mode=quick` | 390×844 | authenticated test session | mobile project detail responsive proof. |
| `33-rich-editor-mobile.png` | `/projects/dddc28bc-9162-4abf-b3c2-070d8cf48337?mode=quick#editor` | 390×844 | authenticated test session | mobile rich-editor adaptive proof. |
| `34-dashboard-tablet.png` | `/dashboard` | 768×1024 | authenticated test session | tablet dashboard responsive proof. |
| `35-create-tablet.png` | `/create` | 768×1024 | authenticated test session | tablet Create Content responsive proof. |
| `36-project-detail-tablet.png` | `/projects/dddc28bc-9162-4abf-b3c2-070d8cf48337?mode=quick` | 768×1024 | authenticated test session | tablet project detail responsive proof. |
| `37-rich-editor-tablet.png` | `/projects/dddc28bc-9162-4abf-b3c2-070d8cf48337?mode=quick#editor` | 768×1024 | authenticated test session | tablet rich-editor adaptive proof. |
| `38-dashboard-laptop.png` | `/dashboard` | 1280×800 | authenticated test session | laptop dashboard responsive proof. |
| `39-create-laptop.png` | `/create` | 1280×800 | authenticated test session | laptop Create Content responsive proof. |
| `40-project-detail-laptop.png` | `/projects/dddc28bc-9162-4abf-b3c2-070d8cf48337?mode=quick` | 1280×800 | authenticated test session | laptop project detail responsive proof. |
| `41-rich-editor-laptop.png` | `/projects/dddc28bc-9162-4abf-b3c2-070d8cf48337?mode=quick#editor` | 1280×800 | authenticated test session | laptop rich-editor adaptive proof. |

All final screenshots correspond to the application source SHA above. No mockups, manually constructed application HTML, production credentials, or customer data were used.