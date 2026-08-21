---
name: afldb-frontend-theme-review
description: Review AFLDB's existing frontend layout and styling, design several alternative themes/templates, and implement a safe Super Admin-controlled theme selector without changing application behaviour, data, search logic, or core functionality.
---

# AFLDB Frontend Theme Review & Theme System

## Purpose

Review the current AFLDB frontend layout, visual design, component styling, navigation, page structure, responsive behaviour, and overall presentation.

The objective is NOT to redesign AFLDB blindly.

The objective is to:

1. Understand the existing frontend and design system.
2. Identify what is currently working well and what could be improved.
3. Preserve the current design as one available theme/template.
4. Create several additional frontend themes/templates.
5. Allow a **Super Admin** to select which theme/template is active.
6. Make theme switching safe and reversible.
7. Keep all application functionality identical regardless of theme.

This work is primarily presentation-layer work.

Do not change AFL statistics, database behaviour, natural-language search semantics, authentication behaviour, API behaviour, or application business logic unless something is strictly necessary to support theme selection.

---

# Repository Rules

Work only inside the current local AFLDB repository.

Do not:

- clone another repository
- create another working copy
- switch branches
- create branches
- commit
- push
- merge
- rebase
- reset
- stash
- amend Git history

Do not touch Git until the user has reviewed the changes.

Do not alter unrelated files simply because they could be cleaned up.

Keep the change set focused on:

- frontend layout
- visual styling
- reusable presentation components
- theme/template configuration
- Super Admin theme management

---

# Existing Functionality Is the Contract

The current application behaviour is authoritative.

Themes must not change what AFLDB does.

The following must continue to work exactly as before:

- Natural-language search
- Search result links
- Player pages
- Club pages
- Match pages
- Season pages
- Venue pages
- Records
- Statistics
- Navigation
- Authentication
- Beta/access controls
- Admin functions
- Super Admin functions
- SEO metadata
- sitemap behaviour
- static generation
- server rendering
- responsive navigation
- forms
- tables
- charts
- pagination
- filters
- links

A theme may change presentation.

A theme must not change meaning or functionality.

---

# Phase 1 — Inspect the Existing Frontend

Before modifying anything, inspect the repository.

Identify:

- Next.js application structure
- app router layout hierarchy
- root layout
- nested layouts
- global CSS
- Tailwind configuration if used
- CSS modules
- component libraries
- typography
- colour definitions
- spacing system
- border styles
- cards
- page containers
- headers
- navigation
- mobile navigation
- footers
- tables
- buttons
- forms
- badges
- alerts
- search UI
- result cards
- record displays
- admin layout
- responsive breakpoints
- dark/light handling if present

Search for duplicated styling and hard-coded values.

In particular, look for things such as:

```text
bg-*
text-*
border-*
rounded-*
shadow-*
max-w-*
px-*
py-*
font-*
```

Determine whether the current styling can be centralised without unnecessarily rewriting the application.

---

# Phase 2 — Review the Current Design

Review the current public frontend from the perspective of:

- desktop
- tablet
- mobile

Inspect representative pages rather than judging only the homepage.

At minimum review:

- `/`
- `/search`
- a player page
- a club page
- a match page
- a season page
- a venue page
- records/statistics pages where available

Also review the public navigation and footer.

Admin pages should be inspected separately.

The public frontend theme system must not accidentally make the admin interface difficult to use.

---

# Current Theme Must Be Preserved

The existing AFLDB frontend design must become an explicit theme.

For example:

```text
current
```

or:

```text
classic
```

Do not destroy the existing design while building alternatives.

The user must always be able to return to the current AFLDB appearance.

---

# Phase 3 — Produce a Design Review

Before performing a major visual rewrite, document the current design.

Report:

## Current strengths

Examples:

- information density
- readability
- clear statistics hierarchy
- navigation
- AFL-focused presentation
- responsive behaviour
- consistency

## Current weaknesses

Examples:

- excessive whitespace
- overly dense sections
- inconsistent cards
- typography hierarchy
- navigation presentation
- mobile spacing
- table readability
- page width
- inconsistent border radius
- excessive visual chrome
- lack of visual hierarchy

Only report issues actually observed.

Do not manufacture design problems to justify changes.

---

# Phase 4 — Define Several Theme / Template Options

Create several genuinely different visual options.

Do not create four themes that differ only by colour.

The themes should explore differences in:

- page width
- navigation treatment
- cards
- borders
- typography
- information density
- spacing
- section hierarchy
- statistics presentation
- backgrounds
- tables
- hero/header treatment
- content containers

A useful initial set would be:

## Theme 1 — AFLDB Classic

The current AFLDB appearance.

Purpose:

- preserve existing frontend
- provide instant rollback
- establish visual baseline

---

## Theme 2 — Modern Sports Database

A polished modern statistics site.

Characteristics could include:

- cleaner page hierarchy
- slightly wider content area
- stronger typography
- compact statistic cards
- restrained shadows
- clear section separation
- modern data-table styling
- strong search presentation

Think:

```text
professional sports statistics database
```

rather than a marketing website.

---

## Theme 3 — Editorial / Historical

Designed around AFLDB's historical data.

Characteristics could include:

- strong headings
- editorial typography
- restrained colours
- fewer card containers
- more traditional section structure
- excellent long-form readability
- strong presentation of historical records and seasons

The site should still feel modern.

Do not make it look artificially old.

---

## Theme 4 — Data Dense

Designed for users primarily interested in statistics.

Characteristics could include:

- reduced padding
- wide tables
- compact navigation
- more information above the fold
- less decorative UI
- efficient record/result presentation
- strong numeric alignment
- desktop-friendly layouts

Mobile usability must still be retained.

---

## Optional Theme 5 — Clean Minimal

A highly restrained version.

Characteristics could include:

- minimal borders
- limited card usage
- generous but controlled whitespace
- clear type hierarchy
- neutral surface treatment
- emphasis on content rather than interface chrome

---

# Theme Names

Theme names should be human-readable in the admin UI.

Internally they should use stable keys.

For example:

```ts
type SiteTheme =
  | "classic"
  | "modern"
  | "editorial"
  | "data-dense"
  | "minimal";
```

Do not base application logic on the display names.

---

# Theme Architecture

Do not implement theme switching by duplicating the entire site.

Avoid structures such as:

```text
themes/classic/player-page.tsx
themes/modern/player-page.tsx
themes/editorial/player-page.tsx
```

unless there is an extremely strong reason.

Prefer one application structure with theme-controlled presentation.

For example:

```text
app
components
styles
themes
```

with something similar to:

```text
themes/
  classic.ts
  modern.ts
  editorial.ts
  data-dense.ts
  minimal.ts
```

or a CSS-variable/token-based system.

---

# Design Tokens

Prefer centralised semantic design tokens.

Examples:

```css
--site-background
--surface
--surface-secondary
--text-primary
--text-secondary
--border
--accent
--accent-foreground

--radius-card
--radius-button

--page-max-width
--content-gap
--section-gap

--card-padding
--table-density

--heading-weight
```

Prefer semantic tokens over component-specific colour hacks.

Bad:

```css
--player-page-blue-box-border
```

Better:

```css
--border-emphasis
```

---

# Layout Themes vs Colour Themes

The user's requirement is broader than changing colours.

The selected template should be able to affect layout characteristics such as:

- content width
- navigation layout
- card density
- card radius
- section spacing
- table density
- typography scale
- page heading treatment
- statistics layout

However, avoid making every page maintain separate markup for every theme.

Prefer controlled variations through:

- CSS variables
- data attributes
- reusable layout primitives
- component variants

For example:

```html
<html data-site-theme="data-dense">
```

or:

```html
<body data-theme="modern">
```

---

# Site-Wide Theme Resolution

There must be one authoritative way to determine the active public theme.

Do not scatter logic such as:

```ts
if (theme === ...)
```

through dozens of pages.

Create a central theme resolver.

Conceptually:

```text
stored site setting
        ↓
theme resolver
        ↓
root/public layout
        ↓
theme identifier
        ↓
CSS/design tokens
        ↓
components
```

---

# Super Admin Control

The active public theme must be configurable by a **Super Admin**.

Review the current admin/settings implementation before adding anything.

If an existing application settings mechanism already exists, reuse it.

Do not create a second settings architecture unnecessarily.

A suitable admin control might appear under:

```text
Admin
  → Settings
    → Appearance
```

or an equivalent location consistent with the current application.

---

# Theme Selector

The Super Admin interface should show something similar to:

```text
Frontend Theme

○ AFLDB Classic
○ Modern Sports Database
○ Editorial / Historical
○ Data Dense
○ Clean Minimal

[Save]
```

The control should include a short description of each theme.

If practical, include a small preview or visual sample.

Do not over-engineer theme previews if they materially complicate the implementation.

---

# Permissions

Only authorised Super Admin users should be able to change the active site theme.

Do not rely solely on hiding the UI.

The server-side action/API that changes the theme must also enforce the existing Super Admin authorisation rules.

Reuse the application's existing permission model.

Do not invent a parallel authentication system.

---

# Persistence

The selected theme must survive:

- page refreshes
- server restarts
- deployments
- user sessions

Do not store the global active site theme only in:

- localStorage
- browser cookies
- React state
- process memory

This is a **site-level configuration**, not an individual visitor preference.

Prefer the application's existing persistent site-settings mechanism.

If no appropriate persistent settings mechanism exists, document this before creating a new one.

---

# Safe Fallback

The application must have a safe fallback.

For example:

```ts
const DEFAULT_SITE_THEME = "classic";
```

If:

- the setting is missing
- the database is unavailable during resolution
- an unknown theme key is stored
- an old theme has been removed

the public frontend should fall back to the current/classic theme.

It must not crash the site.

---

# Theme Registry

Prefer a central registry.

For example:

```ts
export const SITE_THEMES = {
  classic: {
    label: "AFLDB Classic",
    description: "The original AFLDB layout and styling.",
  },

  modern: {
    label: "Modern Sports Database",
    description: "Modern statistics-focused presentation.",
  },

  editorial: {
    label: "Editorial / Historical",
    description: "A historical and editorial presentation.",
  },

  "data-dense": {
    label: "Data Dense",
    description: "Compact presentation for statistics-heavy users.",
  },

  minimal: {
    label: "Clean Minimal",
    description: "A restrained content-first presentation.",
  },
} as const;
```

The exact implementation should follow the repository's existing conventions.

---

# Shared Components

Identify high-value presentation primitives.

Examples:

```text
PageContainer
PageHeader
Section
StatCard
RecordCard
DataTable
SearchResult
Panel
Badge
Button
Tabs
EmptyState
```

Do not create wrappers simply for architectural purity.

Extract shared components where they genuinely make theme behaviour easier and reduce duplication.

---

# Do Not Fork Business Components

Avoid:

```text
ModernPlayerPage
ClassicPlayerPage
EditorialPlayerPage
```

Prefer:

```text
PlayerPage
```

using shared themed presentation primitives.

The data-fetching and football logic should remain identical.

---

# Admin Interface Styling

The public theme does not necessarily need to restyle the admin interface.

Prefer keeping administration visually stable unless the existing architecture already makes theme sharing safe.

The Super Admin must always have a reliable interface for changing back to another theme.

A broken public theme should not trap the administrator inside the same broken layout.

---

# Accessibility

Every theme must retain:

- readable contrast
- visible keyboard focus
- keyboard navigation
- semantic headings
- meaningful link states
- appropriate button states
- accessible tables
- readable font sizes
- sensible mobile tap targets

A visually attractive theme that harms accessibility is not acceptable.

---

# Responsive Testing

Every theme must be checked at representative sizes.

At minimum:

```text
Mobile
~375px

Tablet
~768px

Desktop
~1440px
```

Look specifically for:

- navigation overflow
- table overflow
- clipped statistics
- long player names
- long club names
- record titles
- search results
- button wrapping
- awkward card grids
- horizontal scrolling
- excessive whitespace

---

# Real AFLDB Data

Test using real content.

Do not evaluate themes using only idealised placeholder data.

Use pages containing:

- short player names
- long player names
- historical clubs
- modern clubs
- high scores
- low scores
- large tables
- long record descriptions
- multiple search results
- unusual historical data

A sports database frontend must survive real sports data.

---

# Browser Testing

Use the development server and available browser automation such as Playwright where appropriate.

Inspect actual rendered pages.

Do not assume a CSS change looks correct because the code appears correct.

Where possible, take screenshots of representative pages under each theme for comparison.

---

# Theme Switching Tests

Verify:

1. Classic is active.
2. Super Admin selects Modern.
3. Save succeeds.
4. Public page immediately uses Modern.
5. Refresh retains Modern.
6. Open another public page.
7. Modern remains active.
8. Restart/reload application if practical.
9. Modern remains active.
10. Switch to Data Dense.
11. Verify change.
12. Switch back to Classic.
13. Confirm the original appearance is restored.

---

# Invalid Theme Test

Also test an invalid theme value.

The site should:

```text
invalid setting
     ↓
fallback
     ↓
classic theme
```

It must not produce a 500 error.

---

# Build Verification

Before declaring the task complete, run the repository's normal validation commands.

Inspect `package.json` first and use the existing scripts.

Typical checks may include:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Do not invent commands if equivalent repository scripts already exist.

The production build must succeed.

---

# Performance

Theme support must not significantly increase client-side JavaScript.

Prefer server-resolved theme configuration and CSS.

Avoid shipping five full independent frontend implementations to every visitor.

Theme switching by the Super Admin is rare.

Normal visitors should receive the active theme efficiently.

---

# SEO / Rendering

Ensure theme support does not break:

- server rendering
- static generation
- metadata
- sitemap
- canonical URLs
- structured data
- caching
- ISR
- public page indexing

Themes are presentation choices and should not produce duplicate public URLs.

Do NOT create:

```text
/modern/players/...
/classic/players/...
```

The public URL remains unchanged.

---

# Scope Protection

Do not make opportunistic changes to:

- natural-language parser
- database queries
- AFL data
- records calculations
- import scripts
- scraping
- APIs unrelated to appearance
- authentication
- unrelated admin functionality

If an unrelated defect is discovered, record it separately instead of expanding this task.

---

# Required Deliverables

At the end provide:

## 1. Current Design Review

Summarise:

- current frontend structure
- styling architecture
- strengths
- weaknesses
- areas suitable for centralisation

## 2. Theme Architecture

Explain:

- where theme definitions live
- how the active theme is resolved
- how the root layout receives it
- how components consume the theme
- how fallback works

## 3. Available Themes

Provide a table similar to:

| Theme | Purpose | Key differences |
|---|---|---|
| AFLDB Classic | Existing design | Current appearance preserved |
| Modern | Contemporary sports DB | Cleaner cards and hierarchy |
| Editorial | Historical presentation | Typography/content focused |
| Data Dense | Power/statistics users | Compact, wide, information dense |
| Minimal | Clean presentation | Reduced visual chrome |

Use the themes actually implemented.

## 4. Super Admin Control

Document:

- settings page/location
- permission enforcement
- persistence mechanism
- save behaviour
- fallback behaviour

## 5. Files Changed

List every changed file and explain why.

Example:

```text
app/layout.tsx
- Applies the active public theme.

lib/site-theme.ts
- Theme registry and validation.

app/admin/settings/...
- Super Admin theme selector.

styles/themes.css
- Theme design tokens.
```

## 6. Testing Performed

Report:

- pages tested
- themes tested
- mobile/desktop testing
- persistence testing
- permission testing
- fallback testing
- lint/typecheck/tests
- production build result

## 7. Screenshots / Visual Comparison

Where tooling allows, provide representative screenshots or clearly identify where they were saved.

Use the same pages when comparing themes so differences are meaningful.

---

# Important Decision Rule

Do not immediately redesign every component.

First determine the smallest architectural change that allows AFLDB to support multiple coherent themes.

Prefer:

```text
shared functionality
        +
shared markup
        +
semantic presentation primitives
        +
theme tokens / variants
```

over:

```text
five separate frontends
```

The end result should make adding another theme later straightforward.

Ideally adding a future theme should involve something roughly equivalent to:

```text
1. Register theme
2. Add theme tokens/variants
3. Test
```

rather than copying the application.

---

# Definition of Done

This task is complete when:

- the existing AFLDB appearance remains available
- several genuinely different themes/templates exist
- themes alter more than just colours
- Super Admin can select the active theme
- selection persists globally
- public URLs do not change
- application functionality remains unchanged
- invalid settings safely fall back
- responsive layouts work
- accessibility remains acceptable
- lint/type checks pass
- tests pass
- production build succeeds
- no Git operations have been performed
- the user can review all changes locally before deciding whether to commit them
