# Content Machine — User Manual

Content Machine (shown in the app as **Content OS**) turns a content idea into a researched, reviewed, exportable long-form document: blog posts, articles, guides, manuals, SOPs, reports, white papers, e-books and newsletters.

## 1. Signing in

1. Open the workspace address you were given (the production URL).
2. Enter the workspace password and choose **Sign in**. There is no username.
3. You stay signed in for up to 7 days on that browser. Use **Sign out** at the bottom of the left rail on shared computers.

Forgotten or changed password: ask the workspace owner; passwords are never reset by e-mail. Five wrong attempts lock sign-in from your network for 15 minutes.

## 2. Finding your way

The left rail is on every screen. On a phone it collapses to icons; hover or long-press an icon to see its name.

| Rail item | What it is for |
|---|---|
| **New content** | Start a new piece from a one-line intent |
| **Documents** | Every document project, most recently updated first, with search, type filters and **Resume** |
| **Brands** | Voice, audience and context that every document inherits |
| **Distribution** | Connect destinations, schedule and review publishing |
| **Performance** | What worked, using only metrics actually reported by connected destinations |
| **Dashboard** | Continue working, production pipeline by stage, recent activity |
| **Settings** | Provider status, model assignments, dependencies, automation keys and webhooks |

## 3. Before your first document: add a brand

**Brands → New brand.** Enter a name, industry and description, then open the brand to add voice, tone, reading level, vocabulary to prefer or avoid, compliance notes, audiences, verified brand facts and brand knowledge. Content Machine uses these in every draft for that brand.

## 4. Creating content

1. **New content.**
2. Describe what should exist when you are done (for example *"A step-by-step guide for first-time home buyers in the US"*).
3. Choose the output shape (Blog Post, Article, Guide, Manual, SOP / Process, Report, White Paper, Ebook, Newsletter) and the brand.
4. Optional: open **Advanced options** to set audience, desired reader outcome, target length, tone/point of view, research depth (Quick, Balanced, Deep) and extra direction.
5. Choose **Generate Content**. Content Machine builds the brief, research plan and outline, creates the document, drafts every section, runs a quality review and opens the editor. Progress is shown on screen.

If the workspace shows **demo mode**, generated text is clearly marked `[DEMO OUTPUT …]`; ask the owner to configure an AI provider for real drafts.

To start from a blank brief instead, use **Documents → Blank project**.

## 5. Working on a document

Open a document from **Documents** (or **Resume** on the Dashboard). The header shows type, status, brand and word count; **Edit brief** changes the assignment. The tab bar follows the workflow:

| Tab | What you do there |
|---|---|
| **Overview** | See pipeline progress and the full assignment brief |
| **Research Plan** | Generate or review the research questions and approach |
| **Sources** | Add sources by URL or PDF upload, fetch their content, approve or reject them |
| **Claims** | Record factual claims, link them to sources and verify them |
| **Outline** | Generate, edit, reorder and approve the section structure |
| **Editor** | Write and refine each section (below) |
| **Quality** | Run an evaluation: accuracy, citations, coverage, readability, brand fit and more, plus publication readiness |
| **Repurpose** | Create channel-specific derivative assets (for example LinkedIn posts, threads, newsletters) and send them to Distribution |
| **Export** | Download the document (section 7) |

## 6. The editor

- **Document map** (left): every section with its word count; select one to edit.
- **Writing canvas** (centre): the toolbar offers headings (H1–H3), bold, italic, code, bulleted and numbered lists, links, image, video, undo and redo. Choose **Save changes** after editing.
- **Re-draft section** asks the AI to rewrite the section; the dropdown next to it applies a targeted edit (natural tone, developmental, continuity, proofread, shorten, expand, simplify) with **Apply edit**.
- **Lock** protects a section from changes; **Approve** marks it final. Unlock or reopen a section to edit it again.
- **Images:** choose the image button, upload a JPEG, PNG, GIF or WebP up to 10 MB, and enter **alt text** (required) and an optional caption.
- **Video:** choose the video button and paste a YouTube or Vimeo `https://` link; other links are rejected for safety.
- The right-hand panel shows section state and the next recommended action.

Everything is saved to the server; reopening the document, signing in elsewhere or a service restart does not lose saved work.

## 7. Exporting

**Export** tab → pick **DOCX**, **PDF**, **HTML**, **Markdown** or **plain text** → **Export** → **Download** when it completes. When the project has sources or claims, the export ends with an evidence register listing each source, its retrieval status and the claims it supports. Previous exports stay listed for download.

## 8. Distribution and performance

- **Distribution → Connect** adds a destination for the selected brand. `demo` destinations are simulated and labelled **demo · simulated**; nothing is posted externally. Real social publishing uses Typefully once the owner has configured it.
- Publish or schedule approved documents and repurposed assets, then follow them in **Upcoming** and **History** and on the calendar.
- **Performance** shows best and worst performers and recommendations only from real, provider-reported metrics. Simulated posts are excluded and the page says so.

## 9. Settings (for owners and admins)

Regular users can view provider status and dependencies. Changing model assignments or testing provider connections needs **admin access**: Settings → Security → enter the admin password → **Unlock admin access**. **Automation** lets admins create scoped API keys and webhook subscriptions for tools such as n8n.

## 10. Getting help

See [`TROUBLESHOOTING_AND_SUPPORT.md`](TROUBLESHOOTING_AND_SUPPORT.md). For anything not covered there, contact the workspace owner using the details in your access handoff.
