# Content Machine — User Manual

Content Machine (shown in the app as **Content OS**) turns a content idea into a researched, reviewed, exportable long-form document: blog posts, articles, guides, manuals, SOPs, reports, white papers, e-books and newsletters.

## 1. Signing in

1. **First time:** open the invitation link you were sent. Enter your name and choose a password of at least 12 characters (a short sentence works well), then choose **Join**. The link works once and expires after 7 days.
2. **After that:** open the workspace address (the production URL), enter your **email** and **password**, and choose **Sign in**. Operators who use the team password leave the email empty.
3. You stay signed in for up to 7 days on that browser. Use **Sign out** at the bottom of the left rail on shared computers.

The left rail shows which workspace you are in. If you belong to several, switch in **Settings → Team**.

Forgotten password: ask an owner or admin of your workspace to remove you and invite you again; you choose a new password when you accept. To change a password you know, go to **Settings → Team → Your account**; this signs you out of every other browser. Five wrong attempts lock sign-in from your network for 15 minutes.

### Two-factor sign-in

Turn it on in **Settings → Team → Two-factor sign-in**: scan the code with an authenticator app (1Password, Google Authenticator, Microsoft Authenticator, Authy), enter the 6-digit code it shows, then copy or download your 10 recovery codes and keep them safe. From then on, sign-in asks for the current code after your password. Lost your phone? Choose **Use a recovery code**; each works once. Make new codes in the same place when you run low.

An owner or admin can **require two-factor for everyone** (Settings → Team → Members). Anyone without it is asked to set it up before they can continue.

### Where you're signed in

**Settings → Team → Where you're signed in** lists every browser signed in to your account, with when it was last active. Sign out any one of them, or choose **Sign out everywhere else**.

### Your team

**Settings → Team** lists the workspace's members and their roles. Owners and admins can:
- **invite someone** (email and role; send them the link that appears, which is shown only once);
- **withdraw** an open invitation;
- **change** a member's role;
- **remove** a member, whose access ends immediately and whose API keys in this workspace are revoked;
- read the **audit log** of sign-ins, security changes, members, approvals and automation, filter it, and export it as CSV.

A workspace always keeps at least one owner, and only owners can make or remove owners. Each workspace's data is private to it.

**Roles decide what each person can do.** Writers create content and applications, including budgets. Reviewers approve and reopen application sections. The authorized representative approves the final package and records submissions and outcomes. Finance edits budgets and records award amounts. Viewers read only. Owners and admins can do everything. Buttons a role cannot use are not shown, and **Settings → Team → What each role can do** has the full table. A role change applies on the person's next action. An admin-unlocked operator can also create a **client workspace** for an organization, with an invitation for its first owner.

## 2. Finding your way

The left rail is on every screen. On a phone it collapses to icons; hover or long-press an icon to see its name.

| Rail item | What it is for |
|---|---|
| **New content** | Start a new piece from a one-line intent |
| **Grant Studio** | Find federal grants your organization can apply for, then write, budget, check and package the application |
| **Grants** | A curated directory of grant and in-kind programs, with official sources |
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

Images and videos stay in place in every format. HTML embeds each image and keeps video players. DOCX embeds PNG, JPEG and GIF images; PDF embeds PNG and JPEG. Where a format cannot hold an image (Markdown, plain text, or an image type that DOCX or PDF does not support, such as WebP), a labelled placeholder such as `[Image: alt text — caption]` takes its place. Outside HTML, videos become links to the YouTube or Vimeo page. The export's validation notes say how many images were embedded or replaced.

## 8. Distribution and performance

- **Distribution → Connect** adds a destination for the selected brand. `demo` destinations are simulated and labelled **demo · simulated**; nothing is posted externally. Real social publishing uses Typefully once the owner has configured it.
- Publish or schedule approved documents and repurposed assets, then follow them in **Upcoming** and **History** and on the calendar.
- **Performance** shows best and worst performers and recommendations only from real, provider-reported metrics. Simulated posts are excluded and the page says so.

## 9. Settings (for owners and admins)

Regular users can view provider status and dependencies. Changing model assignments or testing provider connections needs **admin access**: Settings → Security → enter the admin password → **Unlock admin access**. **Automation** lets admins create scoped API keys and webhook subscriptions for tools such as n8n.

## 10. Getting help

See [`TROUBLESHOOTING_AND_SUPPORT.md`](TROUBLESHOOTING_AND_SUPPORT.md). For anything not covered there, contact the workspace owner using the details in your access handoff.

## Grant resources

Open **Grants** in the sidebar. Search by mission or expense, then choose a funding type, location and status. Each card shows the support amount, eligibility, permitted uses, limits, timing and official source links. Location is a discovery filter, not a determination that your organization qualifies. Check the official page before applying. Older listings and elapsed deadlines show “Review required”; closed and paused programs are watchlist resources. Cash, credits, software and fundraising services are labeled separately. See [the directory guide](GRANT_RESOURCES.md) for scope and maintenance.

## Grant Studio

Open **Grant Studio** in the sidebar. The full guide is [Grant Studio](GRANT_STUDIO.md).

1. **Add organization.** Choose the organization type: 501(c)(3), other nonprofit, small business or other for-profit. Enter the legal name, state, annual budget, mission and focus areas (comma separated, for example `literacy, early childhood`). Specific focus areas give better matches than broad ones such as "health".
2. **Fact library.** Add the facts funders ask for in every application, such as community need statistics, programs, results, staff, partners and finances. Give each one its source and date, then tick the confirmation box once you have checked it. AI drafting uses only confirmed facts, and the Write step lists the ones that fit each section with a **Copy** button.
3. **Readiness.** Mark each registration and document as missing, in progress or ready, with its expiry date. Federal applications need an active SAM.gov registration and a Grants.gov Authorized Organization Representative.
4. **Place designations.** Some funders give priority points or eligibility for Opportunity Zones, HUBZones, HUD Qualified Census Tracts and Difficult Development Areas, persistent-poverty counties or USDA rural areas. On this tab, enter your address, find its census tract with the **Census Geocoder** link, then use **Check on the official tool** for each designation and record what the agency's tool says, with the date you checked. Matches then tell you when a notice mentions a designation and what you recorded, and drafting can use the ones you recorded as in. Recheck each year; HUD designations change every January.
5. **Matches.** Opportunities come from Grants.gov (federal) and the California Grants Portal (state), refreshed daily. California programs show a "CA state program" badge and match only organizations whose profile state is CA, so record your state. Some California programs have rolling deadlines and fund applications until the money runs out. Each card shows the fit score, why it fits, and what is missing. **Only my topics** hides eligible but off-topic opportunities; clear it to see everything you are eligible for. Opportunities you cannot apply for are left out, and the count tells you how many.
6. **New matches.** The Grant Studio page shows each organization's new matches and those closing within 14 days. On the Matches tab, **Only new** shows what arrived since you last looked, and **Mark all as seen** resets the count. To be told by email or Slack, subscribe to the `grant.new_matches` event in **Settings → Automation** and connect it to your email or chat tool. **Add to calendar** on an opportunity or application downloads a calendar entry with reminders, and **Deadline calendar** on the Grant Studio page downloads every open application. The `grant.deadline_approaching` event warns at 14, 7 and 2 days.
7. **Review and apply.** Read the opportunity and open the official notice. **Start application** asks you to confirm that you read the notice's eligibility section and that your organization meets it.
8. **Requirements.** Check the compliance matrix and add anything the notice asks for. With an AI provider configured, you can paste the notice and choose **Extract**. Then choose **Confirm all**.
9. **Write.** Work through each section within its limit. **Draft with AI** uses only your organization's facts and marks anything missing as `[Add: …]`, which you must fill in. **Review** scores the section. **Approve** locks it, and editing it later reopens it. Once a section is approved, **Save to library** keeps it for later applications. In the next application, **Reuse approved writing** beside the editor lets you **Replace** the section with it or **Append** it, then adapt it for the new funder. The organization's **Saved writing** tab lists, renames and deletes saved texts. **Writing checks** under the editor list placeholders still to fill, very long sentences, the reading grade and, for objectives, whether each one has a number, a time frame and a starting point. On a logic model section, the **Logic model builder** takes inputs, activities, outputs and outcomes (one per line) and puts them into the section.
10. **Budget.** Add lines by category with a justification for each, and set your indirect rate if you have one. The total is checked against the award ceiling.
11. **Format & letters.** Copy the notice's font, size, line spacing, margins, page limit and required file name. The page estimate and the exported file follow them, and the file name is checked against Grants.gov's rules. Add each letter of support you need, with who you asked and when it is due; **Copy request** gives a request to edit and send yourself, and you mark each letter received or declined.
12. **Review & package.** The **Competitiveness rating** (0–100, also in the header) shows how ready the application is to compete: fit, reviewer scores weighted by the notice's points, completeness, and registrations and time. Under **To raise it**, it lists what is worth the most points. It is not a chance of approval. Once you record outcomes, the Grant Studio page shows your real award rate for each rating band. Every failing check has a **Fix** link. When all checks pass, the authorized representative approves the package and downloads it. **Download draft** works at any time for team review. After your authorized representative submits, use **Outcome** on the same step to record the submission (date and tracking number), and later the award, decline or withdrawal. The Grant Studio page then shows your pipeline and win rate.

**Foundations.** **Grant Studio → Foundations** shows what private foundations have funded, from their tax filings. It is funding history, not a list of open calls.

1. Under **Funders matched to your organization**, choose the organization. Funders are ranked out of 100 by giving in your state, giving to your cause, grant size, and how recently and steadily they gave. Each factor shows its points and why.
2. To compare grant sizes with what you plan to ask for, type a **Request amount** and press **Update**. Without one, sizes are compared with the organization's annual budget. **Cause (NTEE)** lets you look at a different cause from the one in your profile.
3. Each funder shows **Accepts applications**, **Invitation only** or **Unknown**, from its own Form 990-PF and with the tax year. Invitation-only foundations do not accept unsolicited requests: tick **Hide funders whose latest filing says they accept no unsolicited requests** to leave them out. Unknown means the filing has not been read; it is not a yes or a no.
4. Open a funder for its giving by year, state and cause, its largest recent grants, and, when its filing gives them, what to send, deadlines and limits. **Source filing** gives the IRS object id with links to ProPublica and the IRS downloads.

A match is a starting point for research. Check each funder's own instructions before you approach it.

**Past federal awards.** A federal opportunity's page shows **Past federal awards** from USAspending.gov for each Assistance Listing number: how many grants the program made in recent fiscal years, the median and range, the most recent recipients with their state and amount, and, once you choose an organization, recent winners in its state. It shows what the program funded before, not what it will fund. If USAspending cannot be reached, the page says so and shows the last copy it read.

**Templates.** **Grant Studio → Templates** holds the sections and requirements new applications start with. Duplicate a built-in template to adapt it to the funders you apply to most: rename it, set when it should be used (organization type, federal or state programs, words in the opportunity title), and add, reorder or edit sections and requirements. New applications use it automatically when its rules fit, or you can pick it when you start one. Applications already under way keep their own copy.

Grant Studio never submits for you. Submit through Grants.gov Workspace or the funder's portal, and confirm the forms the package lists. Without an AI provider, the drafting tools show a labelled scaffold, which has to be replaced before the package can be approved. The package also cannot be approved while any `[Add: …]` or `TBD` placeholder remains.
