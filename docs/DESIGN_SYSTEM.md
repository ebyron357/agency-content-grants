# Content OS design system

**Status:** current, locked by Issue #8 closeout (2 October 2026).
**Owner:** product owner (ebyron357). Changes go through a pull request that updates this file and re-runs the accessibility gate.

Content OS uses one visual system for every authenticated route: a **premium dark editorial command center**. There is no light theme. `index.html` sets `class="dark"` on `<html>` and `color-scheme: dark`.

## Tokens

All colours are CSS custom properties in `artifacts/content-os/src/index.css` (`:root`), exposed to Tailwind v4 as `bg-*`, `text-*`, `border-*` utilities. Pages must use tokens, not hex values or Tailwind palette neutrals (`stone-*`, `gray-*`).

| Token | Value | Use |
|---|---|---|
| `background` | `#080a0f` | Application shell and page background |
| `card` | `#10131a` | Panels, cards, tab bars |
| `popover` | `#141822` | Menus, tooltips, toasts |
| `muted` | `#151923` | Inset wells, skeletons, chips |
| `secondary` | `#1b202b` | Raised controls, active tab, hover surface |
| `border` / `input` | `#232835` / `#2e3442` | Soft low-contrast borders / form control borders |
| `foreground` | `#f3f4f6` | Primary text |
| `muted-foreground` | `#9aa1ad` | Secondary text (≥ 6.5:1 on every surface) |
| `primary` | `#d4363c` | Filled primary actions; white text 4.8:1 |
| `brand` | `#ff7979` | Coral accent text, active indicators, focus ring (≥ 7:1) |
| `destructive` | `#dc2626` | Errors and irreversible actions (deeper than brand) |
| emerald (`emerald-300/400`) | — | Verified success only |
| amber (`amber-300/400`) | — | Caution, missing configuration, demo/simulated data |
| `sidebar*` | `#0b0d13` … | Navigation rail |

Status tints use the status colour at 10% for the surface, 25% for the border and the `-300` shade for text, e.g. `border-amber-400/25 bg-amber-400/10 text-amber-300`.

## Typography

One sans family (Inter) everywhere; no serif headings.

- Page title (`h1`): `text-3xl sm:text-4xl font-semibold tracking-[-0.03em]` via `PageHeader`.
- Eyebrow: `text-[11px] font-semibold uppercase tracking-[0.18em] text-brand` with a brand dot.
- Section/panel title (`h2`): `text-sm font-semibold`.
- Metadata: `text-xs text-muted-foreground`.

## Shape and spacing

- Radius scale: controls `rounded-xl` (12px), panels `rounded-2xl` (16px), chips `rounded-full`/`rounded-lg`.
- Control heights: buttons and inputs `h-10` (default), `h-8` (small), `h-11` (large).
- Page frame: `PageShell` (`px-4 sm:px-6 lg:px-8`, `py-6 lg:py-8`; widths `wide` 1480px, `default` 6xl, `narrow` 4xl).

## Shared components

`artifacts/content-os/src/components/layout/`:

- `Sidebar` — dark navigation rail. Identity, primary **New content** action, Documents, Brands, Distribution, Performance, Dashboard, Settings, secondary Sign out. Collapses to a 64px icon rail below `md` with tooltips and accessible names; active item has `aria-current="page"` and a brand indicator.
- `Page` — `PageShell`, `PageHeader`, `Panel`, `PanelHeader`, `StateMessage` (empty/error state with one recommended action), `LoadingState`.

Shared primitives in `components/ui/` (button, input, select, textarea, card, dialog, alert-dialog, tabs, tooltip, toast) carry the same radius, height and focus-ring rules.

## Behaviour standards

- Every primary screen has an obvious primary action, a useful empty state, a loading state (`role="status"`), an actionable error state (`role="alert"`, retry or route back) and no dead-end navigation.
- Workflow and settings tabs are `role="tablist"` / `role="tab"` with `aria-selected`; segmented toggles use `aria-pressed`.
- Every form control has a programmatic label; icon-only buttons have `aria-label`.
- Focus is always visible (`:focus-visible` outline in `brand`).
- `prefers-reduced-motion: reduce` disables animation and transitions globally (`index.css`).
- Layouts are single-column below `lg`; the page never scrolls horizontally at 390px.
- Demo or simulated data is labelled as such (amber); unavailable integrations are never shown as connected.

## Enforcement

`artifacts/content-os/e2e/accessibility.spec.ts` (CI job **CI → validate**) logs in and runs axe (WCAG 2.0/2.1 A/AA, critical + serious) on login, Create, Dashboard, Documents, Brands, Brand detail, Distribution, Performance, Settings, the 404 page and all nine Project Detail workflow tabs. It also asserts the dark shell tokens, that every navigation destination is reachable by name on a 390px viewport, and that there is no horizontal page scroll on mobile.

Visual evidence for the locked system: `docs/evidence/ui/closeout-2026-10-02/`.
