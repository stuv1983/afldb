# AFLDB-ISSUE-173 — Super Admin selectable frontend layout styles

**Status:** RESOLVED 2026-09-15. Phase 1 implemented 2026-09-15; one MUST FIX and one SHOULD
FIX found by the Vercel Web Interface Guidelines quality-gate review were remediated the same
day and confirmed resolved by a narrow re-audit; manual DEV rendered acceptance (Playwright)
then passed with no ISSUE-173 defects found. See §15-§17 below for the full record.
**Date:** 2026-09-15
**Author:** Claude (frontend-design planning session, then implementation session),
worktree `D:\dev\afldb-issue-173`, branch `claude/issue-173-layout-styles`

This is the design/architecture plan requested for AFLDB-ISSUE-173, and §14 below records the
Phase 1 implementation carried out against it. It is not a redesign of any individual page —
ISSUE-172 already owns page/nav-specific UI cleanup separately.

---

## 14. Phase 1 implementation record (2026-09-15)

Implemented exactly the §12/§13 scope, with no unrelated changes:

- `src/lib/site-settings.ts` — added `SiteLayout = 'classic' | 'sidebar'`, `SITE_LAYOUTS`,
  `DEFAULT_SITE_LAYOUT = 'classic'`, `parseSiteLayout` (fallback to `'classic'` on any
  missing/unrecognised value), `SETTING_KEYS.frontendLayout = 'site.frontend_layout'`;
  `frontendLayout` added to `SiteSettings`, `DEFAULT_SITE_SETTINGS`, and `parseSiteSettings`.
- `src/db/queries/site-settings.ts` — added `getSiteLayout()`, reading `frontendLayout` off the
  same memoized `getSiteSettings()` call used by `getSiteTheme()`/`getSiteFooter()`.
- `src/app/admin/settings/actions.ts` — `frontendLayout` parsed via `parseSiteLayout` and
  persisted through the existing `INSERT ... ON CONFLICT` transaction loop alongside every other
  setting; added to the `audit('settings.saved', …)` payload. No new `revalidatePath` call added
  — the existing unconditional `revalidatePath('/', 'layout')` already covers this key (§5).
- `src/app/admin/settings/SettingsForm.tsx` — new `AdminSection id="settings-layout"` ("Layout"),
  separate from "Appearance", radio-card list from `SITE_LAYOUTS`. Corrected the Appearance
  section's copy so it no longer claims to change "layout," now that layout is a distinct
  control.
- `src/app/layout.tsx` — `getSiteLayout()` fetched in the same `Promise.all` as
  `getSiteFooter()`/`getSiteTheme()`; `data-site-layout={siteLayout}` set on `<html>` alongside
  the existing `data-site-theme`; a `sidebarLayout` boolean branches only `PrimaryNav`
  placement — rendered in the header for `classic` (unchanged), rendered inside a new
  `.container.layout-shell` (`.layout-nav` / `.layout-main`) beside `main` for `sidebar`.
  `PrimaryNav`, `TabBar`, `ThemeToggle` and the footer are reused unmodified in both branches;
  `import '@/styles/layouts.css'` added alongside the existing `themes.css` import.
- `src/styles/layouts.css` (new) — `[data-site-layout='sidebar']` structural rules only
  (`.layout-shell` grid, `.layout-nav` sticky positioning, vertical `.site-nav` orientation
  inside the sidebar). Declares no theme-owned token (colour, radius, `--font-*`, `--measure`,
  `--gutter`). Collapses to a single column with the nav hidden at the same 640px breakpoint
  `globals.css` already uses to switch to the `TabBar` — both presets converge on the existing
  mobile `TabBar` with no new mobile-only code.
- `tests/site-settings.test.ts` — extended the default-shape assertion with
  `frontendLayout: DEFAULT_SITE_LAYOUT`; added independent read-path assertions
  (`frontendLayout`/`frontendTheme` set independently of each other) and a `parseSiteLayout`
  fallback suite (valid values pass through; `undefined`/`null`/`''`/unrecognised string/non-string
  all fall back to `'classic'`).
- `tests/admin-settings-actions.test.ts` — added: a valid `frontendLayout` submission persists and
  the single-`revalidatePath` assertion still holds; an invalid submitted `frontendLayout` falls
  back to `'classic'` rather than being stored as submitted; `frontendTheme` and `frontendLayout`
  are written independently in the same save.
- No `src/db/migrations/` file added or changed — `frontendLayout` is a new key in the existing
  generic `site_settings` table (migration 034), exactly as planned in §11.

**Validation completed (operator-run):**
- `npm test -- tests/site-settings.test.ts tests/admin-settings-actions.test.ts` — 2 test files,
  41/41 tests passed.
- `npm run typecheck` — Next.js route types generated successfully; TypeScript completed with no
  errors.

**Validation outstanding:**
- Manual DEV rendered-acceptance pass (§10): switching the setting and navigating statically
  generated and dynamic routes to confirm no stale/mixed layout is served.
- Browser/visual verification of the `sidebar` preset (composition, focus order, responsive
  collapse at the 640px breakpoint) — not performed this session.
- Vercel Web Interface Guidelines quality-gate review — not performed this session.

This checkpoint is implementation-plus-focused-test validation only. The issue stays open per
§10's own acceptance step and the planned quality-gate review; nothing in this runbook designates
unit-test-and-typecheck-green as sufficient for resolution.

---

## 1. What already exists (investigation findings)

AFLDB already has a Super Admin-controlled **frontend theme**, and it is easy to mistake for a
layout system because its labels and its admin copy both say "layout":

- `SETTING_KEYS.frontendTheme` = `'site.frontend_theme'`, stored as one row in the generic
  `site_settings` jsonb table (migration 034, no dedicated schema).
- Type `SiteTheme = 'classic' | 'modern' | 'editorial' | 'data-dense' | 'minimal'`
  (`src/lib/site-settings.ts:556-572`), parsed by `parseSiteTheme` with silent fallback to
  `'classic'` on anything unrecognised.
- Resolved server-side in `src/app/layout.tsx:92,97` via `getSiteTheme()`
  (`src/db/queries/site-settings.ts:74-80`) and written straight onto
  `<html data-site-theme={siteTheme}>`. No client script, no FOUC risk — it is a normal SSR
  value, not a client-persisted preference.
- **`src/styles/themes.css` (180 lines) is CSS custom properties only**: `--radius`, `--gutter`,
  `--measure` (container max-width), the colour ramp, and font-family swaps, per
  `[data-site-theme='…']`, plus light/dark variants of the same tokens. Two trivial exceptions
  (`.panel` box-shadow under `modern`, `.split` under `minimal`) are still pure decoration, not
  structure. **No theme changes DOM structure, container composition, or navigation placement.**
- The admin picker (`src/app/admin/settings/SettingsForm.tsx:84-107`, "Appearance" section) says
  *"This changes the design and layout of public pages"* — that claim overstates what the
  setting actually does today. Recommend correcting this copy alongside the new setting so two
  now-clearly-distinct controls are not both described as "layout" (§9).

Separately, `data-theme` (`light`/`dark`, from `THEME_INIT_SCRIPT` /
`src/lib/theme.ts`) is a **reader-local** light/dark preference stored in `localStorage`, applied
by a blocking pre-paint script. This is a third, unrelated axis and is out of scope here.

**The cache-consistency lesson is already fixed generically.** AFLDB-ISSUE-077 (RESOLVED
2026-08-26) was exactly "a global setting must not render differently as a user navigates between
statically generated/cached pages." The fix was `revalidatePath('/', 'layout')`, called once,
unconditionally, at the end of `saveSiteSettings` (`src/app/admin/settings/actions.ts:134`) —
it invalidates the *entire* root-layout cache boundary, not a list of known paths. Because it is
unconditional and already covers every field the action writes, **a new setting added to the
same transaction/action needs no new cache-invalidation work**, and the existing regression test
(`tests/admin-settings-actions.test.ts`, asserting `revalidatePath` is called exactly once with
`('/', 'layout')`) continues to hold without modification. This is the load-bearing precedent for
§5 below.

`/admin/*` is **not** a separate root: `src/app/admin/layout.tsx` nests inside the same
`src/app/layout.tsx`, so the shared header/`PrimaryNav`/`TabBar`/footer chrome already wraps
admin pages too (there's a `.container:has(> .admin-shell)` CSS escape hatch for width only).
Interestingly, `.admin-shell` (`src/styles/globals.css:1378-1384`) is already a proven
sidebar-plus-content CSS grid (`grid-template-columns: minmax(0, 15rem) minmax(0, 1fr)`, with a
collapsed/mobile-disclosure variant) — i.e. the exact structural pattern a "sidebar" public
layout preset would need already exists and is battle-tested in this codebase.

---

## 2. Proposed setting

| | |
|---|---|
| Setting key | `SETTING_KEYS.frontendLayout = 'site.frontend_layout'` (new key in the existing `site_settings` table — **no migration required**, same as `frontendTheme`) |
| TS field | `frontendLayout` on `SiteSettings` |
| Type | `SiteLayout = 'classic' \| 'sidebar'` |
| Default | `'classic'` (today's structure, byte-for-byte) |
| Fallback | Any missing/unrecognised/malformed stored value parses to `'classic'` — mirrors `parseSiteTheme`/`parseGridAudience`'s existing "a settings row that fails to parse must not be the thing that changes public rendering" convention. Never falls back to the alternative preset. |

Kept as an independent key from `frontendTheme`, so any theme × layout combination is valid and
neither read path depends on the other. `SITE_THEMES`' 5-preset catalogue shape
(`{ value, label, help }[]`) is reused verbatim for `SITE_LAYOUTS` for consistency with the rest
of `site-settings.ts`.

Two presets at launch, not more — matches "named, code-defined presets," not a page-builder:

- **`classic`** — today's frontend, unchanged: top masthead + horizontal `PrimaryNav`, single
  full-width `.container`, existing card grids/`.split` panels, `.table-wrap` tables, full-width
  footer colophon.
- **`sidebar`** — a genuinely different navigation paradigm: `PrimaryNav`'s items render as a
  persistent left-hand vertical nav (reusing the same nav *model*, `site-nav-model.ts`, and the
  same `.admin-shell`-style CSS grid pattern already proven in this codebase) beside a narrower
  content column. Collapses to the **existing, already-accessible** `TabBar` bottom-nav +
  "More" sheet below the tablet breakpoint — i.e. mobile presentation does not need new code in
  Phase 1 (§8).

```
classic (existing)                    sidebar (new)
+----------------------------+        +--------+-------------------------+
| logo   PrimaryNav   toggle |        | logo   |                         |
+----------------------------+        | ------ |    content column       |
|         container          |        | nav    |    (.card / .split /    |
|   (cards / split / tables) |        | items  |     .table-wrap, same   |
|                             |        | (vert) |     components as      |
+----------------------------+        |        |     classic)            |
|       footer colophon      |        +--------+-------------------------+
+----------------------------+        |       footer colophon            |
                                       +-----------------------------------+
mobile: TabBar (unchanged)             mobile: same TabBar (unchanged)
```

---

## 3. Where layout is resolved, and how it reaches components/CSS

**Resolution point:** `src/app/layout.tsx`, identical mechanism to `getSiteTheme()` — add
`getSiteLayout()` to `src/db/queries/site-settings.ts` (same `cache()`-memoized
`getSiteSettings()` read, same swallow-and-default-on-`42P01` behaviour as `getSiteFooter`/
`getSiteTheme`), fetched in the same `Promise.all` as `footer`/`siteTheme`. No client script, no
localStorage — it's a global admin setting, not a per-visitor preference, so there's no FOUC
class of bug to guard against the way `THEME_INIT_SCRIPT` has to for light/dark.

**Exposure is a deliberate hybrid**, because one of the differences (nav placement) is structural
and cannot be pure CSS, while everything else is:

1. **`data-site-layout={layout}` on `<html>`**, parallel to the existing `data-site-theme` —
   drives every CSS-only variation (spacing rhythm, content column width, card density) via a
   *new, separate* stylesheet `src/styles/layouts.css`, mirroring `themes.css`'s structure. This
   file must not redeclare tokens `themes.css` already owns (`--measure`, `--gutter`, colour
   ramp) — see the ownership split in §4.
2. **A small server-rendered composition change in `src/app/layout.tsx` itself** for the one
   thing CSS attributes cannot do: where `<PrimaryNav />` sits in the DOM relative to `<main>`.
   `RootLayout` already builds the header/nav/footer chrome inline; branch that composition on
   the resolved `siteLayout` value. `PrimaryNav`, `TabBar`, `ThemeToggle` and the footer-render
   logic are reused completely unmodified — only their *arrangement* differs. (For 2 presets,
   prefer a plain conditional in `layout.tsx` over extracting a `LayoutShell` component; extract
   only if/when a 3rd preset is added — smallest correct change over premature abstraction.)

This directly satisfies "root data attribute + layout wrapper + CSS classes" without introducing
a Context Provider: nothing below the root needs to branch in JS, because the nav/footer/card/
table components themselves are not preset-aware — they are laid out differently by their
*parent*, not rewritten.

---

## 4. Token ownership split (theme vs. layout) — avoiding the two systems fighting

| Concern | Owned by | Selector prefix |
|---|---|---|
| Colour ramp, radius, font-family, `--measure`/`--gutter` (today's meaning: max content width / edge padding for a single-column page) | **Theme** (`themes.css`, unchanged) | `[data-site-theme='…']` |
| Nav placement/composition (top bar vs. sidebar) | **Layout** (root layout JSX) | n/a — structural, not CSS |
| Sidebar width, content-column width when a sidebar is present, structural spacing between the nav and content grid | **Layout** (`layouts.css`, new) | `[data-site-layout='sidebar']`, scoped to new classes (`.layout-nav`, `.layout-main`) that `themes.css` never touches |

`layouts.css` must not redefine `--measure`/`--gutter` — those stay theme-owned so a super admin
picking, say, `editorial` (narrow `--measure`, serif) still gets that narrower column *inside*
whichever layout's content area, rather than the two settings silently overriding each other
depending on CSS load order.

---

## 5. Cache/revalidation

No new work. `saveSiteSettings` already writes every setting in one `authSql.begin` transaction
and calls `revalidatePath('/', 'layout')` exactly once afterwards, unconditionally
(`src/app/admin/settings/actions.ts:93-134`), which is the ISSUE-077 fix and already invalidates
the whole root-layout cache boundary regardless of which keys changed. Adding
`SETTING_KEYS.frontendLayout` to the same `for (const [key, value] of [...])` loop is suficient;
the existing `tests/admin-settings-actions.test.ts` assertion (revalidatePath called once with
`('/', 'layout')`) continues to hold unmodified and remains the regression guard against a
repeat of ISSUE-077 for this setting too.

---

## 6. What legitimately varies vs. what stays shared

**Varies between presets:**
- Overall page/container composition (single column vs. nav-beside-content grid)
- Navigation presentation (horizontal top bar vs. persistent vertical sidebar)
- Structural spacing tokens that only apply when a sidebar is present
- Content-column width (narrower automatically, because it sits beside the sidebar — the
  existing `auto-fill minmax(...)` card grids and responsive tables reflow on their own; no
  bespoke per-component code needed)

**Stays 100% shared (unmodified):**
- `site-nav-model.ts` (the nav *data* — routes, labels, AFLW variants) — identical for both
  presets, just rendered in a different container
- `PrimaryNav`/`TabBar`/`ThemeToggle` component internals, including all existing focus-trap/
  keyboard/ARIA behaviour in `TabBar`'s "More" sheet
- `.card`, `.split`, `.table-wrap` (including its themed directional scroll-shadow) — every
  low-level presentation primitive, and every route/page component under `src/app/**`. None of
  them become preset-aware; they don't need to.
- All query/route/permission/feature code — nothing in `src/db/queries`, `src/search`, or
  capability checks is touched. This is enforced by construction: the plan only touches
  `src/lib/site-settings.ts`, `src/db/queries/site-settings.ts`, `src/app/admin/settings/*`,
  `src/app/layout.tsx`, and one new CSS file.

---

## 7. Super Admin selector UX

New `AdminSection id="settings-layout"` in `SettingsForm.tsx`, **separate from** (not merged
into) the existing "Appearance" section — the brief requires the two settings to be visibly
independent, and merging them would re-create the exact "layout" ambiguity in the admin UI that
prompted this issue. Same radio-card pattern as `SITE_THEMES` (`SITE_LAYOUTS.map(...)`, one
`<label>` per option with a bold name + one-line plain-language `help` string, e.g. *"Sidebar — a
persistent left-hand navigation with a wider content area for browsing stats."*). Also correct
the Appearance section's existing copy so it no longer claims to change "layout" now that layout
is a distinct control.

---

## 8. Responsive/mobile behaviour

Both presets converge to the **same, already-accessible** `TabBar` bottom nav + "More" sheet
below the tablet breakpoint (this is existing, tested behaviour —
`tests/e2e/responsive-nav` already asserts every nav entry is reachable at mobile width). The
`sidebar` preset's vertical nav is a desktop/tablet-only structural difference; at mobile width
it simply isn't rendered, same as `.admin-shell`'s own collapse behaviour at `1565-1572` in
`globals.css` already demonstrates for the analogous admin grid. This is a deliberate scope
control: **no new mobile navigation pattern is designed or built in Phase 1.**

---

## 9. Accessibility

- Sidebar nav remains a `<nav aria-label="Primary">` landmark, unchanged from today — only its
  CSS position/parent changes.
- Skip-link target (`#main`) is unaffected by either preset.
- Existing global `:focus-visible` styling and the `TabBar` sheet's focus trap need no changes,
  since neither preset introduces a new interactive disclosure at desktop width.
- Verify (during Phase 1 implementation, not this design pass) that focus order in the `sidebar`
  preset still reads nav-before-content, matching visual order left-to-right.

---

## 10. Testing strategy

Extend, do not create new suites — matches the existing precedent for `frontendTheme` exactly:

- `tests/site-settings.test.ts` — extend the default-shape assertion
  (`frontendLayout: DEFAULT_SITE_LAYOUT`, already the pattern used for `frontendTheme` at line
  199) and add a focused `parseSiteLayout` fallback test (unknown/malformed value → `'classic'`).
- `tests/admin-settings-actions.test.ts` — the existing single-revalidation assertion already
  generically covers any new field; add a targeted round-trip assertion for `frontendLayout`
  (submitted `'sidebar'` is persisted; an invalid submitted value falls back to `'classic'`),
  mirroring however `frontendTheme` is asserted there today.
- No new E2E/Playwright suite for the caching guarantee itself — ISSUE-077's root cause was the
  cache invalidation call, already covered by the unit assertion above, not a rendering bug
  requiring browser coverage.
- Manual DEV rendered-acceptance step (same as recent issues in this repo, e.g. 171/172): after
  deployment, switch the layout setting and navigate across several statically generated and
  dynamic routes to confirm no stale/mixed layout is served — this is acceptance, not a new
  automated test file.

---

## 11. Migration requirements

**None.** `site_settings` (migration 034) is a generic `(key text primary key, value jsonb,
updated_by, updated_at)` table; `frontendTheme` itself needed no dedicated migration beyond 034,
and `frontendLayout` is exactly the same shape of addition (new `SETTING_KEYS` entry + new
`SiteSettings` field + one more tuple in `saveSiteSettings`'s existing `INSERT ... ON CONFLICT`
loop).

---

## 12. Affected files (Phase 1 — see §13 for scope)

- `src/lib/site-settings.ts` — add `SiteLayout`, `SITE_LAYOUTS`, `DEFAULT_SITE_LAYOUT`,
  `parseSiteLayout`, `SETTING_KEYS.frontendLayout`, extend `SiteSettings`/
  `DEFAULT_SITE_SETTINGS`/`parseSiteSettings`.
- `src/db/queries/site-settings.ts` — add `getSiteLayout()` mirroring `getSiteTheme()`.
- `src/app/admin/settings/actions.ts` — parse + persist the new field in the existing
  transaction loop; extend the `audit('settings.saved', …)` payload.
- `src/app/admin/settings/SettingsForm.tsx` — new "Layout" `AdminSection`; corrected Appearance
  copy.
- `src/app/layout.tsx` — fetch `getSiteLayout()`; set `data-site-layout`; branch the header/nav
  composition for the `sidebar` preset.
- `src/styles/layouts.css` (new) — `[data-site-layout='sidebar']` structural rules only; no
  token redeclaration (§4).
- `tests/site-settings.test.ts`, `tests/admin-settings-actions.test.ts` — extended, not
  replaced.

---

## 13. Recommended first implementation increment

Everything in §12/Phase 1 above, and nothing more:
- The `classic`/`sidebar` two-preset setting, fully wired end to end (admin UI → persistence →
  root-layout resolution → CSS/structural rendering → cache invalidation → tests).
- The Appearance section copy correction.

**Deliberately deferred, not part of this increment:**
- Any additional presets beyond `classic`/`sidebar` — adding more is now a small, low-risk,
  purely additive change to `SITE_LAYOUTS`/`layouts.css` once the shell architecture is proven,
  but is not needed to satisfy this issue's brief ("at least one genuinely different
  alternative").
- A distinct mobile-only structural layout — both presets share the existing `TabBar` at mobile
  width; a genuinely different *mobile* navigation paradigm is a separate future design
  decision, not required here.
- Per-page bespoke tuning inside the `sidebar` preset (e.g. a sidebar-aware density variant of
  specific stat-heavy tables, or reflowing the home page's `.split` panels differently) — the
  shared components already reflow acceptably via existing responsive CSS; hand-tuning individual
  pages is explicitly the kind of work ISSUE-172-style follow-ups own, not this architecture
  issue.
- Restructuring the footer for the `sidebar` preset — it stays full-width under everything in
  both presets for now.
- Any change to `/admin/*`'s own chrome — the admin shell keeps its existing structure
  regardless of the selected public layout; this setting is scoped to the public site as
  specified in the brief.

---

## 15. Vercel Web Interface Guidelines quality-gate review (2026-09-15)

Scope: `src/app/layout.tsx`, `src/app/admin/settings/SettingsForm.tsx`, `src/styles/layouts.css`,
`src/lib/site-settings.ts`, `src/db/queries/site-settings.ts`, `src/app/admin/settings/actions.ts`,
plus `PrimaryNav`/`TabBar` read only where needed to verify ISSUE-173 behaviour.

**Findings introduced by ISSUE-173:**

- **MUST FIX** — the `sidebar` preset defeated the existing "Skip to content" link. `PrimaryNav`
  was rendered inside `<main id="main">`, before `{children}`, so activating the skip link (which
  targets `#main`) landed a keyboard/AT user at the start of the primary nav again rather than at
  page content — the opposite of what a skip link is for. `classic` was unaffected (nav stayed in
  `<header>`, ahead of the skip target).
- **SHOULD FIX** — the persistent `PrimaryNav` landmark (`<nav aria-label="Primary">`) was nested
  inside the `<main>` landmark in the `sidebar` preset, where `classic` keeps it a sibling
  landmark under `<header>`.

One SHOULD FIX (missing `<fieldset>`/`<legend>` on the new Layout radio group) and one OPTIONAL
(sidebar nav touch-target height) were also noted but classified PRE-EXISTING / low-impact and
explicitly left out of this issue's remediation scope (see §16.1).

## 16. Remediation (2026-09-15)

**16.1 — Scope.** Fixed only the MUST FIX and SHOULD FIX findings introduced by ISSUE-173
(treated as one structural defect). Did not touch the pre-existing radio-group fieldset/legend
gap (identical pattern already exists on the Appearance and Grid Solver sections) or the
touch-target OPTIONAL note.

**16.2 — Fix.** `src/app/layout.tsx`: restructured the `sidebar` branch so `<main id="main">`
wraps only `{children}`, and `PrimaryNav` (`.layout-nav`) is a sibling of `<main>` inside a plain,
non-landmark wrapper div (`.container.layout-shell`), rather than `<main>` wrapping both. `classic`
is byte-for-byte unchanged. `src/styles/layouts.css`: reproduced the vertical rhythm
`globals.css`'s bare `main { min-height: 72vh; padding: … }` rule used to give the whole shell
(now that only `.layout-main` is a `<main>`) — added `min-height`/`padding-block` to
`.container.layout-shell` (desktop and the existing 640px breakpoint), and zeroed the inherited
rule on `.layout-main` itself so it isn't applied twice. `padding-inline` (the gutter) was left
untouched throughout. No other selectors, breakpoints, navigation model, `TabBar`, routes,
settings persistence, or theme behaviour changed.

**16.3 — Re-audit (2026-09-15), same scope.** Previous MUST FIX (skip link): **RESOLVED** —
`#main` now contains only page content in both presets; skip link bypasses `PrimaryNav`
identically in `classic` and `sidebar`. Previous SHOULD FIX (nav nested in main): **RESOLVED** —
`.layout-nav` and `<main id="main">` are siblings under a non-landmark wrapper; no landmark
nesting in either preset. No new MUST FIX / SHOULD FIX / OPTIONAL findings from the remediation
itself (checked: landmark structure, skip-link target/focus order, duplicate navigation,
hidden-but-focusable content, responsive/mobile behaviour, spacing side effects of the new
shell/`main` relationship).

## 17. Manual DEV rendered acceptance (Playwright, 2026-09-15)

Authenticated as the existing Super Admin account through the real `/admin/login` form (no auth
path bypassed). Routes: `/`, `/players`, `/clubs`, `/coaches`, `/admin/settings`. Viewports:
1440×900 (desktop) and 375×800 (mobile, ≤640px). `/players` (13,273-row sortable/paginated table)
used as the table-heavy route.

- **Super Admin Layout section:** PASS — separate from Appearance; `classic`/`sidebar` both
  render correctly; selected value persists after save + reload; changing layout never alters the
  saved theme (`frontendTheme` held at `editorial` throughout every layout change tested).
- **Classic preset (desktop):** PASS — single `nav[aria-label="Primary"]`, always in `<header>`,
  never inside `#main`; no sidebar shell rendered; no horizontal overflow; `/players` table fully
  usable; structure stable across client-side navigation.
- **Sidebar preset (desktop):** PASS — `PrimaryNav` renders once in the left column; accessibility
  tree confirms `navigation "Primary"` and `main` as direct siblings (not nested); `#main` never
  contains `PrimaryNav` on any route tested; no duplicate nav; `/players` table fully usable in the
  wider content column; no horizontal overflow; no spacing irregularity between nav and content
  columns; structure stable across client-side navigation and direct reloads.
- **Mobile (375px), both presets:** PASS — desktop nav (`.site-nav`/`.layout-nav`) computed
  `display: none` and (`sidebar`) not focusable (`offsetParent === null`) while hidden; existing
  `TabBar` visible and is the only navigation; no duplicate nav; no horizontal overflow; classic
  and sidebar mobile renders are visually identical, confirming true convergence.
- **Skip-link/keyboard:** PASS on the ISSUE-173-scoped requirement (skip link bypasses
  `PrimaryNav`, lands at page content, identically in both presets). Separately noted,
  pre-existing and out of scope: `<main id="main">` carries no `tabindex`, so DOM focus falls back
  to `<body>` after activating the skip link — identical in `classic` and predates this issue; not
  absorbed into ISSUE-173.
- **Runtime health:** zero console errors/warnings, no page errors, no relevant failed network
  requests (all page-load requests returned 200), no hydration-mismatch messages, no obvious
  CLS/FOUC across any capture.
- **No ISSUE-173 defects found.** Rendered acceptance: **PASS**.

DEV's live `frontendLayout` setting was returned to `classic` through the normal Super Admin
settings UI after this pass (save + reload confirmed `classic` persisted and `frontendTheme`
remained `editorial`, unaffected).

## Resolution (2026-09-15)

**Root cause (of the two guidelines findings):** the `sidebar` preset's initial implementation
placed `PrimaryNav` inside `<main id="main">` (§14) to keep it visually beside the content column
using a single wrapping element; this incidentally made the skip link's target contain the nav it
was meant to bypass, and nested a persistent landmark inside `main`.

**Fix:** §16 — `PrimaryNav` and `<main id="main">` are siblings under a non-landmark grid wrapper
in the `sidebar` preset; `classic` unchanged.

**Validation:**
- `npm test -- tests/site-settings.test.ts tests/admin-settings-actions.test.ts` — 2 files,
  41/41 passed (operator-run).
- `npm run typecheck` — Next.js route types generated successfully, TypeScript clean
  (operator-run).
- Vercel Web Interface Guidelines: initial review found one ISSUE-173 MUST FIX (skip link) and
  one SHOULD FIX (nav nested in main); both RESOLVED by remediation and confirmed by a narrow
  re-audit with no new findings (§15-§16).
- Manual DEV rendered acceptance via Playwright: PASS across Super Admin settings, `classic` and
  `sidebar` desktop, mobile convergence, skip-link/keyboard, and runtime health, with zero
  ISSUE-173 defects found (§17).

**Follow-up explicitly outside this issue, not blocking resolution:**
- Missing `<fieldset>`/`<legend>` grouping on radio-button settings sections (Appearance, Layout,
  Grid Solver) — pre-existing pattern, not introduced by ISSUE-173.
- Sidebar nav touch-target height (~30-34px, clears the WCAG 24px minimum but below the 44px
  recommendation) — OPTIONAL, low impact, not required for this issue.
- `<main id="main">` has no `tabindex`, so the site-wide skip link does not move DOM focus on
  activation (identical in `classic`, predates ISSUE-173).
- Any additional layout presets beyond `classic`/`sidebar`, a distinct mobile-only layout
  paradigm, and per-page bespoke tuning inside `sidebar` remain explicitly deferred (§13).
