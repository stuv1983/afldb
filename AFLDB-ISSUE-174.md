# AFLDB-ISSUE-174 — Coaches page family: design/layout review

**Status:** RESOLVED 2026-09-15. Implemented per §18 Phases 1-4 below, closed out per Phase 5
(§20). Uncommitted in worktree `D:\dev\afldb-issue-174`, branch `claude/issue-174-coaches-design`.
PROD untouched.
**Scope:** `/coaches`, `/coaches/[slug]`, `/coaches/compare`, and the shared coach-record
components they render through. `ClubCoachRecords` (on `/clubs/[slug]`) and `/records/coaches`
are reviewed only as neighbours/cross-links — not redesigned here.

---

## 1. Current-state inventory

Verified directly from the repository (not assumed).

### Routes

| Route | File | Rendering |
|---|---|---|
| `/coaches` | `src/app/coaches/page.tsx` | Static, `revalidate = 3600` |
| `/coaches/[slug]` | `src/app/coaches/[slug]/page.tsx` | `dynamic = 'force-dynamic'` (Stage 1D's `?opponent=` needs `searchParams`) |
| `/coaches/compare` | `src/app/coaches/compare/page.tsx` + `state.ts` | `dynamic = 'force-dynamic'`, state/URL split following `/clubs/compare` |

There is no separate "team-history" route. "History v team" is the `?opponent=` selector and
result block embedded in `/coaches/[slug]` (Stage 1C/1D), plus its client-fetched twin on
`/players/[slug]` (`CoachOpponentHistoryClient`, inside the collapsed "Coaching Career" panel).

### Shared components actually involved

- `CoachCareerRecord.tsx` — `CoachTotalsTable`, `CoachClubTable`, `CoachBiggestWinLossTable`,
  `CoachVenueHistoryTable`, `CoachCareerBody`, `CoachOpponentRecordBody`. The single shared
  renderer set used by **every** surface that shows a coach record (standalone page,
  player-linked panel, and both pages' opponent-scoped slice).
- `CoachOpponentSelector.tsx` — standalone-page opponent dropdown, GET-navigation via
  `router.push(..., { scroll: false })` (ISSUE-172 fix, preserved).
- `CoachOpponentHistoryClient.tsx` — player-page opponent dropdown, client-fetched (`/api/coaches/[id]/opponent-record`), because `/players/[slug]` is static ISR and cannot read `searchParams`.
- `CoachComparisonView.tsx`, `CoachComparisonControls.tsx`, `CoachComparisonCareer.tsx`,
  `CoachHeadToHead.tsx` — the compare-page presentation, all plain prop-to-JSX renderers.
- `PlayerCoachingCareer.tsx` — the collapsed "Coaching Career" panel on `/players/[slug]`,
  wraps `CoachCareerBody` + `CoachOpponentHistoryClient`.
- `ClubCoachRecords.tsx` — a `/clubs/[slug]` section (one row per coach of that club). Not part
  of the Coaches route family; reviewed only for cross-link/consistency purposes.
- `ExpandableTableFrame.tsx` — CSS-only "expand table" overlay, added by ISSUE-172, wired in
  today **only** on the Coaches index table. Its own comment explicitly invites "other tables
  adopt it opportunistically" — this issue is a natural next adopter.
- `CollapsibleTable` / `CollapsiblePanel` — native `<details>`-based disclosure. Confirmed (by
  reading `src/app/players/[slug]/page.tsx`) that **every** major section of the player page
  (Career & Biography, Draft & recruitment, Honours, Clubs, Season by season, Brownlow Medal,
  Match log) is one of these. The Coaches page family is the outlier: its sections are plain
  `<section className="section"><h2>`, never a disclosure.

### Design system already in force ("the almanac")

From `src/styles/globals.css`'s own header comment and tokens: cream paper / ink dark mode
(`--bg`, `--text`), a single gold accent (`--accent: #765913`), ruled lines instead of shadows,
2px corner radius, Newsreader serif for voice, IBM Plex Sans for labels/UI, IBM Plex Mono for
every number (`tabular-nums`). `.stat-strip` (ruled cells, no cards), `.table-wrap` (contained
horizontal scroll with an edge-shadow cue), `.grid`/`.grid-panels`/`.grid-shrink` (auto-fit
card/column grid), `.filter-group`/`.filter-grid` (fieldset-based form controls), `.empty`/
`.notice`/`.muted` (state messaging). This is a mature, consistent, already-distinctive system.
**This design pass works inside it — it does not introduce a second visual identity.** The one
"signature" move this issue makes is structural: bringing the Coaches pages into the same
disclosure/record-book convention every other profile page already uses (see §3).

### Layout tokens (ISSUE-173)

- `--measure: 1180px`, `--gutter: clamp(1rem, 3vw, 2rem)`.
- `classic`: `.container` capped at `--measure`, full width beneath it.
- `sidebar`: `.container.layout-shell` drops the cap; CSS grid
  `minmax(0, 15rem) minmax(0, 1fr)` with a `2rem` gap; converges on the same mobile `TabBar`
  at ≤640px (nav column disappears, single column).
- **Computed content width, sidebar preset** (viewport minus gutters minus 15rem nav minus
  2rem gap): roughly **692px at 1024px** viewport, **~1104px at 1440px** viewport — both below
  classic's 1180px cap, and the 1024px figure lands inside a width most designs would otherwise
  treat as "plenty of room for a wide table." See §9/§11.

### Related but out-of-scope query surface (noted, not touched)

`src/db/queries/coaches.ts` also exports `getCoachRecordsByMetric` (wins/finals/grand
finals/premierships leaderboards) — used nowhere in the reviewed route family today (only
`getCoachRecordsByGames`/`getCoachRecordsByWinPct`, consumed by `/records/coaches`, a sibling
page under `/records`, not `/coaches`). This is category-2 data (available via an existing
query, not currently exposed on the Coaches pages) — explicitly **not** pulled into this
issue's scope; see §16.

---

## 2. Confirmed UX/layout problems

Each of these is grounded in the actual code read above, not assumed from the brief text.

1. **Duplicated totals on the standalone coach page.** `/coaches/[slug]` renders a `.stat-strip`
   headline (Games / W–L–D / Win % / Finals / Grand Finals / Premierships) and then, a few
   hundred pixels below under "Coaching record," `CoachCareerBody` renders `CoachTotalsTable` —
   the same six numbers again, in a boxed table. Two different visual treatments of one fact,
   back to back. (Brief: "repeated or competing headings," "duplicating the same facts.")
2. **The Coaches page family is the one profile-style surface with no disclosure.** Every
   major section of `/players/[slug]` is a `CollapsibleTable`/`CollapsiblePanel`. `/coaches/[slug]`
   and `/coaches/compare` use flat `<section><h2>`/`<h3>` throughout — nothing collapses. This is
   the direct mechanical cause of "cramped/squashed": a multi-club coach or a compare page (up
   to 7 stacked tables: career × 2 coaches, biggest win/loss × 2, venue history × 2, plus the
   full head-to-head cluster) renders as one long uninterruptible scroll with no reader control.
3. **Two visual weights for the same one-field control.** The standalone page's
   `CoachOpponentSelector` wraps a single `<select>` in a full `fieldset`/`legend`/`.filter-grid`
   — the same chrome the multi-field `/players` advanced search used before ISSUE-172 removed it.
   The player-page's `CoachOpponentHistoryClient`, presenting the *identical* control, uses a
   plain inline `<label>+<select>`. One control, two weights, on two surfaces that must feel like
   the same feature.
4. **Wide tables with no column strategy.** `CoachClubTable` (8 columns) and
   `CoachVenueHistoryTable` (8 columns) rely solely on `.table-wrap`'s contained horizontal
   scroll. That is correct and must stay (the page body must never scroll), but at typical coach
   career sizes (1–4 club stints, a handful of venues) a reader on a 375–768px viewport has to
   scroll sideways to see Win % or Premierships on a table that is otherwise only a few rows tall
   — exactly where `ExpandableTableFrame` (already built, already used on the index) earns its
   keep, and exactly the kind of table it was built for.
5. **Compare-page comparison grid uses content-driven reflow for an always-exactly-2-item
   layout.** `grid-panels` is `auto-fit, minmax(min(320px, 100%), 1fr)` — right for "however many
   cards fit," but a coach comparison is always exactly two columns. Two `minmax(320px)` tracks
   need ~672px combined before they sit side by side; below that they silently drop to one
   column. That threshold falls **inside** the 641–1080px band the brief calls out, and moves
   around with the sidebar layout's narrower content column (§9), so today's behaviour there is
   coincidental, not designed.
6. **`/coaches` and `/records/coaches` compete on the same fact.** The index's `SortableTable`
   defaults to `games desc` — the same framing `/records/coaches`' "Most games coached" board
   already owns, complete with rank numbers and a 50-minimum win-percentage board.
   `/records/coaches` already links back to `/coaches` ("Browse every coach... on the Coaches
   index"); nothing links forward. The index has no distinct job of its own stated in its
   hierarchy.
7. **No horizontal-overflow risk found**, and no accessibility violation found in the existing
   markup — `.table-wrap` is used correctly everywhere, every table has proper `<th scope>`, every
   selector has an associated `<label>`. These are hierarchy/density/consistency problems, not
   correctness or a11y defects.

---

## 3. Design goals

1. Make the Coaches page family consistent with the rest of AFLDB's profile pages: disclosure
   sections, one totals surface per fact, one visual weight per control shape.
2. Establish a clear read order on the coach profile: **who → headline record → club-by-club
   ledger → milestone matches → venue detail (progressive) → head-to-head drill-down
   (progressive)** — most-scanned facts first, least-scanned facts opt-in.
3. Give the compare page the same disclosure treatment so a two-coach, long-career comparison
   does not read as one unbroken scroll.
4. Make every table's mobile behaviour a deliberate choice (contained scroll vs. expand-to-view),
   not an accident of `.table-wrap`'s default.
5. Differentiate `/coaches` (find/browse a coach) from `/records/coaches` (who is best), and
   connect them.
6. Change nothing about what data exists, what a number means, or how a route resolves identity.

---

## 4. Information hierarchy — Coaches index (`/coaches`)

```
Coaches
1,234 people have coached a VFL/AFL match.
See also: Games and win-percentage leaderboards →         (NEW cross-link)

┌─ Coaches ──────────────────────────────────────── 1,234 found ─┐
│ Name ▲            Seasons        Games                          │
│ A.N. Other        1998–2004        112                          │
│ ...                                                              │
└───────────────────────────────────────────────────── Expand ───┘
```

- The index's job is **find/browse a coach by name**, not rank them — `/records/coaches` already
  owns ranking, with rank numbers and a stated win-percentage minimum. Default sort changes from
  `games desc` to **`name asc`**, so opening the page reads as a phone-book, not a leaderboard.
  Games remains sortable (a reader who does want "most games" is one click away — the data and
  the column are unchanged, only the *default* changes).
- One new line under the subtitle, linking to `/records/coaches`. Purely additive; the reverse
  link already exists.
- No new filter/search control. 1,234 rows in one client-sorted table is exactly what
  `SortableTable`'s Name-column sort is for, and ISSUE-172 only just finished *removing*
  advanced-search UI from `/clubs` and `/players` as unnecessary weight — adding a parallel
  filter box here would cut against that same-day decision without new evidence it is needed.
  If a future issue finds evidence otherwise, `TableFilters`' plain-GET convention is the right
  tool, not a new client-side search box.
- Table markup, columns and `ExpandableTableFrame` wiring are unchanged.

---

## 5. Information hierarchy — coach detail/profile (`/coaches/[slug]`)

Target read order (desktop, classic layout):

```
Breadcrumbs: Coaches / A.N. Other

A.N. Other
Essendon · Carlton · 1998–2015
A.N. Other coached 340 VFL/AFL games (1998–2015), winning 2 premierships.
Compare with another coach →  ·  View playing career →

┌─────────┬──────────┬────────┬────────┬─────────────┬──────────────┐
│ 340     │ 210–120–10│ 61.8% │  48    │      6      │       2      │
│ Games   │  W–L–D    │ Win % │ Finals │ Grand Finals│ Premierships │
└─────────┴──────────┴────────┴────────┴─────────────┴──────────────┘

▾ Coaching record                                    2 clubs · 1998–2015
    Club-by-club                                              [Expand]
    ┌─ Club ── Seasons ── Games ── W–L–D ── Win% ── Finals ── GF ── Prem ─┐
    │ Essendon  1998–2008    250   ...                                   │
    │ Carlton   2009–2015     90   ...                                   │
    └──────────────────────────────────────────────────────────────────┘
    Biggest win and loss
    ┌─ Record ── Margin ── Opponent ── Coaching ── Season ── Date ── Venue ┐
    └──────────────────────────────────────────────────────────────────┘
    Venue history                                                [Expand]
    ┌─ Venue ── Games ── W–L–D ── Win% ── Finals ── GF ── First ── Latest ┐
    └──────────────────────────────────────────────────────────────────┘

▾ History against club
    History against club: [ Choose an opponent ▾ ]
    (selection results render here, same layout as above, scoped)
```

Changes from today, each tied to a §2 finding:

- **No `CoachTotalsTable` directly under the stat-strip** (finding 1). `CoachCareerBody` gains a
  `showTotalsTable` prop, default `true` (so `PlayerCoachingCareer`, which has no stat-strip of
  its own, is unaffected); the standalone page passes `showTotalsTable={false}`.
- **"Coaching record" and "History against club" become `CollapsibleTable`s**, `defaultOpen`
  (finding 2) — same convention as the player page's "Season by season"/"Brownlow Medal," not a
  behaviour change, a consistency fix. The club table, biggest-win/loss table and venue table
  stay bundled inside one "Coaching record" disclosure, exactly the way the player page already
  bundles multiple related tables inside one `CollapsibleTable` (e.g. "Career & Biography").
- **`CoachClubTable` gains an `ExpandableTableFrame`** (finding 4), matching the index's own
  wiring. `CoachVenueHistoryTable` gets the same treatment where a coach's venue count makes it
  worthwhile (both are 8-column tables; wiring both is the same one-line change per table).
  `CoachBiggestWinLossTable` (two rows) does not need it.
- **`CoachOpponentSelector` drops its `fieldset`/`legend`/`.filter-grid` wrapper** for a plain
  inline `<label htmlFor>+<select>`, matching `CoachOpponentHistoryClient` exactly (finding 3).
  `fieldset`/`legend` is for *grouping* related controls; a single select does not need it, so
  this is a correction, not an accessibility reduction. The `router.push(..., { scroll: false })`
  behaviour ISSUE-172 fixed is untouched — this only changes the wrapping markup, never the
  `onChange` handler.
- **Zero-game coach** keeps its existing explicit `<p className="muted">` state (no games, no
  fabricated tables) — unchanged, already correct per the Jim Adamson case in the code comments.

---

## 6. Treatment of club-history / history-v-team

"History against club" stays a full, visible, `defaultOpen` disclosure — this is genuine
reference content people look up deliberately (rivalry records), not a secondary afterthought,
so it is **not** collapsed-by-default or buried behind extra clicks. The only changes are:

1. It becomes a `CollapsibleTable` (consistency with every other section, §5).
2. Its selector loses the heavyweight form chrome (§5, finding 3) so it visually reads as "one
   more control on this page" rather than "a second, different kind of search form."
3. **Nothing about `resolveCoachOpponentSelection`, the `?opponent=` URL contract, or the
   `router.push(..., { scroll: false })` fix ISSUE-172 made is touched.** The explicit ISSUE-172
   boundary — no full-page reload, no scroll-to-top regression — is preserved by construction:
   this issue only restyles the wrapper around an unchanged client component.
4. The player-linked twin (`CoachOpponentHistoryClient`, inside `PlayerCoachingCareer`'s
   collapsed panel) is unchanged. Its markup was already the lighter pattern this issue adopts
   for the standalone page — no divergence is introduced between the two.

---

## 7. Table strategy

| Table | Columns | Strategy |
|---|---|---|
| Coaches index | 3 (Name, Seasons, Games) | `.table-wrap` only — never wide enough to need more. Unchanged. |
| `CoachClubTable` | 8 | `.table-wrap` + `ExpandableTableFrame` (new wiring on standalone page) |
| `CoachBiggestWinLossTable` | up to 7 | `.table-wrap` only — always exactly 2 rows, short enough that horizontal scroll on a phone is a minor, rare inconvenience; not worth the "Expand" affordance |
| `CoachVenueHistoryTable` | 8 | `.table-wrap` + `ExpandableTableFrame` where wired (standalone page; optional on the player-page panel, which is already inside its own collapsed disclosure and a narrower content column) |
| Compare page per-coach tables | same shapes as above, ×2 (`grid-panels`) | Same per-table strategy; additionally wrapped in section-level `CollapsibleTable`s (§8) so the *page*, not just individual tables, stays manageable |
| `CoachHeadToHeadVenueTable` | 9 | `.table-wrap` + `ExpandableTableFrame` |

No column is ever hidden or dropped at narrow widths — every number stays reachable, which is
the brief's explicit "make dense historical data easier to understand, not hide it." The choice
is contained-scroll (cheap, always available) vs. expand-to-full-viewport (better for anything
wider than ~5 columns), never removal.

---

## 8. Search/filter/control placement

- **Coaches index:** no filter control (§4) — sort-by-name is the browse mechanism, site search
  is the lookup mechanism. One new cross-link line, placed directly under the existing subtitle
  so it reads as page-level orientation, not a call-to-action competing with the table.
- **Coach detail — Compare/View playing career links:** unchanged position (`page-header`
  `.section-note`, directly under the lede) — already correctly placed as the page's primary
  actions, immediately after identity and before any data.
- **Coach detail — opponent selector:** unchanged position (top of "History against club"),
  lighter markup (§5).
- **Compare page — two-coach picker:** unchanged. It is a genuine two-field form (`a`, `b`) and
  keeps its `fieldset`/`legend`/`.filter-grid` — this is exactly the shape that chrome is for,
  unlike the single-field opponent selector.

---

## 9. Classic-layout behaviour

Full-width content beneath the top nav, capped at `--measure` (1180px). This is the layout every
existing coach-page screenshot/acceptance run has been checked against (ISSUE-172, ISSUE-173).
All wireframes in §5/§6 are drawn against classic. No content changes based on layout — only the
column width the same components render into changes (see §10/§11).

---

## 10. Sidebar-layout behaviour

`.container.layout-shell` gives the content column `1fr` beside a fixed `15rem` nav, `2rem` gap,
uncapped by `--measure`. Computed content width (§1): **~692px at 1024px viewport, ~1104px at
1440px viewport.**

Consequences specific to this issue:

- **`CoachClubTable`/`CoachVenueHistoryTable` (8 columns) will commonly need `.table-wrap`'s
  scroll or the "Expand table" control even at 1024px desktop width in `sidebar` mode** — a
  width where `classic` mode would still show most or all columns unscrolled. This is exactly why
  §7 wires `ExpandableTableFrame` onto these tables rather than assuming desktop means "no scroll
  needed."
- **Compare page's two-column `grid-panels` (§2 finding 5) is more likely to collapse to one
  column at moderate widths in `sidebar` mode** than in `classic`, because the available track
  width is smaller for the same viewport. The deterministic breakpoint in §11 is chosen against
  `sidebar`'s narrower content column, not just the raw viewport, so it behaves correctly in
  both.
- Below 640px, `sidebar` converges on the same mobile `TabBar` as `classic` (ISSUE-173's own
  design) — no Coaches-specific mobile behaviour is needed for either layout.
- No component built or changed by this issue reads `data-site-layout` directly; every difference
  above is a consequence of the content column simply being narrower, which is exactly the
  "adapt naturally to available width" behaviour the brief asks for rather than two page
  implementations.

---

## 11. Responsive behaviour at target widths

Widths are evaluated against the **narrower of the two layouts' content columns** at that
viewport, since both must work.

| Width | Coaches index | Coach detail | Compare page |
|---|---|---|---|
| **375px** (phone) | 3-col table fits or scrolls trivially; unchanged | Stat-strip wraps to 2 columns (existing `flex-wrap`, unchanged); disclosures stacked, collapsed sections take no vertical space; club/venue tables scroll inside `.table-wrap` or expand | Picker form stacks (`.filter-grid` already collapses to 1 column ≤640px per existing rule); comparison grid is single-column (well under any 2-column threshold); each comparison section is its own collapsible, so the page is a stack of closed/open cards rather than one long scroll |
| **640px** (mobile boundary) | Unchanged | Same as 375px; stat-strip may fit more cells per row | Still single-column comparison (640px < the ~672–700px two-column threshold in both layouts) |
| **768px** (tablet) | Unchanged | Table columns mostly fit in `classic`; `sidebar`'s ~500–550px content column at this viewport still needs scroll/expand for the 8-column tables — expected and handled by §7 | **Deterministic breakpoint**: comparison grid switches to 2 columns at content-column width ≥768px in `classic`; in `sidebar` (content column ~500–550px here) it correctly stays single-column — see below |
| **1024px** (small desktop/tablet landscape) | Unchanged | `classic`: full club table likely fits without scrolling. `sidebar`: content column ~692px — 8-column tables still commonly need scroll/expand (§10) | `classic` content column (~960px) comfortably fits 2 columns; `sidebar` content column (~692px) is right at the edge — the deterministic breakpoint (below) makes this a designed choice, not luck |
| **1440px** (desktop) | Unchanged | Both layouts comfortably fit the club table without scrolling in most real career lengths | Both layouts comfortably fit 2 columns |

**Deterministic comparison breakpoint (§2 finding 5, resolved):** rather than relying on
`grid-panels`' content-driven `auto-fit` reflow, the three `CoachComparisonCareer` sections and
`CoachHeadToHeadSection`'s internal pairs use a small, explicit modifier — two fixed columns
above a defined content-column width, one column at or below it, keyed to a clamp comparable to
`~640–680px` of *available content width* (not raw viewport), so it produces the same visual
result in both layouts once each layout's own content width is accounted for. This is a
CSS-only addition (`grid-template-columns` override alongside the existing `.grid-panels
.grid-shrink` classes on those specific call sites), not a new component, and not a change to
`grid-panels` itself (which stays exactly as generic-card behaviour for every other page that
uses it).

Tables never force page-level horizontal scroll at any listed width, in either layout — this was
already true before this issue (`.table-wrap` guarantees it) and nothing here changes that
guarantee.

---

## 12. Accessibility/keyboard considerations

- `CollapsibleTable`/`CollapsiblePanel` are native `<details>/<summary>` — inherently
  keyboard-operable (Enter/Space toggles) and require no new ARIA. Adopting them on the Coaches
  pages is itself an accessibility improvement (a reader can skip sections via the existing
  heading/disclosure outline, which screen-reader users already rely on across every other AFLDB
  profile page).
- `ExpandableTableFrame` already implements `role="dialog"`, `aria-modal`, a focus trap, Escape-
  to-close and focus restoration to the trigger — verified by reading the component. Wiring it
  onto two more tables reuses this verbatim; no new interaction code.
- Simplifying `CoachOpponentSelector` to a plain `<label htmlFor>+<select>` (dropping
  `fieldset`/`legend`) is accessibility-neutral-to-positive: `fieldset`/`legend` is for grouping
  multiple related controls, and a single labelled `<select>` needs only the `<label>`
  association, which is preserved unchanged.
- Heading outline: the standalone coach page keeps `<h1>` (name) → `<h2>` ×2 ("Coaching record",
  "History against club") via `CollapsibleTable`'s `Heading` → `<h3>` ×2 nested inside "Coaching
  record" ("Biggest win and loss", "Venue history") — no change to nesting depth from today,
  only the h2s gaining a native disclosure wrapper.
- Compare page: "Career", "Biggest win and loss", "Venue history" and "Head-to-head" each become
  their own `<h2>` `CollapsibleTable`, matching how the player page stacks multiple independent
  `<h2>` disclosures rather than one page-level container.
- Must re-verify after implementation (not claimed here): focus order through newly-wrapped
  `<details>` elements; that `ExpandableTableFrame`'s focus trap still behaves correctly when its
  trigger now sits inside a `<details>` that could itself be closed/reopened; keyboard-only pass
  (Tab, Enter, Escape) at each viewport in §17.

---

## 13. Component reuse vs. new components

**Reused verbatim (no change):** `CollapsibleTable`, `CollapsiblePanel`, `SortableTable`,
`ExpandableTableFrame`, `.stat-strip`, `.table-wrap`, `.grid`/`.grid-panels`/`.grid-shrink`,
`.filter-group`/`.filter-grid` (kept for the two-field compare picker), `CoachOpponentHistoryClient`
(player-page twin, untouched), `resolveCoachOpponentSelection` and every query/data function.

**Small, scoped changes to existing components (no new files unless noted):**

1. `CoachCareerRecord.tsx` — `CoachCareerBody` gains `showTotalsTable?: boolean` (default `true`).
2. `src/app/coaches/[slug]/page.tsx` — wrap "Coaching record" / "History against club" in
   `CollapsibleTable`; pass `showTotalsTable={false}`; wire `ExpandableTableFrame` around
   `CoachClubTable`/`CoachVenueHistoryTable`.
3. `CoachOpponentSelector.tsx` — markup simplification only (drop `fieldset`/`legend`/
   `.filter-grid`, adopt the inline `<label>+<select>` shape `CoachOpponentHistoryClient` already
   uses). No change to `onChange`/`router.push`.
4. `src/app/coaches/page.tsx` — `defaultSort` `'games'` → `'name'`; add one cross-link line.
5. `CoachComparisonCareer.tsx` / `CoachHeadToHead.tsx` — wrap each section in `CollapsibleTable`;
   apply the new deterministic 2-column class (§11) to the existing `grid grid-panels
   grid-shrink` call sites.
6. `src/styles/globals.css` (or a small addition near `.grid-panels`) — the new deterministic
   comparison-grid breakpoint rule. `layouts.css` is not touched (it owns structural layout
   tokens only, per its own header comment, and this is a page-level content rule, not a global
   layout token).

**No new component files are required.** Every change is either a prop, a markup
simplification, a wrapping disclosure, or a CSS rule on an existing selector family.

---

## 14. CSS/layout architecture

- No new design tokens. No colour, radius, or font addition — everything draws from the existing
  "almanac" palette/type tokens in `themes.css`, respected as-is.
- `layouts.css`'s ownership boundary (structural presets only, "must never redeclare a
  theme-owned token") is preserved — the new comparison-grid rule is page-content CSS, added
  alongside the existing `.grid-panels`/`.grid-shrink` rules in `globals.css`, not to
  `layouts.css`.
- `ExpandableTableFrame`'s CSS (`.table-expand`, `.table-expand-open`, fixed-position overlay
  logic) is unchanged — reused as-is on the additional tables.
- No JavaScript-driven responsive logic is introduced; every width-dependent behaviour in this
  plan is CSS (`.table-wrap` scroll, the new grid breakpoint, existing `@media (max-width:
  640px)` rules) or an unconditional prop (`showTotalsTable`).

---

## 15. Exact affected files/components

```
src/app/coaches/page.tsx                    (defaultSort change, cross-link)
src/app/coaches/[slug]/page.tsx             (CollapsibleTable wrapping, showTotalsTable, ExpandableTableFrame wiring)
src/components/CoachCareerRecord.tsx        (showTotalsTable prop on CoachCareerBody)
src/components/CoachOpponentSelector.tsx    (markup simplification only)
src/components/CoachComparisonCareer.tsx    (CollapsibleTable wrapping, grid breakpoint class)
src/components/CoachHeadToHead.tsx          (CollapsibleTable wrapping, grid breakpoint class)
src/styles/globals.css                      (new deterministic comparison-grid rule)
```

Not touched: `src/app/coaches/compare/page.tsx`, `src/app/coaches/compare/state.ts`,
`CoachComparisonControls.tsx`, `CoachOpponentHistoryClient.tsx`, `PlayerCoachingCareer.tsx`,
`ClubCoachRecords.tsx`, `src/app/records/coaches/page.tsx`, `src/db/queries/coaches.ts`,
`src/lib/coach-opponent-history.ts`, `src/lib/coach-comparison-url.ts`, `src/styles/layouts.css`,
`src/styles/themes.css`, any migration, any route/URL shape, any permission.

---

## 16. Explicit backend/data non-goals

- **No schema change, no migration.** Nothing here touches `src/db/migrations/`.
- **No query semantics change.** Every number rendered today is rendered by the same query
  function, called the same way, with the same arguments.
- **No new coaching statistic.** `getCoachRecordsByMetric` remains unused by this issue — noted
  in §1 as available (category 2), deliberately left for a future issue if `/records/coaches`
  (or elsewhere) wants it; pulling it into `/coaches` here would be adding a statistic this issue
  is explicitly not chartered to add.
- **No historical-identity rule change.** Coach/player identity resolution, `resolveCoachOpponentSelection`, and canonical-slug redirects are untouched.
- **No route/URL change.** `/coaches`, `/coaches/[slug]`, `/coaches/compare`, and the
  `?opponent=`/`?a=&b=` query contracts are unchanged.
- **No permissions/admin change.** The admin Coaches management surface (`.admin-cards`/
  `.responsive-table`, `tests/admin-coach-actions.test.ts`) is a different, admin-only pattern
  and is not in scope.
- **No change to ISSUE-173's global layout architecture.** This issue only proposes a
  page-content CSS rule that reads how much width each layout happens to offer; it adds no new
  layout preset and does not touch `src/app/layout.tsx`.

---

## 17. Testing/rendered-acceptance strategy

No new test file — every change lands in an existing semantic home:

| File | Covers |
|---|---|
| `tests/coach-profile-route.test.ts` | `/coaches/[slug]` structure: `CollapsibleTable` wrapping, `showTotalsTable={false}` on this route, `ExpandableTableFrame` presence |
| `tests/coach-career-record.test.ts` | `CoachCareerBody`'s new `showTotalsTable` prop (default `true` still renders the table, e.g. for `PlayerCoachingCareer`'s existing expectations) |
| `tests/coaches.test.ts` | Index `defaultSort`/`defaultDir` change to name-ascending |
| `tests/coach-comparison-career.test.ts` | `CollapsibleTable` wrapping and grid class on `CoachComparisonCareer` |
| `tests/coach-head-to-head-view.test.ts` | Same, for `CoachHeadToHeadSection` |
| `tests/player-coaching-career.test.ts` | Confirms `PlayerCoachingCareer` is unaffected (default `showTotalsTable` keeps the totals table inside the collapsed panel, exactly as today) |
| `tests/e2e/journeys.spec.ts`, `tests/e2e/responsive-nav.spec.ts` | Rendered acceptance at 375/640/768/1024/1440px, both `frontendLayout` presets (`classic`/`sidebar`), following ISSUE-173's own acceptance convention |

Rendered/manual acceptance (next session, once DEV is available):

1. Playwright screenshots at all five target widths × both layout presets, for: the Coaches
   index; a multi-club coach; a single-club coach; a zero-game coach; `/coaches/compare` in its
   unselected, invalid, same-coach and selected states.
2. Confirm the ISSUE-172 fix survives verbatim: changing the opponent selection on
   `/coaches/[slug]` does **not** reload the page or reset scroll position.
3. Keyboard-only pass: Tab through every control, Enter/Space to open/close each disclosure,
   Escape to close an expanded table, focus restored to its trigger.
4. Console/network/hydration clean, no horizontal page overflow, at every width above.
5. Focused unit suite for the files in §17's table, `npm run typecheck`, then
   `npm run build` only if the change set proves larger than expected once implemented.

---

## 18. Phased implementation plan (for the next session)

1. **Coach detail page** — `showTotalsTable` prop, `CollapsibleTable` wrapping, opponent-selector
   markup simplification, `ExpandableTableFrame` wiring. Extend `coach-career-record.test.ts` and
   `coach-profile-route.test.ts`.
2. **Coaches index** — default-sort change, cross-link to `/records/coaches`. Extend
   `coaches.test.ts`.
3. **Compare page** — `CollapsibleTable` wrapping on `CoachComparisonCareer`/`CoachHeadToHead`,
   deterministic comparison-grid CSS. Extend `coach-comparison-career.test.ts` and
   `coach-head-to-head-view.test.ts`.
4. **Responsive/layout acceptance** — the full Playwright pass in §17, both layout presets, all
   five widths, keyboard pass.
5. **Standard lifecycle close-out** — focused unit + typecheck green, `issues.md`/
   `IssuesIndex.md` updated on resolution, `CHANGELOG.md` entry once behaviour actually ships
   (this planning session does not add one, per the brief).

Each phase is independently shippable and independently testable; a fresh session can stop after
any phase at a safe milestone.

---

## 19. Deferred follow-ups

- Broader `ExpandableTableFrame` adoption beyond the Coaches family — already an open ISSUE-172
  deferral, unchanged by this issue.
- `ClubCoachRecords` (`/clubs/[slug]`) visual pass — a club-page section, not part of this
  issue's route family; a candidate for its own issue if the club page ever gets a similar
  review.
- `/records/coaches` visual pass — untouched beyond the one new cross-link; it is a sibling
  leaderboard page under `/records`, not part of the Coaches route family.
- Exposing `getCoachRecordsByMetric` (wins/finals/grand-finals/premiership leaderboards)
  anywhere — category-2 data, explicitly not pulled into this issue (§16).
- A unified "metric-rows × coach-columns" comparison table (one table instead of two side-by-side
  per-coach tables) for `/coaches/compare` — considered and explicitly **not** proposed here,
  because `CoachComparisonCareer`'s own code comment records a deliberate prior decision to
  mirror `ClubComparisonCareer`'s side-by-side convention rather than build a second parallel
  presentation. Changing only the coach side would create presentation drift between the two
  comparison surfaces; if this is worth doing, it should be scoped as a joint Club+Coach compare
  issue, not smuggled into ISSUE-174.
- Sidebar-preset touch-target sizing on `PrimaryNav` (~30–34px) — an existing ISSUE-173 follow-up,
  unrelated to Coaches, not affected by this issue.

---

## 20. Implementation, rendered acceptance and closeout (2026-09-15)

Executed the §18 phased plan in the same worktree, same day.

### Phases 1-3 — implementation

- **Phase 1 (coach detail page):** `CoachCareerBody` gained `showTotalsTable` (default `true`) and
  `expandWideTables` (default `false`). `/coaches/[slug]` passes `showTotalsTable={false}`
  (removes the duplicate totals table under the stat-strip) and `expandWideTables` (wires
  `ExpandableTableFrame` onto the club and venue tables). "Coaching record"/"History against club"
  became `CollapsibleTable` disclosures. `CoachOpponentSelector` dropped its `fieldset`/`legend`/
  `.filter-grid` for a plain `<label>+<select>` matching `CoachOpponentHistoryClient`'s existing
  `.filter-group` shape exactly — `onChange`/`router.push(..., { scroll: false })` untouched, and
  the ISSUE-172 no-reload/no-scroll-reset behaviour was re-verified intact. `PlayerCoachingCareer`
  is unaffected (both new props default to the pre-existing rendering).
- **Phase 2 (`/coaches` index):** `defaultSort`/`defaultDir` changed `games`/`desc` ->
  `name`/`asc`; one `.section-note` cross-link to `/records/coaches` added.
- **Phase 3 (compare page):** `CoachComparisonCareer`'s three sections and
  `CoachHeadToHeadSection` (all three states) became independent `CollapsibleTable` disclosures.
  The three comparison grids gained a `grid-compare` class for a new deterministic two-column
  breakpoint (`.grid-compare-container` / `@container (min-width: 672px)` in `globals.css`),
  replacing `.grid-panels`' content-driven `auto-fit` reflow per §2 finding 5/§11.

No schema, query, identity, route/URL, permission, admin, or ISSUE-173 layout-architecture change
in any phase — confirmed by diff against the §15/§16 exact-affected-files and non-goals lists.

### Phase 4 — rendered acceptance

Local dev server against the shared DEV database (operator-authorised), Playwright pass across
`classic`/`sidebar` at 375, 640, 768, 1024 and 1440px, covering: the Coaches index; a multi-club
coach (Malthouse); a single-club coach (Scott); the zero-game coach (Adamson); the compare page;
and the opponent-history interaction. Result: no horizontal overflow, no console/hydration errors,
ISSUE-172's scroll-preserving opponent-selector navigation intact in both layouts,
`ExpandableTableFrame`'s focus trap/Escape/focus-restore intact even nested inside a now-collapsible
`<details>`.

**Defect found and fixed during this pass:** the first version of the deterministic
comparison-grid rule put `container-type: inline-size` and its `@container` override on the same
`.grid-compare` class. This silently never applied — a size-containment container cannot be the
query target of its own `@container` rule — so the grid was actually still running on
`.grid-panels`' plain `auto-fit`, which happened to look right at most probed widths only because
its own natural collapse threshold sits close to the intended 672px one. Fixed by moving
`container-type: inline-size` onto a dedicated wrapping `.grid-compare-container` element around
each of the three comparison grids (`src/styles/globals.css`,
`src/components/CoachComparisonCareer.tsx`). Re-verified correct and independent per layout at the
same viewport after the fix (e.g. 1024px: two columns in `classic`, one column in `sidebar`,
because their actual content widths differ) across all five widths in both layouts. `frontendLayout`
was restored to `classic` on the shared DEV database afterward, and the local dev server stopped.

### Focused regression and typecheck (pre-Vercel-review)

- `npx vitest run tests/coach-career-record.test.ts tests/coach-profile-route.test.ts tests/coaches.test.ts tests/coach-comparison-career.test.ts tests/coach-head-to-head-view.test.ts`
  — 5 test files, **81/81 passed**.
- `npm run typecheck` — next typegen + `tsc --noEmit`, **passed**.

### Vercel Web Interface Guidelines review

Scope: `/coaches` index, standalone coach profile, history-against-club controls, comparison page,
`CollapsibleTable` usage, `ExpandableTableFrame` usage, the comparison-grid CSS, and
responsive/accessibility behaviour introduced or changed by this issue. (The `web-design-guidelines`
skill was not present in the session's available-skills list; the guidelines were applied directly
against the diffed code instead.)

- **0 MUST FIX.**
- **1 SHOULD FIX, found and fixed:** the runbook's own table strategy (§7) calls for
  `ExpandableTableFrame` on `CoachHeadToHeadVenueTable` (9 columns — the widest table in the whole
  feature), but `CoachHeadToHead.tsx` never wired it in, unlike the equal/lesser-width
  `CoachClubTable`/`CoachVenueHistoryTable` (8 columns) that got it in Phase 1. On `sidebar` layout
  at 1024px (~692px content column) this left the one wide table on the compare page without the
  deliberate expand-to-view choice §3.4 calls for. **Fixed:** `CoachHeadToHead.tsx` now wraps
  `CoachHeadToHeadVenueTable` in `ExpandableTableFrame` (guarded on `venues.length > 0`, matching
  `CoachCareerBody`'s own convention). `tests/coach-head-to-head-view.test.ts` extended with two
  cases (expand control present with venue data; absent when there is none).
  Post-fix focused regression: `npx vitest run tests/coach-head-to-head-view.test.ts` — 1 file,
  **16/16 passed**.
- **Optional/pre-existing, left out of scope:** `CoachOpponentSelector`'s markup now matches
  `CoachOpponentHistoryClient` exactly (both `.filter-group` div + inline label/select) —
  intentional, not a defect. `.grid-compare-container`'s `container-type: inline-size` establishes
  a containing block for `position: fixed` descendants, relevant to `ExpandableTableFrame`'s fixed
  overlay, but no `ExpandableTableFrame` is nested inside `.grid-compare-container` anywhere today,
  so this has no live effect — worth remembering if a future issue nests one there. The standalone
  page's "Clear" link lost its `.btn.btn-secondary` styling when `fieldset`/`.filter-actions` were
  dropped; checked against the rest of the codebase, a plain-text `Clear` link next to a filter (no
  button styling) is already the dominant site convention (`admin/draft`, `admin/coaches`,
  `admin/awards/*`, `admin/records/*`) — not a regression.

### Phase 5 — closeout

- Focused unit suites: 81/81 (pre-review) + 16/16 (post-fix) — no regressions.
- `npm run typecheck`: passed.
- `frontendLayout` confirmed restored to `classic` on DEV; no other DEV state changed.
- PROD untouched throughout.
- `CHANGELOG.md`'s existing `[Unreleased]` ISSUE-174 entry is accurate and updated with the final
  Vercel review outcome; `issues.md`/`IssuesIndex.md` synchronized to RESOLVED.
- Not committed, not pushed, not merged — operator action per repository policy.
