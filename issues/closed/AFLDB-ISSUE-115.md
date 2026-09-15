# AFLDB-ISSUE-115 — Data QA multi-domain composable queries

**AUTHORITATIVE APPROVED RUNBOOK — complete implementation contract.**

**Status:** RESOLVED 2026-08-30 — Stages 0–8 COMPLETE / GREEN on the worktree; not merged, not deployed (§20.8)
**Severity:** Medium
**Area:** Admin tooling / Data QA / Query compilation
**Worktree:** `D:\dev\afldb-issue-115` · **Branch:** `claude/issue-115` · **Baseline:** `aa034b5`
**Planned by:** Opus / High effort / Plan mode, 2026-08-30
**Implementation session:** Fable / High effort / Normal mode

> **Resume here.** §20 is the implementation record and carries the current state, validation
> evidence and the exact next action for a fresh session. Read §20 first, then the stage you are
> about to execute in §14.

> **Plan-mode boundary.** Plan mode permits writing only this artefact. The
> repository-root runbook `D:\dev\afldb-issue-115\AFLDB-ISSUE-115.md` therefore
> **does not exist yet**; creating it from **this complete document — every
> section, not a subset** — is Stage 0 of implementation (§14). The
> implementation session must not reconstruct the architecture from conversation
> history; this file is the one authoritative copy.

---

## 1. Context — why this change

`/admin/query-builder` ("Data QA search") is the super-admin ad-hoc QA tool. A
query today has **one global table**. Cards can be combined with AND/OR, but every
card filters columns of that same table, so no question spanning two relations can
be asked. The class of QA questions that matters most — *rows that exist in one
relation but not in another* — is unreachable.

The goal: let one query combine cards from different Data QA domains (Player +
Player Career + Player Match Stats, Match + Player Match Stats, Club + Club Seasons
+ Matches, …) with deterministic, safe cross-domain relational semantics, losing
none of the existing security or performance boundaries.

---

## 2. Confirmed current architecture

Five files, ~1,180 lines. All read in full; findings are from source.

| File | Role |
|---|---|
| `src/search/query-builder-spec.ts` (316 ln) | Isomorphic spec: `QUERYABLE_TABLES` allowlist, operators by kind, `QB_LIMITS`, AST types, URL-token serialise/parse/validate |
| `src/db/queries/query-builder.ts` (199 ln) | `server-only` compiler + executor |
| `src/app/admin/query-builder/page.tsx` (125 ln) | Server Component: `requireSuperAdmin()`, parse `?q=`, run, render |
| `src/app/admin/query-builder/QueryBuilderForm.tsx` (320 ln) | Client Component: all builder state, pushes one `q` token |
| `tests/query-builder-spec.test.ts` (67 ln) / `tests/integration/query-builder.test.ts` (154 ln) | URL-state unit tests / DB-backed compiler semantics |

### 2.1 State / AST (spec `:222-251`)

```ts
ConditionSpec     = { column, op, value?, lo?, hi? }
CardSpec          = { match: 'AND'|'OR', conditions: ConditionSpec[] }
CardGroup         = { join: 'AND'|'OR', card: CardSpec }
QueryBuilderState = { table: string, cards: CardGroup[], sort?, page }
```

`emptyState(table)` → one empty AND card.

### 2.2 Catalogue (spec `:38-189`)

`TableDef = { key, label, from, defaultSort, columns, displayColumns }`. `from` is a
**fixed, already-aliased** FROM/JOIN fragment. Five entries and their aliases — this
matters, see §5.2:

| key | `from` | aliases |
|---|---|---|
| `players` | `players p` | `p` |
| `player_career_stats` | `players p JOIN player_career_stats c ON c.player_id = p.id` | `p`, `c` |
| `clubs` | `clubs cl` | `cl` |
| `matches` | `matches m JOIN clubs hc ON hc.id=m.home_club_id JOIN clubs ac ON ac.id=m.away_club_id` | `m`, `hc`, `ac` |
| `player_match_stats` | `player_match_stats pms JOIN players p ON p.id=pms.player_id JOIN matches m ON m.id=pms.match_id JOIN clubs cl ON cl.id=pms.club_id` | `pms`, `p`, `m`, `cl` |

`ColumnDef.column` is a fixed qualified SQL expression. `ColumnKind` ∈
`integer|float|text|date|boolean`; `OPERATORS_BY_KIND` fixes the operator set per kind.

### 2.3 Compiler (`query-builder.ts`)

- `compileCondition(tableKey, spec)` — resolves `spec.column` **only** in that one
  table's `columns`; throws on unknown column or on an operator not valid for the
  kind; returns `null` for a half-built condition (column chosen, no value yet).
- `compileCard` — conditions folded by the card's `match`, parenthesised as a unit.
- `compileCards` — left fold `((A op B) op C)`, accumulator re-parenthesised at
  every step. `tests/integration/query-builder.test.ts:75-108` is the regression
  that exists because the unparenthesised version silently answered a different
  question.
- `runQueryBuilder` — one flat statement:
  `SELECT <displayColumns>, count(*) OVER () AS __total FROM <table.from> WHERE <fold> ORDER BY <sort> LIMIT 50 OFFSET …`

### 2.4 Security model — three walls (spec header `:11-21`)

1. Identifiers come only from `QUERYABLE_TABLES` (allowlist, deliberately **not**
   `information_schema` discovery).
2. Operators come only from `OPERATORS_BY_KIND`.
3. Values are always bound parameters; `sql.unsafe` touches only catalogue-owned
   fragments.

Plus the database wall: the tool runs through `@/db/client`'s `sql`, the `afldb_app`
role — read-only by grant and, since migrations 031/039, fail-closed: it cannot
SELECT any table absent from `afldb_meta.app_readable_tables`.

### 2.5 Limits (`QB_LIMITS`)

`maxCards 6`, `maxConditionsPerCard 8`, `defaultPageSize 50`, `maxPage 50`,
`maxStateChars 8192`. Parameter budget bounded structurally: 6 × 8 × 2 = 96.

### 2.6 Persistence surface — audited

State lives **only** in the `?q=` URL token (JSON → base64url, `src/lib/urlState.ts`).
No server action, no API route, no database table, no saved-query store.
`tests/admin-nav/admin-nav.spec.ts:34` visits `/admin/query-builder` with **no** `q`
parameter. → **No stored-state migration work exists.** Do not invent any.

### 2.7 The first architectural constraint

`QueryBuilderState.table` is a single global key, and `compileCondition` resolves
every column against that one key's catalogue. Because `table.from` is one fixed
monolithic fragment and the compiler emits one flat `SELECT … FROM <that fragment>`,
**there is no place for a second relation to enter the query.** That, not the UI
position of the table selector, is the blocker.

### 2.8 Directly relevant precedent — `AFLDB-ISSUE-103` (Resolved 2026-08-29)

Grid Solver's `won_a_final` / `never_won_a_final` compiled a semi-join / anti-join
over `player_match_stats` that PostgreSQL planned as `Nested Loop Semi Join` /
`Nested Loop Anti Join` over a `Materialize` node, with a 1,737-vs-14,499 row
misestimate, and **hit the 5 s statement timeout**. Fixed by compiling the inner set
as a scalar-array InitPlan (`p.id = ANY (ARRAY(…))`) — 57 / 504 / 105 ms after.

ISSUE-115 introduces exactly that query shape deliberately. This governs §9.

### 2.9 Established timing-gate precedent

`tests/integration/grid-solver.test.ts:110-116` and `:392-395` already assert
wall-clock ceilings with `performance.now()` deltas and
`expect(elapsedMs).toBeLessThan(1000)` / `toBeLessThan(4_000)`, the latter carrying a
descriptive failure message. This is a **stable, in-repository precedent** for a hard
timing gate, and §9.3 reuses its exact shape rather than inventing one.

---

## 3. Decision 1 — result / anchor grain

**The root query owns an `anchor`. One returned row = one anchor row. Always.**

**V1 anchors are exactly the five existing `QUERYABLE_TABLES` keys.** Their `from`,
`defaultSort` and `displayColumns` carry over **byte-identical**. No new anchor in V1.

The anchor owns result identity, the FROM fragment, the result columns and the
default sort. Related-domain cards are **predicates only**: they never implicitly
contribute result columns and never alter the result grain.

*Operator decision (2026-08-30):* keep V1 anchors to the five grains the tool already
renders, to minimise result-rendering and SQL-output change while multi-domain
composition is proved. Hall of Fame, draft picks and link/match status remain
available **as related filter-card domains**. Additional result anchors are deferred
(§13).

**Result columns: the anchor's `displayColumns`, and nothing else.** Consequence to
state in the UI and docs — "players with 100+ games but no player-match rows" shows
the Players columns; select the *Player career stats* anchor if you want `games` in
the output.

### Column-ownership invariant

> The FROM clause of the emitted statement is the anchor's fixed `from` fragment and
> nothing else. No related relation is ever added to it.

This is what makes `count(*) OVER ()` exact and `DISTINCT` unnecessary (§6.6).

---

## 4. Decision 2 — card model

```ts
type CardSpec = {
  match: 'AND' | 'OR';
  conditions: ConditionSpec[];
  /** Domain this card filters. Absent ⇒ the anchor's own domain (pre-115 tokens). */
  domain?: string;
  /** Related-domain cards only. Absent ⇒ 'any'. */
  quantifier?: 'any' | 'none';
};

type QueryBuilderState = {
  /** Anchor key. Field name stays `table` so pre-115 URL tokens keep working. */
  table: string;
  cards: CardGroup[];
  sort?: string;
  page: number;
};
```

- Every card owns a domain; the root owns the anchor. No ambiguity between "table
  being filtered" and "row being returned" — the anchor alone decides the returned
  row, and it is named once, at the root.
- `CardGroup.join` semantics are **unchanged**.
- Card ordering affects semantics exactly as today (the left fold) and in no new way.
- Serialisation omits `domain` when it equals the anchor and omits `quantifier` when
  `'any'`, so tokens stay short and a pre-115 token is a valid new-model token.

---

## 5. Decision 3 — the curated relationship graph

### 5.1 Subjects, not anchor×domain pairs

A relationship is declared from a **subject** the anchor provides, not from an anchor.
This avoids a combinatorial catalogue and is why `player_career_stats` inherits every
player-side relationship for free.

```ts
type SubjectKey = 'player' | 'club' | 'match';
AnchorDef.subjects: SubjectKey[]
```

| anchor | subjects | why |
|---|---|---|
| `players` | `player` | |
| `player_career_stats` | `player` | `p` is in its FROM |
| `clubs` | `club` | |
| `matches` | `match` | **not** `club` — a match has two clubs, so a `club` subject would be ambiguous. Refused deliberately. |
| `player_match_stats` | ~~`player`, `club`, `match`~~ **none in V1 — Stage 5 amendment, operator-approved 2026-08-30 (§20.5)** | all three are unambiguous at that grain, but every related shape measured RED under this anchor (four over the 5 s ceiling, none under the 1 s target) because the anchor's own pre-115 materialisation is already > 1 s with no card at all. It remains a results anchor with its own columns; related filtering at this grain is deferred until that baseline is fixed (separate follow-up). No relationship is removed globally. |

### 5.2 Canonical subject aliases — the key finding

Each subject fixes one canonical anchor-side alias, and **the existing `from`
fragments already satisfy it**:

`player → p` · `club → cl` · `match → m`

Therefore **no anchor `from` fragment changes**, and correlation predicates are fixed
literals against `p.` / `cl.` / `m.` with no placeholder-substitution machinery at
all. Enforced by spec test T-A1.

### 5.3 Subquery alias namespace

Every relationship's `subqueryFrom` uses only `r_`-prefixed aliases. The anchor
namespace is `{p, c, cl, m, hc, ac, pms}`; `r_` is disjoint from all of them, so no
correlated subquery can shadow the anchor row. Enforced by T-A2.

### 5.4 Relationship definition

```ts
type RelationshipDef = {
  key: string;              // stable; appears in the URL token
  subject: SubjectKey;
  label: string;            // UI domain-select label
  hint: string;             // one plain-English line under the select
  /** Fixed FROM fragment for use INSIDE the correlated subquery. `r_` aliases only. */
  subqueryFrom: string;
  /** Fixed correlation predicate. Uses r_ aliases and the canonical subject alias. */
  correlation: string;
  /** The relation whose rows this relationship yields — used by §5.9 self-equivalence. */
  targetTable: string;
  cardinality: 'one' | 'many';
  columns: Record<string, ColumnDef>;   // qualified with r_ aliases
};
```

`subqueryFrom` and `correlation` are catalogue constants, never derived from request
data, so `sql.unsafe` on them is the same trust level as today's
`sql.unsafe(table.from)`.

### 5.5 V1 relationship catalogue

Every target below is app-readable (created ≤ migration 019, or explicitly registered
via `afldb_meta.grant_app_read`), so `afldb_app` can SELECT it.

**Subject `player` (anchor alias `p`):**

| key | `targetTable` | `subqueryFrom` | `correlation` | card |
|---|---|---|---|---|
| `player.career` | `player_career_stats` | `player_career_stats r_c` | `r_c.player_id = p.id` | **one** (PK is `player_id`) |
| `player.match_stats` | `player_match_stats` | `player_match_stats r_pms JOIN matches r_m ON r_m.id = r_pms.match_id JOIN clubs r_cl ON r_cl.id = r_pms.club_id` | `r_pms.player_id = p.id` | many |
| `player.clubs` | `player_clubs` | `player_clubs r_pc JOIN clubs r_pcl ON r_pcl.id = r_pc.club_id` | `r_pc.player_id = p.id` | many |
| `player.draft_picks` | `draft_picks` | `draft_picks r_dp LEFT JOIN clubs r_dcl ON r_dcl.id = r_dp.club_id` | `r_dp.player_id = p.id` | many |
| `player.hall_of_fame` | `hall_of_fame` | `hall_of_fame r_hof` | `r_hof.player_id = p.id` | many (0/1 in practice) |
| `player.captaincies` | `captaincies` | `captaincies r_cap JOIN clubs r_ccl ON r_ccl.id = r_cap.club_id` | `r_cap.player_id = p.id` | many |
| `player.awards` | `award_winners` | `award_winners r_aw JOIN awards r_a ON r_a.id = r_aw.award_id` | `r_aw.player_id = p.id` | many |
| `player.link_candidates` | `player_link_match_candidates` | `player_link_match_candidates r_plmc` | `r_plmc.player_id = p.id` | many |

**Subject `club` (anchor alias `cl`):**

| key | `targetTable` | `subqueryFrom` | `correlation` | card |
|---|---|---|---|---|
| `club.club_seasons` | `club_seasons` | `club_seasons r_cs` | `r_cs.club_id = cl.id` | many |
| `club.matches` | `matches` | `matches r_m` | `(r_m.home_club_id = cl.id OR r_m.away_club_id = cl.id)` | many |

**Subject `match` (anchor alias `m`):**

| key | `targetTable` | `subqueryFrom` | `correlation` | card |
|---|---|---|---|---|
| `match.player_stats` | `player_match_stats` | `player_match_stats r_pms JOIN players r_p ON r_p.id = r_pms.player_id JOIN clubs r_cl ON r_cl.id = r_pms.club_id` | `r_pms.match_id = m.id` | many |
| `match.clubs` | `clubs` | `clubs r_cl` | `r_cl.id IN (m.home_club_id, m.away_club_id)` | many (exactly 2) |

### 5.6 Curated relational-predicate columns

Some QA questions need a comparison *between* the related row and the anchor row,
which column/operator/value cannot express as a value. Handle these as fixed
`boolean` columns in the relationship's own catalogue — no new machinery, because the
anchor alias is already in scope inside the subquery:

- `match.player_stats` → `club_is_participant`, label *"Club is one of the two
  competing clubs"*, `column: '(r_pms.club_id IN (m.home_club_id, m.away_club_id))'`,
  `kind: 'boolean'`.
  → *"matches containing a player row whose club is neither participating club"* =
  anchor Matches · card `match.player_stats` · quantifier **any** · condition
  `Club is one of the two competing clubs` **is false**.

Add curated predicate columns only where a real QA question needs one. Each is a
reviewed catalogue constant, never composed from user input.

### 5.7 Historical club identity

Every club-touching relationship correlates on `club_id` — the season-correct
historical identity. **No relationship uses `clubs.organization_id`** in V1.
`player_clubs` is already documented as "historical club identities represented by
each player" and is correct as-is. A lineage-combining relationship, if ever wanted,
must be a separate explicitly-keyed relationship, never an implicit widening.

### 5.8 The application layer is the authority

A foreign key in the schema is **not** a licence to traverse. Only the twelve
relationships above may be composed in V1. No user-chosen join key, no user-chosen
path, no discovery.

### 5.9 Self-equivalent domains — settled

An anchor can represent the same logical row as a relationship reachable through one
of its subjects. Under the `player_career_stats` anchor, `player.career` targets the
very same 1:1 record, so the UI would otherwise offer both *"This Player career stats
row"* and *"related Player career"*.

**Deterministic rule.** Add `AnchorDef.grainTable` (the relation whose row is
returned) and `AnchorDef.grainSubject: SubjectKey | null` (the subject that uniquely
identifies that row, `null` when no single subject does). A relationship is
**self-equivalent to the anchor** iff all three hold:

```
rel.targetTable === anchor.grainTable
&& rel.cardinality === 'one'
&& rel.subject     === anchor.grainSubject
```

| anchor | `grainTable` | `grainSubject` |
|---|---|---|
| `players` | `players` | `player` |
| `player_career_stats` | `player_career_stats` | `player` |
| `clubs` | `clubs` | `club` |
| `matches` | `matches` | `match` |
| `player_match_stats` | `player_match_stats` | **`null`** — a PMS row is keyed by (player, match); no single subject identifies it |

In V1 this fires on **exactly one pair**: `player_career_stats` × `player.career`.

It deliberately does **not** fire on `player_match_stats` × `player.match_stats`
(cardinality `many`), so under the PMS anchor *"this player had some game with 8+
goals"* stays available and genuinely differs from the anchor row. The rule never
suppresses a relationship merely for touching the same physical table.

**Decision: reject, do not merely hide.** `relationshipsForAnchor(anchor)` applies the
predicate and is the single source used by **both** the UI option list **and**
`parseQueryState`'s reachability check. A hand-crafted URL naming a self-equivalent
domain is therefore rejected as unreachable (`parseQueryState` → `null`) by the same
code path that hides it, with no special case anywhere. Asserted by T-B8 and T-C12.

---

## 6. Decision 4 — SQL compilation semantics

### 6.1 Every card compiles to one scalar boolean on the anchor row

- **Anchor-domain card** → the existing predicate, through the **unchanged**
  `compileCard` path.
- **Related-domain card, quantifier `any`** →
  `EXISTS (SELECT 1 FROM <subqueryFrom> WHERE <correlation> AND <cardPredicate>)`
- **Related-domain card, quantifier `none`** → the same with `NOT EXISTS`.

This is the load-bearing property of the design: because every card is a boolean on
the anchor row, mixing domains changes nothing about the fold, the FROM clause, the
row count or the total.

The idiom already exists here — `src/db/queries/advanced-search.ts:49-55` builds a
correlated `EXISTS` over `player_clubs` bound to `p.id` with `sql` fragments. Reuse
that construction.

### 6.2 Empty / half-built cards

| card | conditions compile to nothing | meaning |
|---|---|---|
| anchor domain | — | **filters nothing** (today's rule, unchanged) |
| related, `any` | — | `EXISTS (relation)` — "has at least one related row" |
| related, `none` | — | `NOT EXISTS (relation)` — "has no related row at all" |

The related-domain rule deliberately drops the "half-built card filters nothing"
convenience: a related card with no conditions is a *complete and meaningful*
question, and it is the one the motivating QA cases need. The UI cannot produce a
half-built condition — `QueryBuilderForm.add()` already refuses a blank value — so
only a hand-crafted URL reaches the degenerate case, where behaviour is still
deterministic and documented.

### 6.3 One-to-one relationships

`player.career` is 1:1 (`player_career_stats.player_id` is the PRIMARY KEY). It
compiles as `EXISTS` like everything else. **Do not special-case it as a join.** One
rule for all cardinalities is the point; for 1:1 the semantics are identical and
immunity to multiplication is free.

### 6.4 Many-to-many / intermediate paths

A relationship may contain fixed inner joins inside `subqueryFrom` (`player.clubs`
traverses `player_clubs → clubs`; `player.awards` traverses `award_winners → awards`).
Relationship depth is **exactly one hop per card**; chaining is not representable in
the state model. `QB_LIMITS.maxRelationshipDepth = 1` is declared and asserted (T-B7).

### 6.5 OR across cards from different domains

Works with no special handling and no ambiguity, because both operands are scalar
booleans on the same anchor row:

```
Player card  AND  Career card  OR  Match Stats card
```
compiles to
```sql
((<playerPred>) AND EXISTS (career…)) OR EXISTS (pms…)
```
— the identical left fold as today, with `EXISTS` in the operand position.

### 6.6 Duplicate suppression / DISTINCT

**No `DISTINCT` is required, and none may be added.** Record this as a code comment:
the compiler never adds a relation to the anchor's FROM, so the row set is exactly
the anchor relation's rows and multiplication is impossible. (The `matches` anchor's
two `clubs` joins are 1:1 on the PK and already yield one row per match today.) A
`DISTINCT` appearing in this compiler in future is evidence that the
column-ownership invariant (§3) was broken.

### 6.7 Aggregation

None. V1 emits no aggregate over a related relation and no matched-row count. Counts
would introduce aggregation semantics and extra per-row cost, and their meaning
becomes unclear under OR composition. Deferred (§13).

### 6.8 NULL semantics

- Missing-relation questions are **always** `NOT EXISTS`. Never a nullable
  `LEFT JOIN … IS NULL` — the three-valued trap this design exists to avoid.
- Inside a subquery a condition on a NULL column is UNKNOWN, so the row does not
  qualify: `EXISTS` false, `NOT EXISTS` true. So *"no related row with goals ≥ 5"*
  **includes** players whose `goals` is NULL. This is the "not recorded ≠ zero" hazard
  from `CLAUDE.md` §11. The `is null` / `is not null` operators already exist for
  asking precisely; state the rule in the UI hint and in `docs/search.md`.

### 6.9 ALL/ANY inside one card

The existing `CardSpec.match` applies to conditions **within one related row**.
Crossed with the card quantifier, four well-defined readings:

| quantifier | match | meaning |
|---|---|---|
| any | AND | some related row satisfies A **and** B |
| any | OR | some related row satisfies A **or** B |
| none | AND | no related row satisfies A **and** B |
| none | OR | no related row satisfies A **or** B |

### 6.10 Two cards over the same relation

Fully supported, and semantically distinct from one card with two conditions — each
card is an independent subquery scope, so aliases cannot collide:

- one card, `any`, `goals ≥ 8 AND brownlow_votes = 3` → **one game** with both;
- two cards, `EXISTS(goals ≥ 8) AND EXISTS(brownlow_votes = 3)` → possibly **different
  games**.

Surface this in the UI hint; it is a feature, not an accident.

---

## 7. Decision 5 — cross-card AND/OR semantics

**Unchanged.** The left fold `((A op B) op C)` with the accumulator parenthesised at
every step is preserved exactly, including the regression it exists for
(`tests/integration/query-builder.test.ts:75-108`). Precedence is positional, as
today; no new grouping construct, no new nesting level.

Because a pre-115 token carries no `domain`/`quantifier`, every card in it is an
anchor-domain card and compiles through the untouched path — **existing single-domain
queries emit byte-identical SQL** (T-B1, T-C0).

The existing UI does not express arbitrary precedence and this plan does not add it.
That is a deliberate carry-over of the documented two-level design, not a new
limitation, and no smallest-safe-fix is owed.

---

## 8. Decision 6 — negative / existence QA

All four relational predicates are in V1, from the (quantifier × conditions) matrix of
§6.2 and §6.9:

| question | how |
|---|---|
| has related row | related card, `any`, no conditions |
| has no related row | related card, `none`, no conditions |
| related rows satisfy condition | related card, `any`, conditions |
| no related rows satisfy condition | related card, `none`, conditions |

`NOT EXISTS` is the only permitted compilation of "missing relation". A nullable
inner/outer join standing in for absence is prohibited by §6.8 and asserted by T-C4.

### 8.1 Motivating questions — honest coverage matrix

| # | question | V1 |
|---|---|---|
| 1 | players with 100+ career games but no player-match rows | ✅ Players · `player.career` any `games ≥ 100` · `player.match_stats` **none** |
| 2 | players with **no career row, or zero career games**, that nevertheless have match statistics | ✅ Players · `player.career` **none** (or any `games = 0`) · `player.match_stats` any. **Scope note:** this proves a career-vs-match-history contradiction. It does **not** prove anything about *link status* — no V1 relationship or predicate establishes that a player-link record is unlinked, and none is invented to preserve older wording. Link-candidate coverage is row #5 only. |
| 3 | players with a draft record but no senior VFL/AFL games | ✅ Players · `player.draft_picks` any · `player.match_stats` **none** |
| 4 | Hall of Fame entries whose linked player has no VFL/AFL career | ⚠️ **partial** — ✅ in the *linked-player* reading (Players · `player.hall_of_fame` any · `player.career` none). HoF rows with `player_id IS NULL` are invisible from a player anchor; that reading needs a `hall_of_fame` anchor (deferred, §13.1) |
| 5 | player-link records marked unmatched with a plausible matching player | ⚠️ **partial** — ✅ from the player side (Players · `player.link_candidates` any `band = high`: *"this player is a plausible candidate for some unlinked honours row"*). The row-side reading (*"which unmatched rows have a candidate"*) cannot return the unresolved source row itself from a player anchor; it needs an honours-row anchor (deferred, §13.1) |
| 6 | players whose career club identity disagrees with their match history | ⚠️ **partial** — `player_clubs` is *derived from* `player_match_stats`, so those two cannot disagree by construction. The expressible disagreement is against an independently sourced club: Players · `player.clubs` any `Club = X` · `player.awards`/`player.captaincies` any `Club ≠ X` |
| 7 | matches with a player row whose club is neither participating club | ✅ Matches · `match.player_stats` any · `club_is_participant` **is false** (§5.6) |
| 8 | clubs with matches in a season but no club-season record | ⚠️ **partial by design** — ✅ per fixed season (Clubs · `club.matches` any `season = 1995` · `club.club_seasons` **none** `season = 1995`). The "some season, that same season" form is not expressible; see §8.2 |
| — | e.g. players with a bag-of-8 game and a separate 3-vote game | ✅ §6.10 |

Do not disguise the ⚠️ rows. They are stated in `docs/search.md` and in the UI hint.

### 8.2 Card-independence invariant (operator-approved boundary)

> **Anchor = the returned row. Card = a self-contained boolean predicate on that
> anchor row. Cross-card AND/OR combines booleans, never related rows.**

Cards correlate with the **anchor** and never with each other. Fixed-value correlation
across cards is supported (*matches in 1995* AND *no club-season in 1995*);
existential same-row / same-season correlation across cards is not.

Generic cross-card correlation is deferred capability. **Do not design or implement it
under ISSUE-115** unless later investigation shows it can be added without introducing
shared-variable or grouping semantics.

---

## 9. Decision 7 — performance and safety

### 9.1 Limits

Every existing limit is retained unchanged. Additions:

```ts
QB_LIMITS = {
  maxCards: 6,                  // unchanged
  maxConditionsPerCard: 8,      // unchanged
  defaultPageSize: 50,          // unchanged
  maxPage: 50,                  // unchanged
  maxStateChars: 8_192,         // unchanged
  maxRelatedCards: 4,           // NEW — at most 4 of the 6 cards may be related-domain
  maxRelationshipDepth: 1,      // NEW — structural; no chaining is representable
}
```

`maxRelatedCards = 4` is **provisional and evidence-gated** by Stage 5 (§9.3). If
evidence shows four concurrent related cards over `player_match_stats` cannot meet the
acceptance target, **reduce the limit** — never raise the timeout. No existing limit
may be weakened for any reason.

### 9.2 Parameter binding and injection boundary

Unchanged and re-asserted:

- `sql.unsafe` is applied only to `AnchorDef.from`, `AnchorDef.defaultSort`,
  `ColumnDef.column`, `RelationshipDef.subqueryFrom`, `RelationshipDef.correlation`
  and the operator token already validated against `OPERATORS_BY_KIND`.
- Every user value remains a bound parameter, inside subqueries as much as outside.
- Parameter budget stays structurally bounded: 6 × 8 × 2 = 96.
- The compiler still runs as `afldb_app`, so an unlisted table is unreadable **by
  database grant**, not only by allowlist. Every V1 relationship target was verified
  app-readable during planning; a future relationship whose target is unregistered
  fails closed at the database.

### 9.3 Query cost contract — two distinct obligations

`AFLDB_STATEMENT_TIMEOUT_MS` default is 5000 (`src/db/client.ts:22`). Separate the two
obligations and do not conflate them:

**A. Permanent correctness/safety ceiling (5 s).** Every query the tool can build must
complete inside the normal 5-second application statement timeout. This is fail-closed
and non-negotiable. **The timeout is never raised** — not for a test, not for a
relationship, not temporarily.

**B. Implementation acceptance target (< 1 s), with evidence.** Each V1 relationship,
in both `EXISTS` and `NOT EXISTS` form, must measure comfortably **under 1 second**
against `afldb_test`, and `EXPLAIN (ANALYZE, BUFFERS)` must be captured for the
expensive shapes — every relationship over `player_match_stats` (685,471 rows) at
minimum. Measured values are recorded in the issue's Validation section.

**Permanent regression assertion.** §2.9 established a stable in-repository precedent
for hard timing gates (`performance.now()` delta + `toBeLessThan`, with a descriptive
message, at `tests/integration/grid-solver.test.ts:110-116` and `:392-395`). T-C11
therefore **reuses that exact shape** at a per-relationship bound of 1000 ms for a
single compiled query, matching `grid-solver.test.ts:395`. If a relationship measures
close to that bound in practice, widen the bound **for that case only**, toward but
never at or above the 5 s statement timeout, and record the measured value — do not
delete the gate and do not raise the timeout.

**Decision procedure.**

```
normal EXISTS / NOT EXISTS shape passes comfortably
    -> keep it
ISSUE-103-style pathological plan appears
   (Nested Loop Semi/Anti Join over Materialize, large row misestimate)
    -> evidence-gated scalar-array InitPlan (p.id = ANY (ARRAY(...)))
       for that relationship only; re-measure
still cannot satisfy acceptable performance
    -> exclude that relationship from V1 and record the evidence
```

The InitPlan form is never the default and is never applied without EXPLAIN evidence
of the pathology.

### 9.4 Indexes

**No index is proposed by this plan and none is pre-authorised.** Correlation columns
were surveyed only to inform the Stage 5 gate, not to justify a change:
`player_career_stats.player_id` PK · `ix_pms_player` / `ix_pms_match` / `ix_pms_club` ·
`player_clubs` PK `(player_id, club_id)` · `ix_club_seasons_club` · `ix_hof_player`
(partial, `player_id IS NOT NULL`) · `ix_draft_player` and `ix_captaincies_player`
(**partial**, restricted to `link_status_value IN ('unique','resolved')` — flag for
Stage 5). Any index requires real query-plan evidence and separate scope.

### 9.5 Schema

No schema change, no migration, no privilege change is authorised. If implementation
appears to need one, that is a **stop condition** (§18).

---

## 10. Decision 8 — UI/UX

### 10.1 Shape

```
Results are:  [ Players ▾ ]

┌ Card 1 ───────────────────────────────────────────────┐
│ Filter on: [ This player ▾ ]                           │
│ Debut season between 1960 and 1969   ×                 │
│ [Column ▾] [Operator ▾] [Value] [Add condition]        │
└────────────────────────────────────────────────────────┘
      [AND ▾]
┌ Card 2 — has no matching row ─────────────────────────┐
│ Filter on: [ Player match stats ▾ ]                    │
│ ⓘ Matches this player appeared in.                     │
│ This card matches when: [ there is no such row ▾ ]     │
│ [Column ▾] [Operator ▾] [Value] [Add condition]        │
└────────────────────────────────────────────────────────┘
[+ Add card]      [Search] [Reset]
```

### 10.2 Behaviour

- **Result grain** is chosen once at the top. The existing `Table` select is
  relabelled *"Results are"*; the control itself is unchanged.
- **Each card** gets a `Filter on` select. Options = the anchor's own domain
  (`<optgroup label="This row">`) + `relationshipsForAnchor(anchor)`
  (`<optgroup label="Related">`), which already excludes self-equivalent domains
  (§5.9). Anything outside that set cannot be built in the UI, and `parseQueryState`
  rejects one arriving by URL — same helper, so the two cannot drift.
- **Quantifier select** appears only for a related domain, phrased in English:
  *"there is at least one such row"* / *"there is no such row"*. No SQL jargon anywhere
  in the UI.
- **Relationship explanation**: `RelationshipDef.hint` renders as one line under the
  domain select ("Matches this player appeared in", "Seasons this club has a ladder
  record for").
- **Card legend** renders the sentence, e.g. `Card 2 — has no matching Player match
  stats row`, from a shared `describeCard()` in the spec module so the page and the
  form phrase it identically.
- **Changing the result grain resets the query** to `emptyState(newAnchor)` — today's
  exact behaviour (`changeTable`). Rejected alternative in §17. The *"Results are"*
  label makes the control read as "start a new question".
- **Changing a card's domain** clears that card's conditions **and** resets the `Card`
  component's local `column` / `op` / `value` state — the same reset `pickColumn`
  already performs, extended to the domain change. Missing this is the obvious defect
  to guard against; covered by T-D1.

### 10.3 Scope guard

This stays a Data QA tool. No raw SQL, no user-selected join keys, no arbitrary
relationship paths, no visual database designer, no relationship editor.

---

## 11. Decision 9 — backwards compatibility

**Existing behaviour is a strict subset of the new model.**

- A pre-115 `q` token has no `domain` and no `quantifier` on any card ⇒ every card is
  an anchor-domain card ⇒ the compiler takes the untouched path ⇒ identical SQL,
  identical rows, identical total.
- `QueryBuilderState.table` keeps its name and meaning as the anchor key, so pre-115
  tokens parse unchanged. **No version field, no token migration.**
- Persistence audit (§2.6) found no stored state anywhere: no server action, no API
  payload, no database table, no saved queries. **No migration work exists.**
- `tests/admin-nav/admin-nav.spec.ts:34` uses no `q` parameter and is unaffected.
- All four existing integration cases stay in place, unmodified, as the no-regression
  proof (T-C0).

---

## 12. Decision 10 — testing strategy

Extend the two existing suites. **No new test file** — both are the correct semantic
homes per `CLAUDE.md` §10.

### 12.1 `tests/query-builder-spec.test.ts` (DB-free)

| id | test |
|---|---|
| T-A1 | every anchor's `from` contains the canonical alias for each subject it declares (`player→p`, `club→cl`, `match→m`) |
| T-A2 | every `subqueryFrom` uses only `r_`-prefixed aliases; none collides with `{p,c,cl,m,hc,ac,pms}` |
| T-A3 | every `RelationshipDef.correlation` references its subject's canonical alias, and otherwise only `r_` aliases |
| T-A4 | every relationship's `columns` are qualified with aliases its own `subqueryFrom` declares |
| T-B1 | a **literal pre-115 token** (a captured string constant, not regenerated) parses to a state whose cards all carry no `domain`/`quantifier` |
| T-B2 | round-trip of a multi-domain state; `domain` omitted when it equals the anchor, `quantifier` omitted when `'any'` |
| T-B3 | unknown domain → `null` |
| T-B4 | domain not reachable from the anchor's subjects → `null` (e.g. `club.club_seasons` under the `players` anchor) |
| T-B5 | quantifier outside the enum → `null` |
| T-B6 | `maxCards`, `maxConditionsPerCard`, `maxRelatedCards` each rejected one over |
| T-B7 | `maxRelationshipDepth === 1`, and no relationship names another relationship |
| T-B8 | **self-equivalence (§5.9)**: `player.career` is absent from `relationshipsForAnchor('player_career_stats')` and a token naming it under that anchor → `null`; it **is** present for `players`; `player.match_stats` **is** present for `player_match_stats` |
| T-D1 | pure state transitions: changing the anchor resets to `emptyState`; changing a card's domain clears that card's conditions |

T-D1 requires extracting the form's state transitions (`changeAnchor`,
`setCardDomain`) as **pure functions in the spec module**, which the Client Component
then calls. This is deliberate: real UI-state coverage without creating a new React
test home, and reuse rather than new infrastructure.

### 12.2 `tests/integration/query-builder.test.ts` (DB-backed, `afldb_test`)

| id | test |
|---|---|
| T-C0 | **the four existing cases, unmodified** — 110-player regression, card ALL/OR, two-card OR, three-card left fold |
| T-C1 | two-domain AND vs an independent hand-written SQL count |
| T-C2 | two-domain OR vs an independent hand-written SQL count |
| T-C3 | three-domain composition (Players + career + match stats) vs an independent count |
| T-C4 | `NOT EXISTS`: "career games ≥ 100 and no `player_match_stats` row" equals an independent `NOT EXISTS` oracle, **and** is a strict subset of the `games ≥ 100` set |
| T-C5 | one-to-many produces **no duplicate anchor rows**: `result.total` equals both `count(*)` and `count(DISTINCT p.id)` of the oracle |
| T-C6 | an unreachable anchor/domain pair **fails closed** at `runQueryBuilder` (throws), independently of the parse-level rejection in T-B4 |
| T-C7 | a column belonging to another domain inside a card is rejected (extends the existing `password_hash` case to the related-card path) |
| T-C8 | LIKE-wildcard escaping still holds **inside** a subquery (extends the existing `%` case) |
| T-C9 | anchor correctness: for the same card set, the Players anchor and the Player-career-stats anchor return their own grains and their own `columns` |
| T-C10 | `club_is_participant is false` under the Matches anchor equals an independent oracle |
| T-C11 | **cost gate (§9.3)**: each V1 relationship, in both `EXISTS` and `NOT EXISTS` form, measured with the `performance.now()` + `toBeLessThan` shape precedented at `grid-solver.test.ts:392-395`, bound 1000 ms per single compiled query, at the normal `AFLDB_STATEMENT_TIMEOUT_MS=5000` |
| T-C12 | a self-equivalent domain (`player.career` under the `player_career_stats` anchor) **fails closed** at `runQueryBuilder` as well as at parse |

Deterministic fixtures are not needed: every DB-backed case is proved against an
independently written SQL oracle over the same `afldb_test` snapshot, which is the
pattern the four existing cases already use.

---

## 13. Deferred capability — recorded, not authorised

**None is in ISSUE-115 scope. None may be absorbed into an implementation stage.**
Record any of these in `issues.md` only if and when it independently meets the normal
issue criteria.

1. Additional result anchors (`hall_of_fame`, `draft_picks`, `award_winners`,
   `captaincies`, `honour_team_members`, `draft_persons`) — unlocks the row-side
   readings of motivating questions 4 and 5.
2. Generic cross-card shared-variable correlation — §8.2. Only if it can be added
   without shared-variable/grouping semantics.
3. Related matched-row counts or aggregates as explicit display features — §6.7.
4. `player_season_stats` and `player_achievements` as related domains — unless
   separately authorised.
5. Organization-lineage traversal as separately keyed relationships — §5.7.
6. Arbitrary related display columns — §3.

---

## 14. Implementation stages, in dependency order

Each stage ends at a safe, committable milestone.

**Stage 0 — tracking.**
1. Create `D:\dev\afldb-issue-115\AFLDB-ISSUE-115.md` from **this complete document —
   every section, §1 through §19 — not a subset**. The repository runbook must carry
   the invariants (§16), rejected approaches (§17), risks and stop conditions (§18),
   validation commands (§15) and handoff (§19).
2. Read `IssuesIndex.md` **once**. Confirm `AFLDB-ISSUE-115` is not already
   represented and that the id has not collided on this branch. **A genuine id
   collision is a stop condition (§18)** — report it, do not silently renumber.
3. Add the `AFLDB-ISSUE-115` entry to `issues.md` and its row to the Open Issues table
   and `IssuesIndex.md`.
4. **Compute and write the actual current open-issue count** from the file as it
   stands. Do not carry forward any count quoted in planning; branch state may have
   moved.

*Files:* `AFLDB-ISSUE-115.md` (new), `issues.md`, `IssuesIndex.md`. No `CHANGELOG.md`
entry — nothing has shipped.

**Stage 1 — spec model (DB-free).** In `src/search/query-builder-spec.ts`: add
`SubjectKey`; `AnchorDef` (existing `QUERYABLE_TABLES` entries carried over
byte-identical, plus `subjects`, `grainTable`, `grainSubject`); `RelationshipDef`; the
`RELATIONSHIPS` catalogue of §5.5–§5.6; `relationshipsForAnchor()` including the §5.9
self-equivalence filter; `domainColumns()`; the extended `CardSpec`; the new
`QB_LIMITS` fields; extended `validateState` (T-B3/B4/B5/B6/B8); `describeCard()`; and
the pure state transitions for T-D1.
*Verify:* T-A1–A4, T-B1–B8, T-D1.

**Stage 2 — compiler.** In `src/db/queries/query-builder.ts`: `compileCondition`
resolves columns against the **card's domain**; new `compileRelatedCard()` emitting
`EXISTS` / `NOT EXISTS` per §6.1–§6.2, using the `advanced-search.ts:49-55` idiom;
`compileCards` unchanged apart from dispatching on `card.domain`. Assert the
anchor/related dispatch so a pre-115 card provably takes the old path. Record §6.6 (no
DISTINCT) as a code comment.
*Verify:* T-C0 must be green before anything else proceeds.

**Stage 3 — semantic proof.** Add T-C1–T-C10 and T-C12 to
`tests/integration/query-builder.test.ts`. Do not proceed until every one passes
against an independent SQL oracle.

**Stage 4 — UI.** `QueryBuilderForm.tsx`: relabel the anchor select; add the per-card
domain select (grouped optgroups, sourced from `relationshipsForAnchor`), the
quantifier select, the hint line, the card legend sentence, and the domain-change
reset (§10.2). `page.tsx`: subtitle wording; the results header continues to read the
**anchor's** `columns`.
*Verify:* T-D1, then `npx tsc --noEmit`.

**Stage 5 — performance gate.** T-C11 plus captured `EXPLAIN (ANALYZE, BUFFERS)` for
the expensive shapes (every relationship over `player_match_stats` at minimum). Apply
§9.3's two-obligation contract and decision procedure. Settle `maxRelatedCards` and
any relationship exclusion from the measured evidence, and record the measured values.

**Stage 6 — focused regression.** `tests/query-builder-spec.test.ts` and
`tests/integration/query-builder.test.ts` in full, then a typecheck.

**Stage 7 — documentation.** Rewrite `docs/search.md` §6 (lines 131-167) for the
anchor/domain/relationship model, the §8.1 coverage matrix including the ⚠️ rows, the
§8.2 card-independence boundary, the §6.8 NULL rule, and the new limits.
*Pre-existing doc drift to correct while there:* §6 says the tool is "not linked from
the admin nav", but `src/app/admin/nav-model.ts:82` links it. Fix that sentence only;
do not expand into unrelated doc work.

**Stage 8 — close-out.** Add the `CHANGELOG.md` `Unreleased` entry **now, because
behaviour ships at this point and not before**. Update the `AFLDB-ISSUE-115` entry
with actual root cause, fix and validation (including the Stage 5 measured values);
remove its `IssuesIndex.md` row and Open Issues entry, and re-synchronise the
open-issue count from the file as it then stands.

### Files expected to change

```
AFLDB-ISSUE-115.md                                (new — Stage 0)
issues.md                                         (Stages 0, 8)
IssuesIndex.md                                    (Stages 0, 8)
src/search/query-builder-spec.ts                  (Stage 1 — the bulk of the work)
src/db/queries/query-builder.ts                   (Stage 2)
tests/query-builder-spec.test.ts                  (Stage 1)
tests/integration/query-builder.test.ts           (Stages 3, 5)
src/app/admin/query-builder/QueryBuilderForm.tsx  (Stage 4)
src/app/admin/query-builder/page.tsx              (Stage 4 — minimal)
docs/search.md                                    (Stage 7)
CHANGELOG.md                                      (Stage 8)
```

No migration. No privilege change. No index. No file outside this list.

---

## 15. Validation — commands for the operator

Run in worktree `D:\dev\afldb-issue-115`. Smallest test that proves each stage; do not
run the full suite while iterating.

```bash
# Stage 1 — spec model, DB-free
npm test -- tests/query-builder-spec.test.ts

# Stage 2 — no regression in the existing four cases, before adding anything
npm test -- tests/integration/query-builder.test.ts -t "reproduces the"
npm test -- tests/integration/query-builder.test.ts -t "folds three cards"

# Stage 3 — full DB-backed semantics
npm test -- tests/integration/query-builder.test.ts

# Stage 4 — typecheck (compare against the known unrelated baseline)
npx tsc --noEmit

# Stage 5 — cost gate at the NORMAL timeout; never raise it
AFLDB_STATEMENT_TIMEOUT_MS=5000 npm test -- tests/integration/query-builder.test.ts -t "cost"

# Stage 6 — focused regression, both suites
npm test -- tests/query-builder-spec.test.ts tests/integration/query-builder.test.ts

# Stage 4 only, and only if the admin nav route is touched
npm test -- tests/admin-nav/admin-nav.spec.ts
```

Integration tests require `AFLDB_TEST_DATABASE_URL` pointing at a database whose name
ends in `_test`. No state-changing database command is needed at any stage.

---

## 16. Invariants (assert in code and test; never silently relax)

1. **Anchor = returned row.** One output row per anchor row, always.
2. **Card = self-contained boolean on the anchor row.** Cross-card AND/OR combines
   booleans, never related rows. Cards share no row-level variables.
3. **The FROM clause is the anchor's fixed fragment and nothing else.**
4. **No `DISTINCT`.** Its appearance means invariant 3 was broken.
5. **Absence is `NOT EXISTS`.** Never a nullable outer join.
6. **No aggregation and no matched-row counts** in V1.
7. `sql.unsafe` sees only catalogue constants and pre-validated operator tokens. Every
   user value is a bound parameter, inside subqueries as much as outside.
8. Subquery aliases are `r_`-prefixed and disjoint from `{p, c, cl, m, hc, ac, pms}`.
9. Subject aliases are canonical: `player→p`, `club→cl`, `match→m`.
10. Relationship depth is exactly 1. No chaining is representable.
11. A self-equivalent anchor/relationship pair (§5.9) is unreachable — rejected at
    parse **and** at compile, from one shared helper.
12. A pre-115 URL token compiles to byte-identical SQL.
13. No existing limit is weakened; `AFLDB_STATEMENT_TIMEOUT_MS` is never raised.
14. Club correlation is on `club_id` (historical identity), never `organization_id`.
15. Only the curated catalogue may be traversed; never schema FKs or
    `information_schema`.

---

## 17. Rejected approaches, and why

*(Single authoritative list.)*

| rejected | why |
|---|---|
| Move the table selector into each card and JOIN the tables | The actual defect. Joining two one-to-many relations multiplies anchor rows and silently changes the logical meaning of every count and every OR. |
| `LEFT JOIN … WHERE related.id IS NULL` for "missing relation" | Three-valued-logic trap, and it multiplies rows before filtering. `NOT EXISTS` is exact and null-safe. |
| `SELECT DISTINCT` to paper over multiplication | Hides the bug instead of preventing it, breaks `count(*) OVER ()`, and costs a sort. Unnecessary once invariant 3 holds. |
| Special-casing 1:1 relationships as joins | Two compilation rules to reason about, for no semantic gain. `EXISTS` is identical for 1:1 and free of multiplication risk. |
| Deriving the relationship graph from `information_schema` / schema FKs | The security model is an allowlist precisely so nothing unlisted can leak. A schema FK is not a licence to traverse; the application layer stays the authority. |
| User-chosen join keys, arbitrary paths, raw SQL, a relationship editor, a visual database designer | Out of scope by instruction; would turn a QA tool into a SQL designer. |
| Relationships declared per (anchor × domain) pair | Combinatorial. The subject indirection gives `player_career_stats` every player-side relationship for free. |
| Placeholder-substitution machinery for correlation predicates | Unnecessary: the existing `from` fragments already use stable canonical aliases, so correlations are plain constants. |
| Suppressing every relationship that touches the anchor's physical table | Too blunt — it would remove `player.match_stats` under the `player_match_stats` anchor, which is a genuinely different question. §5.9's three-part rule is the minimum correct test. |
| Merely *hiding* a self-equivalent domain in the UI | Leaves a hand-crafted URL reaching an ambiguous shape. Rejecting it in the shared reachability helper costs nothing extra and cannot drift from the UI. |
| Related columns or matched-row counts in the SELECT list | No deterministic single value exists for a one-to-many `EXISTS`; it needs aggregation or an arbitrary LATERAL pick. Operator-rejected for V1. |
| Adding honours-row anchors in V1 | Operator-rejected: keep V1 to the five grains the tool already renders. Deferred (§13.1). |
| Cross-card shared correlation variables | Operator-rejected: introduces shared-variable and grouping semantics. Deferred (§13.2). |
| Keeping cards whose domain remains reachable when the anchor changes | Ambiguous when a domain is reachable via a different subject, and a half-kept QA query is a correctness hazard. Full reset (today's behaviour) is retained. |
| A `version` field in the URL token | Unneeded — absent `domain`/`quantifier` *is* the pre-115 shape, and it round-trips. |
| Raising `AFLDB_STATEMENT_TIMEOUT_MS` if a plan is slow | Weakens an existing safety boundary. ISSUE-103's remedy was a better query shape; §9.3 follows it. |
| Adding indexes | No plan evidence exists. Any index needs its own issue and real `EXPLAIN` evidence. |
| Inventing a link-status capability to keep the old "unlinked" wording in motivating example 2 | No V1 relationship establishes link status. The example was corrected instead (§8.1 row 2). |

---

## 18. Risks and stop conditions

*(Single authoritative list.)*

### Risks

| risk | mitigation |
|---|---|
| `EXISTS`/`NOT EXISTS` over 685k `player_match_stats` rows hits the 5 s ceiling — the ISSUE-103 pathology, reintroduced deliberately | Stage 5 EXPLAIN gate (§9.3); the evidence-gated InitPlan remedy; exclusion as last resort |
| Partial indexes (`ix_draft_player`, `ix_captaincies_player`) cover only `link_status_value IN ('unique','resolved')`, so `NOT EXISTS` may seq-scan | Explicitly flagged for Stage 5; excluded from V1 if it cannot meet the acceptance target |
| A hard wall-clock test proves flaky | Mitigated by reusing the established precedent shape (§2.9) and by §9.3's rule for widening a single case's bound below 5 s while recording the measurement — never by deleting the gate or raising the timeout |
| Silent behaviour change to an existing single-domain query | T-C0 unmodified + T-B1 literal pre-115 token + the untouched anchor code path |
| A related card's degenerate half-built form is stricter than intended | UI cannot produce it (`add()` refuses blank values); documented and deterministic (§6.2) |
| Domain change leaving stale local `column`/`op` state in a card | T-D1, and the pure-transition extraction that makes it testable |
| "not recorded ≠ zero" misreadings under `NOT EXISTS` | §6.8 documented in the UI hint and `docs/search.md`; `is null`/`is not null` remain available |

### Stop conditions — halt and report, do not work around

1. Implementation appears to require a schema change, a migration, or a privilege
   change (§9.5).
2. A relationship target turns out not to be readable by `afldb_app`.
3. Any T-C0 case changes result, or a pre-115 token stops round-tripping.
4. Meeting the cost contract appears to need a raised statement timeout or a new index.
5. The design appears to need `DISTINCT`, an aggregate, or a related relation in the
   anchor's FROM (invariants 3, 4, 6 broken).
6. Work starts drifting toward any §13 deferred capability.
7. `AFLDB-ISSUE-115` turns out to be genuinely already allocated on this branch
   (Stage 0 collision) — report rather than renumbering.
8. An unrelated defect is found: record it as its own issue if it meets the criteria,
   then return to ISSUE-115.
9. Repository evidence materially contradicts an approved architectural decision in
   §3–§10 — stop and report; do not improvise a redesign.

---

## 19. Handoff

**Issue:** `AFLDB-ISSUE-115` — Data QA multi-domain composable queries
**Status:** Approved plan / not implemented
**Worktree:** `D:\dev\afldb-issue-115` · **Branch:** `claude/issue-115` · **Baseline:** `aa034b5`
**Implementation session:** **Fable / High effort / Normal mode**
**Authoritative carry-over:** this complete document —
`C:\Users\stuar\.claude\plans\you-are-planning-afldb-issue-115-humble-sonnet.md`
(Stage 0 copies it, in full, to `D:\dev\afldb-issue-115\AFLDB-ISSUE-115.md`)

**Objective.** Redesign the Data QA query builder so cards from different domains
compose in one query. The root owns an anchor (one of the five existing grains) that
alone determines the returned row and result columns; each card owns its filter domain
and compiles to one self-contained boolean on that anchor row — anchor-domain cards
through the untouched existing path, related-domain cards as correlated
`EXISTS`/`NOT EXISTS` over a curated relationship catalogue reached by subject. Every
existing safety wall, limit, AND/OR semantic and URL token is preserved unchanged.

**First action.** Stage 0 — persist the complete approved runbook as
`D:\dev\afldb-issue-115\AFLDB-ISSUE-115.md` if it does not already exist, then
synchronise `AFLDB-ISSUE-115` into `issues.md` and `IssuesIndex.md` using the **actual
current** open-issue count read from the file.

**Implementation begins.** Stage 1, after Stage 0 tracking is complete.

**Approved stage order.** 0 tracking → 1 spec model → 2 compiler → 3 semantic proof →
4 UI → 5 performance gate → 6 focused regression → 7 documentation → 8 close-out.

**Load-bearing invariants.** §16, in full. In brief: anchor = returned row; card =
self-contained boolean; FROM is the anchor's fragment only; no DISTINCT; absence is
`NOT EXISTS`; no aggregation; `sql.unsafe` only on catalogue constants with every
value bound; `r_` subquery aliases disjoint from anchor aliases; canonical subject
aliases `p`/`cl`/`m`; depth exactly 1; self-equivalent pairs unreachable at parse and
compile; pre-115 tokens compile byte-identically; no limit weakened and no timeout
raised; club correlation on `club_id`; curated catalogue is the only traversal
authority.

**Stop conditions.** §18, in full. In brief: any need for schema/migration/privilege/
index change; an unreadable relationship target; a changed T-C0 result or broken
pre-115 token; needing a raised timeout to pass; needing DISTINCT/aggregate/related
FROM relation; drift into deferred capability; an ISSUE-115 id collision at Stage 0;
an unrelated defect; repository evidence contradicting an approved decision.

**Evidence-gated implementation parameters.**
- `maxRelatedCards` remains provisional until Stage 5 performance evidence.
- Relationship inclusion may be narrowed by Stage 5 performance evidence.
- The scalar-array InitPlan form is permitted only where `EXPLAIN` evidence
  demonstrates the known ISSUE-103 semi/anti-join pathology, for that relationship
  only.
- No timeout increase. No speculative index.

**Architectural authority.** The approved runbook is authoritative. Architectural
redesign is neither required nor authorised. If implementation evidence materially
contradicts the runbook, stop and report it.

**Command boundary.** The operator executes all shell, test, build, SQL, database and
Git commands. The implementation agent performs native repository inspection and edits
only, and provides the smallest exact command needed to prove the next fact.

---

## 20. Implementation record (updated after every completed stage or checkpoint)

Rule: after every completed stage or safe milestone, this section is updated **before the
session ends**, so a fresh chat can resume from this file alone. If a stage cannot be
completed, persist a checkpoint here: work completed, files changed, validation already run,
failure/blocker, exact next action, applicable stop condition.

### 20.0 Stage 0 — tracking — COMPLETE (2026-08-30)

- **Collision check:** `AFLDB-ISSUE-115` appeared only in this runbook; the highest ledger
  heading was `AFLDB-ISSUE-114`. No collision; stop condition 7 not triggered.
- **Files changed:** `issues.md` (open count → **5**, Open Issues row, new `AFLDB-ISSUE-115`
  entry appended after `-114`), `IssuesIndex.md` (count → 5, row placed before `-104`, trailing
  "no open rows follow" comment corrected).
- **Open-issue count** recomputed from the live Open Issues table: `102, 104, 112, 113, 115`.
- No `CHANGELOG.md` entry (nothing shipped).

### 20.1 Stage 1 — spec model (DB-free) — COMPLETE / GREEN (2026-08-30)

**Files changed (exactly two):**

- `src/search/query-builder-spec.ts`
- `tests/query-builder-spec.test.ts`

**Implemented in `src/search/query-builder-spec.ts`:**

- `SubjectKey`; `SUBJECT_ALIASES` (`player→p`, `club→cl`, `match→m`); `ANCHOR_ALIASES`
  (`p, c, cl, m, hc, ac, pms`).
- `AnchorDef` (the former `TableDef` plus `subjects`, `grainTable`, `grainSubject`).
  `TableDef` is retained as a type alias of `AnchorDef` so existing imports (the form,
  the compiler) keep compiling. The five `QUERYABLE_TABLES` entries keep `from`,
  `defaultSort`, `columns` and `displayColumns` **byte-identical**; only the three new
  fields were added, per §5.1 (`matches` declares no `club` subject;
  `player_match_stats.grainSubject = null`).
- `RelationshipDef` and the twelve-entry `RELATIONSHIPS` catalogue exactly as §5.5
  (`subqueryFrom` / `correlation` / `targetTable` / `cardinality` verbatim), every column
  qualified with `r_` aliases, every club correlation on `club_id`; the §5.6 curated
  predicate `match.player_stats.club_is_participant` (`boolean`). `RELATIONSHIP_KEYS`.
  Column sets were taken from the target tables' migrations (`005`, `006`, `007`, `067`);
  `link_status_value` enums are exposed as `::text`; `award_winners.votes` and
  `club_seasons.percentage` are `float`.
- `relationshipsForAnchor()` with the §5.9 three-part self-equivalence filter
  (`targetTable === grainTable && cardinality === 'one' && subject === grainSubject`) —
  the single source for the UI option list and the parse reachability check;
  `relationshipForCard()`; `domainColumns()` (anchor columns / reachable relationship
  columns / `null`).
- `CardSpec.domain?` and `CardSpec.quantifier?: 'any' | 'none'` (`CardQuantifier`);
  `QueryBuilderState.table` unchanged as the anchor key.
- `QB_LIMITS.maxRelatedCards = 4` (**provisional**, §9.1/§9.3) and
  `maxRelationshipDepth = 1`; the five existing limits unchanged.
- `validateState`: unknown domain → `null`; domain unreachable from the anchor's subjects
  or self-equivalent → `null` (through `relationshipForCard`, i.e. the shared helper);
  quantifier outside the enum → `null`; `quantifier: 'none'` on an anchor-domain card →
  `null` (`'any'` on an anchor card is tolerated and dropped); more than
  `maxRelatedCards` related cards → `null`. Domain equal to the anchor is normalised to
  absent; quantifier `'any'` is normalised to absent.
- `serializeQueryState` omits `domain` when it equals the anchor and `quantifier` when
  `'any'`, so a pre-115 token is exactly the anchor-only shape (§11, no version field).
- `describeCard(anchorKey, card, index)` — `Card N` / `Card N — has a matching <label> row`
  / `Card N — has no matching <label> row`.
- Pure state transitions for the Client Component: `changeAnchor` (→ `emptyState`),
  `setCardDomain` (clears that card's conditions and quantifier; anchor domain stored as
  absent), `setCardQuantifier` (related cards only; `'any'` stored as absent); `emptyCard()`.

**Tests added to `tests/query-builder-spec.test.ts`** (the seven pre-existing cases are
unmodified): T-A1, T-A2, T-A3 (also asserts no `organization_id` in any relationship),
T-A4 (own `r_` aliases, or the subject alias for the curated predicate), T-B1 (a
**hand-captured literal** pre-115 token — players, one card, `debut_season >= 1960` — parses
to cards with no `domain`/`quantifier` **and** re-serialises byte-identically), T-B2, T-B3,
T-B4 (also proves `club.club_seasons` is reachable from `clubs` and from
`player_match_stats`), T-B5 (plus `none` on an anchor card rejected), T-B6 (at-limit
accepted, one-over rejected, anchor cards not counted; pre-115 limit values pinned),
T-B7, T-B8 (also pins `relationshipsForAnchor('matches')` to exactly
`['match.player_stats', 'match.clubs']`), T-D1 (three cases), and a `describeCard` case.

**Validation (operator-run, 2026-08-30):**

```bash
npm test -- tests/query-builder-spec.test.ts
```

Result: **1 file passed, 24/24 tests passed, 287 ms.** No database was contacted.

**Deviations from the approved plan:** none. Two implementation choices within the plan's
latitude, recorded for transparency: (a) `TableDef` kept as an alias of `AnchorDef` rather
than removed, so no file outside the Stage 1 list had to change; (b) a `quantifier: 'none'`
on an anchor-domain card is rejected at parse (the plan defines `quantifier` for related
cards only and says nothing about this shape; rejecting is the fail-closed reading).

**Not touched in Stage 1 (by design):** `src/db/queries/query-builder.ts`,
`QueryBuilderForm.tsx`, `page.tsx`, `tests/integration/query-builder.test.ts`,
`docs/search.md`, `CHANGELOG.md`. No schema, migration, privilege, index or timeout change.

**Evidence-gated items still deferred to later stages:**

- `maxRelatedCards = 4` remains provisional until Stage 5 (§9.3) measures four concurrent
  related cards over `player_match_stats`.
- Relationship inclusion in V1 may still be narrowed by Stage 5 EXPLAIN evidence (the
  partial indexes `ix_draft_player` / `ix_captaincies_player` are flagged in §9.4).
- The scalar-array InitPlan form is permitted only on Stage 5 evidence of the ISSUE-103
  pathology, per relationship.

**Exact next action (as recorded at the end of Stage 1): Stage 2 — compiler** (§14).
Completed below.

### 20.2 Stage 2 — compiler — COMPLETE / GREEN (2026-08-30)

**Files changed (exactly one):** `src/db/queries/query-builder.ts`.

**Implemented:**

- `compileCondition(columns, domainKey, spec)` resolves the column against the **card's
  domain catalogue** (`domainColumns(anchorKey, card.domain)`) rather than
  `QUERYABLE_TABLES[tableKey]` directly. For an anchor-domain card that catalogue is the
  anchor's own `columns` object and the error text keeps the pre-115 wording
  (`Unknown column "<c>" for table "<anchorKey>"`), so the anchor path emits the same SQL
  and the same errors as before. A column belonging to another domain is unknown in the
  card's catalogue and rejected (basis for T-C7).
- `compileCard(columns, domainKey, card)` — fold logic byte-for-byte the same; only the
  column-resolution inputs changed.
- New `compileRelatedCard(rel, card)` —
  `[NOT] EXISTS (SELECT 1 FROM <subqueryFrom> WHERE <correlation> [AND <cardPredicate>])`
  per §6.1, the `advanced-search.ts:49-55` idiom. `subqueryFrom`/`correlation` are fixed
  `RELATIONSHIPS` text spliced with `sql.unsafe`; every condition value stays a bound
  parameter inside the subquery. An empty related card emits the bare `EXISTS` /
  `NOT EXISTS` (§6.2 — "has at least one / has no related row"). No 1:1 special case
  (§6.3). `quantifier === 'none'` → `NOT EXISTS`, anything else → `EXISTS`.
- New `compileOneCard(anchorKey, card)` — the anchor/related dispatch. `domain` absent
  or equal to the anchor → the anchor path, which never consults the relationship
  catalogue (a pre-115 card provably takes the old path). Otherwise
  `relationshipForCard()` must resolve, else it **throws** — unknown, unreachable and
  self-equivalent domains fail closed at `runQueryBuilder` independently of parse
  (basis for T-C6/T-C12). `quantifier: 'none'` on an anchor-domain card also throws.
- `compileCards` — the left fold `((A op B) op C)` with the accumulator parenthesised at
  every step is unchanged; it now calls `compileOneCard` and enforces
  `QB_LIMITS.maxRelatedCards` in the same style as the existing `maxConditionsPerCard`
  guard. A related card is never `null`, so the "empty card filters nothing" skip applies
  to anchor cards only, as before.
- `runQueryBuilder` outer query untouched: same `SELECT`, `count(*) OVER ()`, anchor
  `FROM`, `ORDER BY`, `LIMIT/OFFSET`. No related relation in the anchor FROM, no
  `DISTINCT`, no aggregate, no matched-row count. §6.6/§6.7 recorded in the module header
  comment (a future `DISTINCT` here is evidence the column-ownership invariant broke).
- `sql.unsafe` surface is exactly §9.2's list: `AnchorDef.from`, `AnchorDef.defaultSort`,
  `ColumnDef.column`, `RelationshipDef.subqueryFrom`, `RelationshipDef.correlation`, and
  the operator token already validated against `OPERATORS_BY_KIND`.

**Validation (operator-run, 2026-08-30, worktree `D:\dev\afldb-issue-115`) — T-C0:**

```bash
npm test -- tests/integration/query-builder.test.ts -t "reproduces the"
npm test -- tests/integration/query-builder.test.ts -t "folds three cards"
```

| command | result |
|---|---|
| `-t "reproduces the"` | **1/1 passed**, 8 skipped; regression case returned the expected **110 players**; test 74 ms, Vitest total 345 ms |
| `-t "folds three cards"` | **1/1 passed**, 8 skipped; three-card left-fold semantics unchanged; test 72 ms, Vitest total 340 ms |

Two earlier attempts failed for **environment-only** reasons and established no compiler
regression: (1) `AFLDB_TEST_DATABASE_URL` was absent; (2) the DSN targeted an unavailable
`127.0.0.1:5432`. The GREEN runs used the established SSH tunnel on local port 55432.
Stop condition 3 (a changed T-C0 result) was **not** triggered.

**Deviations from the approved plan:** none. One implementation choice within the plan's
latitude, recorded for transparency: `compileCards` enforces `maxRelatedCards` at the
compiler as well as at parse (`validateState`), mirroring how `maxCards` /
`maxConditionsPerCard` were already double-enforced pre-115; this is fail-closed and
weakens nothing.

**Not touched in Stage 2 (by design):** `src/search/query-builder-spec.ts`,
`tests/query-builder-spec.test.ts`, `tests/integration/query-builder.test.ts`,
`QueryBuilderForm.tsx`, `page.tsx`, `docs/search.md`, `CHANGELOG.md`. No schema,
migration, privilege, index or timeout change.

**Evidence-gated items still deferred to Stage 5 (unchanged from Stage 1):**

- `maxRelatedCards = 4` remains provisional until Stage 5 (§9.3) measures four concurrent
  related cards over `player_match_stats`.
- Relationship inclusion in V1 may still be narrowed by Stage 5 EXPLAIN evidence (partial
  indexes `ix_draft_player` / `ix_captaincies_player`, §9.4).
- The scalar-array InitPlan form is permitted only on Stage 5 evidence of the ISSUE-103
  pathology, per relationship.

**Exact next action (as recorded at the end of Stage 2): Stage 3 — semantic proof** (§14).
Completed below.

### 20.3 Stage 3 — semantic proof — COMPLETE / GREEN (2026-08-30)

**Files changed (exactly one):** `tests/integration/query-builder.test.ts`.
No compiler or spec change was required; `src/db/queries/query-builder.ts` and
`src/search/query-builder-spec.ts` are unchanged since Stage 2 / Stage 1.

**Implemented:** a second `describe` block, `query builder compiler -- multi-domain cards
(ISSUE-115)`, appended after the existing suite. The nine pre-existing cases (including
the four T-C0 cases) are byte-unmodified. Every new case is proved against an
independently written SQL oracle over the same `afldb_test` snapshot, deliberately in a
**different formulation** from the compiler's correlated `EXISTS` (1:1 `JOIN` on the
career row, `IN (subquery)`, `LEFT JOIN … IS NULL` over a `DISTINCT` set, plain join +
`count(DISTINCT match_id)`), so agreement is evidence rather than tautology, with
non-vacuity guards so no case can pass on an empty or degenerate set:

| id | proof |
|---|---|
| T-C1 | Players · anchor `debut_season 1960–1969` AND `player.career` any `games ≥ 100` = JOIN oracle; result `columns` are the Players display columns |
| T-C2 | Players · anchor `debut_season 1960–1969` OR `player.career` any `games ≥ 300` = `IN` oracle; guarded by inclusion–exclusion `|A|+|B|−|A∩B|`, both operands non-empty, neither swallowing the other |
| T-C3 | Players + career (`games ≥ 200`) + `player.match_stats` (`goals ≥ 8`) = independent JOIN/IN count |
| T-C4 | motivating question 1 — `player.career` any `games ≥ 100` AND `player.match_stats` **none** (empty card) = `LEFT JOIN … IS NULL` over DISTINCT oracle; strict subset of the `games ≥ 100` set; and the empty **any** card partitions that set exactly (`any + none = superset`, §6.2) |
| T-C5 | `player.match_stats` any `goals ≥ 5`: `total` = `IN` count = `count(DISTINCT p.id)` of the join, and the naive join count is strictly larger (a JOIN *would* have multiplied) |
| T-C6 | fail-closed at `runQueryBuilder`, bypassing parse: `club.club_seasons` under `players`, `club.matches` under `matches` (no `club` subject, §5.1), and an unknown domain all throw |
| T-C7 | an anchor column inside a related card, a related column inside an anchor card, and `password_hash` inside a related card all throw `Unknown column` |
| T-C8 | `player.clubs` `club contains '%'` → 0 rows inside the subquery; positive control `contains 'Carlton'` = `ILIKE` oracle |
| T-C9 | same `player.match_stats` card under `players` and `player_career_stats`: each returns its own `displayColumns`, row keys match, totals match their own oracles, career ≤ players |
| T-C10 | Matches · `match.player_stats` any `club_is_participant is false` = join oracle requiring a non-NULL club differing from both participants (motivating question 7); `is true` control = its own oracle and > 0 |
| T-C12 | `player.career` under `player_career_stats` throws `cannot be queried` at `runQueryBuilder` (§5.9, before any SQL); `relationshipForCard` resolves `player.match_stats` under `player_match_stats` and returns `null` for the self-equivalent pair — the shared helper the compiler dispatches on |

**Validation (operator-run, 2026-08-30, worktree `D:\dev\afldb-issue-115`,
`AFLDB_TEST_DATABASE_URL` on the established 55432 tunnel):**

```bash
npm test -- tests/integration/query-builder.test.ts
```

Final result: **1 file passed, 20/20 tests passed** (9 pre-existing + 11 new), Vitest
3.79 s total / 3.53 s test execution. Existing compiler regressions 9/9 GREEN throughout;
stop condition 3 not triggered.

**History — initial full run was 17/20; three test-only corrections were made:**

1. **T-C2** — the original non-vacuity guard assumed neither OR operand contained the
   other, and the first anchor operand (`height_cm ≥ 200`) has **zero rows** in the
   `afldb_test` snapshot. Corrected to a known-populated anchor operand
   (`debut_season 1960–1969`) and an inclusion–exclusion guard. The semantic oracle was
   not weakened.
2. **T-C10** — the independent oracle (a correlated `EXISTS` with `<>` comparisons per
   match) hit the existing 5 s statement timeout. Rewritten as a hash-joinable
   `player_match_stats JOIN matches` + `count(DISTINCT match_id)`; the compiled query
   itself had completed. Passed in 1,438 ms on the targeted rerun. No timeout increase,
   no index, no InitPlan remedy.
3. **T-C12** — first reported as "reached SQL and timed out". Investigation showed the
   fail-closed assertion had **passed** (`isSelfEquivalent` at spec `:603` →
   `relationshipForCard` → `null` → `compileOneCard` throws before any SQL); the timeout
   came from a *control* half of the test that executed a `player.match_stats` EXISTS
   under the `player_match_stats` anchor plus an `IN` oracle over all 685k rows — the
   Stage 5 cost-gate shape, which Stage 3 must not pre-empt. The control was replaced by
   DB-free assertions through the shared helper. Passed in 3 ms targeted / 1 ms final.
   **No fail-closed defect exists; no compiler or spec correction was needed.**

**Deviations from the approved plan:** none. T-C12's "rule does not fire under the PMS
anchor" half is asserted through `relationshipForCard` rather than by executing the PMS
query; the plan's T-C12 requires only the fail-closed check, and the executed form of that
shape is Stage 5's T-C11.

**Performance evidence deferred to Stage 5 (record only — not acted on):** during the
first T-C12 run, the `player_match_stats`-anchor × `player.match_stats` EXISTS query and/or
its 685k-row `IN` oracle exceeded the 5 s statement timeout. This is direct input to the
§9.3 gate and the §9.3 decision procedure (EXPLAIN first; evidence-gated InitPlan for that
relationship only; exclusion as last resort). Also carried forward unchanged from Stages
1–2: `maxRelatedCards = 4` provisional; partial indexes `ix_draft_player` /
`ix_captaincies_player` flagged (§9.4). No index, no timeout change, no early InitPlan.

**Not touched in Stage 3 (by design):** `src/search/query-builder-spec.ts`,
`src/db/queries/query-builder.ts`, `tests/query-builder-spec.test.ts`,
`QueryBuilderForm.tsx`, `page.tsx`, `docs/search.md`, `CHANGELOG.md`, `issues.md`,
`IssuesIndex.md`. No schema, migration, privilege, index or timeout change.

**Exact next action (as recorded at the end of Stage 3): Stage 4 — UI** (§14, §10).
Completed below.

### 20.4 Stage 4 — UI — COMPLETE / GREEN (2026-08-30)

**Files changed (exactly two, both on the §14 Stage 4 list):**

- `src/app/admin/query-builder/QueryBuilderForm.tsx`
- `src/app/admin/query-builder/page.tsx`

No change to `src/search/query-builder-spec.ts`, `src/db/queries/query-builder.ts` or either
test suite.

**Implemented in `QueryBuilderForm.tsx` (§10.1–§10.2):**

- Anchor select relabelled **"Results are"**, with a one-line note under it ("Each result row is
  one *<anchor label>* row, showing that table's columns. Changing this starts a new
  question."). Changing it calls the pure `changeAnchor` (→ `emptyState`, today's reset).
- Per-card **"Filter on"** select: `<optgroup label="This row">` (the anchor's own domain,
  stored as absent `domain`) + `<optgroup label="Related">` sourced from
  `relationshipsForAnchor(anchor)` — the same helper `parseQueryState` and the compiler use,
  so self-equivalent/unreachable domains are neither offered nor accepted. Related options are
  disabled (with an explanatory note) once `QB_LIMITS.maxRelatedCards` is used by *other*
  cards.
- **Quantifier select** rendered only for a related domain, English only: *"there is at least
  one such row"* / *"there is no such row"*, via the pure `setCardQuantifier`.
- **Hint line** for a related card: `RelationshipDef.hint`, followed by the §6.10 two-cards
  note ("conditions apply within one related row; use a second card for a different related
  row") and the §6.8 not-recorded rule (a condition on a missing value never matches, so
  *"there is no such row"* includes rows where the value is not recorded; use *is null* /
  *is not null*).
- **Card legend** from the shared `describeCard()` (`Card N` / `Card N — has a / has no matching
  <label> row`).
- **Domain-change reset:** the change goes through the pure `setCardDomain` (clears that card's
  conditions and quantifier) **and** a `pickDomain` handler in the `Card` component resets its
  local `column` / `op` / `value` / `lo` / `hi` to the new domain's first column — the same
  reset `pickColumn` already performs, extended to the domain change (§10.2, T-D1 guard).
- Column list, operator kinds and condition badges resolve through `domainColumns(anchor,
  card.domain)`; `describeCondition` now takes a column catalogue rather than a `TableDef`.
  `addCard` uses `emptyCard()`. No SQL jargon anywhere in the UI.

**Implemented in `page.tsx`:** subtitle wording only, plus the gating rule below. The results
header continues to read the **anchor's** `columns` (`QUERYABLE_TABLES[state.table]`),
unchanged.

**Validation (operator-run, 2026-08-30, worktree `D:\dev\afldb-issue-115`):**

```bash
npm test -- tests/query-builder-spec.test.ts
npx tsc --noEmit
```

| command | result |
|---|---|
| `npm test -- tests/query-builder-spec.test.ts` | **1 file passed, 24/24 tests passed**, 258 ms; all T-D1 state-transition coverage GREEN |
| `npx tsc --noEmit` | **PASS — no TypeScript errors** |

**Deviation (within latitude, recorded for transparency) — empty related-card gating.**
§6.2/§8.1 make a related-domain card with **no** conditions a complete question ("has / has
no such row"; motivating question 3 consists only of such cards). The pre-115 gates — the
form's `canSearch` and the page's `hasConditions` — counted conditions only, so those queries
could never be run from the UI. Both now apply one identical rule: a card "asks something" if
it has conditions **or** names a related domain. Anchor-only empty cards retain the previous
behaviour exactly (filter nothing; Search stays disabled; the page runs no query). Implemented
in `QueryBuilderForm.tsx` (`canSearch`) and `page.tsx` (`hasQuery`) only; **no spec or
compiler change was made** — the rule was inlined in the two files rather than added to the
spec module so Stage 4 touched only its listed files. No other deviation. No blockers.
`tests/admin-nav/admin-nav.spec.ts` was not run: the admin nav route was not touched.

**Not touched in Stage 4 (by design):** `src/search/query-builder-spec.ts`,
`src/db/queries/query-builder.ts`, both test suites, `docs/search.md`, `CHANGELOG.md`,
`issues.md`, `IssuesIndex.md`. No schema, migration, privilege, index or timeout change; no
performance investigation; no InitPlan.

**Evidence carried forward to Stage 5 (unchanged from Stage 3 — record only, not acted on):**

- During the first Stage 3 T-C12 run, the `player_match_stats`-anchor × `player.match_stats`
  EXISTS query and/or its 685k-row `IN` oracle exceeded the 5 s statement timeout. Direct
  input to the §9.3 gate and decision procedure (EXPLAIN first; evidence-gated InitPlan for
  that relationship only; exclusion as last resort).
- `maxRelatedCards = 4` remains provisional until Stage 5 measures four concurrent related
  cards over `player_match_stats`.
- Partial indexes `ix_draft_player` / `ix_captaincies_player` flagged (§9.4) — `NOT EXISTS`
  over `player.draft_picks` / `player.captaincies` may seq-scan.
- No index, no timeout change, no early InitPlan.

**Exact next action: Stage 5 — performance evidence/gates** (§9.3, §14), in a fresh Fable
session: add T-C11 to `tests/integration/query-builder.test.ts` (each V1 relationship, EXISTS
and NOT EXISTS, `performance.now()` + `toBeLessThan(1000)` per the
`grid-solver.test.ts:392-395` shape); capture `EXPLAIN (ANALYZE, BUFFERS)` for every
relationship over `player_match_stats` at minimum; apply the §9.3 decision procedure; settle
`maxRelatedCards` and any relationship exclusion from measured evidence and record the values.
Verify with `AFLDB_STATEMENT_TIMEOUT_MS=5000 npm test -- tests/integration/query-builder.test.ts -t "cost"`
at the normal timeout — never raise it. Do not begin Stage 6.

### 20.5 Stage 5 — performance evidence/gates — COMPLETE / GREEN (2026-08-30)

**Status:** all §9.3 evidence collected and classified; the decision procedure was run to its final
branch; the operator approved the anchor-scoped exclusion below ("Option 1") on 2026-08-30; the
edits are applied and **both gates are GREEN** (validation at the end of this record). Stage 5 is
COMPLETE. Every Stage 5 timing and EXPLAIN conclusion is captured in this section.

**This is an evidence-driven Stage 5 narrowing of the approved V1 capability, not a redesign:**
`player_match_stats` remains a results anchor with unchanged anchor-domain filtering, columns and
grain, but hosts **no related-domain cards in V1**. All twelve relationships stay in V1 under their
other anchors. `maxRelatedCards` stays 4. No index, no statement-timeout change, no InitPlan
compiler path, no schema or privilege change. The root cause is the **pre-ISSUE-115
`player_match_stats` anchor baseline** — 685,471 rows pushed through `count(*) OVER ()` and an
index-ordered `LIMIT 50`, which the planner costs as a fast-start plan but must execute to
completion — measured at **1072 ms (T-C11) / 1441 ms (EXPLAIN) with no card at all**. Related
filtering while anchored on `player_match_stats` is **deferred**; fixing that baseline is
**separate follow-up work, not part of ISSUE-115**. No individual relationship is removed globally.

**Files changed (four, all on the §14 list):**

- `tests/integration/query-builder.test.ts` — new `describe('query builder compiler -- cost gate
  (ISSUE-115 T-C11)')`: (1) every reachable anchor × relationship pair, bare card, EXISTS and NOT
  EXISTS, coverage asserted against `RELATIONSHIP_KEYS`; (2) the `player_match_stats`-target
  shapes with a related condition plus the partial-index relationships, with three anchor-alone
  reference points held to the 5 s ceiling; (3) the `maxRelatedCards` composites (Players × 4
  `player.match_stats` cards; `player_career_stats` × 2 anchor + 4 `player.match_stats` cards).
  Each case measures every query before asserting (`performance.now()` +
  `expect(ms, msg).toBeLessThan(1000)`, the `grid-solver.test.ts:392-395` shape), prints the
  timings, and records a statement timeout as that case's failure. A vitest per-test harness
  timeout (`HARNESS_TIMEOUT_MS = 300_000`, not a query bound) replaces the 30 s default that
  truncated the first run. T-C12 extended: `player.match_stats` under `player_match_stats` now
  fails closed at `runQueryBuilder` (`/cannot be queried/`) and via `relationshipForCard` → `null`,
  while an anchor-domain card on the same anchor still runs.
- `src/search/query-builder-spec.ts` — `QUERYABLE_TABLES.player_match_stats.subjects: []` (one
  value plus a comment). `relationshipsForAnchor('player_match_stats')` is therefore `[]`, so the
  existing single source of truth does the rest: the UI offers no *Related* group (it already
  guards `related.length > 0`), `parseQueryState` rejects the domain, the compiler fails closed.
- `tests/query-builder-spec.test.ts` — T-B8: PMS offers no relationships and `subjects` is `[]`;
  T-B4: the `club.club_seasons` token under `player_match_stats` is now rejected; T-A1: the
  "declares at least one subject" guard still applies to the four hosting anchors, while
  `player_match_stats` is asserted **equal to `[]`** (an exact check, so a silently re-added subject
  fails T-A1 as well as T-B8); the canonical-alias and closed-namespace checks still run for every
  anchor including PMS, whose `from` still aliases `p`/`cl`/`m`. (First spec run was 23/24 on the
  old guard; corrected, then 24/24.)
- `AFLDB-ISSUE-115.md` — §5.1 row amended (strikethrough, pointer here); this record.

**Not changed:** `src/db/queries/query-builder.ts`, `QueryBuilderForm.tsx`, `page.tsx`,
`QB_LIMITS`, `docs/search.md`, `CHANGELOG.md`, `issues.md`, `IssuesIndex.md`; no migration, index,
privilege or `AFLDB_STATEMENT_TIMEOUT_MS` change.

**Method.** T-C11 timings are end-to-end `runQueryBuilder` calls over the 55432 tunnel against
`afldb_test` at the normal 5 s timeout. Plans were captured with two read-only psql scripts
(`stage5-explain.sql`, 22 shapes; `stage5-explain-2.sql`, 7 uncaptured shapes + the §9.3 InitPlan
form of the failing shapes + two Players-anchor controls) under a **session-only**
`SET statement_timeout = '5000ms'` (the application setting was never touched), each with the
exact compiler SQL and bound values inlined, plan-only `EXPLAIN` ahead of at-risk shapes so the
plan survives a timeout. Raw outputs (`stage5-tc11.txt`, `stage5-explain.out` 262 KB,
`stage5-explain-2.out` 182 KB) live in the session scratchpad and are ephemeral; every measured
value is carried here. EXPLAIN ANALYZE runs 25–40 % slower than T-C11 on the 685k-row loops
(instrumentation); T-C11 is the gate, EXPLAIN the plan evidence.

**Snapshot.** PostgreSQL 16.15. players 13,277 · player_career_stats 13,275 · player_match_stats
685,471 (0 NULL `player_id`, 13,275 distinct players; `goals ≥ 8` 1,078 rows / 317 players;
`goals ≥ 5` 1,736 players) · matches 16,838 · clubs 24 · player_clubs 16,713 · draft_picks 6,810
· award_winners 46 · club_seasons 1,622 · **captaincies 0 · hall_of_fame 0 ·
player_link_match_candidates 0 (empty in `afldb_test`)**. Every correlation column is indexed
(`ix_pms_player`, `ix_pms_match`, `ix_pms_club`, `pms_player_match_uq`, `player_clubs_pkey`,
`player_career_stats_pkey`, `ix_club_seasons_club`, `ix_matches_home/away`, `ix_plmc_player`).

**Correction to §9.4 (planning-time survey error):** `ix_draft_player`, `ix_captaincies_player`,
`ix_hof_player` and `ix_award_winners_player` are partial on **`player_id IS NOT NULL`**, not on
`link_status_value`. The equality correlation implies that predicate, so the planner uses them
(E18/E19: `Index Scan using ix_draft_player` / `ix_captaincies_player`, 32 ms). The
partial-index risk is retired; no index is needed.

**Measured — GREEN, every relationship under `players`, `player_career_stats`, `clubs`, `matches`
(T-C11 ms, bare card, EXISTS / NOT EXISTS, first Stage 5 run):**

| anchor | relationship | EXISTS | NOT EXISTS |
|---|---|---|---|
| players | player.career | 60.7 | 17.4 |
| players | player.match_stats | 110.9 | 84.6 |
| players | player.clubs | 65.5 | 17.8 |
| players | player.draft_picks | 9.6 | 41.4 |
| players | player.hall_of_fame † | 11.1 | 37.1 |
| players | player.captaincies † | 12.3 | 38.9 |
| players | player.awards | 12.0 | 66.3 |
| players | player.link_candidates † | 9.8 | 37.4 |
| player_career_stats | player.match_stats | 130.2 | 110.1 |
| player_career_stats | player.clubs | 95.1 | 23.2 |
| player_career_stats | player.draft_picks | 10.5 | 63.8 |
| player_career_stats | player.hall_of_fame † | 7.8 | 63.9 |
| player_career_stats | player.captaincies † | 8.3 | 67.0 |
| player_career_stats | player.awards | 9.7 | 94.9 |
| player_career_stats | player.link_candidates † | 10.8 | 65.9 |
| clubs | club.club_seasons | 12.6 | 7.4 |
| clubs | club.matches | 12.2 | 9.5 |
| matches | match.player_stats | 127.0 | 87.2 |
| matches | match.clubs | 73.2 | 43.5 |

† target table empty in `afldb_test`: the timing is a floor; the plan shape is the same per-player
probe on the partial index as `player.draft_picks` (6,810 rows), which is the evidence for it.

Conditioned and composite (T-C11 ms; EXPLAIN in brackets): players × player.match_stats EXISTS
goals≥8 457.0 [452.9], NOT EXISTS 478.6 [465.2]; player_career_stats × player.match_stats NOT
EXISTS goals≥8 504.1; matches × match.player_stats EXISTS `club_is_participant IS FALSE` **686.1
[896.3]** — the closest GREEN case to the bound (Hash Semi Join hashing all 685k PMS rows, 8
batches); retained at the 1000 ms bound, to be widened for that case only if it ever proves
flaky (§9.3); NOT EXISTS 337.6; players × player.draft_picks NOT EXISTS link_status=unique 38.6;
captaincies 25.2; **players × 4 `player.match_stats` cards 94.1 [92.2]** — planned as four
*hashed SubPlans*, each evaluated once. Anchors alone: players 195.3 [18.7], matches 41.4
[33.3]. Other EXPLAIN values: E1 100.1, E2 82.0, E9 135.4, E10 86.9, E18 32.3, E19 32.3.

**Measured — RED, every shape under the `player_match_stats` anchor (T-C11 ms / EXPLAIN ms /
§9.3 InitPlan-form EXPLAIN ms where measured):**

| shape | current T-C11 / EXPLAIN | InitPlan form | plan (current form) |
|---|---|---|---|
| anchor alone | 1072.4 / 1441.4 | — | E0c: index-ordered walk of 685,471 rows → WindowAgg spills to temp → LIMIT |
| × player.career EXISTS / NOT EXISTS | 1393.1 / 1903.2 · 15.4 | — | A1: memoized 1:1 PK probe (13,275 real) + baseline |
| × player.match_stats EXISTS bare | **timeout / timeout** | **4184.2** | E5: Nested Loop Semi Join, 685,471 correlated executions; `Limit` costed 4.41..577 (fast-start misplan) |
| × player.match_stats NOT EXISTS bare | 4151.8 / 4815.7 | 1796.5 | E6: Nested Loop Anti Join ×685,471, 4.27M buffer hits, 0 rows |
| × player.match_stats EXISTS goals≥8 | **timeout / timeout** | **304.9** | E7: same, inner scans every row of the player then `Filter goals>=8` |
| × player.match_stats NOT EXISTS goals≥8 | **timeout / timeout** | 1454.0 | E8: Nested Loop Anti Join, same inner |
| × player.clubs EXISTS / NOT EXISTS | 3383.4 / **4294.0** · 20.2 | — | A2: Nested Loop Semi Join, 685,471 PK probes, 2.06M hits |
| × player.draft_picks EXISTS / NOT EXISTS | 14.8 · 1966.2 / 2571.0 | — | A4: anti probe ×685,471 on `ix_draft_player` + baseline |
| × player.hall_of_fame EXISTS / NOT EXISTS † | 1104.5 · 1891.4 / 2497.8 | — | A7: anti probe ×685,471 + baseline |
| × player.captaincies EXISTS / NOT EXISTS † | 1111.9 · 1943.9 | — | same shape as A7 |
| × player.awards EXISTS / NOT EXISTS | 33.6 · 3110.9 / **timeout under EXPLAIN ANALYZE** | — | A3: instrumentation alone pushed it over the ceiling |
| × player.link_candidates EXISTS / NOT EXISTS † | 1084.6 · 1897.6 | — | same shape as A7 |
| × club.club_seasons EXISTS / NOT EXISTS | 2197.7 / 3832.9 · 10.8 | — | A5: semi join folded into `clubs` (0.2 ms), then Nested Loop `Join Filter (cl.id = pms.club_id)` over `Materialize`(24): 15.77M rows removed |
| × club.matches EXISTS bare | **timeout / timeout** | 1450.9 | E14: Nested Loop Semi Join over `Materialize` (Seq Scan matches), OR join filter — the literal ISSUE-103 shape |
| × club.matches NOT EXISTS bare | 40.5 / 41.6 | — | E15: anti join placed on the 24-row `clubs` side; PMS never executed |
| × club.matches EXISTS / NOT EXISTS is_final | 2107.0 / 3722.2 · 29.2 | — | A6: the A5 Materialize join-filter shape, 15.08M rows removed |
| × match.player_stats EXISTS / NOT EXISTS bare | 1154.6 / 1529.7 · 91.2 / 89.8 | — | E12: semi join at the matches level (117 ms) + baseline — the ideal plan is still > 1 s; E13 anti join on the small side |
| × match.player_stats EXISTS / NOT EXISTS disposals≥30 | 660.6 · 786.7 | — | small results, under the bound |
| × match.clubs EXISTS / NOT EXISTS bare | 1094.4 / 1484.3 · 49.4 / 45.5 | — | E16: semi join at the matches level (60 ms) + baseline |
| 2 anchor cards + 4 related PMS-target cards | 2457.1 / 2501.8 | 901.2 | E21: one `player.match_stats goals≥5` semi join = 2.2 s of 2.5 s (loops=32,821, 3.58M hits); the other three cards ≈ 250 ms |

Players-anchor InitPlan controls: bare EXISTS 100.1 → 269.8 ms (a fixed ~226 ms: one parallel
scan of all 685k PMS rows to build the 13,275-id array); NOT EXISTS goals≥8 465.2 → 65.8 ms.

**Plan-shape findings.**

1. *Baseline.* The PMS anchor's `ORDER BY m.match_date DESC LIMIT 50` with `count(*) OVER ()` is
   costed as a fast-start plan (`Limit cost=4.41..577`) but the window aggregate must consume all
   685,471 rows and spills to temp (3,401 blocks). 1072–1441 ms before any card.
2. *Repeated correlated execution.* Under that fast-start plan the planner keeps every related
   card as a Nested Loop Semi/Anti Join executed once per anchor row — 685,471 executions for
   13,275 distinct keys (E5–E8, A2, A4, A7). The same bias exists under `players` (E1 is the same
   shape) but 13,277 probes cost 100 ms; the anchor cardinality is what turns it into a timeout.
3. *OR-correlation pathology.* `club.matches` under PMS: Nested Loop Semi Join over a
   `Materialize`d matches scan (E14) — the ISSUE-103 shape. Under `clubs` (24 rows) it is 12 ms.
4. *Anchor-join pathology.* When the planner folds a club-side semi join into `clubs` first (A5,
   A6), it then joins PMS to the 24 clubs by Nested Loop join filter over `Materialize` — 15M
   discarded comparisons — instead of hashing.
5. *Small-result shapes are fast everywhere* (E13, E15, E17, NOT EXISTS with 0 rows: 11–91 ms):
   the anti join is placed on the small side and PMS is never executed.
6. *InitPlan form.* Removes the per-row execution and the OR pathology, but (a) `p.id = ANY($n)`
   on an InitPlan Param is **estimated at rows=10 whatever the array size** (B1: actual 13,275 →
   4184 ms, 84 % of the ceiling; B6: actual 1,622), and (b) every large-result shape lands on the
   baseline (B2 1796, B4 1454, B5 1451). It reaches the < 1 s target only for small results (B3
   305 ms; B6 901 ms is not "comfortably" under). Under `players` it is a regression for the bare
   form and an improvement for the conditioned form.
7. *Empty tables.* captaincies, hall_of_fame and link_candidates have 0 rows in `afldb_test`; their
   PMS-anchor 1.1–1.9 s is a floor that will rise in production.

**§9.3 decisions (recorded).**

1. *Obligation A (5 s).* Breached in the current form by four PMS-anchor shapes
   (`player.match_stats` ×3, `club.matches` ×1), with `player.match_stats` NOT EXISTS bare at
   96 %, `player.clubs` EXISTS at 86 %, and `player.awards` NOT EXISTS over the ceiling under
   instrumentation. InitPlan would clear the five measured ones (305–4184 ms) but the fix would
   have to be applied to all twelve relationships under that anchor (seven unmeasured in that
   form) and B1 rests on a misestimate.
2. *Obligation B (< 1 s).* Unattainable under the PMS anchor for any large-result shape by any
   relationship rewrite: the anchor alone is already over it. Met with margin by all twelve
   relationships, both forms, under the four other anchors.
3. *`maxRelatedCards = 4` — retained.* Four cards under Players cost 94 ms; E21's cost is one
   card's semi join; the single-card shapes fail on their own; B6 shows the same four cards at
   901 ms once the shape changes. The limit is not implicated.
4. *Exclusion under the PMS anchor — all relationships (anchor-scoped).* The failing unit is the
   anchor: every relationship fails B there in at least one form and six threaten A. This is the
   decision the operator approved.
5. *Global exclusion — none.*
6. *Index — none.* Every plan uses the right index; cost is iteration count and baseline. §9.4
   gate not met.
7. *InitPlan compiler path — rejected.* Where the normal form passes, §9.3 says keep it (and B7
   shows InitPlan would regress bare EXISTS there); under the PMS anchor it was measured per the
   procedure and still cannot satisfy the target, which is the procedure's exclusion branch.

**Alternatives considered and rejected (recorded for §17):** InitPlan for every relationship under
the PMS anchor only (meets A, never B; needs an anchor-keyed second compile path, per-relationship
key expressions for the OR/IN correlations, `IS NOT NULL` guards on nullable targets such as
`draft_picks.player_id`, and a runbook amendment); excluding only the six A-threatening
relationships (still violates B, and the retained ones sit on empty test tables); fixing the anchor
baseline inside ISSUE-115 (pre-115 behaviour, out of scope).

**Deviations from the approved plan:** §5.1's `player_match_stats` subjects reduced to none
(operator-approved, §18-9). T-C12's "resolves under PMS" assertion inverted to "excluded under
PMS". T-C11 carries three anchor-alone reference points held to the 5 s ceiling rather than the
1 s bound (pre-115 shapes, context only). Harness timeout added. No other deviation.

**Follow-up (separate from ISSUE-115, to be raised as its own issue at close-out):** the
`player_match_stats` anchor alone exceeds the 1 s target (1072 ms) and any large-result query on it
is bounded by `count(*) OVER ()` + ordered-LIMIT materialisation over 685k rows; related filtering
at that grain (§13-style deferred capability) waits on that fix.

**Validation (operator-run, 2026-08-30, worktree `D:\dev\afldb-issue-115`, `afldb_test` on the
55432 tunnel, normal `AFLDB_STATEMENT_TIMEOUT_MS=5000` — never raised):**

```bash
npm test -- tests/query-builder-spec.test.ts
npm test -- tests/integration/query-builder.test.ts -t "cost|T-C12"
```

| command | result |
|---|---|
| `npm test -- tests/query-builder-spec.test.ts` | **1 file passed, 24/24 tests passed**, 268 ms (T-A1, T-B4, T-B8 on the amended reachability) |
| `npm test -- tests/integration/query-builder.test.ts -t "cost\|T-C12"` | **4 passed / 19 skipped**, 6.83 s total — T-C12 exclusion proof plus all three T-C11 cost cases GREEN at the 1000 ms bound; no statement timeout |

Final T-C11 measurements (ms), supported shapes only:

- Bare anchor × relationship pairs (19 pairs across `players`, `player_career_stats`, `clubs`,
  `matches`; all 12 relationships covered; PMS contributes no pair): every EXISTS / NOT EXISTS case
  passed; slowest **`matches × match.player_stats EXISTS` 132.7**.
- Conditioned: players × player.match_stats EXISTS goals≥8 **467.5**, NOT EXISTS **474.6**;
  player_career_stats × player.match_stats EXISTS goals≥8 **489.9**, NOT EXISTS **514.3**;
  matches × match.player_stats EXISTS `club_is_participant IS FALSE` **687.5** (closest to the
  bound; retained at 1000 ms), NOT EXISTS **334.0**; matches × match.player_stats EXISTS
  disposals≥30 **197.5**, NOT EXISTS **213.3**; players × player.draft_picks NOT EXISTS
  link_status=unique **37.3**; players × player.captaincies NOT EXISTS link_status=unique **24.7**.
- Anchor reference points (5 s ceiling only): players alone **22.2**; matches alone **28.6**;
  **player_match_stats alone 1065.6** — the known pre-ISSUE-115 baseline: above the 1 s
  related-card target with no card at all, below the 5 s hard ceiling; it hosts no related cards.
- `maxRelatedCards` composites: **players × 4 related player.match_stats cards 88.3**;
  **player_career_stats × 2 anchor cards + 4 related player.match_stats cards 133.1** —
  `maxRelatedCards = 4` is supported by evidence and retained.

**Stage 5 outcome, in one place:** evidence-driven exclusion of related-domain cards under the
`player_match_stats` anchor (it remains a valid anchor for its own-row filtering and results);
all 12 relationships remain available globally through their supported anchors;
`maxRelatedCards = 4` retained; no index change; no `statement_timeout` change; no InitPlan
compiler path; no schema or privilege change; the §9.4 partial-index concern is retired (indexes
are partial on `player_id IS NOT NULL`, which the correlation implies, and are used); the
pre-ISSUE-115 PMS anchor baseline remains separate follow-up work.

**Exact next action: Stage 6 — focused regression** according to §14/§15, in a fresh session:
`npm test -- tests/query-builder-spec.test.ts tests/integration/query-builder.test.ts` in full,
then `npx tsc --noEmit` (compare against the known unrelated baseline). Stage 5 made no compiler
or UI change, so the remaining exposure is the full integration file (T-C0–T-C12 with the cost
gate) and the typecheck of the test edits. Do not begin Stage 7 in that session.

### 20.6 Stage 6 — focused regression — COMPLETE / GREEN (2026-08-30)

**Status:** COMPLETE / GREEN. Both suites ran in full and the typecheck is clean. Stage 6 required
**no repository edits** before verification: Stage 5 had already left the compiler and UI untouched,
so the only exposure was the full integration file (T-C0–T-C12 including the cost gate), the full
spec suite, and the typecheck of the Stage 5 test edits.

**Files changed during Stage 6:** `AFLDB-ISSUE-115.md` only (this record). No source, test, doc,
`CHANGELOG.md`, `issues.md` or `IssuesIndex.md` change. No migration, index, privilege,
`AFLDB_STATEMENT_TIMEOUT_MS`, schema or InitPlan change.

**Validation (operator-run, 2026-08-30, worktree `D:\dev\afldb-issue-115`, `afldb_test` on the
55432 tunnel, normal `AFLDB_STATEMENT_TIMEOUT_MS=5000` — never raised), exactly the §15 Stage 6
sequence:**

```bash
npm test -- tests/query-builder-spec.test.ts tests/integration/query-builder.test.ts
npx tsc --noEmit
```

| command | result |
|---|---|
| `npm test -- tests/query-builder-spec.test.ts tests/integration/query-builder.test.ts` | **2/2 test files passed, 47/47 tests passed**, 10.43 s — 24 spec tests (T-A1–A4, T-B1–B8, T-D1) + 23 integration tests (T-C0–T-C12 including the three T-C11 cost cases), no statement timeout |
| `npx tsc --noEmit` | **PASS — no TypeScript errors**; the Stage 4 clean baseline remains clean |

**Stage 5 performance boundaries remained stable under the full run:** every supported
anchor × relationship shape (bare, conditioned and `maxRelatedCards` composite) stayed within its
accepted 1000 ms bound; the `player_match_stats` anchor-alone reference point measured
**1056.3 ms** (Stage 5: 1065.6 / 1072.4) — the known pre-ISSUE-115 baseline, above the 1 s
related-card target with no card at all and below the 5000 ms hard ceiling. No regression test
produced evidence contradicting the Stage 5 decisions, so the V1 boundary stands unchanged:
`player_match_stats` remains a valid results anchor for its own-row filtering/results and hosts
no related-domain cards; all 12 relationships remain available through their supported anchors;
`maxRelatedCards = 4` retained.

**Deviations / blockers:** none.

**Exact next action: Stage 7 — documentation** according to §14, in a fresh session: rewrite
`docs/search.md` §6 (lines 131-167) for the anchor/domain/relationship model, the §8.1 coverage
matrix including the ⚠️ rows, the §8.2 card-independence boundary, the §6.8 NULL rule, and the
new limits — reflecting the Stage 5 narrowing (`player_match_stats` hosts no related-domain
cards in V1; the pre-115 PMS anchor baseline is separate follow-up). Correct the pre-existing
"not linked from the admin nav" drift sentence only (`src/app/admin/nav-model.ts:82` links it).
No `CHANGELOG.md` entry until Stage 8. Do not begin Stage 8 in that session.

### 20.7 Stage 7 — documentation — COMPLETE / GREEN (2026-08-30)

**Status:** COMPLETE / GREEN. `docs/search.md` §6 rewritten per §14 and approved by operator
review of the diff. No code, test, `CHANGELOG.md`, `issues.md` or `IssuesIndex.md` change.

**Files changed:** `docs/search.md` (§6 "Data QA search", the old lines 131-167, now ~131-320)
and `AFLDB-ISSUE-115.md` (this record). No file outside the §14 list.

**Documentation summary (implemented V1 behaviour only; nothing unsupported documented as
capability):**

- Pre-existing drift corrected: the tool is linked from the admin nav as *Data QA search*
  (`src/app/admin/nav-model.ts`). That sentence only; no other unrelated doc work.
- Anchor/domain/relationship model: the anchor determines the result grain and columns; a related
  card compiles to a correlated `EXISTS` / `NOT EXISTS` boolean on the anchor row; no related
  relation is joined into the anchor `FROM`, so no `DISTINCT` (§6.6); pre-115 tokens emit identical
  SQL; `sql.unsafe` boundary restated to include `subqueryFrom`/`correlation`; unregistered targets
  fail closed at the database grant.
- `any` / `none` × conditions table (§6.2, §8): an empty related card is existence /
  non-existence; "missing relation" is always `NOT EXISTS`, never `LEFT JOIN … IS NULL` — worded as
  "proved against an independently formulated absence oracle" to match what T-C4 actually asserts
  (it does not string-check the compiled SQL for outer joins).
- One card's conditions apply to the same related row (§6.9); separate cards over the same
  relation may be satisfied by different rows (§6.10); cross-card left fold unchanged (§7); no
  related aggregates or counts (§6.7, deferred).
- §6.8 NULL rule: "not recorded ≠ zero"; `NOT EXISTS` with a condition includes rows whose column
  is NULL; `is null` / `is not null` are the precise operators.
- Full twelve-relationship catalogue by subject (§5.5) including `club_is_participant` (§5.6) and
  the historical `club_id` rule (§5.7); anchor → offered-domains table: Players 8, Player career
  stats 7 (`player.career` rejected as self-equivalent, §5.9), Clubs 2, Matches 2 (not the club
  subject), **Player match stats none**; `relationshipsForAnchor()` as the single source for UI and
  reachability.
- Stage 5 boundary stated as evidence-driven, not a design choice: `player_match_stats` remains a
  valid results anchor for own-row filtering/results and hosts no related-domain cards in V1;
  cause is the pre-ISSUE-115 PMS anchor baseline (> 1 s with no card), recorded as separate
  follow-up; no relationship removed globally; no index; statement timeout never raised.
- §8.1 coverage matrix reproduced with rows 4, 5, 6 and 8 kept ⚠️ partial and row 2's link-status
  scope note preserved; the missing anchors are described as not existing, not as planned.
- §8.2 card-independence boundary; cross-card shared-variable correlation explicitly deferred.
- Limits: 6 cards, 8 conditions/card, `maxRelatedCards = 4` (with the Stage 5 four-card evidence),
  `maxRelationshipDepth = 1`, 50 rows/page, 50 pages, 8,192-char token, 5 s ceiling never raised,
  T-C11 1 s cost gate.

**Validation:** §15 defines no Stage 7 command (documentation-only stage). Operator review of
`git diff -- docs/search.md` on 2026-08-30 — **GREEN**; every documented point confirmed against
the implemented V1 behaviour and the approved runbook; no further Stage 7 edit required.

**Deviations / blockers:** none.

**Exact next action: Stage 8 — close-out** according to §14, in a fresh session: add the
`CHANGELOG.md` `Unreleased` entry (behaviour ships at this point); update the `AFLDB-ISSUE-115`
entry in `issues.md` with actual root cause, fix and validation including the Stage 5 measured
values; raise the pre-ISSUE-115 `player_match_stats` anchor baseline as its own follow-up issue
(§20.5); remove the ISSUE-115 row from `IssuesIndex.md` and the Open Issues table; recompute the
open-issue count from the file as it then stands.

### 20.8 Stage 8 — close-out — COMPLETE / GREEN (2026-08-30)

**Final status: Stage 8 COMPLETE / GREEN. `AFLDB-ISSUE-115` is Resolved (2026-08-30) on worktree
`D:\dev\afldb-issue-115` / branch `claude/issue-115` — not merged to `dev` or `main`, not deployed
to any environment; no production or `afldb_dev` change was made at any stage.**

**Pre-edit inspection (native tools only; no command run):**

- Next unused id: highest `issues.md` heading was `AFLDB-ISSUE-115`; `AFLDB-ISSUE-110` is
  allocated to unmerged NL work (not free, no row written, per the existing ledger note);
  `ISSUE-116` appeared in no file under the repository. **`AFLDB-ISSUE-116` allocated.** No
  collision; stop condition 7 not triggered.
- Live open set before edits, identical in `issues.md` and `IssuesIndex.md`: `102, 104, 112,
  113, 115` (5).

**Files changed (four):**

- `CHANGELOG.md` — new `Unreleased` entry *"AFLDB-ISSUE-115 — Data QA search composes
  related-domain cards on one anchor (Resolved) - 30 August 2026"*: model, catalogue, invariants,
  limits, UI, the evidence-driven PMS boundary (citing `AFLDB-ISSUE-116`), `docs/search.md`, and
  the operator-run validation figures. Placed first under `Unreleased`.
- `issues.md` — open count → `102, -104, -112, -113, -116`; Open Issues row for `-115` replaced by
  the `-116` row (position unchanged); `AFLDB-ISSUE-115` entry set to **Resolved 2026-08-30**
  with a `Follow-up` pointer, the stage record completed through Stage 8, `Root cause`, `Fix`
  (with the operator-approved §5.1 deviation), `Measured performance` (the Stage 5 GREEN and RED
  tables, InitPlan result, plan-shape findings), a per-stage `Validation` table and the
  `Resolution`; explicitly **not** claiming merge or deployment. New `AFLDB-ISSUE-116` entry
  appended after `-115`.
- `IssuesIndex.md` — count and set updated; the `-115` row retired into a `RETIRED 2026-08-30`
  comment (lineage), the `-116` row written in its place; the trailing "open issues are …"
  comment corrected to `-116`.
- `AFLDB-ISSUE-115.md` — header status; this record.

**Not changed:** no source, test or `docs/search.md` edit (Stage 7's "separate follow-up work"
sentence is left as written; it now resolves to `AFLDB-ISSUE-116` via the ledger). No migration,
index, privilege, timeout, schema or InitPlan change. No shell, Git, test, build or database
command was run.

**New follow-up issue — `AFLDB-ISSUE-116`, Low, Open:** the `player_match_stats` anchor alone
costs 1.05–1.44 s over 685,471 rows (T-C11 1056–1072 ms; EXPLAIN 1441 ms) because the page query's
`count(*) OVER ()` forces the index-ordered `LIMIT 50` walk — costed fast-start at
`Limit cost=4.41..577` — to consume every row and spill to temp; that plan is what turned every
related card under this anchor into a per-row Nested Loop Semi/Anti Join, which is why ISSUE-115
excluded related cards there as an evidence-driven V1 boundary. Fixing the baseline is separate
work; re-admission under PMS is gated on it and on a T-C11 re-run.

**Stage 5 conclusions preserved unchanged:** `player_match_stats` is a valid own-row results
anchor hosting no related cards in V1; all 12 relationships available globally through the four
other anchors; `maxRelatedCards = 4`; no index / InitPlan / timeout / schema / privilege change;
partial-index concern retired.

**Open-issue count after edits, recomputed from the live Open Issues table:** **5** —
`AFLDB-ISSUE-102`, `-104`, `-112`, `-113`, `-116`.

**Verification (operator-run, 2026-08-30, worktree `D:\dev\afldb-issue-115`) — GREEN.** §15
defines no Stage 8 command; the close-out fact to prove was ledger/index/changelog consistency:

| check | result |
|---|---|
| `git diff --stat` | 10 tracked files changed, 2,182 insertions / 90 deletions — the accumulated Stages 1–7 implementation plus the Stage 8 `CHANGELOG.md` / `issues.md` / `IssuesIndex.md` edits; `AFLDB-ISSUE-115.md` is untracked and correctly absent from the stat |
| `Select-String -Path issues.md,IssuesIndex.md,CHANGELOG.md -Pattern 'AFLDB-ISSUE-116'` count | **9** (expected ≥ 8) — PASS |
| `Select-String -Path issues.md,IssuesIndex.md -Pattern '^\| `AFLDB-ISSUE-115`'` | **no output** — no live `-115` table row remains — PASS |

Operator cleanup, not a repository change: the four zero-byte untracked files `Hash`,
`HashAggregate`, `Index`, `Materialize` at the worktree root were confirmed to be Stage 5 shell-
redirection strays and removed. Git's LF→CRLF working-copy warnings on several files are
line-ending notices only, not a validation failure.

**Final files changed by ISSUE-115 (all on the §14 list; nothing outside it):**

```
AFLDB-ISSUE-115.md                                (new, untracked — Stages 0–8)
CHANGELOG.md                                      (Stage 8)
IssuesIndex.md                                    (Stages 0, 8)
issues.md                                         (Stages 0, 8)
src/search/query-builder-spec.ts                  (Stages 1, 5)
src/db/queries/query-builder.ts                   (Stage 2)
src/app/admin/query-builder/QueryBuilderForm.tsx  (Stage 4)
src/app/admin/query-builder/page.tsx              (Stage 4)
tests/query-builder-spec.test.ts                  (Stages 1, 5)
tests/integration/query-builder.test.ts           (Stages 3, 5)
docs/search.md                                    (Stage 7)
```

No migration, index, privilege, `AFLDB_STATEMENT_TIMEOUT_MS`, schema or InitPlan change in any
stage.

**Follow-up issue:** `AFLDB-ISSUE-116` (Low, Open) now tracks the pre-ISSUE-115
`player_match_stats` anchor baseline separately — the 1.05–1.44 s anchor-alone cost from
`count(*) OVER ()` plus the fast-start-costed ordered `LIMIT` materialisation over 685,471 rows.
It is not a residue of this implementation and does not reopen ISSUE-115.

**Final open-issue count: 5**, recomputed from the reconciled Open Issues table and identical in
`issues.md` and `IssuesIndex.md`: `AFLDB-ISSUE-102`, `-104`, `-112`, `-113`, `-116`.
(`AFLDB-ISSUE-110` remains allocated to unmerged NL work and is deliberately not counted here, per
the standing ledger note.)

**Deviations / blockers:** none. The only deviation across the whole issue is the
operator-approved Stage 5 narrowing of §5.1 (`player_match_stats` hosts no related cards),
recorded in §20.5 and in the ledger's `Fix` section.

**Exact next action after close-out:** none under ISSUE-115. The branch is ready for the
operator's review/commit of `claude/issue-115` and merge into `dev` under the normal
dev-before-prod procedure; deployment is separate work and is not authorised by this resolution.
`AFLDB-ISSUE-116` is separate work, not started, and should begin in its own fresh session.
