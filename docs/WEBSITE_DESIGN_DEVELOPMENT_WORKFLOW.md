# Website Design & Development Workflow

Canonical end-to-end pipeline for taking a client/business website engagement from
intake to release. This document defines the stages, the owner-approval gates
that must not be skipped, and the tool categories appropriate to each stage.
It is a process playbook, not an authorization to build product features —
implementation work in this repository remains governed by `AGENTS.md` and
`docs/GO_NO_GO_DECISION.md`.

## Pipeline

```
BUSINESS / WEBSITE INPUT
        |
        v
RESEARCH
  Competitors, Awwwards, Behance, Dribbble, best-in-class sites
        |
        v
DECONSTRUCT + SYNTHESIZE
  Extract what works -> original design strategy
        |
        v
[GATE] OWNER APPROVAL
        |
        v
UI / DESIGN GENERATION
  Stitch, Figma AI, v0, or another qualified generator
        |
        v
AI CRITIQUE + REVISION LOOP
  Generated design checked against the research quality standard
        |
        v
[GATE] OWNER APPROVAL
        |
        v
CREATIVE PRODUCTION
  Higgsfield, Open Higgsfield, ComfyUI, or an appropriate image/video model
        | (creative QC)
        v
PRODUCTION DESIGN
  Figma + MCP, or an appropriate direct design-to-code route
        |
        v
[GATE] OWNER APPROVAL
        |
        v
DEVELOPMENT
  Codex, Claude Code, Cursor, Copilot coding agent, or another qualified agent
        |
        v
QA + VISUAL COMPARISON
  Implementation checked against the approved production design -> correction loop
        |
        v
PRODUCTION -> VERIFY -> RELEASE
```

## Stage definitions

### 1. Business / website input

Intake of the client's brief: business goals, audience, brand assets, content
inventory, technical constraints, and any existing site. This is the only
stage that originates outside the pipeline; everything downstream traces back
to it.

### 2. Research

Survey the competitive and craft landscape before designing anything:

- Direct competitors and adjacent players in the client's category.
- Award/portfolio sources for best-in-class execution: Awwwards, Behance,
  Dribbble.
- Any other sites that set the bar for the client's category or audience.

Output: an evidence set (screenshots, links, notes) of what exists today, not
yet a design.

### 3. Deconstruct + synthesize

Break down the research into the specific patterns, layouts, motion, and
content strategies that work, and why. Synthesize an **original** design
strategy for this client — a point of view, not a collage of references.
Never ship a derivative copy of a single reference site; extract principles,
not pixels.

Output: a written design strategy (positioning, structure, visual direction,
key differentiators) ready for owner review.

### 4. 🚧 Owner approval (gate 1)

The design strategy must be explicitly approved by the business owner before
any UI is generated. Do not proceed on an assumed approval.

### 5. UI / design generation

Turn the approved strategy into concrete UI using a qualified AI design
generator (e.g. Stitch, Figma AI, v0, or an equivalent tool). This produces a
first-pass design artifact, not final production design.

### 6. AI critique + revision loop

Evaluate the generated design against the research-derived quality standard
from stage 3. Iterate — critique, revise, re-generate — until the design
meets that standard. This loop runs before the design goes back to the owner,
so the owner is reviewing a vetted candidate, not a rough draft.

### 7. 🚧 Owner approval (gate 2)

The revised, AI-vetted design must be explicitly approved by the business
owner before creative production or production design work begins.

### 8. Creative production

Produce the imagery, video, and other creative assets the approved design
calls for, using an appropriate generative tool (Higgsfield, Open Higgsfield,
ComfyUI, or another qualified image/video model). Every asset passes a
creative QC pass — checked against brand, quality, and usage-rights
expectations — before it moves downstream.

### 9. Production design

Convert the approved design and creative assets into implementation-ready
production design, using Figma + MCP or another direct design-to-code route
appropriate to the target stack. This is the last design artifact before
development and must be complete enough to build from without ambiguity.

### 10. 🚧 Owner approval (gate 3)

The production design must be explicitly approved by the business owner
before development starts. This is the last approval gate before code is
written.

### 11. Development

Implement the approved production design using a qualified coding agent
(Codex, Claude Code, Cursor, Copilot coding agent, or another qualified
agent). Development in this repository still follows `AGENTS.md`: dedicated
branches, focused PRs, and no merge/deploy without the required gates.

### 12. QA + visual comparison

Compare the running implementation against the approved production design
pixel-by-pixel and interaction-by-interaction. Any mismatch goes back through
a correction loop until the implementation matches the approved design and
passes functional QA.

### 13. Production → verify → release

Deploy, verify the live result (routes, responsiveness, performance,
accessibility, analytics/tracking), and release. Production promotion for
work in this repository still requires the merge/production gates in
`AGENTS.md`.

## Gate discipline

- There are exactly three owner-approval gates: after the design strategy,
  after the AI-critiqued UI design, and after the production design. Do not
  add unapproved shortcuts around them and do not collapse them into one
  review.
- Each gate blocks all downstream stages until the owner's approval is
  explicitly recorded (e.g. in the relevant PR, ticket, or decision doc).
- "AI critique" and "creative QC" are internal quality passes, not
  substitutes for owner approval — they raise the quality of what reaches the
  owner, they don't replace their sign-off.

## Tool categories by stage

| Stage | Tool category | Example tools |
|---|---|---|
| UI/design generation | AI design generator | Stitch, Figma AI, v0 |
| Creative production | Generative image/video | Higgsfield, Open Higgsfield, ComfyUI |
| Production design | Design-to-code | Figma + MCP |
| Development | Coding agent | Codex, Claude Code, Cursor, Copilot coding agent |

Tool names above are examples of a qualified category, not a mandated
toolchain — pick the specific tool that fits the client's stack and the
team's existing licenses.
