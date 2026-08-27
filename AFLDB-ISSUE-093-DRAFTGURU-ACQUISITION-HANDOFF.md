# AFLDB-ISSUE-093 — DraftGuru ACQUISITION EXECUTION RUNBOOK

**This is the approved acquisition execution runbook only.**

It defines how the identity-complete DraftGuru source snapshot is acquired, validated and
made immutable. **It does not design the DraftGuru PostgreSQL importer.** Downstream importer
requirements are recorded here only where acquisition evidence establishes them (§16).

| | |
|---|---|
| Issue | `AFLDB-ISSUE-093` (Open), phase §13.5 "Draft adapter (DraftGuru) — follows 4a" |
| Predecessors | `AFLDB-ISSUE-093-CORE-IMPORT-DB-COMPLETE-HANDOFF.md` §13 (opened this boundary) |
| Evidence base | `AFLDB-ISSUE-093-DRAFTGURU-INVESTIGATION-HANDOFF.md` §1–§13 + Step 1, Residual audit, Step 2 target selection, Step 2 probe |
| Safety base | `AFLDB-ISSUE-092.md` §4/§5/§11; `tools/migration/common.py:129` `check_population_drop()` |
| Identity base | `src/db/migrations/069_draft_source_identity.sql` (the durable record of `AFLDB-ISSUE-078`, whose ledger entry is `issues.md:3778`; there is no `AFLDB-ISSUE-078.md`) |
| Pattern base | fitzRoy: `tools/rebuild/fitzroy/acquire_core.R`, `tools/rebuild/fitzroy/fitzroy-contract.json`, `tools/migration/import_fitzroy_core.py --validate-only`, `docs/rebuild-manifests/afltables_fitzroy_core/trial-2024.json`, `tests/fitzroy-acquisition.test.ts` |
| Status | **EXECUTION CHECKPOINT (2026-08-26, Opus takeover session).** U1 RESOLVED/SETTLED; contract/parser/adapter/tests/fixtures/retrospective manifest implemented. Targeted suite: **30/30 PASS** (user-run, §19) — the **acquisition implementation gate is PASSED**. **Stage A live acquisition itself is NOT YET RUN**; next action is the bounded 2001 live probe (§19). |

**Non-negotiables carried in from §9 of the investigation handoff:** zero
`AFLDB_LEGACY_SQLITE` dependency; acquisition and PostgreSQL import remain separate stages;
the validation stage requires no database access; no name-only merging; no manufacturing of
canonical players; era-aware club resolution failing closed; `Original Club` stays raw text;
NULL≠0 preserved; existing human decisions survive; cross-source and admin-owned rows are
never deleted.

---

## 1. Authoritative acquisition source

**Primary acquisition surface: the server-rendered DraftGuru annual pages.**

**Year-page URL pattern (measured, Step 2):**

```text
https://www.draftguru.com.au/years/<YYYY>
```

Evidence: both Brad Miller person pages link to `/years/2001`, and `/years/2001` returned a
fully populated 16-column draft/trade table in server-rendered HTML with player and club
hrefs intact. The pattern is **not** to be re-derived by crawling; the adapter constructs it
directly and records the constructed URL per year in the manifest.

**Coverage target (42 pages):**

```text
1981, 1982, 1986, 1987, 1988, … 2025
```

**Known intentional gaps: 1983, 1984, 1985 — no draft was held.**

> These are **positive assertions**, not failed downloads. The adapter must never request
> them, must record them in `known_coverage_gaps[]` with the reason, and must not treat their
> absence as an error. Corroboration: the CSV corpus and `docs/data-dictionary.md:217` both
> report 6,810 rows across 1981–2025 with the same three years absent.

**Base URL** `https://www.draftguru.com.au` is a single constant used both to construct year
URLs and to canonicalise root-relative hrefs (§6).

**Out of scope for this runbook:** `/clubs/*`, `/lists/*`, `/from/*`, `/trades`, `/awards`.
They are linked from the pages we acquire and must not be followed.

---

## 2. Acquisition outputs

**Working snapshot (gitignored under the existing `/data/*` rule):**

```text
data/sources/draftguru/<snapshot-label>/
```

**Snapshot label pattern:** `annual-html-<YYYYMMDD>` (e.g. `annual-html-20260827`). The date
is fixed at run time; the *pattern* is fixed here.

> **The existing `data/sources/draftguru/full-history-20260826/` is the browser-export CSV
> validation artifact. It must NOT be overwritten, renamed, modified, combined, normalised,
> rewritten or deleted, and the new snapshot must NOT be written inside it.** The two labels
> are deliberately dissimilar so no glob, script or human confuses them.

**Layout:**

```text
data/sources/draftguru/<snapshot-label>/
  raw/
    years/
      year_1981.html            # exact response bytes, no decode, no reformat
      year_1982.html
      year_1986.html
      …
      year_2025.html
    persons/                    # only if §3 Stage B runs
      <slug>__<ordinal>.html
  http/
    years/
      year_1981.json            # status, final URL, headers subset, fetched_at, bytes, sha256
      …
  parsed/
    rows.jsonl                  # one deterministic record per table row
    persons.jsonl               # one record per distinct player_url seen
    schema.json                 # per-year header fingerprints
    trade_column_profile.json   # §9
```

**Raw acquisition must preserve enough source information to recover, per row:** draft year;
annual source URL; row structure/ordinal position; player display text; player href
(`player_url`); destination club display text; destination club href/slug; `Pick`;
`Draft`/event type; selection number (`# ↧`); `Signing`; `Detail`; `Original Club`; the
`Trade` column; and every remaining table field required for CSV parity checking (`Age`,
`Height`, `Grade`, `Games`, `Goals`, `Coaches`, `Brownlow`, `Awards`).

> **Preserve raw server responses *plus* deterministic parsed output — never parsed output
> alone.** `raw/` is the source of truth; `parsed/` is regenerable from it and is re-derived,
> not edited. If the parser is later corrected, the same `raw/` bytes reproduce a corrected
> `parsed/` without re-fetching DraftGuru.

**Durable archive:** once accepted as a rebuild baseline, `raw/` is additionally preserved
off-host per `AFLDB-ISSUE-093.md` §4 (the off-host backup practice already used for database
dumps at `D:\backups\afldb\`). Exact path settled at execution; the requirement is that it is
documented and not committed to Git.

---

## 3. Person-page acquisition boundary

**Annual pages alone are sufficient for the identity gate.** They already carry the durable
`player_url` with its disambiguating ordinal, which is the only thing the rebuild's identity
model requires (migration 069: `draft_persons (source_id, player_url)`,
`draft_picks (source_id, player_url, draft_year, draft_kind)`).

**Full acquisition of all 5,057 person pages is NOT approved by this runbook.**

Person pages additionally offer DOB, source biography, DraftGuru career figures, and the
**AFL Tables profile link** (measured on exactly one page). Only the last has established
value, and its corpus-wide availability is unmeasured.

**Approved boundary — three stages, each separately gated:**

| Stage | Scope | Requests | Approved here |
|---|---|---:|---|
| **A** | 42 annual pages | **42** | **YES — mandatory** |
| **B1** | Bounded person-page **profiling sample** | **≈120** | **YES — bounded** |
| **B2** | All remaining person pages | ~4,937 | **NO — separate decision, §16** |

**Stage B1 sample composition (deterministic, recorded in the manifest):**

- the **8** persons in the four convergent groups (Residual B) — including the two Brad
  Millers, which double as the §8 regression fixtures;
- **≈50** persons drawn from the 68 missing-canonical-identity population (Residual A) —
  selected by a user-run read-only `afldb_dev` query emitting `player_url` only, under the
  Step-1 envelope, exactly as the target-selection lookup was;
- **≈40** persons stratified across draft decades (1980s/1990s/2000s/2010s/2020s) to test
  page-shape stability over time;
- **≈20** persons with `reported_games = 0` to test whether zero-game people appropriately
  lack an AFL Tables link.

**Stage B1 answers exactly one question:** *does the DraftGuru person page reliably carry the
AFL Tables profile link, and does it carry one for the players AFLDB is missing?* Its output
is §10's profile. **B2 is proposed only if B1 shows material coverage**, and then with its own
justification, request count, rate limit, caching/restart behaviour and failure handling
written into a successor runbook — not decided here.

> **Do not build a high-volume crawler casually.** Stage A is 42 requests. Stage B1 is ~120.
> Neither needs concurrency, and neither is permitted to use it (§4).

---

## 4. Raw HTTP semantics

Ordinary, respectful, single-threaded retrieval. No concurrency, no parallelism, no headless
browser, no JavaScript execution (Step 2 proved none is required).

| Property | Requirement |
|---|---|
| **User-Agent** | Explicit and identifying, e.g. `AFLDB-rebuild/1.0 (+https://github.com/<repo>; contact: <maintainer email>)`. Never a browser impersonation string. |
| **Timeout** | 20s connect+read per request. |
| **Retries** | Max 3 attempts. Exponential backoff 2s → 4s → 8s. **Retry only on timeout, connection error, and HTTP 5xx / 429.** Never retry a 4xx other than 429. |
| **Rate limit** | Minimum **1.5s** delay between requests, applied to *every* request including retries. Stage A ≈ 1 minute; Stage B1 ≈ 3 minutes. |
| **Ordering** | Deterministic ascending year, then deterministic person order (slug, then ordinal). Byte-identical run ordering across runs. |
| **Redirects** | Followed only same-host; the final URL is recorded. A cross-host redirect is a failure, not a follow. |
| **robots.txt** | Fetched once and recorded in the manifest. If it disallows these paths, **stop and report** — do not proceed and do not work around it. |
| **Status recording** | HTTP status, final URL, `Content-Type`, `Content-Length`, `Last-Modified`/`ETag` where present, `fetched_at` (UTC, ISO-8601), byte size, SHA-256 — per request, in `http/`. |
| **Resumability** | A year/person whose `raw/` file **and** `http/` record already exist is skipped. Re-running under the same label completes an interrupted run; it never re-fetches what succeeded and never rewrites an existing raw file. |
| **Failure semantics** | **A snapshot is not complete if any required year fails.** Following the fitzRoy adapter (`acquire_core.R:182-220`): raw files are written as they arrive, **the manifest is written LAST and only on complete success**. A directory with raw files and no manifest is a failed/incomplete acquisition, and is the only state a partial run may leave behind. |
| **No silent partials** | Any missing required year, any non-200 status on a required year, or any zero-byte body ⇒ the run aborts with a non-zero exit and an explicit list of what failed. Stage B1 failures are reported and permitted to be partial *only* because B1 is a profiling sample, and its manifest records exactly which persons were and were not fetched. |

---

## 5. Encoding / raw bytes

**Store original response bytes.** `raw/**/*.html` is written in binary mode, exactly as
received: no decode, no re-encode, no newline translation, no prettifying, no whitespace
stripping, no entity expansion.

Additionally record, per response: the `Content-Type` header verbatim including any `charset`
parameter; any `<meta charset>` / `<meta http-equiv="Content-Type">` declaration found in the
first 2KB; and the byte-level counts of `U+00A0` NBSP, `U+200B` ZWSP, `U+21A7` `↧` and the
CP1252 mojibake signature bytes, computed **after** decoding with the declared charset.

This settles, from evidence rather than inference:

- **NBSP provenance** — 9,143 occurrences in the CSV, in 100% of player names;
- **ZWSP provenance** — 6,621 occurrences following every `/` in `Original Club`;
- **CP1252 mojibake provenance** — the 6 affected rows (`Setanta Ã hAilpÃ­n`, `CiarÃ¡n
  Sheehan`, `CiarÃ¡n Byrne`, `Red Ãg Murphy`);
- **source charset declarations**;
- **Unicode normalisation rules** the parser may then apply.

> **Do not bake cleaned text into the only stored snapshot.** Normalisation is a parser
> function operating on preserved bytes, and every normalisation the parser applies must be
> reversible by re-parsing `raw/`.

Known already: the `↧` glyph **is** in the live source header, so it is not an export artefact
and must not be "repaired" out of a schema fingerprint.

---

## 6. Parser contract

A validation parser that:

- **requires no PostgreSQL connection**;
- **requires no `psycopg` import** — the module must be importable and fully exercisable with
  psycopg absent, exactly as `import_fitzroy_core.py --validate-only` already demonstrates;
- **consumes only the acquired snapshot** — never the live site, never the legacy SQLite,
  never the CSV corpus except in the explicitly separate parity stage (§7);
- **detects year/page/schema drift** — per-year header fingerprint compared against the
  pinned contract; an unknown header ⇒ fail closed, never best-effort;
- **extracts the player href exactly** as written in the source;
- **normalises a root-relative href into the canonical stored form** — the single
  documented transform, applied identically everywhere, matching what `draft_persons.player_url`
  holds (the exact stored prefix is confirmed against `afldb_dev` before the transform is
  frozen; see §16 unresolved decision U1);
- **preserves the ordinal** — `/players/brad_miller/1` and `/players/brad_miller/2` must
  survive as distinct values through every stage; stripping, collapsing or defaulting the
  ordinal is a defect, not a simplification;
- **extracts the club href separately from the club display name** — two fields, never fused;
- **treats blank as absence, never zero** — a blank `# ↧` is *not-applicable* (§1.5) and
  becomes NULL; `Games`/`Goals`/`Coaches`/`Brownlow` arrive already coerced to `0` at source
  and are **captured for parity only, never emitted as facts**;
- **preserves `Draft` / `Signing` / `Detail` as three separate concepts** — `Detail` (1981,
  1982, 1986, 1987, 1997, 1998) is *not* `Signing` renamed, and `Pick` is a special-pick label,
  not a pick number;
- **profiles the live `Trade` column** (§9);
- **never infers player identity from a name** — `player_name_raw` is retained text; identity
  is `player_url` alone.

**Entry point contract** (mirrors fitzRoy):

```text
python tools/rebuild/draftguru/parse_draft_snapshot.py --label <snapshot-label> --validate-only
```

Exit non-zero on any contract violation, with the failing year/row identified.

---

## 7. CSV parity validation

The existing **42-file / 6,810-row** CSV corpus at
`data/sources/draftguru/full-history-20260826/` is used as an **independent validation
oracle** — *never* as canonical identity data, and never modified.

The parsed annual-HTML snapshot must reconcile against it **for the fields the CSV actually
preserved**:

| Measure | Expected |
|---|---|
| Year coverage | 42 pages ≡ 42 files; 1981, 1982, 1986–2025 |
| Total rows | **6,810** |
| Rows per year | Equal per year, both directions |
| Event vocabulary | The 11 groups of §1.5, with identical row counts |
| Selection-number population | **1,686** blank, and blank for *exactly* Trade, Pre-Draft, Post-Draft, Free Agency |
| Special `Pick` labels | 101 populated: Priority 42, Compensation 23, FA Compensation 21, Inactive 13, Penalised 2 |
| Player display names | Equal **after deterministic normalisation** (NBSP→space, ZWSP strip, mojibake repair, Unicode NFC) |
| Destination club labels | The 19 strings of §6, with identical per-year distribution |
| `Signing` / `Detail` values | The 25 mechanism groups over 1,007 populated rows |
| `Original Club` | Compared where comparable, after ZWSP stripping |

**Any unexplained population difference must fail validation.** A difference that *is*
explained — the live `Trade` column the CSV lacks, or a name the CSV corrupted — is recorded as
a documented, enumerated exception in the parity report, not waved through.

> **Do not force parity for fields the browser export lost or corrupted.** Specifically: the
> `Trade` column (absent from the CSV entirely), `player_url` (absent entirely), and the six
> mojibake-damaged names. Requiring the HTML to reproduce the export's damage would be
> backwards.

A legitimate live-source change since 2026-08-26 (a corrected row, an added pick) is possible.
It is **investigated and recorded**, never silently accepted and never silently rejected.

---

## 8. Identity validation

Required, all fail-closed:

1. **Every acquired transaction row has a non-blank `player_url`.** Zero exceptions — this is
   the whole point of the reacquisition.
2. **Every person URL matches the canonical shape** `/players/<slug>/<ordinal>` with
   `<ordinal>` a positive integer; anything else fails the run rather than being coerced.
3. **`player_url` population collapses to the expected person grain** — 6,810 rows reduce to
   the distinct-person count.
4. **Expected current baseline ≈ 5,057 distinct persons.** A difference is **investigated,
   not silently accepted**: the live source may legitimately have changed, and the manifest
   records the measured number with the delta called out.
5. **Same-name people with different ordinals remain separate** through every stage.

**Explicit regression test (mandatory):**

```text
/players/brad_miller/1   ->  2001 National  #55  Melbourne
/players/brad_miller/2   ->  2001 Rookie    #30  Richmond
```

The parser must prove these remain **two distinct persons** despite identical rendered names,
on a committed fixture derived from the real 2001 page. This is the proven-incorrect
convergence from Step 2, and it is the canonical regression for the entire identity model.

**Population-drop protection:** acquisition writes no database rows, so
`check_population_drop()` does not apply here. It becomes **mandatory** in the downstream
importer, which today has none — `import_draft.py` calls `reload_keyed(..., delete_missing=True)`
on `draft_picks` and runs an ungated orphan-person DELETE (§9 of the investigation handoff).
Recorded in §16 as a downstream requirement.

---

## 9. Live `Trade`-column profiling

Profile across **all 42 annual pages**, output to `parsed/trade_column_profile.json`:

- years in which a `Trade` column exists at all (header present);
- populated-row count per year and overall;
- distinct value forms (verbatim, with counts);
- link presence — whether any cell contains an `<a href>`, and to what path shape;
- cross-tabulation against `Draft` event type, to see whether it is populated only for trades;
- whether it carries actual prior-club/trade provenance or some other semantic (a pick
  exchanged, a note, a future-pick reference).

Measured so far: present in 2001's header, **empty on every 2001 row**, no links.

> **Do not define its database destination until the complete profile is known.** If it turns
> out to carry prior-AFL-club provenance in some years, that materially changes §7 of the
> investigation handoff and is a **new** design input, not a field to be quietly mapped.

---

## 10. AFL Tables-link profiling (Stage B1 only)

If person pages are acquired/probed, measure and record in the manifest:

- persons exposing an AFL Tables profile link;
- the URL form(s) observed, and whether they normalise to the `players/A/Name.html` path that
  `tools/migration/import_fitzroy_core.py` registers under `match_method =
  'afltables_profile_url'`;
- duplicate/collision counts — two DraftGuru persons pointing at one AFL Tables profile is a
  finding, not a merge instruction;
- persons with no AFL Tables link;
- whether links are present for **historically linked** DraftGuru people;
- whether the **68** missing canonical-side identity cases can be resolved from DraftGuru's own
  page.

> **Do not write any of this into PostgreSQL during acquisition. This is source-contract
> evidence only.** A DraftGuru-asserted AFL Tables link is a *candidate* for
> `external_identities`, and adopting it would be a deliberate, separately approved decision
> about trusting one source's claim about another — with its own collision policy. Nothing
> here pre-authorises it.

---

## 11. Manifest

Tracked in Git at:

```text
docs/rebuild-manifests/draftguru/<snapshot-label>.json
```

Minimum fields (fitzRoy's field set plus the DraftGuru-specific additions of §8 of the
investigation handoff):

```jsonc
{
  "source": "DraftGuru (draftguru.com.au) annual draft/trade pages",
  "adapter": "tools/rebuild/draftguru/acquire_draft.py",
  "adapter_version": "1.0.0",
  "adapter_schema_version": 1,
  "parser_contract_version": 1,
  "snapshot_label": "annual-html-<YYYYMMDD>",
  "mode": "acquire",
  "extraction_date": "<YYYY-MM-DD>",
  "extraction_started_utc": "<ISO-8601>",
  "extraction_completed_utc": "<ISO-8601>",
  "base_url": "https://www.draftguru.com.au",
  "robots_txt_sha256": "<64 hex>",
  "requested_range": { "from": 1981, "to": 2025 },
  "expected_years": [1981, 1982, 1986, "…", 2025],
  "known_coverage_gaps": [
    { "year": 1983, "reason": "no draft held" },
    { "year": 1984, "reason": "no draft held" },
    { "year": 1985, "reason": "no draft held" }
  ],
  "working_directory": "data/sources/draftguru/<snapshot-label>",
  "source_urls": [
    { "year": 2001, "url": "https://www.draftguru.com.au/years/2001",
      "http_status": 200, "fetched_at": "<ISO-8601>",
      "raw_filename": "raw/years/year_2001.html",
      "byte_size": 0, "sha256": "<64 hex>",
      "content_type": "text/html; charset=utf-8",
      "parsed_row_count": 0, "schema_fingerprint": "<hash of header row>" }
  ],
  "schema_variants": [
    { "fingerprint": "<hash>", "columns": ["Pick","Draft","# ↧","Club","Signing","Player","…","Trade"],
      "years": [2001] }
  ],
  "total_rows": 0,
  "distinct_player_url_count": 0,
  "identity_fields_present": ["player_url", "club_href"],
  "identity_complete": true,
  "import_capable": true,
  "person_pages": { "stage": "B1", "requested": 0, "fetched": 0, "failed": [], "sample_basis": "…" },
  "afltables_link_profile": { "…": "§10" },
  "trade_column_profile": { "…": "§9" }
}
```

**Retrospective manifest for the CSV artifact.** The existing browser-export snapshot receives
its own manifest under the same directory, label **`csv-export-20260826`**, asserting:

```jsonc
{ "identity_complete": false, "import_capable": false, "identity_fields_present": [] }
```

> **The manifest must make it impossible to confuse the two.** `identity_complete` /
> `import_capable` are the single fields a validator refuses on, without having to open a file:
> the CSV artifact is `false/false` and can never become an import source; the HTML snapshot is
> `true/true` only after §7 and §8 pass.

---

## 12. Immutability

Mirroring `acquire_core.R:182-186`:

- **an existing manifest label is never overwritten** — if
  `docs/rebuild-manifests/draftguru/<label>.json` exists, the adapter aborts with an explicit
  message and writes nothing;
- **reacquisition uses a new label**, never an in-place replacement;
- **manifest + per-file SHA-256 anchor immutability**, linking the working copy and the durable
  off-host archive; the parser and any downstream consumer verify hashes before use, as
  `import_fitzroy_core.py:437-440` already does;
- **raw files are never edited** — a correction is a new snapshot or a parser change, never a
  hand-edit of `raw/`;
- **`data/sources/draftguru/full-history-20260826/` is frozen** and is referenced read-only by
  the parity stage.

---

## 13. Safety

**ZERO `AFLDB_LEGACY_SQLITE` dependency.** `tools/migration/import_draft.py:423`
(`connect_legacy()`) is the last draft-path consumer of the legacy SQLite database; the new
adapter must be test-pinned the way `import_fitzroy_core.py`, `load_reference_data.py` and
`acquire_core.R` already are.

The acquisition path **must not**:

- connect to PostgreSQL (any database, any role, read or write);
- mutate AFLDB in any way;
- import or write player links;
- replay historical mappings;
- manufacture identities — ~1,498 draft persons legitimately never played and stay unlinked;
- silently accept partial source collapse.

It **must**:

- run entirely offline against `raw/` once acquisition completes;
- leave no partial snapshot that looks complete (§4);
- keep `raw/` gitignored and manifests tracked.

---

## 14. Test matrix

Home: **`tests/draftguru-acquisition.test.ts`** — a new file, justified because no existing
suite is a semantic home; it is the direct analogue of `tests/fitzroy-acquisition.test.ts`,
which asserts adapter source text plus a tracked contract JSON. Parser behaviour is tested
against small committed fixtures under `tests/fixtures/draftguru/` (hand-trimmed excerpts of
real pages — never the full snapshot, which is gitignored).

| # | Test | Asserts |
|---|---|---|
| 1 | No legacy SQLite dependency | Adapter/parser source contains no `AFLDB_LEGACY_SQLITE`, no `sqlite3`, no `connect_legacy` |
| 2 | No DB dependency | No `psycopg`/`DATABASE_URL` reference; `--validate-only` path importable with psycopg absent |
| 3 | URL construction | `1981 → https://www.draftguru.com.au/years/1981`; base URL is a single constant |
| 4 | Expected-year set | Exactly 42 years; 1981, 1982, 1986–2025 |
| 5 | Intentional gaps | 1983/1984/1985 never requested; present in `known_coverage_gaps[]` with a reason |
| 6 | href extraction | Player cell href extracted verbatim from fixture HTML |
| 7 | Ordinal preservation | `/players/x/2` never becomes `/players/x` or `/players/x/1` at any stage |
| 8 | **Brad Miller regression** | 2001 fixture yields two distinct persons, identical display names, `#55 Melbourne National` vs `#30 Richmond Rookie` |
| 9 | Root-relative canonicalisation | `/players/brad_miller/1` → the canonical stored form; idempotent; absolute URLs unchanged |
| 10 | Schema variants | Known header fingerprints accepted; an unknown header **fails closed** |
| 11 | Live `Trade` column | 16-column header parsed; empty `Trade` recorded as absent, never as `""` fact or `0` |
| 12 | Blank/null semantics | Blank `# ↧` → NULL, never 0; `Games`/`Goals`/`Coaches`/`Brownlow` never emitted as facts |
| 13 | Encoding / raw bytes | Fixture bytes round-trip unchanged; NBSP/ZWSP/mojibake counted, not silently repaired in `raw/` |
| 14 | Manifest hashing | SHA-256 written as validated lowercase 64-hex; recomputed hash matches |
| 15 | Manifest immutability | Existing label ⇒ abort, nothing written |
| 16 | Partial acquisition refusal | One year failing ⇒ non-zero exit, **no manifest written**, raw files retained for resume |
| 17 | CSV parity reconciliation | Fixture-scale parity harness: row counts, event vocabulary, blank-`#` set |
| 18 | Population-drop / refusal | Asserted-empty or >10% drop refused; wired via `check_population_drop()` **in the downstream importer** — here, the test asserts the acquisition path performs no delete at all |
| 19 | Snapshot layout | `data/sources/**` gitignored, `docs/rebuild-manifests/**` tracked; CSV snapshot path never written by the adapter |

Run: `npx vitest run tests/draftguru-acquisition.test.ts` (user-executed).

---

## 15. Execution boundary — files expected to be created/changed

**None of these exist yet. Do not implement them from this document.**

| Path | Action | Purpose |
|---|---|---|
| `tools/rebuild/draftguru/acquire_draft.py` | **create** | Stage A/B1 acquisition adapter (§1–§5) |
| `tools/rebuild/draftguru/parse_draft_snapshot.py` | **create** | Snapshot parser + `--validate-only` (§6–§10) |
| `tools/rebuild/draftguru/draftguru-contract.json` | **create** | Pinned URL pattern, expected years, gaps, header fingerprints, field classification (§6) |
| `tests/draftguru-acquisition.test.ts` | **create** | §14 matrix |
| `tests/fixtures/draftguru/year_2001_excerpt.html` | **create** | Trimmed real 2001 rows incl. both Brad Millers |
| `tests/fixtures/draftguru/player_brad_miller_1_excerpt.html` | **create** | Person-page shape + AFL Tables link |
| `tests/fixtures/draftguru/player_brad_miller_2_excerpt.html` | **create** | Same-name counterpart |
| `docs/rebuild-manifests/draftguru/csv-export-20260826.json` | **create** | Retrospective CSV manifest, `identity_complete:false` (§11) |
| `docs/rebuild-manifests/draftguru/annual-html-<YYYYMMDD>.json` | **create at run time** | The identity-complete snapshot manifest |
| `data/sources/draftguru/annual-html-<YYYYMMDD>/**` | **create at run time** | Gitignored raw + parsed snapshot |
| `docs/rebuild.md` (or the existing rebuild doc) | **update** | Register the DraftGuru acquisition stage |
| `AFLDB-ISSUE-093.md` | **update** | §13.5 phase state on completion |
| `IssuesIndex.md` | **update** | ISSUE-093 next action |
| `CHANGELOG.md` | **update** | Only if retained behaviour changes (a new tracked adapter + manifests does qualify) |

**Not touched:** `tools/migration/import_draft.py` (importer phase, not acquisition), any
`src/` code, any migration, `data/sources/draftguru/full-history-20260826/`.

---

## 16. Downstream importer requirements discovered during investigation

Recorded here **only** because acquisition evidence establishes them. **The importer is not
designed in this document.**

1. **`check_population_drop()` is mandatory** in the draft importer plus
   `--acknowledge-population-drop`; `import_draft.py` currently has neither and deletes by
   `delete_missing=True` against a table named by `player_link_resolutions`.
2. **Reload by key, never truncate** — `draft_persons (source_id, player_url)` and
   `draft_picks (source_id, player_url, draft_year, draft_kind)`; the partial index on
   `source_id IS NOT NULL` is the ownership boundary and admin-created rows stay outside it.
3. **Only explicit `player_link_resolutions` rows are replayable**; automatic links are
   reconciliation evidence and must be re-earned (proven by the Brad Miller convergence).
4. **NULL `match_method`/`algorithm_version` on historical resolutions must be preserved as
   NULL** — no manufactured provenance.
5. **Era-aware destination-club resolution, failing closed on `Brisbane`.**
6. **`Original Club` stays `original_club_raw`**, never a `clubs` FK.
7. **The `Trade` column has no approved destination** until §9's profile exists.
8. **A DraftGuru-asserted AFL Tables link is not automatically an `external_identities` row.**

### Unresolved acquisition decisions

| # | Decision | Needed before |
|---|---|---|
| **U1** | **RESOLVED 2026-08-26** (user-run read-only `afldb_dev` lookup, REPEATABLE READ READ ONLY + ROLLBACK): all **5,057** `draft_persons.player_url` values are **absolute `https://www.draftguru.com.au/players/<slug>/<ordinal>`**, **0 trailing slashes**, **all end in a numeric ordinal**; Brad Miller anchors exactly `…/players/brad_miller/1` and `…/players/brad_miller/2`. Frozen normalisation: root-relative href → resolve against `https://www.draftguru.com.au`; output absolute HTTPS, no trailing slash, ordinal preserved exactly; identity never from rendered names. Pinned in `draftguru-contract.json` `canonical_player_url`. | Freezing the §6 normalisation |
| **U2** | Whether Stage B2 (all ~4,937 remaining person pages) is justified. | Depends entirely on §10's B1 profile |
| **U3** | The durable off-host archive path for accepted `raw/` snapshots. | Snapshot acceptance, not acquisition |
| **U4** | **RESOLVED 2026-08-26:** both — `csv-export-20260826.json` asserts `identity_complete: false`, `import_capable: false`, `identity_fields_present: []`, exactly as this runbook's §11 example already showed. | Writing `csv-export-20260826.json` |
| **U5** | Whether a legitimate live-source drift from 6,810 rows / 5,057 persons is accepted for this snapshot or investigated first. | §7/§8 validation sign-off |

---

## 17. Execution recommendation

| | |
|---|---|
| **Model** | **Fable** |
| **Effort** | **High** |
| **Mode** | **Normal** |
| **Basis** | `WORKFLOW.md` §2: *"Multi-file implementation with approved complex runbook — Fable / High / Normal."* The design judgement is done and is in this document; what remains is bounded multi-file implementation against a fixed contract. |
| **Session start** | Fresh session. Read `IssuesIndex.md`, the `AFLDB-ISSUE-093` entry, and **this runbook**; do not re-read the investigation handoff in full — its §1.4/§1.5 field and event catalogues are the only parts the parser needs. |
| **Escalate to Opus** | Only if U1 or the §7 parity stage produces a contradiction with this runbook. `WORKFLOW.md` §3: contradiction between evidence and an approved runbook is a stop-and-report, not a redesign in flight. |
| **First action** | Settle **U1** with one user-run read-only `afldb_dev` lookup, then write `draftguru-contract.json` and `tests/draftguru-acquisition.test.ts` **before** the adapter. |

---

## 18. Execution log — 2026-08-26 (Fable / High / Manual execution session)

### U1 — RESOLVED

User-run read-only `afldb_dev` lookup (psql -X, ON_ERROR_STOP=1, REPEATABLE READ READ
ONLY, ROLLBACK, `default_transaction_read_only=on`): all **5,057** `draft_persons.player_url`
values are absolute `https://www.draftguru.com.au/players/<slug>/<ordinal>`; 0 trailing
slashes; all end in a numeric ordinal; Brad Miller anchors exactly
`https://www.draftguru.com.au/players/brad_miller/1` and `…/2`. The §6 normalisation is
frozen accordingly (root-relative → resolved against the base URL; absolute HTTPS out; no
trailing slash; ordinal preserved exactly; names never identity) and pinned in
`draftguru-contract.json` (`canonical_player_url`, with the U1 evidence recorded inline).

### Files created/changed this session (all new unless noted)

| File | State |
|---|---|
| `tools/rebuild/draftguru/draftguru-contract.json` | CREATED — full §6 contract: base URL, `{base_url}/years/{year}` pattern, 42 expected years, 1983–85 gaps with reason, canonical player_url regex + U1 evidence, Brad Miller regression anchor, `# ↧` selection header, CSV schema variants A/B/C (exact columns/years), live-header rule (variant ± final `Trade`), §1.4 field classification (Games/Goals/Coaches/Brownlow `parity-only-never-fact`), §1.5 event baseline, blank-`#` event set, special-pick-label baseline, 6,810/5,057/1,686 parity baseline, frozen CSV-artifact declaration, `annual-html-[0-9]{8}` label pattern, §4 HTTP policy, comparison-only normalisation rules incl. latin-1→utf-8 mojibake repair |
| `tools/rebuild/draftguru/parse_draft_snapshot.py` | CREATED — pure-stdlib validation parser (§6): fail-closed header/variant matching, verbatim href extraction, U1 canonicalisation (idempotent; `--print-canonical` debug entry), ordinal preservation, club name/href/slug as separate fields, blank→null (`#` never 0), parity-only capture of career figures, per-year schema fingerprints + §5 encoding counts (raw-document and extracted-text), §9 trade profile, §8 identity validation with fail-closed baseline-drift refusal (`--accept-baseline-drift` = the explicit U5 acknowledgement), §7 CSV parity (multiset per-year checks + corpus-level baselines; enumerated exceptions: Trade column, player_url, mojibake repairs), deterministic `parsed/` outputs, `--validate-only` writes nothing, refuses the frozen CSV label. **Deliberately pure ASCII — special codepoints built with `chr()`** (see failed-approach note below) |
| `tools/rebuild/draftguru/acquire_draft.py` | CREATED — Stage A adapter (§1–§5, §11–§13): label pattern enforced (frozen CSV path unreachable), manifest-exists abort BEFORE any network, robots.txt fetched/hashed/honoured (404 = no restrictions, recorded), identifying UA from contract, 20s timeout, ≤3 retries backoff 2/4/8 only on timeout/conn/5xx/429, 1.5s pacing before every request, same-host-only redirects, deterministic ascending years, resume = skip when raw+http exist (never rewrites), zero-byte body = failure, `--years` subset probe NEVER writes a manifest, full run: parse → §8 identity → §9 profile → parsed outputs → §7 parity → manifest written LAST (`identity_complete/import_capable: true` only because every gate passed), atomic tmp+rename writes, sha256 validated `^[0-9a-f]{64}$` |
| `tests/draftguru-acquisition.test.ts` | CREATED — §14 matrix as **30 targeted tests**: contract pins (U1 form incl. negative regex cases, years/gaps, variants, frozen artifact, baselines, HTTP policy), source pins (zero legacy/db dependency, no destructive ops, §4 HTTP contract, manifest-LAST/immutability/sha), parser spawns on fixtures (href verbatim, gary_ablett/2 ordinal, **Brad Miller /1 vs /2 regression**, `--print-canonical` idempotence + trailing-slash/foreign-host rejection, variant-A 1981 shape, unknown-header fail-closed, blank/null + trade profile, raw-bytes hash-unchanged + encoding counts, `--validate-only` writes nothing, `--require-complete` partial refusal, frozen-label refusal), fixture-scale §7 parity (PASS + injected-mismatch FAIL), adapter fail-before-network spawns (manifest immutability, label pattern, 1983 gap refusal), snapshot layout + retrospective manifest + frozen-corpus intactness. Python spawns follow the `fitzroy-core-import.test.ts` `.venv`/`AFLDB_PYTHON` convention and skip when python is absent |
| `tests/fixtures/draftguru/year_2001_excerpt.html` | CREATED — deterministic 16-column (variant C + Trade) excerpt shaped on the Step-2 probe: both Brad Millers (#55 National Melbourne `/players/brad_miller/1`; #30 Rookie Richmond `/players/brad_miller/2`), luke_hodge/1, gary_ablett/2 (ordinal ≠ 1), Clint Bizzell Trade row (blank `#`), NBSP names (as `&#160;` entities), literal ZWSP in Original Club, `# ↧` header. **Synthetic-but-faithful; to be re-derived from real raw/ bytes after the first accepted acquisition** |
| `tests/fixtures/draftguru/year_1981_excerpt.html` | CREATED — variant-A 14-column excerpt (no Draft, no Trade) from the real 1981 CSV rows (Alan Johnson #1 Melbourne, Neil Craig #2 Western Bulldogs) |
| `docs/rebuild-manifests/draftguru/csv-export-20260826.json` | CREATED — retrospective manifest, U4 settled: `identity_complete:false`, `import_capable:false`, `identity_fields_present:[]`, immutable, role = parity oracle only |
| `AFLDB-ISSUE-093-DRAFTGURU-ACQUISITION-HANDOFF.md` | UPDATED — status line, U1/U4 resolved, this §18 |

Gitignored/untracked artifacts expected later (none created yet): `data/sources/draftguru/annual-html-<YYYYMMDD>/**`.

**Not touched (per runbook §15):** `tools/migration/import_draft.py`, migrations/schema, `src/`, `data/sources/draftguru/full-history-20260826/` (verified intact by the new test), `IssuesIndex.md`, `CHANGELOG.md`.

### Failed/rejected approaches (do not repeat)

- **Literal invisible codepoints in source do not survive this editing transport.** A first
  version of the parser embedded literal NBSP/ZWSP constants; NBSP was silently normalised
  to a plain space and the file additionally acquired a stray NUL byte (ripgrep flagged it
  as binary; Python would refuse to compile it). The parser was rewritten **pure ASCII**
  with `chr(0x00A0)`-style constants; the HTML fixtures carry NBSP as `&#160;` entities
  (expanded by the parser) and literal ZWSP (which does survive); the vitest constants file
  keeps literal NBSP/ZWSP/↧ (verified present by codepoint grep). If these tests ever fail
  on name comparisons, check codepoint integrity of the fixtures/test constants first.

### Validation completed (user-run, Windows Git Bash, cwd `D:/dev/afldb`)

1. **U1 read-only `afldb_dev` lookup** — recorded above; SETTLED, do not reopen.
2. **`npx vitest run tests/draftguru-acquisition.test.ts`** — **Test Files: 1 failed;
   Tests: 29 passed / 1 failed / 30 total.** The overall suite is NOT passed. Passing
   areas: acquisition contract 7/7; acquisition static safety pins 4/4; CSV parity
   reconciliation 2/2 (fixture-scale PASS + injected-mismatch FAIL detected); adapter
   fail-before-network 3/3 (manifest immutability, label pattern, 1983-gap refusal);
   snapshot layout 3/3 (gitignore/manifest split, retrospective manifest refusal fields,
   frozen 42-file corpus intact); and the parser fixture spawns for: Brad Miller /1 vs /2
   identity regression, ordinal preservation (`gary_ablett/2`), verbatim href extraction +
   U1 canonicalisation, `--print-canonical` idempotence and trailing-slash/foreign-host
   rejection, 14-column variant A (1981), unknown-header schema-drift fail-closed,
   blank/null semantics + Trade profile, `--validate-only` writes nothing,
   partial-snapshot refusal, frozen-CSV-label refusal.

### The one remaining test failure — THE IMMEDIATE RESUME POINT

- Failing test: `snapshot parser (fixture spawns) > never modifies raw/ bytes and counts
  encoding artefacts instead of repairing them` (`tests/draftguru-acquisition.test.ts:375`).
- Failing assertion: expected `schema.years["2001"].encoding_counts_extracted.nbsp === 4`;
  **actual 5**.
- Assertions that PASSED inside the same test before the failure:
  `encoding_counts_raw_document.zwsp = 4`, `encoding_counts_extracted.zwsp = 4`,
  `downward_arrow >= 1`, `mojibake_signature = 0`, raw-file SHA-256 unchanged,
  `column_count = 16`, `trade_column_present = true`, fingerprint is 64-hex.
- **Root cause NOT yet determined.** Two open hypotheses, neither proven:
  (A) the fixture legitimately contains 5 extracted NBSP codepoints (e.g. a stray
  NBSP outside the four `&#160;` player names, or one introduced during the fixture's
  invisible-character repair edits) and the expectation of 4 is wrong; or
  (B) the parser extracts/counts one NBSP incorrectly. Do not record either as fact
  without deterministic byte/codepoint evidence.

### Exact next action (first task of the takeover session)

One bounded root-cause cycle on the NBSP count. Inspect ONLY:
`tests/fixtures/draftguru/year_2001_excerpt.html`,
`tests/draftguru-acquisition.test.ts`,
`tools/rebuild/draftguru/parse_draft_snapshot.py` — using deterministic byte/codepoint
inspection (never visual whitespace inspection). Decide whether the correct expected
count is 5 or the parser is wrong, then make the smallest justified correction.
Constraints: no literal NBSP/ZWSP/NUL characters in Python source (keep the
chr()/numeric-codepoint approach); do not weaken the test merely to make it green.
Then the user runs:

```text
npx vitest run tests/draftguru-acquisition.test.ts
```

Target: **30/30 PASS.** Only after 30/30 may the smallest live acquisition probe be
considered (`acquire_draft.py --label annual-html-<YYYYMMDD> --years 2001`, then parser
`--parity` on the partial snapshot; fixtures re-derived from real raw bytes if live
markup differs).

### Current acquisition/data state

- Identity-complete Stage A snapshot: **NOT YET ACQUIRED**. Full 42-year HTML crawl:
  **NOT RUN**. Stage A accepted manifest: **NOT CREATED**. Stage A parity against 6,810
  rows: **NOT YET RUN**. Live raw-byte encoding validation: **NOT YET RUN**.
- Stage B1 person-page profiling: **NOT STARTED**. Stage B2: **NOT APPROVED**.
- PostgreSQL DraftGuru importer: **OUT OF SCOPE / NOT STARTED**.
- CSV validation artifact `data/sources/draftguru/full-history-20260826/`: untouched —
  42 files, 6,810 rows, years 1981/1982/1986–2025, intentional gaps 1983–1985,
  `identity_complete = false`, `import_capable = false`.

### Settled design boundaries — MUST NOT be reopened

ZERO `AFLDB_LEGACY_SQLITE`; annual server-rendered HTML is the identity-bearing
acquisition surface; the CSV export is validation/parity only; `player_url` is the durable
DraftGuru person identity; canonical form is absolute HTTPS `www.draftguru.com.au` with a
numeric ordinal and no trailing slash (U1); the rendered player name is never identity;
Brad Miller `/1` and `/2` are different people; old automatic DraftGuru player links are
not replayable identity truth; explicit human decisions are distinct from the automatic
reconciliation baseline; acquisition and PostgreSQL import remain separate stages; Stage
B2 is not approved; `IssuesIndex.md`/`CHANGELOG.md` completion updates wait until
acquisition validation is actually complete.

### Expected working tree (no Git was run by the agent)

Untracked (new): `tools/rebuild/draftguru/draftguru-contract.json`,
`tools/rebuild/draftguru/parse_draft_snapshot.py`,
`tools/rebuild/draftguru/acquire_draft.py`, `tests/draftguru-acquisition.test.ts`,
`tests/fixtures/draftguru/year_2001_excerpt.html`,
`tests/fixtures/draftguru/year_1981_excerpt.html`,
`docs/rebuild-manifests/draftguru/csv-export-20260826.json`.
Modified: `AFLDB-ISSUE-093-DRAFTGURU-ACQUISITION-HANDOFF.md` (untracked at session start,
so it appears as untracked too). The raw CSV snapshot under `data/` is gitignored and was
not modified. No other repository file was changed by this session.

---

## 19. Execution log — 2026-08-26 (Opus / High / Manual-execution takeover session)

### NBSP count failure — ROOT-CAUSED AND CORRECTED (hypothesis A confirmed)

**Prior state carried in:** `npx vitest run tests/draftguru-acquisition.test.ts` = **29 passed /
1 failed / 30 total**; failing assertion
`schema.years["2001"].encoding_counts_extracted.nbsp === 4`, actual `5`
(`tests/draftguru-acquisition.test.ts:375`).

**Deterministic evidence gathered (codepoint/entity grep only — no visual whitespace
inspection, no command execution):**

| Measurement | Result |
|---|---|
| `&#160;` entity occurrences in `tests/fixtures/draftguru/year_2001_excerpt.html` | **6**, at lines **5, 26, 33, 40, 47, 54** |
| Line 5 | inside the leading **HTML comment**, not a table cell — correctly never extracted |
| Lines 26/33/40/47/54 | the **five player-name cells**: `luke_hodge/1`, `gary_ablett/2`, `brad_miller/1`, `brad_miller/2`, `clint_bizzell/1` |
| Literal `U+00A0` bytes in the fixture | **0** (`\x{00A0}` grep: no matches) |
| Literal `U+200B` ZWSP bytes in the fixture | **4** |

**Why ZWSP is 4 and NBSP is 5 — not a discrepancy:** ZWSP follows the `/` in `Original Club`,
and only four of the five rows have one (Brad Miller `/1`'s `Mount Gravatt` has no `/`). NBSP
sits inside every player name, so it is one per row = five.

**Parser extraction domain verified correct, not fixed:**

- `parse_draft_snapshot.py:256` computes `encoding_counts_raw_document` on the decoded
  document **before** entity expansion — hence `nbsp = 0`, `zwsp = 4`, exactly matching the
  assertions that already passed.
- `extracted_text_parts` (`:292` header columns once, `:372` each cell text once) contains no
  duplicated and no out-of-domain text; `encoding_counts()` (`:221`) is a plain `str.count`.
- Therefore **5 is the true extracted NBSP count**. Hypothesis (B) — parser double-counting or
  counting outside the extraction domain — is **disproven**.

**Root cause:** the *test expectation* was wrong. It mirrored the ZWSP count of `4`, which is
4 for an unrelated reason (one row lacks a `/` in `Original Club`). The parser, the fixture
and the contract are all correct and were **not** changed.

**File changed (one, test-only):** `tests/draftguru-acquisition.test.ts` — in
*"never modifies raw/ bytes and counts encoding artefacts instead of repairing them"*:

- `encoding_counts_extracted.nbsp` expectation corrected `4` → **`5`**;
- **strengthened, not weakened** — added `encoding_counts_raw_document.nbsp === 0` (pins the
  entity-vs-literal-byte distinction that caused the confusion) and
  `encoding_counts_extracted.nbsp === info.row_count` (pins the invariant *one NBSP per player
  name per row*, so a future fixture row change cannot silently drift the count);
- comment rewritten to record why ZWSP is 4 and NBSP is 5, and that the 6th `&#160;` lives in
  the fixture's HTML comment.

**Not changed:** `tools/rebuild/draftguru/parse_draft_snapshot.py` (no Python edited, so the
pure-ASCII / `chr()`-constant constraint is untouched and no NBSP/ZWSP/NUL was introduced),
`tests/fixtures/draftguru/year_2001_excerpt.html`, `draftguru-contract.json`,
`acquire_draft.py`, `data/sources/draftguru/full-history-20260826/`, `IssuesIndex.md`,
`CHANGELOG.md`. No Git, no shell, no SQL, no network access performed by the agent.

### Validation — COMPLETE, 30/30 PASS

User-run, Windows Git Bash, cwd `/d/dev/afldb`:

```text
npx vitest run tests/draftguru-acquisition.test.ts
```

**Result: Test Files 1 passed; Tests 30 passed / 30 total; duration 2.85s.** Every contract,
parser, identity-regression, encoding, parity, adapter, manifest-safety and snapshot-layout
test is green. The NBSP correction is validated; the prior 29/30 state is closed.

**Acquisition implementation gate: PASSED.**

**Stage A live acquisition itself: NOT YET RUN.** Unchanged from §18 — snapshot NOT acquired,
42-year crawl NOT run, accepted manifest NOT created, live raw-byte encoding validation NOT
run, 6,810-row parity NOT run. Stage B1 NOT started; Stage B2 NOT approved.

### Verified CLI surface (inspected, not invented)

`tools/rebuild/draftguru/acquire_draft.py` — `--label` (required, must match
`annual-html-[0-9]{8}`), `--years` (comma-separated bounded probe), `--snapshot-root`,
`--manifest-dir`, `--accept-baseline-drift`.

`tools/rebuild/draftguru/parse_draft_snapshot.py` — `--label`, `--snapshot-root`,
`--validate-only`, `--require-complete`, `--parity`, `--parity-dir`,
`--accept-baseline-drift`, `--print-canonical HREF`.

**`--years` probe semantics confirmed by reading `acquire_draft.py:344-390`:** label pattern
enforced and manifest-existence checked **before any network access**; requested years
validated against the 42-year set with the 1983–85 gaps refused outright; robots.txt fetched
and hashed; each year fetched with §4 pacing/retry/redirect policy; raw bytes written verbatim
to `raw/years/year_<Y>.html` plus an `http/years/year_<Y>.json` record; resume skips anything
already acquired and never rewrites it; then it prints `"mode": "partial-probe",
"manifest_written": false` and **returns without parsing and without writing a manifest**. The
manifest is reachable only from the complete non-`--years` path (`:392-413`), after parse +
identity + trade profile + parity all pass. A probe therefore cannot produce an accepted Stage
A manifest, and parsing is a deliberately separate second command.

### Exact next action — bounded 2001 live probe

Step 1 (issued to the user, awaiting output): acquire the single 2001 annual page under label
`annual-html-20260826`, writing raw bytes only.

```text
.venv/Scripts/python.exe tools/rebuild/draftguru/acquire_draft.py --label annual-html-20260826 --years 2001
```

Label choice: `annual-html-20260826` matches the pinned pattern, is deliberately dissimilar to
the frozen CSV label `full-history-20260826`, and has no existing manifest
(`docs/rebuild-manifests/draftguru/` holds only `csv-export-20260826.json`). Reusing this label
for the later full Stage A run is intended — §4 resume semantics skip the already-acquired 2001
page rather than re-fetching it, and a later parser correction re-derives `parsed/` from the
same `raw/` bytes.

Step 2 (only after step 1's output is evaluated): parse the partial snapshot with the existing
parser to measure, from real server bytes, the §"Live probe objectives" list — real header
accepted, root-relative hrefs extracted verbatim, canonical `player_url`, Brad Miller `/1` vs
`/2` distinct, ordinals preserved, NBSP/ZWSP/mojibake/`↧` counted, Trade column profiled — then
parity semantics. Exact command issued after step 1.

**The probe must not:** acquire all 42 years, write an accepted Stage A manifest, start Stage
B1, touch PostgreSQL or `AFLDB_LEGACY_SQLITE`, or modify
`data/sources/draftguru/full-history-20260826/`. None of these are reachable from the command
above.

### Step 1 — bounded 2001 live acquisition: EXECUTED, SUCCEEDED

User-run, Windows Git Bash, cwd `/d/dev/afldb`:

```text
.venv/Scripts/python.exe tools/rebuild/draftguru/acquire_draft.py --label annual-html-20260826 --years 2001
```

Output:

```text
year 2001: 200 178974 bytes
{"label": "annual-html-20260826", "manifest_written": false, "mode": "partial-probe", "note": "partial/probe acquisition — the manifest is written only by a complete validated 42-year run", "years_fetched_now": [2001], "years_requested": [2001]}
```

**Evidence recorded:**

| Fact | Value |
|---|---|
| HTTP status | **200** |
| Raw body | **178,974 bytes**, written verbatim to `data/sources/draftguru/annual-html-20260826/raw/years/year_2001.html` |
| HTTP record | `data/sources/draftguru/annual-html-20260826/http/years/year_2001.json` (status, final URL, headers subset, `fetched_at`, byte size, SHA-256) |
| Years acquired | **2001 only** — `years_requested == years_fetched_now == [2001]` |
| Mode | **`partial-probe`** |
| Manifest | **`manifest_written: false`** — no Stage A acceptance occurred |
| robots.txt | fetched and hashed before any year request; no restriction blocked the path (the run proceeded) |
| Failures | none — the adapter's non-zero partial-failure path was not taken |

**No full Stage A acceptance occurred.** The 42-year crawl remains NOT RUN, the accepted
manifest remains NOT CREATED, Stage B1 remains NOT STARTED, and no PostgreSQL /
`AFLDB_LEGACY_SQLITE` access and no write to the frozen CSV corpus was possible from this
code path. **The live source still serves the 2001 annual page as server-rendered HTML at the
pinned URL** — no JavaScript execution, no browser, one request.

### Step 2 — parse/validate the real 2001 bytes (command issued, awaiting output)

CLI re-inspected before choosing the command; **no flag invented**. Two ordering facts from
`parse_draft_snapshot.py:852-888` decide the sequencing:

1. **Without `--require-complete`**, `validate_identity` (`:489-527`) still enforces the
   fail-closed per-row gates — every `player_url` must match the pinned canonical regex and
   every ordinal must be a positive integer — but **skips** the 6,810-row / 5,057-person
   corpus baseline, so a one-year probe cannot falsely trip baseline drift. Correct for a probe.
2. **`run_parity` executes BEFORE `write_parsed`** (`:869-877`), and a parity failure raises
   `ParseFailure`, so a `--parity` run that mismatched would abort **without writing
   `parsed/`** — losing the schema fingerprint, encoding counts, trade profile, canonical
   `player_url` values and ordinals this probe exists to measure.

**Therefore this step runs the parse WITHOUT `--parity`** so `parsed/` is durably written
first, and parity is the immediately following command against the same already-parsed
snapshot. This is evidence preservation, not a weakening: parity is fail-closed either way and
is still mandatory before any Stage A acceptance.

```text
.venv/Scripts/python.exe tools/rebuild/draftguru/parse_draft_snapshot.py --label annual-html-20260826
```

Expected to establish, from real server bytes: accepted real header shape + column count +
64-hex fingerprint, extracted row count, canonical `player_url` per row, Brad Miller `/1` vs
`/2` as two distinct persons, ordinal preservation, raw-document and extracted NBSP/ZWSP
counts, downward-arrow presence, mojibake signature, and the §9 Trade-column profile — written
to `parsed/schema.json`, `parsed/rows.jsonl`, `parsed/persons.jsonl`,
`parsed/trade_column_profile.json` and summarised on stdout. Parity against the frozen 2001
CSV follows as step 3 (`--parity`, corpus read-only, overlapping-year comparison only when
`--require-complete` is absent, per `:655-668`).

### Step 2 — real-source parse: EXECUTED, SUCCEEDED

User-run output:

```text
{"distinct_person_count": 156, "identity": {"baseline_distinct_persons": 5057, "baseline_drift": null, "baseline_total_rows": 6810, "distinct_person_count": 156, "total_rows": 156}, "label": "annual-html-20260826", "parity": "SKIPPED", "total_rows": 156, "validate_only": false, "years_parsed": [2001]}
```

- **2001 parsed successfully** from the real 178,974 raw bytes; `years_parsed: [2001]`.
- **156 rows**; **156 distinct `player_url` identities** (one row per person in 2001 — no
  person appears twice this year).
- **Canonical identity validation PASSED** — `validate_identity()` enforces the pinned
  canonical regex on every row's `player_url` and a positive integer ordinal on every row;
  all 156 rows cleared both gates fail-closed.
- **Corpus baseline drift intentionally NOT enforced** for a partial probe (`baseline_drift:
  null`; the 6,810/5,057 baselines are reported alongside for reference only). Enforcement is
  reached only on a `--require-complete` 42-year run.
- **Parity: SKIPPED** — still pending, step 3.
- **Stage A still NOT accepted**; no manifest written.

### Step 2 artifact inspection (agent-side, native file reads — no user command)

Artifacts at `data/sources/draftguru/annual-html-20260826/parsed/`.

| # | Measurement | Result from real 2001 bytes |
|---|---|---|
| 1 | **Live header/schema shape** | **15 columns**, one matched table (`table_count: 1`): `Pick`, `Draft`, `# ↧`, `Club`, `Signing`, `Player`, `Age`, `Height`, `Original Club`, `Grade`, `Games`, `Goals`, `Coaches`, `Brownlow`, `Awards`. Fingerprint `429645c7c72f8ffc3af0e34893a2edd4250e2e95683e92f9e1287aa0567e5b2e` (64-hex). Charset `utf-8` from `http-content-type` (`text/html; charset=utf-8`). **This is CSV variant C exactly, with NO trailing `Trade` column** |
| 2 | **Brad Miller /1 and /2 both present and distinct** | **YES** — two separate `persons.jsonl` records, identical display name `Brad Miller` (NBSP inside), `row_count: 1` each |
| 3 | **Canonical URLs** | `https://www.draftguru.com.au/players/brad_miller/1` and `https://www.draftguru.com.au/players/brad_miller/2` — absolute HTTPS, `www.draftguru.com.au`, no trailing slash, exactly the U1 frozen form |
| 4 | **Ordinal preservation** | `player_ordinal: 1` and `player_ordinal: 2`, from `player_href_raw` `/players/brad_miller/1` and `/players/brad_miller/2` captured verbatim |
| 5 | **Raw-document NBSP** | **0** |
| 6 | **Extracted NBSP** | **255** |
| 7 | **Raw-document ZWSP** | **0** |
| 8 | **Extracted ZWSP** | **129** |
| 9 | **Downward arrow `↧`** | raw-document **0**, extracted **1** — present, in the `# ↧` selection header |
| 10 | **Mojibake signature** | **0** in both raw document and extracted text |
| 11 | **Trade column present** | **NO** — `trade_column_present: false`; every row carries `trade_raw: null` |
| 12 | **Populated Trade values / forms** | `years_with_trade_header: []`, `populated_by_year: {}`, `total_populated: 0`, `distinct_values: {}`, `link_paths: []` — nothing to profile in 2001 |
| 13 | **Live-vs-fixture differences** | Three, all recorded below; none changes code |

**The mandatory §8 regression, re-proven against real bytes (not the synthetic fixture):**

```text
/players/brad_miller/1  ->  2001 National  #55  Melbourne   Mount Gravatt   18yr 194cm
/players/brad_miller/2  ->  2001 Rookie    #30  Richmond    Western U18     age/height null
```

This matches the runbook §8 anchor exactly. The identity model holds on live data.

**2001 event vocabulary (156 rows):** National 68, Rookie 54, Trade 29, Pre-Season 5. All four
are inside the pinned 11-group baseline; **no unexpected event vocabulary**.

#### Live-vs-fixture / live-vs-prior-observation differences (measured, NOT "repaired")

1. **The live 2001 table has 15 columns and no `Trade` column.** The Step-2 investigation probe
   recorded a "16-column table", and `tests/fixtures/draftguru/year_2001_excerpt.html` was
   built on that observation as variant C + `Trade`. **This is not a contract violation:** the
   contract's live-header rule accepts a known variant *with or without* the trailing `Trade`
   column, the header was accepted, the fingerprint is deterministic, and parsing did not fall
   back to best-effort. The 16-column fixture remains a valid test of the permitted
   `Trade`-bearing shape. Candidate explanations — **unresolved and not to be guessed at**: the
   earlier probe may have counted a rendered/browser-side column absent from `<thead>`, or read
   a different table on the page, or the page changed. **Resolution comes from the §9 profile
   across all 42 pages**, which will show which years (if any) carry the column. Do not edit the
   fixture, the contract or the parser on the strength of one year.
2. **NBSP, ZWSP and `↧` are HTML entities in the live source, not literal codepoints.** Every
   `encoding_counts_raw_document` value is 0 while the extracted counts are 255/129/1 — the
   parser counts the raw document *before* entity expansion (`parse_draft_snapshot.py:256`), so
   0/N is the signature of entity encoding. The synthetic fixture used literal ZWSP bytes and
   `&#160;` entities, hence its 4/4 raw/extracted ZWSP. **Real-source behaviour measured; the
   parser needs no change** — it counts rather than repairs, exactly as §5 requires.
3. **Zero mojibake in the live source.** `mojibake_signature: 0` raw and extracted. This is
   positive evidence that the six damaged names (`Setanta Ã hAilpÃ­n` etc.) are **browser-export
   corruption, not upstream corruption** — which is precisely why §7 carries mojibake repair as
   a documented, enumerated parity exception applied to the *CSV* side.

**No stop condition triggered.** Raw bytes preserved; the real header was accepted by the
pinned contract; root-relative hrefs extracted verbatim; canonicalisation exact; Brad Miller
`/1` vs `/2` distinct; ordinals preserved; no PostgreSQL, no `AFLDB_LEGACY_SQLITE`, no write to
the frozen corpus. **The settled identity/schema contract is contradicted by nothing measured
here.**

**Anticipatory check (read-only, agent-side):** the frozen
`2001_AFL_Draft_and_Trade_Period_Table_1.csv` holds **157 lines = 1 header + 156 data rows**,
matching the live 156 parsed rows exactly.

### Step 3 — 2001 CSV parity (command issued, awaiting output)

CLI re-inspected; **no flag invented**. `--parity` reconciles against the frozen corpus at the
contract's `csv_artifact.path` (read-only; `--parity-dir` is the fixture-scale override and is
deliberately NOT used). Without `--require-complete`, `run_parity` (`:655-668`) compares only
the overlapping years — here 2001 alone — and skips the corpus-level 6,810 / 1,686 / event- and
label-total baselines, which only a complete run may assert. `--validate-only` is added so the
step-2 `parsed/` artifacts recorded above are **not rewritten**; parity runs before
`write_parsed` and is unaffected by it (`:869-877`).

```text
.venv/Scripts/python.exe tools/rebuild/draftguru/parse_draft_snapshot.py --label annual-html-20260826 --parity --validate-only
```

Per-year checks this will apply to 2001, fail-closed: row count, event vocabulary, selection
numbers, special pick labels, player display names (after NBSP→space, ZWSP strip, mojibake
repair on the CSV side, NFC), destination club labels, `Signing`, `Detail`, `Original Club`.
Documented exceptions carried by design: the `Trade` column and `player_url`, both absent from
the CSV export.

### Step 3 — 2001 CSV parity: EXECUTED, **FAILED NARROWLY** (then root-caused, see below)

```text
.venv/Scripts/python.exe tools/rebuild/draftguru/parse_draft_snapshot.py --label annual-html-20260826 --parity --validate-only
```

```text
PARSE FAILURE: CSV parity failed (unexplained population differences fail validation):
  year=2001: special pick labels mismatch -- HTML {'Priority(Fremantle)': 1, 'Priority(St Kilda)': 1, 'Priority(West Coast)': 1} vs CSV {'Priority (Fremantle)': 1, 'Priority (St Kilda)': 1, 'Priority (West Coast)': 1}
  year=2001: signing values mismatch -- HTML {'Father-Son(Gary Ablett)': 1, 'Father-Son(Vin Waite)': 1} vs CSV {'Father-Son (Gary Ablett)': 1, 'Father-Son (Vin Waite)': 1}
```

**Population reconciles; only rendered-value spacing differed.** 156 live rows vs 156 CSV rows;
row count, event vocabulary, selection numbers, player display names, destination club labels,
`Detail` and `Original Club` all passed. **Exactly five values** mismatched, each by a single
missing space:

```text
Priority(Fremantle)      vs  Priority (Fremantle)
Priority(St Kilda)       vs  Priority (St Kilda)
Priority(West Coast)     vs  Priority (West Coast)
Father-Son(Gary Ablett)  vs  Father-Son (Gary Ablett)
Father-Son(Vin Waite)    vs  Father-Son (Vin Waite)
```

**No baseline was changed. No parity rule was weakened. Stage A remains NOT ACCEPTED.**

### Root cause — PROVEN from raw bytes: hypothesis **C** (mechanically **B**), NOT **A**

Direct raw-HTML evidence from `raw/years/year_2001.html` (bytes untouched, read only):

```html
line  634:  <td class="category">
              Priority<br/>(Fremantle)
            </td>
line  654:  <td class="category">
              Priority<br/>(St Kilda)
line  674:  <td class="category">
              Priority<br/>(West Coast)
line 1383:  <td class="category">Father-Son<br/>(<a href="/players/gary_ablett/1">Gary&nbsp;Ablett</a>)
            </td>
line 1479:  <td class="category">Father-Son<br/>(<a href="/players/vin_waite/1">Vin&nbsp;Waite</a>)
            </td>
```

**The separation is genuinely in the source, as a `<br/>` element.** `_TableParser`
(`parse_draft_snapshot.py:132-162`) handled only `table`/`tr`/`td`/`th`/`a` start tags and
appended `handle_data` text; `<br/>` produced no `handle_data` call and no separator, so the two
text nodes on either side were concatenated directly — `Priority` + `(Fremantle)` =
`Priority(Fremantle)`. The browser renders `<br/>` as a line break and the browser export
flattened that break to a single space.

- **Hypothesis A is DISPROVEN.** The CSV did not invent presentation whitespace; it faithfully
  flattened a real line-break element the parser was dropping. No parity-only comparison
  exception was added, and the canonical parsed value was not bent to mimic the CSV.
- **Hypothesis B/C is PROVEN.** The parser was incorrectly joining adjacent semantic text nodes
  across an element that separates them.

**Blast radius measured, not assumed:** the entire 2001 document contains **exactly five**
`<br` occurrences — lines 634, 654, 674, 1383, 1479 — i.e. precisely the five mismatched cells.
The fix cannot touch anything else in this page.

**Incidental structural finding (recorded, no action):** the `Signing` cell carries the
*father's* player href (`/players/gary_ablett/1`, `/players/vin_waite/1`) alongside the son's
row. Row identity is taken only from the `Player` column and was unaffected — now pinned by an
assertion so it cannot regress.

### Files changed

| File | Change |
|---|---|
| `tools/rebuild/draftguru/parse_draft_snapshot.py` | `_TableParser.handle_starttag` gains one branch: a `<br>` inside a cell appends `"\n"` to that cell's parts. `_Cell.text()`'s **existing** ASCII-whitespace collapse (`:117-121`) reduces it to exactly one space. **No new trim/collapse/spacing rule, no generic whitespace normalisation, no change to identity handling, no change to encoding counting.** `html.parser` routes both `<br>` and `<br/>` through `handle_starttag`. Source stays pure ASCII — `"\n"` is an escape sequence, not a literal invisible codepoint |
| `tests/draftguru-acquisition.test.ts` | New regression test *"separates text nodes across `<br>` in Pick and Signing cells (live 2001 structure)"*, using inline HTML reproducing the exact live markup for **both** classes: asserts `pick_note_raw === "Priority (Fremantle)"` and `signing_raw === "Father-Son (Gary<NBSP>Ablett)"`; asserts the fix is scoped to `<br>` (NBSP preserved inside the qualifier; `Original Club` stays `Colac/<ZWSP>Geelong U18` with no invented space); asserts row identity still comes only from the `Player` column despite the father's href in the `Signing` cell |

**Not changed:** raw snapshot bytes, the frozen CSV corpus, `draftguru-contract.json` (no
baseline touched), `acquire_draft.py`, the existing fixtures, any `src/`, migration or importer
file. No network fetch, no additional year, no Stage A run, no manifest.

### Validation — COMPLETE

**1. Targeted suite (user-run):** `npx vitest run tests/draftguru-acquisition.test.ts` →
**31/31 PASS** (30 prior + the new `<br>` regression).

**2. 2001 CSV parity re-run, command unchanged (user-run):**

```text
.venv/Scripts/python.exe tools/rebuild/draftguru/parse_draft_snapshot.py --label annual-html-20260826 --parity --validate-only
```

```text
{"distinct_person_count": 156, "identity": {"baseline_distinct_persons": 5057, "baseline_drift": null, "baseline_total_rows": 6810, "distinct_person_count": 156, "total_rows": 156}, "label": "annual-html-20260826", "parity": "PASS", "total_rows": 156, "validate_only": true, "years_parsed": [2001]}
```

**`"parity": "PASS"`** — all 2001 per-year checks reconcile against the frozen browser-export
corpus: row count 156≡156, event vocabulary, selection numbers, special pick labels, player
display names, destination club labels, `Signing`, `Detail`, `Original Club`. No parity rule
was weakened, no baseline altered, no comparison exception added.

---

## 20. 2001 LIVE PROBE — FULLY VALIDATED (2026-08-26)

The bounded 2001 live probe has **passed end to end**:

| Objective | Result |
|---|---|
| HTTP acquisition | **PASS** — 200, 178,974 bytes, one request, respectful policy honoured |
| Raw-byte preservation | **PASS** — written verbatim in binary; SHA-256 recorded; never edited |
| Live schema parsing | **PASS** — real 15-column variant-C header accepted by the pinned contract, fail-closed, deterministic 64-hex fingerprint |
| Canonical `player_url` extraction | **PASS** — 156/156 rows, absolute HTTPS `www.draftguru.com.au`, no trailing slash |
| Ordinal preservation | **PASS** — ordinals taken verbatim from the href, positive-integer gate on every row |
| **Brad Miller /1 vs /2 identity regression** | **PASS on real bytes** — `/1` National #55 Melbourne, `/2` Rookie #30 Richmond, identical rendered names, two distinct persons |
| Real encoding measurement | **PASS** — NBSP/ZWSP/`↧` are entities upstream (raw 0 / extracted 255/129/1); mojibake 0, proving the six damaged names are export corruption |
| `<br>` semantic separation regression | **PASS** — found, root-caused from raw bytes, fixed in the parser, pinned by a new test |
| Targeted test suite | **PASS — 31/31** |
| Live CSV parity (2001) | **PASS** |

**Stage A full acquisition remains NOT RUN and NOT ACCEPTED.** No manifest exists; the 42-year
crawl has not been attempted; Stage B1 not started; Stage B2 not approved; no PostgreSQL, no
`AFLDB_LEGACY_SQLITE`, no change to the frozen CSV corpus; `IssuesIndex.md` and `CHANGELOG.md`
deliberately untouched.

### Next bounded step — validate the oldest 14-column historical shape (live)

**Remaining live schema risk.** 2001 proved the modern variant-C shape. The materially
different historical shape is **variant A: 14 columns, no `Draft` column, `Detail` retained** —
years **1981, 1982, 1987**. Only a synthetic fixture has exercised it; no real current bytes
have.

**Target year: 1981.** Chosen by inspection of the frozen corpus, not preference:

| Evidence | 1981 |
|---|---|
| CSV shape | `Pick,# ↧,Club,Detail,Player,Age,Height,Original Club,Grade,Games,Goals,Coaches,Brownlow,Awards` — variant A exactly |
| Rows | 24 (25 lines incl. header) |
| Exercises | oldest page on the site; no `Draft` column at all (the `__no_draft_column__` event class); dense null semantics (`Pick` blank on every row, `Age`/`Height`/`Original Club`/`Grade` frequently empty); ZWSP-delimited multi-part `Original Club`; a comma-quoted `Awards` field (`"B&F: 1983, 1989"`) exercising the parity CSV reader |
| Considered alternatives | **1982 and 1987 give nothing extra.** A field-4 population check shows **zero** populated `Detail` rows in 1981, 1982 *and* 1987 — the only match in each file is the header itself. So no variant-A year proves `Detail` content, and none is superior to the oldest page |

**Resume safety verified against the code before issuing the command:**

- `acquire_years()` (`acquire_draft.py:202-226`) iterates **only the requested years**, so 2001
  is not even considered; and its first action per year is to skip anything whose `raw/` **and**
  `http/` files already exist — 2001 cannot be re-fetched or rewritten either way.
- `--years` sets `partial = True`, which returns at `:380-390` **before** the parse / identity /
  parity / manifest path. A probe **cannot** write a manifest.
- The manifest-exists abort runs **before any network access**; `docs/rebuild-manifests/draftguru/`
  currently holds only `csv-export-20260826.json`, so `annual-html-20260826.json` is absent and
  the run proceeds — and still cannot create it.
- 1981 is in `expected_years` and is not one of the 1983–85 gap years, so it clears the
  requested-year validation.
- `check_robots()` (`:171-195`) re-fetches and re-records robots.txt each run: **2 requests
  total** (robots + 1981), 1.5s pacing, 20s timeout, ≤3 retries.
- Current snapshot contents confirmed: `http/robots.txt`, `http/robots_txt.json`,
  `raw/years/year_2001.html`, `http/years/year_2001.json`, `parsed/{rows,persons}.jsonl`,
  `parsed/{schema,trade_column_profile}.json`. Acquisition does not touch `parsed/`; a later
  parser run without `--validate-only` regenerates it deterministically from `raw/` covering
  both years.

**No blocker. Command issued (awaiting output):**

```text
.venv/Scripts/python.exe tools/rebuild/draftguru/acquire_draft.py --label annual-html-20260826 --years 1981
```

Parser/parity commands for 1981 follow only after this output is evaluated.

### 1981 live acquisition: EXECUTED, SUCCEEDED

```text
.venv/Scripts/python.exe tools/rebuild/draftguru/acquire_draft.py --label annual-html-20260826 --years 1981
```

```text
year 1981: 200 28979 bytes
{"label": "annual-html-20260826", "manifest_written": false, "mode": "partial-probe", "note": "partial/probe acquisition — the manifest is written only by a complete validated 42-year run", "years_fetched_now": [1981], "years_requested": [1981]}
```

| Fact | Value |
|---|---|
| HTTP status | **200** |
| Raw body | **28,979 bytes** → `raw/years/year_1981.html`, verbatim |
| HTTP record | `http/years/year_1981.json` |
| Years acquired | **1981 only** — `years_requested == years_fetched_now == [1981]` |
| Mode | **`partial-probe`** |
| Manifest | **`manifest_written: false`** |
| 2001 artifacts | **PRESERVED** — `raw/years/year_2001.html` and `http/years/year_2001.json` neither re-fetched nor rewritten (the run never considered 2001) |

**Stage A still NOT RUN and NOT ACCEPTED.** The snapshot now holds **2 of 42** years.

### Two-year parse (1981 + 2001) — command issued, awaiting output

CLI re-inspected; **no flag invented**. `--parity` is **deliberately excluded from this
command**: `run_parity` executes *before* `write_parsed` (`parse_draft_snapshot.py:869-877`)
and raises on mismatch, so a combined run that failed would leave no `parsed/` artifacts to
inspect — exactly the trap that made the 2001 `<br>` root cause recoverable only because parse
and parity were separated. Parity for 1981 is the following command.

`--require-complete` is also excluded: without it, `parse_snapshot` accepts a 2-year snapshot
and `validate_identity` (`:489-527`) skips the 6,810-row / 5,057-person corpus baseline while
still enforcing the per-row canonical-URL and positive-ordinal gates fail-closed. **No
full-corpus baseline is enforced on a partial snapshot.**

```text
.venv/Scripts/python.exe tools/rebuild/draftguru/parse_draft_snapshot.py --label annual-html-20260826
```

Expected to establish: both years parse; the **real** 1981 variant-A 14-column header (no
`Draft`, `Detail` retained) is accepted by the pinned contract, fail-closed; no-`Draft`
semantics on real bytes (`event_type_raw` null → the `__no_draft_column__` class); null vs zero
handling for the blank `Pick` column and any blank selection number; ZWSP measurement in
multi-part `Original Club`; the comma-quoted `Awards` value (`"B&F: 1983, 1989"`) surviving
intact; 2001 unchanged; identity validation passing across both years.

> Note: this run **regenerates** `parsed/` to cover both years, replacing the 2001-only
> artifacts. That is deterministic re-derivation from unchanged `raw/` bytes, and it also
> refreshes 2001's `pick_note_raw`/`signing_raw` to the post-`<br>`-fix values.

### Two-year parse: EXECUTED, SUCCEEDED

```text
{"distinct_person_count": 180, "identity": {"baseline_distinct_persons": 5057, "baseline_drift": null, "baseline_total_rows": 6810, "distinct_person_count": 180, "total_rows": 180}, "label": "annual-html-20260826", "parity": "SKIPPED", "total_rows": 180, "validate_only": false, "years_parsed": [1981, 2001]}
```

- **1981 and 2001 both parse successfully** — `years_parsed: [1981, 2001]`.
- **Total rows 180**; **distinct persons 180** (still one row per person across the sample).
- **1981 contributes the expected 24 rows** (180 − 156), matching the frozen 1981 CSV's
  25 lines = header + 24 rows exactly.
- **Per-row canonical identity validation PASSED** across both years — canonical `player_url`
  regex and positive-integer ordinal enforced on all 180 rows, fail-closed.
- **Parity still pending**; `"parity": "SKIPPED"`.
- **Full 6,810 / 5,057 corpus baseline intentionally NOT enforced** (`baseline_drift: null`;
  baselines reported for reference only — enforcement needs `--require-complete`).
- **Stage A still NOT RUN / NOT ACCEPTED.**

### 1981 artifact inspection (agent-side, native file reads — no user command)

| # | Objective | Evidence |
|---|---|---|
| 1 | **Live 1981 header/schema** | **14 columns**, `table_count: 1`: `Pick`, `# ↧`, `Club`, `Detail`, `Player`, `Age`, `Height`, `Original Club`, `Grade`, `Games`, `Goals`, `Coaches`, `Brownlow`, `Awards` — **variant A exactly**: no `Draft`, no `Signing`, `Detail` retained. Distinct fingerprint `170485f66c3935f72a490ff37919d5181390ac908db3532687df7222b7b6d4c5`; charset utf-8 from HTTP `Content-Type`; `trade_column_present: false`. **The real historical shape is accepted by the pinned contract, fail-closed** |
| 2 | **No-`Draft` semantics** | `event_type_raw: null` on exactly **24** rows corpus-wide — i.e. all of 1981 and none of 2001. This is the pinned `__no_draft_column__` class; the absent column becomes NULL, never a fabricated event type |
| 3 | **`pick_number` / null distribution** | `pick_number: null` on exactly **29** rows corpus-wide — precisely 2001's 29 `Trade` rows. **1981 has zero nulls**: all 24 rows carry selection numbers 1–24. `pick_note_raw` is null on every 1981 row (`Pick` column blank throughout), and `detail_raw` is null on all **180** rows — 1981's `Detail` column is empty on every row (matching the frozen CSV) and 2001 has no `Detail` column at all. `Detail` and `Signing` stayed separate concepts |
| 4 | **ZWSP in `Original Club`** | Measured, not repaired: `"Maitland (SA)/<ZWSP>Norwood/<ZWSP>Sturt"` (ZWSP after **each** `/` in a three-part value), `"Elizabeth/<ZWSP>Central District"`. Year totals: extracted ZWSP **19**, NBSP **43**, `↧` **1**, mojibake **0** — with **raw-document counts all 0**, confirming 1981 encodes them as entities exactly as 2001 does. Blank `Original Club` → `null`, never `""` |
| 5 | **Comma-quoted `Awards`** | Preserved intact under `parity_only`: `"B&F:<NBSP>1983, 1989"` and the long multi-award value `"AA:<NBSP>1985, 1986, 1987, 1988, 1992; Brownlow:<NBSP>1987; B&F:<NBSP>1987, 1994; Magarey:<NBSP>1984; Prem:<NBSP>1986, 1988, 1989, 1991"` — internal commas and semicolons intact, no field splitting, NBSP preserved verbatim rather than silently flattened |
| 6 | **Live-vs-fixture differences** | Same class as 2001, no new kind: the real page carries **NBSP inside player names** (`Alan<NBSP>Johnson`, `Neil<NBSP>Craig`) and **NBSP after award labels**, all as entities (raw-document count 0), where the synthetic `year_1981_excerpt.html` used plain text. Real 1981 also leaves `Age`/`Height`/`Original Club`/`Grade` empty on many rows — exercising blank→null harder than the fixture does. **No parser change warranted; the fixture remains a valid variant-A shape test** |
| 7 | **2001 unchanged** | Fingerprint still `429645c7…567e5b2e`, `column_count` 15, `row_count` 156, `trade_column_present: false`, extracted NBSP/ZWSP/`↧`/mojibake still **255 / 129 / 1 / 0**. `persons.jsonl` still holds **two** distinct `brad_miller` records (`/1`, `/2`). The 5 `<br>`-affected cells now read `Priority (…)` / `Father-Son (…)` — the fix is present in the regenerated artifacts. **Every previously settled 2001 identity/schema finding survives re-derivation** |

**No stop condition triggered; nothing contradicts the settled contract.** Raw bytes untouched,
frozen CSV untouched, no code modified in this step.

### Parity across the 1981 + 2001 snapshot — command issued, awaiting output

CLI re-inspected; **no flag invented**. `--parity` reconciles against the frozen corpus at the
contract's `csv_artifact.path`, **read-only** (`--parity-dir` is the fixture-scale override and
is not used). **`--require-complete` is omitted**, so `run_parity` (`:655-668`) compares only
the overlapping years — **1981 and 2001** — and skips the corpus-level 6,810 / 1,686 / event-
and label-total baselines that only a complete 42-year run may assert. **`--validate-only`
preserves the parsed artifacts inspected above**, since parity runs before `write_parsed` and is
unaffected by it (`:869-877`).

```text
.venv/Scripts/python.exe tools/rebuild/draftguru/parse_draft_snapshot.py --label annual-html-20260826 --parity --validate-only
```

### 1981 + 2001 parity: EXECUTED, **PASS**

```text
{"distinct_person_count": 180, "identity": {"baseline_distinct_persons": 5057, "baseline_drift": null, "baseline_total_rows": 6810, "distinct_person_count": 180, "total_rows": 180}, "label": "annual-html-20260826", "parity": "PASS", "total_rows": 180, "validate_only": true, "years_parsed": [1981, 2001]}
```

- **`"parity": "PASS"`** across **both** years against the frozen browser-export corpus,
  read-only: per-year row counts, event vocabulary, selection numbers, special pick labels,
  player display names, destination club labels, `Signing`, `Detail` and `Original Club` all
  reconcile.
- **180 rows / 180 distinct persons**; 1981 = 24, 2001 = 156.
- **Real variant A (14-column, no `Draft`, `Detail` retained) VALIDATED** against live bytes.
- **Modern variant C (15-column, `Draft` + `Signing`) VALIDATED** against live bytes.
- **Canonical identity checks remain green** — canonical `player_url` + positive ordinal on
  every row; Brad Miller `/1` vs `/2` still distinct.
- No parity rule weakened, no baseline altered, no comparison exception added, frozen corpus
  unmodified.
- **Stage A full acquisition still NOT RUN / NOT ACCEPTED.**

---

## 21. Final bounded schema probe before Stage A — variant B

**Why one more probe.** The three pinned field layouts differ in which discriminator columns
exist, and each drives a different parser mapping:

| Variant | `Draft` | `Signing` | `Detail` | Live status |
|---|---|---|---|---|
| **A** (14 col) — 1981, 1982, 1987 | absent | absent | present | **PROVEN** (1981) |
| **B** (15 col) — 1986, 1997, 1998 | present | absent | present | **UNPROVEN** |
| **C** (15 col) — 1988–96, 1999–2025 | present | present | absent | **PROVEN** (2001) |

Variant B is the only remaining distinct branch: it is the sole layout combining a present
`Draft` **with** a present `Detail`, and it is where the parser's "`Detail` is not `Signing`
renamed" rule is actually exercised with content.

**Target year: 1986.** Chosen by inspecting the frozen corpus, not by preference:

| Evidence | 1986 | 1997 | 1998 |
|---|---|---|---|
| Header | `Pick,Draft,# ↧,Club,Detail,Player,Age,Height,Original Club,Grade,Games,Goals,Coaches,Brownlow,Awards` — **variant B exactly** | same | same |
| Rows | **71** (72 lines) | 180 | 165 |
| **Populated `Detail`** | **YES** — e.g. `Pre-Draft … Brisbane … Detail="Brisbane"` | — | — |
| Blank `# ↧` | **YES** — the `Pre-Draft` rows, exercising the pinned blank-selection event set on a **non-`Trade`** event | — | — |

1986 is the **lowest-cost** of the three (71 rows vs 180/165) while being the only one that
needs proving at all, and it already exercises both distinguishing behaviours: populated
`Detail` — which **no** variant-A year provides (1981, 1982 and 1987 all have `Detail` empty on
every row, verified earlier) — and blank selection numbers on a non-`Trade` event type. **No
concrete evidence makes 1997 or 1998 materially better**, and both carry more parity surface for
the same structural proof. One year only.

**Pre-flight safety verification (code + on-disk state, checked before issuing the command):**

| Check | Result |
|---|---|
| `--years` adds only that year | **VERIFIED** — `acquire_years()` (`acquire_draft.py:202-226`) iterates `sorted(years)` only; with `--years 1986` the list is `[1986]`, so 1981 and 2001 are never visited |
| 1981 / 2001 raw+http not rewritten | **VERIFIED** — not in the requested list at all; and independently, the per-year guard skips any year whose `raw/` **and** `http/` files both exist (`:209-213`), never rewriting an existing raw file. On-disk now: `raw/years/year_1981.html`, `raw/years/year_2001.html`, `http/years/year_1981.json`, `http/years/year_2001.json` |
| Partial mode cannot write the Stage A manifest | **VERIFIED** — `--years` sets `partial = True` and the run returns at `:380-390`, **before** the parse → identity → trade-profile → parity → manifest path (`:392-413`). `manifest_written` is hard-coded `false` on that branch |
| No existing manifest blocks the probe | **VERIFIED** — `docs/rebuild-manifests/draftguru/` contains only `csv-export-20260826.json`; `annual-html-20260826.json` is absent, so the pre-network immutability abort (`:338-342`) does not trigger |
| 1986 is a legal target | **VERIFIED** — in `expected_years`, not one of the 1983–85 intentional gaps |
| Network cost | 2 requests (robots.txt re-fetch + 1986), 1.5s pacing, 20s timeout, ≤3 retries |

**No blocker. Command issued (awaiting output):**

```text
.venv/Scripts/python.exe tools/rebuild/draftguru/acquire_draft.py --label annual-html-20260826 --years 1986
```

Snapshot will then hold **3 of 42** years. Parser/parity commands follow only after this output
is evaluated. Nothing in parser, contract, tests, ledgers or the frozen corpus was changed in
this step.

---

## 22. SESSION CHECKPOINT — 2026-08-26 (Opus / High / Manual execution). **SESSION ENDS HERE.**

**The 1986 acquisition was NOT run in this session.** It is the first action of the next
session.

### Validated state at checkpoint

| Item | State |
|---|---|
| Targeted suite `npx vitest run tests/draftguru-acquisition.test.ts` | **31/31 PASS** |
| 2001 live acquisition | **PASS** — 200, 178,974 bytes |
| 2001 parse | **PASS** — 156 rows, 156 distinct persons |
| 2001 CSV parity | **PASS** |
| 1981 live acquisition | **PASS** — 200, 28,979 bytes |
| 1981 + 2001 parse | **PASS** — **180 rows / 180 distinct persons** (1981 = 24, 2001 = 156) |
| 1981 + 2001 CSV parity | **PASS** |
| Real **variant A** (14 col, no `Draft`, `Detail` retained) | **VALIDATED** on live bytes |
| Real **modern / variant-C** layout (15 col, `Draft` + `Signing`) | **VALIDATED** on live bytes |
| **Brad Miller `/1` vs `/2` identity regression** | **PROVEN** on live bytes and still green |
| `<br>` parser defect | **FIXED** in `parse_draft_snapshot.py` and **regression-covered** in `tests/draftguru-acquisition.test.ts` |
| **Stage A full 42-year acquisition** | **NOT RUN** |
| **Stage A accepted manifest** | **NOT CREATED** |
| **Stage B1** | **NOT STARTED** (Stage B2 remains NOT APPROVED) |
| PostgreSQL / `AFLDB_LEGACY_SQLITE` | **never touched** at any point |
| Frozen CSV corpus `full-history-20260826/` | **unmodified**, read-only oracle |
| `IssuesIndex.md` / `CHANGELOG.md` | **deliberately not updated** — completion ledgers wait for accepted Stage A |
| Git | **not run** by the agent at any point |

### Settled this session — variant-B probe target: **1986**

Reasons (evidence-based, from the frozen corpus):

- 1986, 1997 and 1998 **share the same variant-B header** — the choice cannot be made on shape;
- **1986 is the smallest at 71 rows** (1997 = 180, 1998 = 165);
- **1986 has populated `Detail` values** (e.g. `Pre-Draft … Detail="Brisbane"`), which no
  variant-A year provides — 1981, 1982 and 1987 all leave `Detail` empty on every row;
- **1986 exercises blank `# ↧` on non-`Trade` `Pre-Draft` rows**, testing the pinned
  blank-selection event set outside the `Trade` case;
- therefore 1986 gives **materially better coverage at lower cost** than 1997 or 1998.

### Verified acquisition pre-flight (carry forward; re-confirm cheaply, do not re-derive)

- Existing snapshot label: **`annual-html-20260826`**
- Current raw snapshot contains: **1981** and **2001**
- Both already have `raw/years/year_<Y>.html` **and** `http/years/year_<Y>.json` artifacts
- `acquire_years()` will **visit only the requested 1986**
- Existing 1981 and 2001 artifacts **will not be rewritten**
- `--years` remains **partial-probe mode**
- **`manifest_written = false`** in that path
- **No Stage A manifest currently exists** (`docs/rebuild-manifests/draftguru/` holds only
  `csv-export-20260826.json`)
- **1986 is an expected year and not an intentional gap** (gaps are 1983, 1984, 1985)

### Exact next user-run command

```text
.venv/Scripts/python.exe tools/rebuild/draftguru/acquire_draft.py --label annual-html-20260826 --years 1986
```

After that output: parse the three-year snapshot (no `--parity` in the same command, so
`parsed/` survives a parity failure), inspect the 1986 artifacts for variant-B evidence
(`Draft` **and** `Detail` both populated and kept separate, blank `# ↧` on `Pre-Draft`), then
parity with `--parity --validate-only`. Only once variant B is proven may the full Stage A
42-year acquisition be proposed.

### NEXT STEP REQUIRES A FRESH CHAT

**Recommended session — Model: Opus · Reasoning: High · Mode: Manual / execution.**

Read first: `CLAUDE.md`, `WORKFLOW.md`, `AFLDB-ISSUE-093.md`, and this handoff (§18–§22 are the
complete resume state; the prior conversation is not required). The fresh session begins with
the 1986 variant-B acquisition probe above.

Do not reopen any settled boundary: ZERO `AFLDB_LEGACY_SQLITE`; annual server-rendered HTML is
the identity-bearing surface; the CSV export is parity-only; `player_url` is the durable
identity in its U1 canonical form; rendered names are never identity; Brad Miller `/1` and `/2`
are different people; acquisition and PostgreSQL import remain separate stages; Stage B2 is not
approved; ledger completion updates wait for an accepted Stage A.

### Files changed by this session (Opus takeover), cumulative

| File | Change |
|---|---|
| `tests/draftguru-acquisition.test.ts` | NBSP expectation corrected 4 → 5 with two strengthening assertions; new `<br>` separation regression test (both `Priority (…)` and `Father-Son (…)`) |
| `tools/rebuild/draftguru/parse_draft_snapshot.py` | One branch in `_TableParser.handle_starttag`: `<br>` inside a cell appends `"\n"`, collapsed to one space by the existing whitespace rule. Source remains pure ASCII |
| `AFLDB-ISSUE-093-DRAFTGURU-ACQUISITION-HANDOFF.md` | §19–§22 |

Gitignored working artifacts (not repository changes):
`data/sources/draftguru/annual-html-20260826/` — `raw/years/year_1981.html`,
`raw/years/year_2001.html`, matching `http/` records, `http/robots.txt` + `robots_txt.json`,
and regenerable `parsed/` output.

**Nothing else in the repository was modified. No Git, no SQL, no SSH, no deployment command was
executed by the agent.**

---

### Recommended takeover session

**Opus / High / Manual-execution.** The next task is bounded (one NBSP root-cause cycle),
but Opus is the available coding model on the takeover account; it should execute this
approved runbook precisely and must not reopen the architecture or any settled boundary.
Read first: `CLAUDE.md`, `WORKFLOW.md`, `AFLDB-ISSUE-093.md`, and this handoff. The prior
conversation is not required — this §18 is the complete resume state.

> **HISTORICAL TRAILER.** The block immediately above belongs to §18 and is superseded.
> The current resume state is the LAST section of this file.

---

## 23. Execution log — 2026-08-26 (Opus / High / Manual execution, variant-B session)

**This section supersedes every earlier "next action" in this file.**

### Session start — read set and pre-flight re-confirmation

Read: `CLAUDE.md`, `WORKFLOW.md`, `AFLDB-ISSUE-093.md` §13 (phase 5 — "Draft adapter
(DraftGuru) — follows 4a"), and this handoff §1–§22. The prior conversation was not required.

Pre-flight re-confirmed against current on-disk state (agent-side native reads only, nothing
re-derived):

| Check | Result |
|---|---|
| Stage A manifest absent | **CONFIRMED** — `docs/rebuild-manifests/draftguru/` holds only `csv-export-20260826.json`; `annual-html-20260826.json` does not exist, so the pre-network immutability abort does not trigger and the probe cannot create it |
| Existing raw years intact | **CONFIRMED** — `raw/years/` holds exactly `year_1981.html` and `year_2001.html` |
| Variant-B target | **1986**, settled in §21/§22 on frozen-corpus evidence; nothing in the current files contradicts it, so the decision was not reopened |

### Step 1 — bounded 1986 live acquisition: EXECUTED, **SUCCEEDED**

User-run, Windows Git Bash, cwd `/d/dev/afldb`:

```text
.venv/Scripts/python.exe tools/rebuild/draftguru/acquire_draft.py --label annual-html-20260826 --years 1986
```

```text
year 1986: 200 78976 bytes
{"label": "annual-html-20260826", "manifest_written": false, "mode": "partial-probe", "note": "partial/probe acquisition — the manifest is written only by a complete validated 42-year run", "years_fetched_now": [1986], "years_requested": [1986]}
```

| Fact | Value |
|---|---|
| HTTP status | **200** |
| Raw body | **78,976 bytes** → `raw/years/year_1986.html`, written verbatim in binary |
| HTTP record | `http/years/year_1986.json` (status, final URL, headers subset, `fetched_at`, byte size, SHA-256) |
| Years acquired | **1986 only** — `years_requested == years_fetched_now == [1986]` |
| Mode | **`partial-probe`** |
| Manifest | **`manifest_written: false`** — no Stage A acceptance occurred |
| 1981 / 2001 artifacts | **PRESERVED** — never visited by `acquire_years()`, never re-fetched, never rewritten |
| Failures | none — the non-zero partial-failure path was not taken |
| Network cost | 2 requests (robots.txt re-fetch + 1986), 1.5s pacing, 20s timeout, ≤3 retries |

**Live snapshot `annual-html-20260826` now holds 3 of 42 years: 1981, 1986, 2001.**

**Stage A full 42-year acquisition remains NOT RUN and NOT ACCEPTED.** No accepted manifest
exists. Stage B1 NOT STARTED; Stage B2 NOT APPROVED. No PostgreSQL, no `AFLDB_LEGACY_SQLITE`,
no write to the frozen CSV corpus was reachable from this code path.

### Step 2 — three-year parse (1981 + 1986 + 2001): command issued, awaiting output

CLI re-inspected before choosing the command (`parse_draft_snapshot.py:841-889`); **no flag
invented**. Two ordering facts govern the choice, re-verified in source this session:

1. **`run_parity` (`:880-884`) executes BEFORE `write_parsed` (`:886-887`)**, and a parity
   mismatch raises `ParseFailure` — so a combined `--parity` run that failed would abort
   **without writing `parsed/`**, destroying the very artifacts this probe exists to inspect.
   This is the same trap that made the 2001 `<br>` root cause recoverable only because parse
   and parity were separate commands. **`--parity` is therefore excluded from this step** and
   is the immediately following command. Parity remains fail-closed and mandatory before any
   Stage A acceptance — nothing is weakened.
2. **`--require-complete` is excluded**, so `validate_identity` still enforces the fail-closed
   per-row gates (canonical `player_url` regex, positive-integer ordinal) on every row while
   skipping the 6,810-row / 5,057-person corpus baseline, which a 3-year partial snapshot must
   not be measured against.

```text
.venv/Scripts/python.exe tools/rebuild/draftguru/parse_draft_snapshot.py --label annual-html-20260826
```

> This run **regenerates** `parsed/` to cover all three years, replacing the 1981+2001
> artifacts. That is deterministic re-derivation from unchanged `raw/` bytes, not a mutation of
> source data.

Expected to establish, from real 1986 server bytes: the live variant-B header (15 columns,
`Draft` **and** `Detail` both present, no `Signing`) accepted fail-closed by the pinned
contract; populated `Detail` values preserved and kept distinct from `Signing`; blank `# ↧` on
non-`Trade` `Pre-Draft` rows becoming NULL rather than 0; canonical `player_url` + ordinal on
every row; the §5 encoding profile; §9 `Trade`-column behaviour; and that 1981 and 2001 retain
every settled semantic after re-derivation.

### Step 2 — three-year parse: EXECUTED, **SUCCEEDED**

```text
{"distinct_person_count": 251, "identity": {"baseline_distinct_persons": 5057, "baseline_drift": null, "baseline_total_rows": 6810, "distinct_person_count": 251, "total_rows": 251}, "label": "annual-html-20260826", "parity": "SKIPPED", "total_rows": 251, "validate_only": false, "years_parsed": [1981, 1986, 2001]}
```

- **1981, 1986 and 2001 all parse successfully** — `years_parsed: [1981, 1986, 2001]`.
- **Total rows 251**; **distinct persons 251** (still exactly one row per person across the
  three-year sample).
- **1986 contributed the expected 71 rows** (251 − 180), matching the frozen 1986 CSV's
  72 lines = header + 71 rows exactly.
- **Per-row canonical identity validation PASSED** across all three years — the pinned canonical
  `player_url` regex and the positive-integer ordinal gate were enforced fail-closed on all 251
  rows.
- **Corpus baselines intentionally NOT enforced** on a partial snapshot (`baseline_drift: null`;
  6,810 / 5,057 reported for reference only — enforcement requires `--require-complete` on a
  complete 42-year run).
- **Parity still pending** — `"parity": "SKIPPED"`.
- **Stage A still NOT RUN / NOT ACCEPTED**; no manifest written.

### 1986 artifact inspection (agent-side, native file reads — no user command)

| # | Objective | Evidence from real 1986 bytes |
|---|---|---|
| 1 | **Exact live 1986 header/schema** | **15 columns**, `table_count: 1`: `Pick`, `Draft`, `# ↧`, `Club`, `Detail`, `Player`, `Age`, `Height`, `Original Club`, `Grade`, `Games`, `Goals`, `Coaches`, `Brownlow`, `Awards` — **variant B exactly**. Distinct fingerprint `d25f38178a3c28c3e4d16f571b462d6c66730f8da2fae0a89fa5f3f115881222`, its own entry in `schema.json` `variants[]`; charset `utf-8` from HTTP `Content-Type`. **The real variant-B shape is accepted by the pinned contract, fail-closed** — three distinct live fingerprints now exist, one per variant |
| 2 | **`Draft` column present** | **YES** — `event_type_raw` populated on **all 71** 1986 rows: **National 65**, **Pre-Draft 6**. Corpus-wide `event_type_raw: null` count is **24** — i.e. 1981 only, the `__no_draft_column__` class. 1986 is correctly *not* in that class. Both event values are inside the pinned 11-group baseline; **no unexpected event vocabulary** |
| 3 | **`Detail` column present** | **YES** — present in the header and mapped to `detail_raw`, the same field 1981 populates as NULL. This is the only live layout so far carrying `Draft` **and** `Detail` together |
| 4 | **Populated `Detail` values preserved exactly** | **YES** — `detail_raw: "Brisbane"` on **exactly the 6 `Pre-Draft` rows**, `null` on all 65 `National` rows. **`Detail` did not leak into `Signing`:** 1986 rows with a non-null `signing_raw` = **0**. The runbook §6 rule *"`Detail` is not `Signing` renamed"* is now proven on real bytes with real content — which no variant-A year could prove (1981/1982/1987 have `Detail` empty on every row) |
| 5 | **Blank `# ↧` on `Pre-Draft` → NULL** | **YES** — `pick_number: null` on exactly those 6 `Pre-Draft` rows, never `0`. Corpus-wide `pick_number: null` = **35**, decomposing exactly as **29 (2001 `Trade`) + 6 (1986 `Pre-Draft`) + 0 (1981)**. This is the first live proof of the pinned blank-selection event set on a **non-`Trade`** event type. `pick_note_raw` populated in 1986 = **0** (no special pick labels that year) |
| 6 | **`event_type_raw` retained for those rows** | **YES** — the 6 blank-selection rows still read `event_type_raw: "Pre-Draft"`. A NULL selection number did not blank, default or reclassify the event |
| 7 | **Canonical `player_url` extraction** | **VALID** — 251/251 rows cleared the parser's fail-closed canonical-regex + positive-ordinal gate. Independent agent-side check: **249** of 251 match a strict `[a-z0-9_.'-]` slug class; the **2** that do not are 2001 rows whose slug carries **percent-encoding present verbatim in the live source** (see the finding below) — not 1986, and not a parser transform |
| 8 | **Encoding counts / profile** | 1986 `encoding_counts_raw_document` = **0/0/0/0**; `encoding_counts_extracted` = NBSP **87**, ZWSP **43**, `↧` **1**, mojibake **0**. Identical signature to 1981 and 2001: NBSP/ZWSP/`↧` are **HTML entities upstream**, counted rather than repaired (§5), and **zero mojibake** in a third independent live page — further evidence the six damaged names are browser-export corruption |
| 9 | **`Trade` column** | **ABSENT in 1986** — `trade_column_present: false`, `trade_raw: null` on every row. `trade_column_profile.json` remains `years_with_trade_header: []`, `total_populated: 0`, `distinct_values: {}`, `link_paths: []` across all three years. **Still zero live evidence of a `Trade` column anywhere.** §9 resolution stays deferred to the full 42-page profile |
| 10 | **Live-vs-fixture / live-vs-contract differences** | **None of a new kind.** The live 1986 shape matches the pinned variant-B header exactly; the same entity-encoded NBSP/ZWSP behaviour already measured in 1981 and 2001 recurs; and the 16-column `Trade`-bearing fixture shape remains unwitnessed live for a third year. **No contract violation, no fixture change warranted, no code change made** |
| 11 | **1981 and 2001 unchanged after re-derivation** | **CONFIRMED.** 1981: fingerprint still `170485f6…b7b6d4c5`, 14 columns, 24 rows, extracted NBSP/ZWSP/`↧`/mojibake still **43 / 19 / 1 / 0**, still 0 `pick_number` nulls, all 24 `event_type_raw` nulls. 2001: fingerprint still `429645c7…567e5b2e`, 15 columns, 156 rows, **255 / 129 / 1 / 0**, 29 `pick_number` nulls. `persons.jsonl` still holds **two distinct `brad_miller` records** — `/1` and `/2`, ordinals 1 and 2, identical NBSP-bearing display name `Brad Miller`, `row_count: 1` each, `years: [2001]`. **Every settled semantic survived deterministic re-derivation from unchanged `raw/` bytes** |

**No stop condition triggered. No code, contract, fixture, test, baseline or frozen-corpus file
was modified in this step.**

#### New finding (recorded, NOT a defect, NOT acted on here) — percent-encoded slugs

Two live 2001 hrefs contain a percent-encoded space **in the source markup itself**:

```text
player_href_raw  /players/nick_dal%20santo/1
player_url       https://www.draftguru.com.au/players/nick_dal%20santo/1
player_href_raw  /players/kristian_de%20pasquale/1
player_url       https://www.draftguru.com.au/players/kristian_de%20pasquale/1
```

Verified against `raw/years/year_2001.html:871`, which contains the literal text `dal%20santo`
inside the href. The parser extracted it **verbatim** and canonicalised it without alteration;
the pinned contract regex `^https://www\.draftguru\.com\.au/players/[^/]+/[1-9][0-9]*$`
(`draftguru-contract.json:18`) admits it by design, so identity validation passed fail-closed.

- **This is not new to 1986** — both rows are 2001, and both were already present in the passing
  2001 probe (§19/§20). It was simply not measured until now.
- **Downstream importer consequence (record only, no decision taken here):** `player_url` must be
  matched **byte-exactly** against the stored `draft_persons.player_url` values. Any well-meaning
  normaliser that percent-decodes `%20` to a space — or re-encodes a space to `%20` — would
  silently break identity matching for these people. Add to the §16 downstream requirement list
  when the importer is designed; **acquisition does nothing about it**.

### Step 3 — three-year CSV parity: command issued, awaiting output

CLI re-inspected (`parse_draft_snapshot.py:841-889`); **no flag invented**.

- **`--parity`** reconciles against the frozen corpus at the contract's `csv_artifact.path`,
  **read-only** (`--parity-dir` is the fixture-scale override and is deliberately not used).
- **`--require-complete` omitted**, so `run_parity` (`:655-668`) compares only the overlapping
  years — **1981, 1986, 2001** — and skips the corpus-level 6,810 / 1,686 / event- and
  label-total baselines that only a complete 42-year run may assert.
- **`--validate-only` included** — verified at `:886-887` (`if not args.validate_only:
  write_parsed(...)`), so the parsed artifacts inspected above are **preserved, not rewritten**;
  parity runs before `write_parsed` and is unaffected by it.

```text
.venv/Scripts/python.exe tools/rebuild/draftguru/parse_draft_snapshot.py --label annual-html-20260826 --parity --validate-only
```

Per-year checks applied fail-closed to all three years: row count, event vocabulary, selection
numbers, special pick labels, player display names (after NBSP→space, ZWSP strip, mojibake repair
on the CSV side, NFC), destination club labels, `Signing`, `Detail`, `Original Club`. Documented
exceptions carried by design: the `Trade` column and `player_url`, both absent from the CSV
export.

### Step 3 — three-year CSV parity: EXECUTED, **PASS**

```text
{"distinct_person_count": 251, "identity": {"baseline_distinct_persons": 5057, "baseline_drift": null, "baseline_total_rows": 6810, "distinct_person_count": 251, "total_rows": 251}, "label": "annual-html-20260826", "parity": "PASS", "total_rows": 251, "validate_only": true, "years_parsed": [1981, 1986, 2001]}
```

- **`"parity": "PASS"`** across **all three years** against the frozen browser-export corpus,
  read-only: per-year row counts, event vocabulary, selection numbers, special pick labels,
  player display names, destination club labels, `Signing`, `Detail` and `Original Club` all
  reconcile.
- **251 rows / 251 distinct persons** — 1981 = 24, 1986 = 71, 2001 = 156.
- **No parity rule weakened, no baseline altered, no comparison exception added, frozen corpus
  unmodified, parsed artifacts preserved** (`validate_only: true`).

---

## 24. ALL THREE LIVE SCHEMA VARIANTS VALIDATED — individual probing COMPLETE (2026-08-26)

| Variant | Years pinned | Live proof | Acquisition | Parse | Parity |
|---|---|---|---|---|---|
| **A** — 14 col, no `Draft`, `Detail` present | 1981, 1982, 1987 | **1981** | **PASS** (200, 28,979 B) | **PASS** (24 rows) | **PASS** |
| **B** — 15 col, `Draft` **and** `Detail`, no `Signing` | 1986, 1997, 1998 | **1986** | **PASS** (200, 78,976 B) | **PASS** (71 rows) | **PASS** |
| **C / modern** — 15 col, `Draft` + `Signing`, no `Detail` | 1988–96, 1999–2025 | **2001** | **PASS** (200, 178,974 B) | **PASS** (156 rows) | **PASS** |

**Cumulative validated evidence:**

- three-year probe parity **PASS**; **251 rows / 251 distinct persons**;
- **canonical `player_url` validation remains PASS** — fail-closed regex + positive-integer
  ordinal on all 251 rows;
- **Brad Miller `/1` and `/2` remain two distinct persons** on live bytes;
- **populated `Detail` semantics proven on 1986** — `"Brisbane"` on the 6 `Pre-Draft` rows,
  `signing_raw` non-null count 0, so `Detail` is provably not `Signing` renamed;
- **blank selection numbers on non-`Trade` `Pre-Draft` rows correctly become NULL** — corpus
  nulls 35 = 29 (2001 `Trade`) + 6 (1986 `Pre-Draft`) + 0 (1981), never `0`;
- **no new parser defect found** — no code, contract, fixture, test or baseline changed in the
  1986 cycle;
- **Stage A full acquisition still NOT RUN / NOT ACCEPTED.**

**Individual-year probing is CLOSED. 1997, 1998 and every other single-year probe are NOT to be
acquired** — all three materially distinct live branches are proven and a fourth probe would add
parity surface without adding structural coverage.

### Preserved incidental identity finding — percent-encoded hrefs

- Some live DraftGuru player hrefs contain **literal percent-encoded components, including
  `%20`** — measured: `/players/nick_dal%20santo/1` and `/players/kristian_de%20pasquale/1`,
  present verbatim in `raw/years/year_2001.html:871`.
- **Canonical `player_url` preservation must remain byte-exact.** The parser extracts the href
  verbatim and canonicalises without altering the encoding; the pinned contract regex
  (`^https://www\.draftguru\.com\.au/players/[^/]+/[1-9][0-9]*$`) admits it by design.
- **Downstream import/reconciliation must NOT perform `%20`↔space identity normalisation.**
  Decoding or re-encoding either direction would silently break matching against the stored
  `draft_persons.player_url` values and split or fuse real people. Carry into the §16 downstream
  requirement list when the importer is designed. **Acquisition does nothing about it.**

---

## 25. FULL STAGE A READINESS GATE — verified 2026-08-26

Every prerequisite checked against the **current implementation**, not against memory. Line
references are to the files as they stand now.

| # | Prerequisite | Verdict | Evidence |
|---|---|---|---|
| 1 | Targeted suite 31/31 PASS | **SATISFIED** | Last user-run `npx vitest run tests/draftguru-acquisition.test.ts` = **31/31 PASS** (§19/§20). **No test, contract, parser or adapter file has been modified since** — the only file changed in the 1986 session is this handoff `.md`, so the result stands unchanged |
| 2 | Variant A live acquisition/parse/parity | **SATISFIED** | 1981 — §20 and §24 |
| 3 | Variant B live acquisition/parse/parity | **SATISFIED** | 1986 — §23 and §24 |
| 4 | Modern variant live acquisition/parse/parity | **SATISFIED** | 2001 — §19/§20 and §24 |
| 5 | Canonical `player_url` extraction fail-closed | **SATISFIED** | `parse_draft_snapshot.py:501-507` — every row matched against the pinned contract regex; a miss raises `ParseFailure` naming year+row. No best-effort path exists |
| 6 | Ordinals preserved exactly | **SATISFIED** | Ordinal parsed from the verbatim href and gated at `:508-510` (`player_ordinal < 1` ⇒ `ParseFailure`); proven live by `brad_miller/1` vs `/2` and `gary_ablett/2` |
| 7 | Brad Miller `/1` vs `/2` distinct | **SATISFIED** | `parsed/persons.jsonl` holds two records, ordinals 1 and 2, identical NBSP-bearing display name, `row_count: 1` each; pinned in the contract's `regression_anchor` and by a test |
| 8 | Raw HTTP response bytes preserved | **SATISFIED** | `acquire_draft.py:221` writes the response body verbatim in binary; `:211-213` skips (never rewrites) any year whose `raw/` **and** `http/` records exist; SHA-256 recorded per response |
| 9 | Schema drift fails closed | **SATISFIED** | `parse_draft_snapshot.py:289-291` — unknown header ⇒ `ParseFailure` with *"Unknown headers fail closed -- never best-effort"*; `:192` — a year not covered by any pinned variant fails; `:463` zero-byte and `:467` empty-table failures |
| 10 | Partial acquisition cannot create an accepted manifest | **SATISFIED** | `acquire_draft.py:360` sets `partial = True` for `--years`; `:380-390` returns with `manifest_written: False` hard-coded, **before** the parse → identity → parity → manifest path |
| 11 | Existing manifest ⇒ fail before network | **SATISFIED** | `:338-342` raises before `Fetcher` is constructed (`:366`) and before any fetch — *"nothing was written and nothing was fetched"*. A second existence check at `:409-412` guards a manifest appearing mid-run |
| 12 | Accepted manifest written LAST | **SATISFIED** | `:394-413` — parse → identity → trade profile → `write_parsed` → parity → `build_manifest` → `atomic_write_json`. Any gate raising `ParseFailure` exits 1 at `:424-426` with no manifest |
| 13 | Full run requires all 42 expected years | **SATISFIED** | `:394-395` calls `parse_snapshot(..., require_complete=True)`; `parse_draft_snapshot.py:448-456` raises unless the discovered year set **equals** `expected_years` exactly (missing *and* unexpected both fail) |
| 14 | Intentional gaps 1983–1985 explicit | **SATISFIED** | Excluded from `expected_years`, so never requested; explicitly refused if asked for (`acquire_draft.py:354-358`); carried into the manifest as `known_coverage_gaps` with reasons (`:282`) |
| 15 | 6,810-row baseline enforced on full validation | **SATISFIED** | `parse_draft_snapshot.py:520-536` under `require_complete` — `total_rows != 6810` ⇒ drift ⇒ `ParseFailure` unless `--accept-baseline-drift` is explicitly passed |
| 16 | 5,057-person baseline enforced | **SATISFIED** | Same block, `:525-528` |
| 17 | 1,686 NULL/non-ordered pick-number baseline enforced | **SATISFIED — and implemented** | `:735-737` counts `pick_number is None` corpus-wide; `:756-759` fails against `parity_baseline.selection_number_blank` = **1686** (`draftguru-contract.json:90`). The same corpus block also enforces the 6,810 CSV row total, the pinned event totals and the special-pick-label totals |
| 18 | CSV parity before acceptance | **SATISFIED** | `acquire_draft.py:401-404` runs `run_parity(..., require_complete=True)` against the frozen corpus **before** `build_manifest`; parity failure raises and no manifest is written |
| 19 | No PostgreSQL dependency | **SATISFIED** | Grep over `tools/rebuild/draftguru/`: **zero** matches for `psycopg`, `DATABASE_URL`. Pure stdlib |
| 20 | ZERO `AFLDB_LEGACY_SQLITE` dependency | **SATISFIED** | Same grep: **zero** matches for `AFLDB_LEGACY_SQLITE`, `sqlite`, `connect_legacy`, anywhere in the adapter, parser or contract |
| 21 | Existing partial snapshot resumes without rewriting validated bytes | **SATISFIED** | `acquire_years()` (`:202-226`) skips any year with both `raw/` and `http/` present, printing *"already acquired, skipping"* — 1981, 1986 and 2001 are skipped and their bytes are never re-fetched or rewritten. Only the remaining **39** years are fetched |
| 22 | `annual-html-20260826` may become the accepted full snapshot only after all 42 years + full validation | **SATISFIED** | No manifest exists for the label yet, so `:338-342` does not block; the manifest is reachable only from the non-`--years` path after `require_complete` parse + baseline identity + parity all pass |

**GATE RESULT: ALL 22 PREREQUISITES SATISFIED. No gap found. No architecture re-planned, no
flag invented, no code changed by this assessment.**

### Two ordering facts worth carrying (verified, not assumed)

1. **In the full Stage A path, `write_parsed` runs BEFORE `run_parity`** (`acquire_draft.py:400`
   then `:401-404`) — the reverse of the standalone parser CLI. So a parity failure on the full
   run still leaves complete `parsed/` artifacts for diagnosis, while **not** writing a manifest.
2. **Identity/baseline validation runs before parity** (`:396-398`). A 6,810/5,057 drift
   therefore halts **before** parity executes, and the failure message names the exact deltas.

### Stage A drift-detection baselines (do NOT silently update)

Expected years **42**: 1981, 1982, 1986–2025. Intentional gaps **1983, 1984, 1985**.
Baselines: **6,810 rows**, **5,057 distinct persons**, **1,686 NULL/non-ordered pick numbers**.

If the live source materially differs, the run **halts with a non-zero exit and writes no
manifest**. The required response is to record the exact difference, the affected year(s), the
evidence, whether it looks like upstream drift or parser behaviour, and the exact next decision —
**not** to re-run with `--accept-baseline-drift` and **not** to edit the baseline.
`--accept-baseline-drift` is a deliberate human acknowledgement of an *already investigated and
recorded* difference and is **deliberately omitted** from the command below.

### Stage A command issued (awaiting output)

```text
.venv/Scripts/python.exe tools/rebuild/draftguru/acquire_draft.py --label annual-html-20260826
```

- No `--years` ⇒ the complete 42-year path, the only path that can write an accepted manifest.
- Resumes the existing snapshot: 1981, 1986 and 2001 are skipped; **39 years fetched**,
  ~40 requests including the robots.txt re-fetch, ≥1.5s pacing, 20s timeout, ≤3 retries — on the
  order of a few minutes.
- Writes `docs/rebuild-manifests/draftguru/annual-html-20260826.json` **only** if every gate
  passes; a single year failure exits 1, retains the raw files for resume, and writes nothing.
- Stage B1 not started; PostgreSQL importer not touched; `AFLDB_LEGACY_SQLITE` not referenced;
  `IssuesIndex.md` / `CHANGELOG.md` deliberately not updated as complete.

---

## 26. FULL STAGE A ACQUISITION — fetch COMPLETE, acceptance HALTED fail-closed (2026-08-26)

```text
.venv/Scripts/python.exe tools/rebuild/draftguru/acquire_draft.py --label annual-html-20260826
```

### Acquisition result

| Fact | Value |
|---|---|
| Annual pages now present in `raw/` + `http/` | **all 42 expected years** — 1981, 1982, 1986–2025 |
| Years correctly skipped as already validated | **1981, 1986, 2001** — resume worked; their bytes were never re-fetched or rewritten |
| Years fetched this run | the remaining **39** — 1982 and 1987–2025 |
| HTTP status | **200 on every fetched annual request**; zero failures, so the non-zero partial-failure path was not taken |
| Intentional gaps | **1983, 1984, 1985** never requested, still recorded as `known_coverage_gaps` |
| Validation reached | the run proceeded through parse → identity → trade profile → `write_parsed` → **final CSV parity** |
| **Accepted Stage A manifest** | **NOT WRITTEN** — `docs/rebuild-manifests/draftguru/annual-html-20260826.json` does not exist |
| **Stage A** | **NOT ACCEPTED** |

### Gates that passed BEFORE parity (established from code ordering + generated artifacts)

Ordering is `acquire_draft.py:394-404`: `parse_snapshot(require_complete=True)` →
`validate_identity(require_complete=True)` → `build_trade_profile` → `write_parsed` →
`run_parity(require_complete=True)`. Parity is last, and it is the only stage that raised.
Therefore everything before it **completed without raising**:

| Gate | Result | How established |
|---|---|---|
| Complete 42-year snapshot | **PASS** | `parse_snapshot` raises unless the discovered year set equals `expected_years` exactly (`parse_draft_snapshot.py:448-456`); it did not raise |
| Per-year schema fail-closed | **PASS** | every one of the 42 real headers matched a pinned variant; an unknown header raises at `:289-291` |
| Per-row canonical `player_url` + positive ordinal | **PASS** on all 6,810 rows | `validate_identity:501-510`; it did not raise |
| **6,810-row baseline** | **PASS** | enforced at `:520-524`; independently counted in `parsed/rows.jsonl` = **6,810** |
| **5,057-person baseline** | **PASS** | enforced at `:525-528`; independently counted in `parsed/persons.jsonl` = **5,057** |
| `parsed/` artifacts written | **YES** | `write_parsed` runs before parity in the full path, so all four artifacts cover all 42 years and survived the halt |

Measured directly from the parsed artifacts (agent-side, deterministic):

| Baseline | Contract | Measured | Verdict |
|---|---|---:|---|
| Total rows | 6,810 | **6,810** | match |
| Distinct persons | 5,057 | **5,057** | match |
| NULL / non-ordered pick numbers | 1,686 | **1,686** | match |

> **The 1,686 baseline was NOT evaluated by the run.** `run_parity`'s corpus block is gated on
> `if require_complete and not failures` (`parse_draft_snapshot.py:732`) — the per-year name
> mismatches populated `failures`, so the corpus checks (CSV total rows, blank-selection count,
> event totals, special-pick-label totals) were **skipped, not passed**. The 6,810 / 5,057 /
> 1,686 figures above are an independent agent-side measurement of the parsed artifacts, and
> event totals and special-pick-label totals remain **unmeasured**. All four are enforced for
> real on the re-run.

### The halt — exactly six rows, five years

```text
ACQUISITION FAILURE: CSV parity failed (unexplained population differences fail validation):
  year=2003: player display names mismatch -- HTML {'Setanta Ó hAilpín': 1} vs CSV {'Setanta Ã\x93 hAilpÃ\xadn': 1}
  year=2011: player display names mismatch -- HTML {'Setanta Ó hAilpín': 1} vs CSV {'Setanta Ã\x93 hAilpÃ\xadn': 1}
  year=2013: player display names mismatch -- HTML {'Ciarán Sheehan': 1, 'Ciarán Byrne': 1} vs CSV {'CiarÃ¡n Sheehan': 1, 'CiarÃ¡n Byrne': 1}
  year=2016: player display names mismatch -- HTML {'Ciarán Sheehan': 1} vs CSV {'CiarÃ¡n Sheehan': 1}
  year=2018: player display names mismatch -- HTML {'Red Óg Murphy': 1} vs CSV {'Red Ã\x93g Murphy': 1}
```

`run_parity` accumulates **every** mismatch across all 42 years and all nine per-year check
dimensions before raising. The failure list contains only these five lines, so **no other year
and no other dimension mismatched**: row counts, event vocabulary, selection numbers, special
pick labels, destination club labels, `Signing`, `Detail` and `Original Club` all reconciled
across the whole corpus.

### Bounded root-cause task — all five confirmations PROVEN from local artifacts

| # | Claim | Evidence |
|---|---|---|
| 1 | Exactly the six previously identified browser-export mojibake rows | Byte-level grep of the **whole frozen corpus** for the double-encoded lead sequence `C3 83`: **6 occurrences in 5 files** — 2003 (1), 2011 (1), 2013 (2), 2016 (1), 2018 (1). Exactly the reported set; nothing else in 42 files carries it |
| 2 | The live HTML/raw bytes carry the correct Unicode | `parsed/schema.json` — `"mojibake_signature": [1-9]` matches **zero times** across all 42 years, raw-document *and* extracted. The HTML side of every failure line already shows the correct forms |
| 3 | No additional player-name mismatches | The accumulated failure list names exactly 6 values in 5 years; every other year passed the `player display names` check |
| 4 | All other parity dimensions passed first | Per-year: yes for all nine dimensions across 42 years (see above). Corpus-level: **skipped, not passed** — see the `:732` note above; 6,810 / 5,057 / 1,686 independently measured as matching |
| 5 | No identity field affected | The five affected persons keep correct display names and untouched percent-encoded canonical URLs: `.../players/setanta_%C3%B3%20hailp%C3%ADn/1`, `.../players/ciar%C3%A1n_sheehan/1`, `.../players/ciar%C3%A1n_byrne/1`, `.../players/red%20%C3%B3g_murphy/1`. All 6,810 rows passed the canonical gate; parity never compares `player_url` |

### ROOT CAUSE — the existing repair was silently defeated by NBSP

A CSV-side `repair_mojibake()` already existed (`parse_draft_snapshot.py:585-591`) and was
already wired into the name comparison. It did a **whole-string** round trip:

```python
value.encode("latin-1").decode("utf-8")
```

Measured bytes in the frozen corpus (2003, byte-level grep, no visual inspection):

```text
Setanta  C2 A0  C3 83 C2 93  20  hAilp  C3 83 C2 AD  n
         NBSP   damaged 'Ó'       space         damaged 'í'
```

Read as UTF-8, that is `Setanta` + NBSP + `Ã`+U+0093 + ` hAilp` + `Ã`+U+00AD + `n`. Re-encoding
the **whole string** as latin-1 turns the NBSP into the lone byte `0xA0`, which is **not valid
UTF-8**, so `.decode("utf-8")` raised `UnicodeDecodeError`, the `except` returned the value
**unrepaired**, and the comparison failed.

Every CSV player name carries an NBSP (9,143 occurrences, 100% of names — §5). So the repair
could **never** fire on a real player name: it was only ever going to work on a field without an
NBSP. The mechanism looked correct and was inert. This is a genuine parser-side defect in the
comparison layer, and it could not surface until a year containing a damaged name was acquired.

### The fix — narrowest possible, parity-comparison-only

**Repair the damaged *pairs*, not the string.** The damage is deterministic and has an exact
shape: one original UTF-8 byte pair re-read as CP1252/Latin-1 becomes a lead character
(`U+00C2`/`U+00C3`) followed by a continuation character in `U+0080`–`U+00BF`. Only those pairs
are decoded; every other character — NBSP, ZWSP, ASCII, anything else — is untouched, so no
other character can defeat or be altered by the repair.

| File | Change |
|---|---|
| `tools/rebuild/draftguru/parse_draft_snapshot.py` | New module-level `_MOJIBAKE_PAIR` regex (built from `chr()` constants — **source stays pure ASCII**) and a rewritten `repair_mojibake()` that `re.sub`s only matching pairs, sets `applied` only when a pair actually decoded, and keeps the existing `MOJIBAKE_SIGNATURE in value` guard so it cannot even be considered for a field without the signature. Docstring records that it is CSV-side, comparison-only, and explicitly **not** accent/Unicode equivalence |
| `tests/draftguru-acquisition.test.ts` | New `describe("browser-export mojibake parity exception")` — one positive regression covering **Setanta Ó hAilpín, Ciarán Sheehan, Ciarán Byrne, Red Óg Murphy** (live-correct HTML vs damaged CSV ⇒ parity **PASS**, parsed names still correct Unicode, `player_url` still verbatim percent-encoded), plus **two negative tests**: an accent-only difference (`Ciaran` vs `Ciarán` — a real distinction in this corpus, cf. the separate person *Ciaran Kilkenny*) and an unrelated surname difference must both still **FAIL** on `player display names`. The damage is reproduced by a helper that re-reads UTF-8 bytes as Latin-1 per NBSP-delimited segment, matching the measured corpus bytes exactly, and the key codepoints are asserted numerically rather than by eye |

**Deliberately NOT done:** live parsed values unchanged; `player_url` untouched; frozen CSV
corpus never written; no generic Unicode/accent equivalence; no source-data repair; no general
weakening of name parity; **no change to the 6,810 / 5,057 / 1,686 baselines**; `--accept-baseline-drift`
not used and not to be used.

**Blast radius:** the guard requires `U+00C3`, which the byte-level grep proves appears in
**exactly 6 field values across the entire 42-file corpus**. Nothing else in the corpus can
reach the new code path.

### Validation — COMPLETE, **34/34 PASS**

User-run, Windows Git Bash, cwd `/d/dev/afldb`:

```text
npx vitest run tests/draftguru-acquisition.test.ts
```

**Result: Test Files 1 passed; Tests 34 passed / 34 total; duration 2.31s.** The 31 prior tests
remain green and all three new browser-export mojibake tests pass:

- positive repair across all four affected Unicode names (Setanta Ó hAilpín, Ciarán Sheehan,
  Ciarán Byrne, Red Óg Murphy), with the parsed values and `player_url` proven unchanged;
- an unrelated accent/name difference still **fails** parity;
- an unrelated surname difference among the damaged rows still **fails** parity.

**The CSV-side pair-scoped mojibake exception is validated.**

### Summary of this cycle

| Item | State |
|---|---|
| Full Stage A crawl | fetched **all 42 expected annual pages** (1981, 1982, 1986–2025), every request HTTP 200 |
| Acceptance | **halted fail-closed** on **only** the six known browser-export mojibake rows |
| Root cause | the previous **whole-string** latin-1→UTF-8 repair was defeated by the NBSP present in **every** player name: the NBSP re-encodes to a lone `0xA0`, invalid UTF-8, so `decode()` raised and the value was returned unrepaired. The repair was inert for its entire life and could not surface until a year holding a damaged name was acquired |
| Replacement | **pair-scoped** to the known mojibake byte-pair pattern `[U+00C2,U+00C3][U+0080–U+00BF]` — nothing else in a field is examined or altered |
| Live parsed Unicode values | **untouched** |
| `player_url` | **untouched** (still verbatim percent-encoded) |
| Frozen CSV corpus | **untouched** |
| Baselines 6,810 / 5,057 / 1,686 | **unchanged** |
| Targeted suite | **34/34 PASS** |
| **Stage A** | **STILL NOT ACCEPTED** — acceptance requires the full path to re-run successfully and write the manifest |

---

## 27. Stage A acceptance re-run — pre-flight verified, command issued (2026-08-26)

Verified against current on-disk state and current adapter code before issuing the command:

| # | Check | Result |
|---|---|---|
| 1 | All 42 expected raw **and** http artifacts present | **VERIFIED** — `raw/years/` holds exactly 42 `.html` files and `http/years/` exactly 42 `.json` records, both covering 1981, 1982, 1986–2025 |
| 2 | 1983–1985 remain intentional gaps only | **VERIFIED** — no artifact exists for any of the three; they are absent from `expected_years`, refused if requested (`acquire_draft.py:354-358`), and carried into the manifest as `known_coverage_gaps` with reasons |
| 3 | Existing artifacts skipped, not re-fetched or rewritten | **VERIFIED** — `acquire_years()` (`:209-213`) skips any year whose `raw/` **and** `http/` files both exist, printing `already acquired, skipping`. All 42 qualify, so the re-run makes **one** network request (the robots.txt re-fetch) and rewrites nothing |
| 4 | No accepted Stage A manifest exists | **VERIFIED** — `docs/rebuild-manifests/draftguru/` holds only `csv-export-20260826.json`; the pre-network immutability abort (`:338-342`) will not trigger |
| 5 | Full path enforces every gate | **VERIFIED** — exactly 42 years (`parse_draft_snapshot.py:448-456`); canonical `player_url` + positive ordinal per row (`:501-510`); 6,810 rows (`:522-524`); 5,057 persons (`:525-528`); then `run_parity(require_complete=True)` for full per-year CSV parity plus the corpus block (`:732-767`) enforcing 1,686 blank selection numbers, the CSV 6,810 total, the pinned event totals and the special-pick-label totals. **The corpus block runs only when no per-year failure occurred — with the mojibake exception fixed, it is expected to execute for the first time** |
| 6 | Manifest written LAST, only if every gate passes | **VERIFIED** — `acquire_draft.py:394-413`: parse → identity → trade profile → `write_parsed` → parity → `build_manifest` → atomic write, with a second immutability check immediately before writing. Any gate raising exits 1 with no manifest |
| 7 | `--accept-baseline-drift` omitted | **CONFIRMED** — not passed. Any drift from 6,810 / 5,057 / 1,686 must halt for investigation, never be absorbed |

**No blocker. Command issued (awaiting output):**

```text
.venv/Scripts/python.exe tools/rebuild/draftguru/acquire_draft.py --label annual-html-20260826
```

Expected on success: 42 `already acquired, skipping` lines, then a JSON summary with
`"mode": "acquire"`, `"total_rows": 6810`, `"distinct_player_url_count": 5057`,
`"parity": "PASS"`, `"manifest_written": true` and the manifest path
`docs/rebuild-manifests/draftguru/annual-html-20260826.json`.

Expected on any drift: non-zero exit, explicit failing gate named, **no manifest** — at which
point the difference, affected year(s), evidence, upstream-drift-vs-parser judgement and the
exact next decision are recorded here, and the baseline is **not** edited.

---

## 28. STAGE A — **ACCEPTED**. FINAL CHECKPOINT (2026-08-26). **SESSION ENDS HERE.**

**This section supersedes every earlier "next action" in this file.**

### Acceptance record

```text
.venv/Scripts/python.exe tools/rebuild/draftguru/acquire_draft.py --label annual-html-20260826
```

```text
{"distinct_player_url_count": 5057, "label": "annual-html-20260826", "manifest": "D:\\dev\\afldb\\docs\\rebuild-manifests\\draftguru\\annual-html-20260826.json", "manifest_written": true, "mode": "acquire", "parity": "PASS", "total_rows": 6810}
```

| Item | Value |
|---|---|
| **Stage A acquisition** | **ACCEPTED** |
| **Snapshot label** | **`annual-html-20260826`** |
| **Accepted manifest** | **`docs/rebuild-manifests/draftguru/annual-html-20260826.json`** (verified present on disk) |
| Expected annual pages | **42** |
| Acquired annual pages | **42** |
| Intentional gaps | **1983, 1984, 1985** — no draft held; never requested; recorded as `known_coverage_gaps` |
| **Total rows** | **6,810** |
| **Distinct `player_url` identities** | **5,057** |
| **Full CSV parity** | **PASS** |
| `manifest_written` | **true** |
| Mode | `acquire` (the complete non-`--years` path — the only path that can accept) |

**The acceptance re-run reused all 42 existing `raw/` + `http/` artifacts and re-fetched no
annual page.** Every year printed `already acquired, skipping`; the only network request was the
robots.txt re-fetch. No raw byte was rewritten.

### Gates the successful acceptance path enforced and passed

| Gate | Result |
|---|---|
| Exact 42-year coverage (missing **and** unexpected years both fail) | **PASS** |
| Fail-closed per-year schema/header checks (unknown header ⇒ refuse, never best-effort) | **PASS** |
| Canonical `player_url` validation on every row | **PASS** (6,810/6,810) |
| Positive-integer ordinal validation on every row | **PASS** (6,810/6,810) |
| **6,810-row baseline** | **PASS** |
| **5,057-distinct-person baseline** | **PASS** |
| **1,686 NULL / non-ordered pick-number baseline** | **PASS** — the corpus block executed for the first time, having previously been gated behind the per-year mojibake failures |
| **Event totals** vs the pinned baseline | **PASS** |
| **Special-pick-label totals** vs the pinned baseline | **PASS** |
| **Full CSV parity** across all 42 years, all nine per-year dimensions | **PASS** |
| Manifest written LAST, only after every gate | **PASS** — `identity_complete: true`, `import_capable: true` earned, not asserted |

No baseline was edited. `--accept-baseline-drift` was never used at any point.

### Preserved evidence and settled facts

| Item | State |
|---|---|
| Targeted suite `npx vitest run tests/draftguru-acquisition.test.ts` | **34/34 PASS** |
| **Variant A** (14 col, no `Draft`, `Detail` present) live proof | **1981** |
| **Variant B** (15 col, `Draft` **and** `Detail`) live proof | **1986** — populated `Detail` = `"Brisbane"` on 6 `Pre-Draft` rows, `signing_raw` non-null count 0, blank `# ↧` → NULL on non-`Trade` rows |
| **Modern / variant C** (15 col, `Draft` + `Signing`) live proof | **2001** |
| **Brad Miller `/1` vs `/2` identity regression** | **PROVEN on live bytes and still green** — identical rendered names, two distinct persons, `/1` National #55 Melbourne, `/2` Rookie #30 Richmond |
| `<br>` semantic-separator defect | **FOUND, root-caused from raw bytes, fixed narrowly** (`_TableParser.handle_starttag` appends `"\n"` for `<br>` inside a cell, collapsed by the existing whitespace rule), **regression-covered** |
| Browser-export mojibake | **Root cause**: the whole-string latin-1→UTF-8 repair was defeated by the NBSP present in every player name (lone `0xA0` ⇒ `UnicodeDecodeError` ⇒ silent no-op). **Fix**: pair-scoped repair of `[U+00C2,U+00C3][U+0080–U+00BF]` only, CSV-side and comparison-only, covering exactly the 6 damaged values that exist corpus-wide. Three regression tests including two negatives |
| Live parsed Unicode values | **NEVER modified** — mojibake repair is CSV-comparison-only |
| Frozen CSV corpus `full-history-20260826/` | **NEVER modified** — read-only parity oracle, `identity_complete: false`, `import_capable: false` |
| `player_url` | **byte-exact throughout**, including percent-encoded forms — `%20` (`nick_dal%20santo`, `kristian_de%20pasquale`) and `%C3%A1`/`%C3%B3`/`%C3%AD` (`ciar%C3%A1n_sheehan`, `setanta_%C3%B3%20hailp%C3%ADn`, `red%20%C3%B3g_murphy`). **Downstream import/reconciliation must NOT normalise `%20`↔space or percent-decode any slug** — it would split or fuse real people |
| `AFLDB_LEGACY_SQLITE` | **ZERO dependency** — no reference anywhere in the adapter, parser or contract |
| PostgreSQL | **No dependency** — acquisition and validation are pure stdlib and touch no database |

### Ledger state at this boundary

`IssuesIndex.md` and `CHANGELOG.md` are **deliberately still not updated**. Stage A acceptance is
a sub-phase of `AFLDB-ISSUE-093` §13 phase 5, which is **not complete** (the PostgreSQL DraftGuru
importer has not been started). The ledger updates that are now *due* — and which are the first
housekeeping action of a later session, not of Stage B1 — are:

- `AFLDB-ISSUE-093.md` §13.5: record Stage A acquisition as accepted, with the manifest path;
- `IssuesIndex.md`: ISSUE-093 next action ⇒ Stage B1 profiling (or the importer);
- `CHANGELOG.md` (`Unreleased`): a tracked DraftGuru acquisition adapter, parser, contract and
  two manifests is a meaningful retained change and does qualify.

Nothing was committed; no Git command was executed by the agent at any point in this session.

---

## 29. STAGE B1 — EXACT RESUME BOUNDARY (NOT STARTED)

**Stage B1 was not started in this session and must not be started without a fresh session.**

### Purpose (single question only)

Bounded DraftGuru **person-page** profiling to determine whether DraftGuru profiles provide a
reliable **DraftGuru `player_url` → AFL Tables external identity** bridge — i.e. *does the person
page reliably carry an AFL Tables profile link, and does it carry one for the players AFLDB is
missing?* Stage B1 answers that and nothing else. Its output is the §10 profile.

### Read first (in this order)

1. `CLAUDE.md` — operating rules.
2. `WORKFLOW.md` — session/model/handoff strategy.
3. **This handoff** — §3 (person-page boundary and sample composition), §10 (AFL Tables-link
   profiling requirements), §16 (downstream importer requirements + U2), and §28–§29 (accepted
   Stage A state and this resume boundary).
4. `AFLDB-ISSUE-093-DRAFTGURU-INVESTIGATION-HANDOFF.md` — Residual A / Residual B evidence only
   (the convergence pairs and the 68 residual cases); do **not** re-read it in full.
5. `AFLDB-ISSUE-093.md` §13 phase 5 for the phase context.

The prior conversation is not required.

### Existing Stage A manifest / snapshot state (do not disturb)

- Accepted manifest: `docs/rebuild-manifests/draftguru/annual-html-20260826.json` —
  `identity_complete: true`, `import_capable: true`. **Immutable**: an existing label is never
  overwritten; reacquisition requires a new label.
- Retrospective CSV manifest: `docs/rebuild-manifests/draftguru/csv-export-20260826.json` —
  `identity_complete: false`, `import_capable: false`. Parity oracle only.
- Snapshot working directory (gitignored): `data/sources/draftguru/annual-html-20260826/` with
  `raw/years/` (42 pages), `http/years/` (42 records), `http/robots.txt` + `robots_txt.json`, and
  regenerable `parsed/` (`rows.jsonl`, `persons.jsonl`, `schema.json`,
  `trade_column_profile.json`).
- **`raw/years/` is now accepted baseline data. Never edit it.** A correction is a parser change
  re-deriving `parsed/`, or a new snapshot label — never a hand-edit.
- **U3 remains open**: the durable off-host archive path for the accepted `raw/` snapshot (the
  practice already used for database dumps at `D:\backups\afldb\`) is still to be settled and
  documented. It is a snapshot-acceptance follow-up, not a Stage B1 blocker.

### Approved sample construction rules (~120 pages, deterministic, recorded in the manifest)

| Cohort | Size | Basis |
|---|---:|---|
| Convergence-pair persons | **all 8** | The four historical convergence pairs (Residual B). Includes both Brad Millers, which double as the identity regression fixtures |
| AFL Tables-identity residual cases | **≈50 of the 68** | Drawn from the missing-canonical-identity population (Residual A), selected by a **user-run read-only `afldb_dev` query emitting `player_url` only**, under the Step-1 envelope |
| Decade-stratified ordinary cases | **≈40** | Stratified across 1980s / 1990s / 2000s / 2010s / 2020s, to test page-shape stability over time |
| Zero-game / low-information cases | **≈20** | `reported_games = 0`, to test whether zero-game people appropriately lack an AFL Tables link |

- **Overlap/deduplication is allowed** to keep the final sample bounded at ~120 distinct persons.
- **Do NOT crawl all 5,057 profiles.** Stage A was 42 requests; Stage B1 is ~120, single-threaded,
  1.5s pacing, ≈3 minutes.
- **Stage B2 (the remaining ~4,937 person pages) remains NOT APPROVED** (U2). It is proposed only
  if B1 shows material coverage, and then in its own successor runbook with its own justification,
  request count, rate limit, caching/restart behaviour and failure handling.
- Stage B1 failures may be partial **only because it is a profiling sample**, and its manifest must
  record exactly which persons were and were not fetched.

### Known historical identity evidence (carry forward; do not re-derive)

| Figure | Meaning |
|---|---:|
| **3,464** | historically linked DraftGuru persons |
| **3,460** | canonical players behind them |
| **3,392** | with a qualifying AFL Tables identity |
| **68** | **without** a qualifying external identity — the Residual A population Stage B1 samples from |
| **4 pairs / 8 persons** | the historical convergence pairs — Residual B |
| ~1,498 | draft persons who legitimately never played and stay unlinked — **never manufacture identities for them** |

**Brad Miller `/1` vs `/2` is the proven-incorrect convergence**: two different people with
identical rendered names were historically collapsed by automatic matching. It is the canonical
regression for the entire identity model and is now proven on live bytes.

### Stage B1 hard requirements

- **Preserve person-page raw responses separately from Stage A** — person pages belong under
  `raw/persons/<slug>__<ordinal>.html` with matching `http/` records; they must not disturb,
  overwrite or be confused with the accepted `raw/years/` artifacts, and the Stage A manifest
  must not be modified.
- **Measure exact AFL Tables profile hrefs — never infer a link by name.** Record the URL form(s)
  observed, whether they normalise to the `players/A/Name.html` path that
  `tools/migration/import_fitzroy_core.py` registers under `match_method =
  'afltables_profile_url'`, duplicate/collision counts, persons with no link, whether links exist
  for historically linked persons, and whether the 68 residual cases can be resolved from
  DraftGuru's own page.
- **Write nothing to PostgreSQL.** This is source-contract evidence only. A DraftGuru-asserted
  AFL Tables link is a *candidate* for `external_identities`; adopting it would be a separate,
  explicitly approved decision with its own collision policy. Nothing here pre-authorises it.
- **No name-only identity matching**, at any stage, for any purpose.
- **Old automatic DraftGuru links remain audit/reconciliation baseline only, never identity
  truth.** Only explicit `player_link_resolutions` rows are replayable; automatic links must be
  re-earned.
- **Do not implement the PostgreSQL DraftGuru importer yet** — §16 records its requirements;
  it is a separate phase.

### Settled boundaries — MUST NOT be reopened

ZERO `AFLDB_LEGACY_SQLITE`; annual server-rendered HTML is the identity-bearing acquisition
surface; the CSV export is parity/reference only; `player_url` is the durable DraftGuru person
identity in its U1 canonical form, byte-exact including percent-encoding; the rendered player
name is never identity; Brad Miller `/1` and `/2` are different people; acquisition and
PostgreSQL import remain separate phases; Stage B2 is not approved.

### Recommended next session

**Model: Opus · Reasoning: High · Mode: Plan/investigation** for the Stage B1 sample-selection
design and the read-only `afldb_dev` lookup that produces the Residual A `player_url` list — the
first action is that bounded query, not a crawl. Execution of the ~120-page profiling run is
**Fable / High / Manual execution** once the sample is frozen and recorded.

**Files changed by this session:** `tools/rebuild/draftguru/parse_draft_snapshot.py`
(pair-scoped `repair_mojibake` + `_MOJIBAKE_PAIR`), `tests/draftguru-acquisition.test.ts`
(+3 mojibake parity tests), `AFLDB-ISSUE-093-DRAFTGURU-ACQUISITION-HANDOFF.md` (§23–§29), and the
newly created tracked manifest `docs/rebuild-manifests/draftguru/annual-html-20260826.json`.
Gitignored working artifacts: the 42-year `data/sources/draftguru/annual-html-20260826/`
snapshot. No other repository file was modified. No Git, SQL, SSH or deployment command was
executed by the agent.

---

## 30. STAGE B1 — PLANNING CHECKPOINT: **FROZEN SAMPLE + EXECUTION CONTRACT** (2026-08-26,
##     Opus / High / Plan). **APPROVED. PLANNING SESSION ENDS HERE.**

**This section is the approved Stage B1 execution contract and supersedes §29's "recommended next
session" only in respect of the session profile (§30.9). Everything §29 settles remains binding.**

No person page was crawled. No Stage B1 implementation file was created. No Step 1 query was run.
Stage A was not modified. No Git, SQL, SSH, test, build or deployment command was executed by the
agent in this session.

### 30.1 Purpose (unchanged, single question)

Does the DraftGuru **person page** carry a reliable, deterministic
`player_url → AFL Tables external identity` bridge, and does it carry one for the players AFLDB is
missing? One observation exists (`/players/brad_miller/1` →
`http://afltables.com/afl/stats/players/B/Brad_Miller.html`); it is **not** generalised.

### 30.2 Fixed Stage B1 snapshot label

```text
person-html-20260826
```

Working dir (gitignored): `data/sources/draftguru/person-html-20260826/`
Manifest (tracked, written LAST): `docs/rebuild-manifests/draftguru/person-html-20260826.json`

The accepted Stage A snapshot `annual-html-20260826` and its manifest are **immutable** and are
read-only inputs here. Stage B1 must be structurally incapable of writing into them (§30.5).

### 30.3 Frozen sample — exactly 120 distinct persons, mutually exclusive primary cohorts

| Order | `primary_cohort` | Size | Source of truth | Rule |
|---:|---|---:|---|---|
| 1 | `convergence` | **8** | Handoff + accepted snapshot | The four Residual-B pairs. URLs verified present in the accepted `parsed/persons.jsonl`: `adam_houlihan/1,2`, `andrew_hill/1,2`, `brad_miller/1,2`, `michael_brown/1,2` |
| 2 | `residual` | **68 — complete census** | **One bounded read-only `afldb_dev` query (§30.4)** | Every Residual-A person, not a sample |
| 3 | `decade_control` | **30** | Accepted Stage A snapshot | **6 per decade** — 1980s / 1990s / 2000s / 2010s / 2020s — drawn only from persons whose DraftGuru **reported games > 0** |
| 4 | `zero_game_control` | **14** | Accepted Stage A snapshot | Persons where **every** row reports games `"0"` |

**Total 120.** Cohorts are drawn in the order above, each excluding already-selected URLs, so
**every selected person has exactly one `primary_cohort` — selected cohorts are mutually exclusive
by construction, and no overlap is claimed.** Other predicates a person also satisfies are recorded
as descriptive `eligibility_tags` (`games_zero`, `games_positive`, `decade_1990s`, …), never as
membership.

**Deterministic ordering (cohorts 3 and 4):** within each stratum, order candidates by
`sha256(player_url utf-8)` hex ascending and take the first N. Decade = `min(years)` from
`parsed/persons.jsonl`. No randomness. No name-based selection, ever. A stratum with fewer
candidates than its quota takes all of them and records the shortfall explicitly — never a silent
backfill from another stratum.

Cohorts 1, 3 and 4 are derived **entirely offline** from the accepted Stage A snapshot. Only
cohort 2 touches the database.

### 30.4 Step 1 — the single bounded read-only `afldb_dev` query (frozen text)

The only database access required for sample construction. The console shows the guard/identity
proof and the cross-check aggregates; **psql itself writes the 68 residual `player_url` values**
(`\o`, unaligned, tuples-only — no header, no footer) to a deterministic gitignored file inside the
Stage B1 snapshot. **No manual copy/paste. No parsing of mixed terminal output.**

Residual input file:

```text
data/sources/draftguru/person-html-20260826/input/residual_player_urls.txt
```

`player_url` values only, one per line, byte-exact as returned. **No names, no player ids, no
external ids, no other database data.** Expected console counts `3464 / 3460 / 68 / 68 / 60 / 8`;
expected file **exactly 68 non-empty lines**.

```bash
cd /d/dev/afldb && mkdir -p data/sources/draftguru/person-html-20260826/input && DSN="$(sed -n 's/^AFLDB_OWNER_DATABASE_URL=//p' .env | head -1)" && case "$DSN" in */afldb_dev) ;; *) echo "REFUSED: AFLDB_OWNER_DATABASE_URL does not target /afldb_dev"; exit 3;; esac && PGOPTIONS='-c default_transaction_read_only=on' psql -X -v ON_ERROR_STOP=1 -P pager=off "$DSN" <<'SQL' && { echo "--- residual input file ---"; wc -l < data/sources/draftguru/person-html-20260826/input/residual_player_urls.txt; sha256sum data/sources/draftguru/person-html-20260826/input/residual_player_urls.txt; }
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
DO $guard$
BEGIN
  IF current_database() <> 'afldb_dev' THEN
    RAISE EXCEPTION 'refusing: current_database() = %', current_database();
  END IF;
  IF current_setting('transaction_read_only') <> 'on'
     OR current_setting('default_transaction_read_only') <> 'on' THEN
    RAISE EXCEPTION 'refusing: transaction is not read-only';
  END IF;
END
$guard$;
\echo == identity ==
SELECT current_database() AS db, current_user AS usr,
       current_setting('transaction_read_only') AS txn_ro,
       current_setting('transaction_isolation') AS txn_iso;
\echo == residual counts (expect 3464 / 3460 / 68 / 68 / 60 / 8) ==
WITH linked AS (
  SELECT dp.player_id, dp.player_url, dp.link_status
  FROM draft_persons dp
  JOIN sources s ON s.id = dp.source_id AND s.key = 'draftguru'
  WHERE dp.player_id IS NOT NULL
), qualifying AS (
  SELECT DISTINCT ei.player_id
  FROM external_identities ei
  JOIN sources s ON s.id = ei.source_id AND s.key = 'afltables'
  WHERE ei.player_id IS NOT NULL AND ei.status IN ('unique','resolved')
), residual AS (
  SELECT l.* FROM linked l
  WHERE NOT EXISTS (SELECT 1 FROM qualifying q WHERE q.player_id = l.player_id)
)
SELECT (SELECT count(*) FROM linked)                                   AS linked_persons,
       (SELECT count(DISTINCT player_id) FROM linked)                  AS canonical_players,
       (SELECT count(DISTINCT player_id) FROM residual)                AS residual_players,
       (SELECT count(*) FROM residual)                                 AS residual_persons,
       (SELECT count(*) FROM residual WHERE link_status = 'unique')    AS residual_unique,
       (SELECT count(*) FROM residual WHERE link_status = 'resolved')  AS residual_resolved;
\echo == writing player_url values to data/sources/draftguru/person-html-20260826/input/residual_player_urls.txt ==
\pset format unaligned
\pset tuples_only on
\o data/sources/draftguru/person-html-20260826/input/residual_player_urls.txt
WITH linked AS (
  SELECT dp.player_id, dp.player_url
  FROM draft_persons dp
  JOIN sources s ON s.id = dp.source_id AND s.key = 'draftguru'
  WHERE dp.player_id IS NOT NULL
), qualifying AS (
  SELECT DISTINCT ei.player_id
  FROM external_identities ei
  JOIN sources s ON s.id = ei.source_id AND s.key = 'afltables'
  WHERE ei.player_id IS NOT NULL AND ei.status IN ('unique','resolved')
)
SELECT l.player_url FROM linked l
WHERE NOT EXISTS (SELECT 1 FROM qualifying q WHERE q.player_id = l.player_id)
ORDER BY l.player_url;
\o
\pset tuples_only off
\pset format aligned
ROLLBACK;
SQL
```

**Safety envelope (unchanged from Step 1 / the residual audit):** DSN derived from `.env` by `sed`
(never sourced); shell guard refusing any DSN not ending `/afldb_dev`; in-SQL `DO` guard on
`current_database()` **and** both read-only settings; `PGOPTIONS` read-only at connect time;
`psql -X`; `ON_ERROR_STOP=1`; pager off; one `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ
READ ONLY` ending in `ROLLBACK`. `afldb_test_pre_rebuild_20260825` is never named, connected to or
enumerated. `AFLDB_LEGACY_SQLITE` is not involved. **Egress is `player_url` plus aggregate counts,
nothing else.**

### 30.5 Step 2 — freeze the sample (`tools/rebuild/draftguru/stage_b1_sample.py`, new)

Reads the accepted Stage A `parsed/persons.jsonl` + `parsed/rows.jsonl` and the residual input
file; applies §30.3; writes `data/sources/draftguru/person-html-20260826/sample.json`.

Residual input handling: read as **bytes**; record `sha256` + byte size in `sample.json` verbatim;
split on `\n`, strip one optional trailing `\r` (psql on Windows may emit CRLF); require **exactly
68 non-empty lines**, each matching the contract's `canonical_player_url` regex. No other
transformation — **percent-encoding (`%20`, `%C3%A1`) is significant and is never decoded or
space-normalised**.

Per person: `player_url` (byte-exact), `slug`, `ordinal`, **`primary_cohort`** (exactly one of
`convergence` | `residual` | `decade_control` | `zero_game_control`), `eligibility_tags[]`,
`decade`, `reported_games_basis`, `draft_years`. File level: the selection rule, per-stratum
candidate/selected/shortfall counts, the residual-file sha256, and the Stage A manifest label +
sha256 it derives from.

Fail-closed: exactly 120 distinct URLs; every URL present byte-exactly in the accepted snapshot;
all 8 convergence URLs present; no URL carrying two primary cohorts. Zero network, zero database,
zero `psycopg`.

### 30.6 Implementation semantics — **manifest ownership and execution ordering**

**Full-mode `acquire_persons.py` owns Stage B1 orchestration.** The accepted full run is a single
ordered pipeline:

```text
sample.json
  -> acquire / classify all 120 identities
  -> invoke the offline person-page profiler
  -> produce parsed/person_profile.jsonl
  -> produce parsed/afltables_link_profile.json
  -> verify all 120 identities carry terminal classifications
  -> build the Stage B1 manifest
  -> final manifest-immutability check (existing label => abort, write nothing)
  -> write the manifest LAST
```

`profile_person_pages.py` exposes **reusable offline profiling functionality** (stdlib only, no
network, no PostgreSQL, no `psycopg`) and may keep its own CLI for validation/debugging, but **the
accepted full B1 run must not write the manifest before profiler/aggregate completion.** This
removes any ambiguity between the acquisition step and the profiling step: they are one accepted
run, in that order, with the manifest as the last act.

**Probe mode is different:** bounded probe acquisition only (e.g. the two Brad Miller pages); the
profiler may be run separately for inspection; **probe mode MUST NOT write the accepted Stage B1
manifest.**

### 30.7 Implementation semantics — **terminal classification and resume**

A person is **terminally classified** when either:

- **A. fetched** — a raw response file **and** its HTTP metadata record both exist; or
- **B. terminally failed** — acquisition exhausted the approved retry policy (3 retries, 2/4/8s,
  only on timeout / connection error / 5xx / 429) or received another deterministic terminal
  failure (e.g. 404), **and** an HTTP failure record exists containing: exact `player_url`,
  terminal classification, HTTP status where available, reason, and the attempt/retry evidence the
  contract requires.

**Resume rules:**

- successful raw+HTTP pairs are reused and **never rewritten**;
- terminal failure records are **also reused** — never silently retried, never silently
  reclassified;
- interrupted / non-terminal attempts may resume;
- retrying an already-terminal failure requires an **explicit future retry mechanism/decision**,
  not normal resume behaviour.

**Therefore a completed B1 experiment may legitimately have `requested = 120`, `fetched < 120`,
`failed > 0` and still receive a manifest, provided `fetched + failed = 120`, all 120 carry
deterministic terminal classifications, and profiler/aggregate processing is complete.**

**An interrupted run where `fetched + failed < 120` MUST NOT receive a manifest.** Raw/http
artifacts are retained for resume; absence of a manifest means the experiment did not complete.

HTTP/page failures are **findings**, not incompleteness. The manifest records `requested` /
`fetched` / `failed` counts and the **exact** failed identities with their reasons, plus
`person_pages { stage: "B1", sample_basis }` and the §10 `afltables_link_profile`.
**`identity_complete: false` and `import_capable: false` are mandatory** — a profiling sample can
never become an import source.

### 30.8 Remaining implementation contract (execution session)

- **Contract additions** — `tools/rebuild/draftguru/draftguru-contract.json`, **additive only**
  (no existing Stage A key changes; the accepted manifest and the 34/34 suite depend on them):
  `person_stage` with `person_url_pattern` (reusing the frozen `canonical_player_url` regex),
  `person_snapshot { root: data/sources/draftguru, label_pattern: "^person-html-[0-9]{8}$",
  manifest_dir: docs/rebuild-manifests/draftguru }` **plus an explicit refusal if the supplied
  label matches the annual pattern**, and `afltables_link` (recognised host forms
  `afltables.com` / `www.afltables.com`, http/https; the `players/<A>/<Name>.html` shape; the
  normalisation contract mirroring `tools/migration/import_fitzroy_core.py:211
  normalise_profile_url()`, which strips `^https?://afltables\.com/afl/stats/` only — **a `www.`
  host therefore does not reduce and is a finding, not a silent pass**). HTTP policy reused
  unchanged: 1.5s min delay, 20s timeout, 3 retries 2/4/8s, same-host redirects, concurrency 1.
- **`acquire_persons.py`** — imports and reuses, without modifying, `acquire_draft.py`'s `Fetcher`,
  `check_robots`, `atomic_write_bytes`, `atomic_write_json`, `sha256_hex`, `utc_now`. Input
  `sample.json`; ordering slug then ordinal, byte-identical across runs. Layout
  `raw/persons/<slug>__<ordinal>.html` (exact bytes, binary write, no decode) +
  `http/persons/<slug>__<ordinal>.json` (status, final URL, redirect chain, content-type, byte
  size, sha256, `fetched_at`, terminal classification) + `http/persons_index.json` mapping
  filename → exact `player_url` **so a filename never becomes identity**. robots.txt fetched fresh
  for this snapshot with `/players/*` explicitly checked — a disallow is **stop and report**, never
  a workaround.
- **`profile_person_pages.py`** — per person, verbatim: source `player_url`; requested URL; final
  URL + redirect chain; HTTP status; title / `<h1>` display name; DOB if exposed; height; original
  club; DraftGuru reported games and club splits; **every** `<a href>` on an AFL Tables host,
  verbatim and in document order, with count; the normalised `players/A/Name.html` form per href
  (or the reason it does not reduce); other external identity links (Wikipedia/AFL.com) as
  vocabulary only; flags for no link, multiple distinct AFL Tables candidates, malformed form,
  missing/dead page, self-link disagreeing with the requested `player_url`, and `primary_cohort`.
  Aggregate: overall coverage %, per-cohort coverage, URL-form vocabulary, duplicate/collision
  counts (**two DraftGuru persons → one AFL Tables profile is a finding, never a merge
  instruction**), and the per-pair convergence result — do the two members of each pair resolve to
  *distinct* AFL Tables identities?
  **Hard rules: never infer a link from a name; never modify raw bytes; never percent-decode a
  slug; write nothing to PostgreSQL.**
- **Tests** — extend the existing semantic home `tests/draftguru-acquisition.test.ts` (34/34 today;
  **existing tests must not be weakened**): sample determinism and the exact 120 / 8 / 68 / 30 / 14
  shape; mutually-exclusive `primary_cohort`; residual-input parsing (68-line requirement, CRLF
  tolerance, regex, hash recording); percent-encoded slug round-trip; Stage-A-snapshot-write
  refusal (annual label rejected, accepted snapshot path never written); AFL Tables href extraction
  from committed person fixtures; normalisation agreement with `normalise_profile_url` including
  the `www.` non-reducing case; multiple-candidate and no-link classification; manifest
  `identity_complete:false` / `import_capable:false`; **manifest written only after all 120 reach a
  terminal classification and the profiler/aggregate output exists**; **`fetched + failed = 120`
  with `failed > 0` still yields a manifest, while `fetched + failed < 120` yields none**;
  **terminal failure records are reused on resume, not retried or reclassified**; probe mode writes
  no manifest; manifest immutability; zero legacy-SQLite / zero DB dependency pins. Fixtures
  `tests/fixtures/draftguru/person_*_excerpt.html` are trimmed from real Stage B1 raw bytes after
  the probe — Brad Miller `/1` and `/2` first.
- **Verification order:** static suite → 2-page probe (`brad_miller/1`, `/2`, no manifest) →
  full 120-identity run → manifest present ⇒ complete.

### 30.9 Post-crawl reconciliation — second bounded read-only query (aggregate only)

Deliberately **not** part of Step 1. "Does DraftGuru expose the same identity AFLDB already holds,
or contradict it?" is answered **after** the crawl by passing the observed
`(player_url → normalised afltables path)` pairs into a read-only `afldb_dev` query as a `VALUES`
list and returning **aggregate counts and categories only** — same / absent / contradicts /
not-linked. **No `external_id`, name or id egress.** Same safety envelope as §30.4.

### 30.10 HALT conditions (preserve the evidence in this section before stopping)

Residual counts differ from `3464 / 3460 / 68 / 68 / 60 / 8`; the input file is not exactly 68
valid non-empty lines; any line fails the canonical `player_url` regex; any residual URL is absent
byte-exactly from the accepted `parsed/persons.jsonl`; robots.txt disallows `/players/*`; person
pages are not server-rendered or require JavaScript/browser automation; a page exposes multiple
plausible AFL Tables person identities; link forms are structurally inconsistent enough to change
the identity model; the 120-person sample proves insufficient; Stage B2 appears necessary; or any
need arises for a PostgreSQL write, legacy SQLite, or name-only matching.

### 30.11 Decision boundary

Stage B1 concludes with **exactly one** recommendation: **A** bridge reliable enough to be a
primary external-identity acquisition path; **B** useful but incomplete — use where present and
require another deterministic path for residuals; **C** too inconsistent/ambiguous to justify
larger acquisition; **D** evidence insufficient — one specifically bounded further experiment.

**Stage B2 is not self-approved (U2).** Any proposal must state measured B1 coverage, the
known false/contradictory rate, residual coverage gained, the convergence-pair result, expected
incremental value, estimated request count/cost and the exact safety/validation design — then
**HALT for approval**.

### 30.12 Settled boundaries carried forward (must not be reopened)

Zero `AFLDB_LEGACY_SQLITE`; no PostgreSQL writes anywhere in Stage B1; acquisition and import
remain separate phases; **the DraftGuru PostgreSQL importer is not implemented in Stage B1** (§16
records its requirements); `player_url` is the durable person identity in its U1 canonical form,
byte-exact including percent-encoding; the rendered name is never identity; Brad Miller `/1` and
`/2` are different people; old automatic DraftGuru links are audit/reconciliation baseline only and
must be re-earned; only explicit `player_link_resolutions` rows are replayable; the accepted Stage
A snapshot/manifest and the frozen CSV corpus are immutable; `IssuesIndex.md` and `CHANGELOG.md`
stay untouched during Stage B1 (deferred per §28); **U3** (off-host archive path for the accepted
Stage A `raw/`) remains an open operational item and is not a Stage B1 blocker.

### 30.13 Execution boundary — **the planning session ends here**

Approved planning work is complete once (1) this §30 is saved, (2) the §30.4 query text is frozen,
and (3) the §30.3/§30.5 sample-construction contract is frozen. All three are done.

**Not done and deliberately not started in the planning session:** Step 1 was **not run**; no
Stage B1 implementation file was created; no person page was crawled; Stage A was not modified; no
Git command was executed.

**The next session starts from this section and performs, in order:**

1. **Step 1** — the bounded read-only `afldb_dev` residual query of §30.4 (user-run), evaluating
   the counts and the 68-line input file against §30.10;
2. **Step 2** — build and validate `sample.json` per §30.5 (exactly 120, one primary cohort each);

before proceeding into contract/adapter/profiler/test implementation, the 2-page probe, and only
then the full 120-identity run.

**Recommended execution profile:**

| | |
|---|---|
| **Model** | **Opus** |
| **Reasoning** | **High** |
| **Mode** | **Manual / execution** |

**Files changed by this planning session:** `AFLDB-ISSUE-093-DRAFTGURU-ACQUISITION-HANDOFF.md`
(this §30) only.

---

## 31. STAGE B1 EXECUTION LOG — 2026-08-26 (Opus / High / Manual execution session)

Execution session opened from §30. §30 is the implementation contract; nothing in it was re-planned.

### 31.1 Step 1 — bounded read-only `afldb_dev` residual query: EXECUTED, **PASS**

Pre-flight (agent-side, native file inspection only — no shell, no Git, `.env` never read):

- `data/sources/draftguru/person-html-20260826/` did not exist ⇒ `mkdir -p` was a fresh create;
- `.gitignore:37` `/data/*` with opt-ins only for `/data/awards`, `/data/records`,
  `/data/reference/*.json` ⇒ the whole Stage B1 snapshot is gitignored, as §30.2 requires;
- accepted Stage A `annual-html-20260826/parsed/{persons,rows}.jsonl` present; the Step 1 command
  references neither;
- `tools/rebuild/draftguru/` held only Stage A files ⇒ consistent with §30.13 ("no Stage B1
  implementation file was created");
- sole write in the command is `input/residual_player_urls.txt` via `\o`.

**Verdict: the §30.4 frozen command remained valid and was issued unmodified.**

**Exact user-run command:** the §30.4 frozen command, verbatim (Git Bash, cwd `/d/dev/afldb`).

**Observed identity proof**

```text
db=afldb_dev  user=afldb_owner  txn_ro=on  default_ro=on  isolation=repeatable read
```

**Observed residual counts — match §30 expectations exactly**

| Metric | Expected | Observed |
|---|---:|---:|
| `linked_persons` | 3464 | **3464** |
| `canonical_players` | 3460 | **3460** |
| `residual_players` | 68 | **68** |
| `residual_persons` | 68 | **68** |
| `residual_unique` | 60 | **60** |
| `residual_resolved` | 8 | **8** |

**Residual input file (gitignored, inside the Stage B1 snapshot)**

```text
data/sources/draftguru/person-html-20260826/input/residual_player_urls.txt
lines  = 68
bytes  = 3580
sha256 = df6c9a7559bceb649e8e28e457fbe91d3351d8c1737a9042f233b1f1e3c5e841
```

No §30.10 HALT condition triggered. Egress was `player_url` values plus aggregate counts only — no
names, no canonical player ids, no external ids. The transaction ended in `ROLLBACK`;
`afldb_test_pre_rebuild_20260825` was never named or connected to; `AFLDB_LEGACY_SQLITE` was not
involved. Terminal echo noise reported by the user around the paste was explicitly excluded from the
evidence above.

**These three values are now contract inputs** and are recorded verbatim in `sample.json` by Step 2.

### 31.2 Stage A facts re-verified for Step 2 (agent-side native reads, no commands)

- `parsed/persons.jsonl` fields: `player_url`, `slug`, `ordinal`, `years[]`, `row_count`,
  `display_names_raw[]`. Decade basis = `min(years)`.
- `parsed/rows.jsonl` reported games live at `parity_only.games` as **strings**. Measured across all
  6,810 rows: **0 nulls**; **5,292** match `^\d+$`; **1,518** match `^\d+ \(\d+\)$` (career total
  with a club split in parentheses); 5,292 + 1,518 = 6,810 ⇒ **the only two accepted forms**, and no
  `"0 (0)"` form exists. Career games = the leading integer; the parenthetical is a club split.
  `stage_b1_sample.py` fails closed on any third form rather than coercing it.
- All eight §30.3 convergence URLs are present in `parsed/persons.jsonl` (`adam_houlihan/1,2`
  lines 51–52, `andrew_hill/1,2` 222–223, `brad_miller/1,2` 588–589, `michael_brown/1,2`
  3381–3382), each with exactly two ordinals and no third.
- Accepted manifest carries `"snapshot_label": "annual-html-20260826"` and
  `"distinct_player_url_count": 5057` — both cross-checked by Step 2.

### 31.3 Step 2 — sample freezer implemented, **validation PENDING**

**File created:** `tools/rebuild/draftguru/stage_b1_sample.py` (new, ~560 lines). No other
repository file was changed by this step. Stage A snapshot, Stage A manifest, the frozen CSV
corpus, `import_draft.py`, migrations, `src/`, `IssuesIndex.md` and `CHANGELOG.md` are untouched.

Implements §30.3/§30.5 exactly:

- **Inputs, all read-only:** accepted Stage A `parsed/persons.jsonl` + `parsed/rows.jsonl`, the
  accepted Stage A manifest (bytes hashed), and the §30.4 residual input file.
- **Residual handling:** read as bytes; sha256 + byte size recorded verbatim; split on `\n`; one
  optional trailing `\r` stripped per line (Windows psql CRLF) and counted; **no other
  transformation** — percent-encoding is never decoded. Requires exactly 68 non-empty lines, each
  matching the frozen `canonical_player_url` regex, each unique, and each present **byte-exactly**
  in the accepted Stage A person set. The measured §31.1 evidence is **pinned in code**
  (`68` lines / `3580` bytes / `df6c9a75…e841`); a mismatch fails closed as a §30.10 HALT finding
  rather than being absorbed.
- **Cohorts, drawn in order, each excluding already-selected URLs:** convergence (8, fixed contract
  order, all eight asserted present in Stage A) → residual (68, complete census, explicit
  overlap check with a named error) → decade controls (6 per decade 1980s–2020s, career games > 0)
  → zero-game controls (14, every row `"0"`).
- **Determinism:** control strata order candidates by `sha256(player_url utf-8)` hex ascending and
  take the first N. No randomness, no name-based selection. `sample.json` carries **no timestamp**,
  so a rerun over identical inputs is byte-identical; `--validate-only` proves that against the
  on-disk file, and a differing existing `sample.json` is never silently replaced (`--overwrite` is
  a deliberate human act).
- **Games basis:** `parity_only.games` parsed with `^(\d+)( \((\d+)\))?$`; career games is the
  leading integer. Any third form fails closed instead of being coerced (§31.2 measurement).
- **Per person:** `player_url`, `slug`, `ordinal`, `primary_cohort` (exactly one),
  `eligibility_tags[]` (descriptive only — `decade_*`, `games_zero`/`games_positive`,
  `residual_census_member`, `convergence_pair_member`), `decade`, `decade_basis_year`,
  `draft_years`, `stage_a_row_count`, `reported_games_basis`, `player_url_sha256`.
- **File level:** selection algorithm + ordering + mutual-exclusion statement, per-stratum
  candidates/quota/selected/shortfall, residual sha256/bytes/lines/CRLF count, Stage A label +
  manifest sha256 + persons/rows jsonl sha256 + person/row counts, the exact 120-URL selected list,
  and mandatory `identity_complete: false` / `import_capable: false`.
- **Fail-closed gates:** exactly 120 distinct URLs; cohort counts exactly 8 / 68 / 30 / 14; one
  `primary_cohort` per person (a second assignment raises); all eight convergence URLs present;
  every selected URL present byte-exactly in Stage A; any stratum shortfall is an error, never a
  silent backfill from another stratum.
- **Structural Stage A protection:** the label must match `^person-html-[0-9]{8}$` (the
  `person_stage` contract block wins once it exists); an **annual** label or the frozen CSV label is
  refused by name; and every write target is asserted to resolve inside the Stage B1 snapshot and
  outside the Stage A snapshot before any bytes are written.
- **Zero** network, PostgreSQL, `psycopg` and legacy SQLite. Only `parse_draft_snapshot`
  (`load_contract`, `FROZEN_CSV_LABEL`, `ParseFailure`) is imported; the acquisition adapter — the
  only module carrying network code — is deliberately **not** imported.

**Exact next action:** user runs the Step 2 command below; agent evaluates counts against
§30.3 before any contract/adapter/profiler work.

```bash
cd /d/dev/afldb && python.exe tools/rebuild/draftguru/stage_b1_sample.py --label person-html-20260826
```

Expected: cohort counts `8 / 68 / 30 / 14`, total `120`, zero shortfalls, all eight convergence
URLs listed, residual evidence echoing `68 / 3580 / df6c9a75…e841`, and a `sample.json` sha256 to
record. **PENDING — no person page has been crawled; no Stage B1 manifest exists.**

### 31.4 Step 2 — sample freeze: EXECUTED, **PASS**. The 120-person sample is now **FROZEN**

**Exact user-run command**

```bash
cd /d/dev/afldb && python.exe tools/rebuild/draftguru/stage_b1_sample.py --label person-html-20260826
```

**Result: PASS — frozen Stage B1 sample validated (120 persons, one primary_cohort each).**

| Evidence | Observed |
|---|---|
| Stage A label / persons / rows | `annual-html-20260826` / 5,057 / 6,810 |
| Residual input | 68 lines, 3,580 bytes, sha256 `df6c9a75…e841`, **0 CRLF lines stripped** |
| `convergence` | **8** |
| `residual` | **68** |
| `decade_control` | **30** (6 per decade, zero shortfall) |
| `zero_game_control` | **14** |
| **TOTAL** | **120** |
| Convergence URLs present | 8/8 (`adam_houlihan/1,2`, `andrew_hill/1,2`, `brad_miller/1,2`, `michael_brown/1,2`) |

Candidate pools measured (evidence that no stratum was backfilled): decade controls
1980s **269**, 1990s **958**, 2000s **847**, 2010s **917**, 2020s **462**; zero-game **1,528**.
Every stratum shortfall was **0**.

**FROZEN artifact**

```text
data/sources/draftguru/person-html-20260826/sample.json
sha256 = d8d743fbcfca39a4c9e708a1198c7e34592270d32628d4fc0003aea88068db28
```

**The sample membership and the deterministic selection are now FROZEN.** They must not change
unless new evidence triggers an explicit HALT/review. `sample.json` is timestamp-free, so any
rebuild from identical inputs reproduces this exact sha256; `--validate-only` proves it, and the
tool refuses to replace a differing on-disk sample without a deliberate `--overwrite`.

### 31.5 Pre-probe implementation batch — COMPLETE, **validation PENDING**

No person page was crawled. No live acquisition, test, build, Git, database or deployment command
was executed by the agent. The only shell use was a read-only `ast.parse`/`json.load` syntax check
of the new files (no imports executed, no writes).

**Files changed**

| File | Change |
|---|---|
| `tools/rebuild/draftguru/draftguru-contract.json` | **additive** `person_stage` block only — no Stage A key touched |
| `tools/rebuild/draftguru/acquire_persons.py` | **new** — person acquisition + full-run orchestration |
| `tools/rebuild/draftguru/profile_person_pages.py` | **new** — offline person-page profiler |
| `tools/rebuild/draftguru/stage_b1_sample.py` | `--expect-residual-bytes` added (was a hard constant); **no change to selection logic or to the frozen `sample.json` bytes** |
| `tests/draftguru-acquisition.test.ts` | Stage B1 cases appended; the 34 Stage A tests are untouched |

`person_stage` pins: the person URL pattern (reusing the frozen `canonical_player_url` regex),
snapshot root/label pattern `^person-html-[0-9]{8}$`/manifest dir, **explicit refusal of
`annual-html-*`, `csv-export-*` and `full-history-*` labels**, the layout and the
filename-is-never-identity rule, the frozen sample shape, the AFL Tables vocabulary
(`afltables.com` / `www.afltables.com`, http/https, `players/<A>/<Name>.html`) with
`www_host_reduces: false`, the inherited HTTP policy, mandatory
`identity_complete:false` / `import_capable:false`, and the terminal-classification/resume rules.

**`acquire_persons.py`** reuses Stage A's `Fetcher`, `check_robots`, `atomic_write_bytes`,
`atomic_write_json`, `sha256_hex`, `utc_now` **without modifying them**; orders by slug then
ordinal; writes `raw/persons/<slug>__<ordinal>.html` (exact bytes) + `http/persons/<...>.json` +
`http/persons_index.json` (filename → exact `player_url`); writes **raw bytes before** the terminal
record so a crash resumes rather than leaving a terminal record with no evidence; reuses terminal
successes and terminal failures without retrying or rewriting them; refuses probe targets outside
the frozen sample; and owns the accepted ordering — acquire → profile → verify 120 terminal
classifications → build manifest → immutability re-check → **manifest LAST**.

**`profile_person_pages.py`** is offline stdlib only (it imports no network module and never
imports the acquisition adapter). It records, per person: exact `player_url`, requested/final URL
and redirect evidence, HTTP status, title/`<h1>`, heuristic DOB/height/labelled fields (explicitly
labelled heuristic and never identity), **every** AFL Tables href verbatim in document order with
its classification, the canonical reduced identity or the reason it does not reduce, DraftGuru
self-links, external Wikipedia/AFL.com links as vocabulary only, and the flags for no-link,
multiple candidates, malformed form, missing/dead page, self-link disagreement and non-reducing
host. The aggregate answers §30.8's questions 1–10, including per-cohort coverage, URL-form
vocabulary, collisions and the per-pair convergence result.

**AFL Tables normalisation is a deliberate mirror**, not a re-derivation: the strip is exactly
`^https?://afltables\.com/afl/stats/` as in `tools/migration/import_fitzroy_core.py:220`, so a
`www.` host **does not reduce** and is classified `non_reducing_host` — reported as a finding, never
silently repaired. A test asserts the mirror and asserts the regex was **not** broadened.

**Two deliberate additions beyond §30's literal text — both restrict behaviour, neither broadens
scope. Flagged for your review:**

1. **A fully-resumed run performs no network access at all.** If every requested identity is
   already terminally classified there is no request to authorise, so the run reuses the robots.txt
   evidence recorded by the acquiring run (`http/robots_txt.json`) instead of re-fetching it. A
   snapshot that never fetched robots.txt cannot be completed.
2. **`--no-fetch`** — complete/verify only: never make a request, and fail closed with **no
   manifest** if any requested identity is still unclassified.

Together these make completion, manifest and resume semantics provable offline, before any live
request. Progress logging was routed to stderr so stdout carries only the machine-readable summary.

**Tests added** (Stage B1 section appended; existing 34 Stage A tests unchanged and not weakened):
contract additivity and Stage-A-key stability; label shape and Stage A label refusal;
profiling-only manifest declaration; frozen 120 / 8 / 68 / 30 / 14 shape; AFL Tables vocabulary and
the www finding; inherited HTTP policy; terminal/resume pins; zero database-driver imports in all
three tools and zero network imports in the freezer/profiler; no destructive filesystem operations;
the `normalise_profile_url` mirror; manifest-written-LAST source ordering; **spawned** sample-freezer
tests (exact 120 with one cohort each, 6 games-positive controls per decade, all 8 convergence
persons, byte-identical determinism + `--validate-only`, residual evidence recorded, CRLF-only
tolerance, refusal of short/blank/duplicate/foreign residual input, hash-drift refusal,
percent-encoded round-trip with no decoding, Stage A label refusal writing nothing); adapter offline
paths (existing-manifest abort, Stage A label refusal, deterministic plan ordering with
storage-only filenames, probe target outside the sample refused); profiler behaviour on **clearly
labelled synthetic** pages (canonical extraction, www non-reduction finding, no-link with the name
present and unused, multiple-candidate refusal, collision finding, convergence-pair distinctness,
terminal failure as missing page, incomplete-experiment refusal); and completion semantics
(`fetched + failed = 120` with `failed > 0` writes a profiling-only manifest;
`fetched + failed < 120` writes none; terminal successes and failures byte-identical after resume;
probe writes no manifest; every filename maps back to its exact `player_url`).

**Explicitly PENDING until the Brad Miller probe produces real bytes:** every assertion about real
DraftGuru person-page **structure** — where the AFL Tables link actually sits, the real DOB/height/
original-club/games markup, and the trimmed fixtures
`tests/fixtures/draftguru/person_*_excerpt.html`. No real-source fixture was fabricated to close
the matrix; the synthetic pages carry a banner saying they test parser mechanics only.

**Exact next action:** user runs the targeted suite below; agent evaluates it before any live
acquisition.

```bash
npx vitest run tests/draftguru-acquisition.test.ts
```

**Validation PENDING.** No person page crawled, no Stage B1 manifest written, Stage B2 not started,
no importer implemented.

### 31.6 Step 3 — pre-probe implementation validation: EXECUTED, **PASS (79/79)**

**Exact user-run command**

```bash
npx vitest run tests/draftguru-acquisition.test.ts
```

**Result**

```text
Test Files  1 passed (1)
Tests       79 passed (79)
Duration    12.11s
```

- the **34 Stage A tests remain green** — none weakened, skipped or rewritten;
- all Stage B1 pre-probe tests green (45 added);
- the **frozen `sample.json` rebuilt byte-identically** under `--validate-only`
  (sha256 `d8d743fb…db28` reproduced from the accepted Stage A snapshot + the 68-line residual
  input);
- no person page crawled, no Stage B1 manifest, no database access anywhere in the suite.

**Baseline for the rest of Stage B1: `tests/draftguru-acquisition.test.ts` = 79/79 PASS.**

### 31.7 Step 4 — bounded two-page live probe: command issued, **awaiting output**

Scope: exactly two frozen-sample identities, under the Stage B1 label, in probe mode.

```text
https://www.draftguru.com.au/players/brad_miller/1
https://www.draftguru.com.au/players/brad_miller/2
```

These are the proven-different-people anchor pair, so the probe simultaneously tests acquisition,
server-rendering, byte preservation and whether the `/1` vs `/2` distinction survives to an AFL
Tables identity.

**Exact command issued**

```bash
cd /d/dev/afldb && python.exe tools/rebuild/draftguru/acquire_persons.py --label person-html-20260826 --probe "https://www.draftguru.com.au/players/brad_miller/1" --probe "https://www.draftguru.com.au/players/brad_miller/2"
```

Pre-flight verified by agent-side inspection before issuing it:

- `docs/rebuild-manifests/draftguru/person-html-20260826.json` does **not** exist, so the run is
  not aborted by the immutability gate and — being probe mode — **cannot write it either**;
- both URLs are in the frozen `sample.json` (`convergence` cohort), so the probe-target check
  passes; a target outside the sample would be refused;
- neither identity has a raw/HTTP record yet, so both are pending: robots.txt is fetched fresh for
  this snapshot with `/players/*` explicitly checked, and a disallow **stops the run**;
- the frozen HTTP policy is inherited unchanged (concurrency 1, 1.5 s pacing, 20 s timeout,
  3 retries at 2/4/8 s, same-host redirects only);
- every write lands under `data/sources/draftguru/person-html-20260826/`
  (`raw/persons/brad_miller__{1,2}.html`, `http/persons/brad_miller__{1,2}.json`,
  `http/persons_index.json`, `http/robots.txt`, `http/robots_txt.json`); Stage A paths are
  structurally unreachable.

**Expected on success:** two 200s with byte sizes, then a stdout JSON summary with
`"mode": "probe"`, both URLs under `requested`, `failed: []`, and **`"manifest_written": false`**.

### 31.8 Step 4 — bounded two-page live probe: EXECUTED, **PASS**

**Result**

```text
brad_miller__1: 200 20816 bytes
brad_miller__2: 200 7993 bytes
mode = probe   failed = []   manifest_written = false
```

Exactly two identities were fetched, both from the frozen sample's `convergence` cohort:

```text
https://www.draftguru.com.au/players/brad_miller/1
https://www.draftguru.com.au/players/brad_miller/2
```

Proven by this probe: person pages are reachable under the frozen HTTP policy; acquisition,
byte-exact storage and the terminal-classification path work end to end; **no accepted Stage B1
manifest was written** (probe mode cannot write one); robots.txt permitted `/players/*` — a
disallow would have stopped the run. The two pages differ materially in size (20,816 vs 7,993
bytes), which is itself consistent with `/1` and `/2` being different people rather than one
duplicated record.

The remaining 118 identities are **not** crawled.

### 31.9 Probe evidence — agent-side READ-ONLY inspection of the acquired bytes

No file was modified, nothing was fetched, no Git/database command was run. Findings below come
from the stored raw bytes and their HTTP records.

**Stored evidence**

| | `/1` | `/2` |
|---|---|---|
| bytes | 20,816 | 7,993 |
| sha256 | `1296a83b…974d` | `b8801a60…a844` |
| HTTP status / final URL | 200, no redirect | 200, no redirect |
| `content_type` | `text/html` (no charset) | `text/html; charset=utf-8` |
| charset resolution | `<meta charset="utf-8" />` | HTTP header |
| `<td>` data cells | 219 | 44 |
| `<title>` | `Brad Miller (born 1983) - Draftguru` | `Brad Miller (number 2) - Draftguru` |

**1. Server-rendered? YES — both, fully.** Real data is present in the delivered bytes (219 / 44
`<td>` cells, `<table>`/`<thead>`/22 `<th>`, club and year values such as Melbourne, Richmond,
2001). Five `<script>` tags exist but **no hydration markers at all** — no `__NEXT_DATA__`, no
`data-reactroot`, no `window.__INITIAL*`, no `ng-app`. **No browser automation is required**; the
offline profiler is sufficient.

**2. Every AFL Tables href, exactly as stored**

`/1` — one, inside a "More details:" paragraph
(`<p class="top-bump smaller-text">`), anchor text `AFL Tables`:

```html
<a href="http://afltables.com/afl/stats/players/B/Brad_Miller.html">AFL Tables</a>
```

`/2` — **none.** The string `afltables` does not appear anywhere in the 7,993 bytes.

**3. Link count per page: `/1` = exactly ONE AFL Tables profile link; `/2` = ZERO.**

**4. Do the two pages resolve to distinct AFL Tables identities? PARTIALLY — and this is the
first substantive Stage B1 finding.** `/1` reduces under the existing canonicaliser to
`players/B/Brad_Miller.html`. `/2` exposes **no** AFL Tables identity, so the pair cannot be
separated *by DraftGuru evidence*: there is no collision, but there is also no bridge. The bridge
is absent exactly where the historical ambiguity lives. The two pages are nevertheless clearly
different records — different byte size, different `<td>` count, and DraftGuru itself disambiguates
them in the title (`born 1983` vs `number 2`), which is display evidence and **never identity**.

**5. `www.afltables.com` — NOT exercised by this probe.** The one real href uses the bare
`afltables.com` host over `http`, which reduces correctly. The `non_reducing_host` finding path
therefore remains covered by synthetic cases only until a real `www.` form appears in the 120-page
run.

**6. Material differences from the synthetic parser-mechanics fixtures** (all recorded, none
"repaired"):

- **No `<h1>` anywhere.** The display name lives in `<title>` and in `<h2 class="heading">`. The
  synthetic fixtures used `<h1>`, so `page.h1` will be `null` for real pages while `page.title`
  carries the name. Identity is unaffected — the name is never identity — but the profiler should
  also capture `<h2>` as display evidence.
- **External identity links are a set, not a single link.** `/1` carries three in one paragraph:
  ```text
  http://afltables.com/afl/stats/players/B/Brad_Miller.html   AFL Tables
  http://www.footywire.com/afl/footy/pp-richmond-tigers--brad-miller   Footywire
  http://en.wikipedia.org/wiki/Brad_Miller_(footballer)   Wikipedia
  ```
  Wikipedia is in the contract's `external_vocabulary_hosts`; **Footywire is not**, so it is
  currently discarded rather than recorded as vocabulary. That is a measurement gap, not an
  identity risk.
- **No DraftGuru `/players/...` self-link** on either page, so `self_link_disagreement` cannot fire
  on real pages of this shape.
- Real pages carry statistics tables; the synthetic fixtures deliberately do not.

**Verdict: the acquired bytes are suitable for the existing offline profiler.** Two evidence-driven
profiler adjustments are **recommended but not yet made** (they are measurement improvements, and
neither changes an identity rule): capture `<h2>` display text alongside `<title>`/`<h1>`, and
record every non-DraftGuru external host as vocabulary instead of only the contract's four.

### 31.10 Step 5 — offline profiler over the two-page probe: EXECUTED, **PASS**

**Exact user-run command**

```bash
cd /d/dev/afldb && python.exe tools/rebuild/draftguru/profile_person_pages.py --label person-html-20260826
```

**Measured counts**

```text
requested = 2   fetched = 2   profiled = 2   failed = 0
with_afltables_identity = 1   without_afltables_link = 1
malformed_links = 0   multiple_candidates = 0   non_reducing_host = 0
parse_errors = 0   self_link_disagreement = 0   collisions = 0
```

Probe coverage 1/2 = **50%**. **This is probe coverage only and is NOT an estimate for the
120-person sample** — the two probe pages are the convergence anchor pair, deliberately the hardest
case, not a random draw.

**Substantive finding (carried forward to the Stage B1 decision):**

- `brad_miller/1` exposes exactly one reducible AFL Tables identity — `players/B/Brad_Miller.html`;
- `brad_miller/2` exposes **no** AFL Tables link at all;
- **no collision** exists between the pair;
- therefore the person-page bridge is **useful but incomplete for this known historical
  convergence case** — it identifies one member and is silent on the other, so it cannot by itself
  separate the pair.

Artifacts written inside the Stage B1 snapshot only:
`parsed/person_profile.jsonl`, `parsed/afltables_link_profile.json`. No manifest was written.

### 31.11 Step 6 — real-source fixtures + measurement-only profiler additions, **validation PENDING**

No network access, no additional person crawled, Stage A untouched, sample membership unchanged, no
manifest, no database access, no Git.

**Files changed**

| File | Change |
|---|---|
| `tests/fixtures/draftguru/person_brad_miller_1_real_excerpt.html` | **new** — trimmed REAL-SOURCE excerpt of the acquired `/1` bytes |
| `tests/fixtures/draftguru/person_brad_miller_2_real_excerpt.html` | **new** — trimmed REAL-SOURCE excerpt of the acquired `/2` bytes |
| `tools/rebuild/draftguru/profile_person_pages.py` | `<h2>` display capture + all-external-host vocabulary (measurement only) |
| `tests/draftguru-acquisition.test.ts` | real-source fixture regression tests appended |

**Fixtures.** Every element is copied verbatim from the acquired bytes; intervening site chrome,
scripts, stylesheets and surplus statistics rows were **removed**, and nothing was added, reordered
or reformatted. Both files carry a provenance header naming the `player_url`, the snapshot label,
the byte size, the sha256 and the fetch timestamp, and are explicitly labelled
**TRIMMED REAL-SOURCE FIXTURE (not synthetic)** so they can never be confused with the synthetic
parser-mechanics pages (which carry their own `SYNTHETIC fixture` banner). Both acquired pages are
pure ASCII (0 non-ASCII bytes), so the excerpts are byte-faithful. They preserve: the
`<h2 class="heading">Brad Miller</h2>` heading with **no `<h1>`**; the exact bare-host href
`http://afltables.com/afl/stats/players/B/Brad_Miller.html` with its `AFL Tables` anchor text; the
sibling Footywire and Wikipedia links in the same "More details" paragraph; `/2`'s complete absence
of any AFL Tables reference; and the surrounding `<table class="general individual-player">`
statistics structure on both pages.

**Profiler additions (measurement only — identity semantics unchanged).**

1. `<h2>` display text is captured alongside `<title>`/`<h1>` and surfaced as
   `page.display_name_evidence`, whose `$note` states it is **never** used for identity matching.
   No matching path consumes it.
2. Every non-DraftGuru external host on a person page is now recorded as vocabulary/evidence, each
   entry flagged `recognised_vocabulary` (true for the contract's four hosts, false otherwise) and
   carrying a `$note` that it is never an identity source. The aggregate gains
   `external_vocabulary_hosts_outside_contract`. **AFL Tables hrefs never enter this list** — they
   remain the only identity candidates.

**Unchanged and re-verified:** the AFL Tables host/scheme/path vocabulary; `normalise_profile_url()`
mirroring (`^https?://afltables\.com/afl/stats/` only); `www.afltables.com` still classifies as
`non_reducing_host` and is still a finding — **the canonicaliser was not broadened**; no host other
than the AFL Tables vocabulary can yield an identity.

**Tests added** (existing 79 preserved): fixtures are labelled real-source and carry provenance, and
are distinct from synthetic ones; the observed structure is pinned (h2 heading, no h1, exactly one
href on `/1`, none on `/2`, ≥9 `<th>`/`<td>` on both) with structural claims made against the
fixture **body** so the provenance comment cannot satisfy them; the profiler extracts the identity
from the href with the exact verbatim URL and `AFL Tables` anchor text; display name is read from
`<h2>` with `h1 = null` and the two pages carry the **same rendered name yet different identity
outcomes**; `/2` classifies as `no_afltables_link` (not a parse error) despite its tables; Footywire
records as unrecognised vocabulary and Wikipedia as recognised, with AFL Tables excluded from
vocabulary; the aggregate reports 1 identity / 1 absence / 0 collisions and the convergence pair as
`both_resolved:false`, `distinct_identities:null` (unanswerable, never guessed); and — when the
gitignored snapshot is present locally — the pinned markup is proven to exist byte-for-byte in the
acquired pages, with both fixtures strictly smaller than their sources.

**Additional evidence recorded, no action taken:** both real pages carry
`<link rel="canonical" href="http://www.draftguru.com.au/players/brad_miller/N" />` — the **http**
scheme, while AFLDB identity is the **https** `player_url`. Identity is never taken from a page, so
nothing changes; noted because a future `<link rel=canonical>`-based check would need this.

**Exact next action:** user runs the targeted suite; agent evaluates before any further crawling.

```bash
npx vitest run tests/draftguru-acquisition.test.ts
```

### 31.12 Step 6 — real-source regression gate: EXECUTED, **PASS (87/87)**

**Exact user-run command**

```bash
npx vitest run tests/draftguru-acquisition.test.ts
```

```text
Test Files  1 passed (1)
Tests       87 passed (87)
Duration    10.80s
```

All 79 previous tests remain green; the 8 real-source tests prove: the real pages use the observed
`<h2 class="heading">` structure with no `<h1>`; `/1` exposes exactly one reducible identity
`players/B/Brad_Miller.html`; `/2` exposes none; identity comes only from href evidence, never
display text; Footywire and Wikipedia stay descriptive vocabulary; statistics-table content creates
no false AFL Tables link; the real convergence pair is **one bridge, one absence, zero collision**;
and the fixtures are faithful excerpts of the acquired bytes.

**New Stage B1 baseline: `tests/draftguru-acquisition.test.ts` = 87/87 PASS.**

### 31.13 Step 7 — full 120-identity Stage B1 run: pre-flight PROVEN, command issued, **awaiting output**

Pre-flight performed by the agent read-only, using the adapter's own resume logic in-process (no
writes, no network, no database, no Git):

| # | Fact to prove | Measured |
|---|---|---|
| 1 | no accepted manifest exists | `docs/rebuild-manifests/draftguru/person-html-20260826.json` — **absent** |
| 2 | frozen sample still exactly 120 | **120** = `convergence 8 / residual 68 / decade_control 30 / zero_game_control 14`; `sample.json` sha256 **`d8d743fb…db28`** (unchanged since the §31.4 freeze) |
| 3 | the two Brad Miller terminal successes are valid | `/1` state `fetched`, 200, 20,816 bytes; `/2` state `fetched`, 200, 7,993 bytes; **raw sha256 matches the recorded sha256 for both**, and each record's `player_url` matches its planned identity byte-exactly |
| 4 | exactly 118 pending | plan entries **120**, terminal **2**, **pending 118** |
| 5 | the run will not refetch the two successes | both are **absent from the pending list** — the acquisition loop reuses their raw+HTTP pairs and never rewrites them |

**Exact command issued**

```bash
cd /d/dev/afldb && python.exe tools/rebuild/draftguru/acquire_persons.py --label person-html-20260826
```

Full mode (no `--probe`, no `--no-fetch`): reuse terminal records → acquire/classify the 118
pending → offline profile all 120 terminal outcomes → aggregate → verify `fetched + failed = 120` →
final immutability re-check → **write the accepted manifest LAST**, with `identity_complete:false`
and `import_capable:false`. Frozen HTTP policy applies (concurrency 1, 1.5 s pacing, 20 s timeout,
3 retries at 2/4/8 s, same-host redirects only); robots.txt is fetched fresh for the pending set
with `/players/*` checked, and a disallow stops the run. Expect roughly 119 requests (118 pages plus
robots) and ~4–6 minutes at the mandated pacing.

If `fetched + failed < 120` the run writes **no** manifest and retains every artifact for resume.
Individual page failures are findings, not experiment failure.

### 31.14 Step 7 — full 120-identity Stage B1 run: EXECUTED, **PASS**

```text
requested = 120   fetched = 120   failed = 0
identity_complete = false   import_capable = false   manifest_written = true
```

Accepted manifest: `docs/rebuild-manifests/draftguru/person-html-20260826.json`
(written LAST, after profiling and the terminal-count gate).

**Resume proven in the live run** — the two Brad Miller identities were reused, not refetched:

```text
brad_miller__1: already acquired (terminal), reusing
brad_miller__2: already acquired (terminal), reusing
```

so exactly the 118 pending pages were requested, every one returning HTTP 200, with zero terminal
failures. The manifest records this itself as `person_pages.reused_on_resume = {fetched: 2,
failed: 0}`. Run window `2026-08-26T09:20:10Z` → `09:23:12Z`.

### 31.15 STAGE B1 — COMPLETED MEASUREMENTS (read-only evaluation of the accepted artifacts)

Sources: the accepted manifest, `parsed/person_profile.jsonl` (120 records) and
`parsed/afltables_link_profile.json`. Nothing was modified, nothing fetched, no database touched.

**1. Overall AFL Tables bridge coverage (120 requested, 120 fetched)**

| Measure | Count |
|---|---:|
| with a reducible AFL Tables identity | **100** (83.33%) |
| without any AFL Tables link | **20** |
| malformed links | **0** |
| multiple candidates on one page | **0** |
| non-reducing host (`www.`) | **0** |
| parse errors | **0** |
| collisions (two persons → one profile) | **0** |
| terminal failures | **0** |
| redirects | **0** |
| self-link disagreements | **0** |

Link shape is perfectly uniform: **every one of the 100 links is a single
`http://afltables.com/afl/stats/players/<A>/<Name>.html` href**, classified `canonical`
(`url_form_vocabulary` = `{"http://afltables.com [canonical]": 100}`). No `https`, no `www`, no
second form. Pages carry exactly one AFL Tables href or none (distribution `{1: 100, 0: 20}`), and
the **100 identities are 100 distinct values**.

**2. Coverage by primary cohort**

| Cohort | Persons | With identity | Coverage |
|---|---:|---:|---:|
| `convergence` | 8 | 4 | **50.00%** |
| `residual` | 68 | 66 | **97.06%** |
| `decade_control` | 30 | 30 | **100.00%** |
| `zero_game_control` | 14 | 0 | **0.00%** |

**3. Residual cohort — the question Stage B1 exists to answer**

**66 of the 68** residual persons gain a usable AFL Tables identity directly from DraftGuru
(**97.06%**); **2 remain without a bridge**:
`.../players/fred_rodriguez/1` and `.../players/riley_onley/1`, both "no AFL Tables href on the
page" — an absence, not an ambiguity.

**4. All four historical convergence pairs**

| Pair | `/1` | `/2` | Same identity? |
|---|---|---|---|
| Adam Houlihan | `players/A/Adam_Houlihan.html` | **no link** | no |
| Andrew Hill | **no link** | `players/A/Andrew_Hill.html` | no |
| Brad Miller | `players/B/Brad_Miller.html` | **no link** | no |
| Michael Brown | `players/M/Michael_Brown.html` | **no link** | no |

**No pair converges to the same AFL Tables identity — in every pair exactly one side carries a
bridge and the other carries none** (note Andrew Hill is reversed: the identity sits on `/2`).
DraftGuru therefore never asserts that the two members are the same person; it simply says nothing
about one of them. `distinct_identities` is `null` for all four — unanswerable from one identity,
and deliberately never guessed.

**5. Zero-game cohort: 0 of 14.** This is semantically correct rather than a defect: AFL Tables
profiles players who played senior AFL games, so a person who never played has no profile to link.

**Mechanism (measured, not assumed).** Cross-tabulating DraftGuru's reported career games against
identity presence over all 120:

| | identity | no identity |
|---|---:|---:|
| games > 0 | **96** | **0** |
| games = 0 | 4 | 20 |

**Every person DraftGuru reports as having played at least one game carries a link — zero
exceptions.** The four `games = 0` persons that still carry a link (`gary_keane/1`,
`simon_hawking/1`, `simon_luhrs/1`, `terry_board/2`, all residual) are consistent with the Stage A
contract's standing rule that DraftGuru's games figure is **coerced to 0 at source and is
parity-only, never a fact**. The unresolved side of every convergence pair is a `games = 0` person —
which is precisely why the old automatic linking merged a real player with a never-played draftee.

**6. External-host vocabulary observed** (evidence only, never identity):
`en.wikipedia.org` **54**, `www.footywire.com` **19**. `external_vocabulary_hosts_outside_contract`
= `["www.footywire.com"]`. AFL Tables hrefs never enter this list.

**7. Real `www.afltables.com` non-reducing case: NONE appeared.** All 100 links use the bare host,
so the `non_reducing_host` finding path remains covered by synthetic tests only. The canonicaliser
was not broadened, and `www.` would still be reported as a finding if it ever appears.

**8. Anomalous evidence: none.** Zero malformed links, zero multiple-candidate pages, zero
collisions, zero parse errors, zero redirects, zero self-link disagreements, zero failures. One
structural fact carried forward: **no page has an `<h1>` (0/120); all 120 carry
`<h2 class="heading">`**, and every real page's `<link rel="canonical">` uses the `http` scheme
while AFLDB identity is the `https` `player_url` — recorded as evidence; identity is never taken
from a page.

**9. Internal consistency and immutability of the accepted experiment — all verified**

- `requested 120 = fetched 120 + failed 0`; `person_pages.failed = []`;
- 120 raw files and 120 HTTP records on disk, one per sampled identity;
- `sample_basis.sample_sha256` = **`d8d743fb…db28`** — matches `sample.json` on disk, i.e. the
  frozen sample was not altered;
- `sample_basis.stage_a_manifest_sha256` = **`d06bf6be…4652`** — matches the accepted Stage A
  manifest on disk, i.e. Stage A is intact and was only read;
- `sample_basis.residual_input_sha256` = **`df6c9a75…e841`** — the §31.1 query output;
- `parsed_outputs.person_profile.sha256` and `parsed_outputs.afltables_link_profile.sha256` both
  match the files on disk; `person_profile` records = **120**;
- `robots_txt_sha256` = `d3bdd069…` matches `http/robots.txt` on disk;
- `identity_complete: false`, `import_capable: false`, `immutable: true`,
  `identity_fields_present: ["player_url"]`;
- a re-run against this label now aborts on the existing manifest, as designed.

### 31.16 Preliminary Stage B1 conclusion — **B**, pending reconciliation (NOT self-approved)

**B — the bridge is useful but incomplete: use it where present, and require another deterministic
path for the identities it does not cover.**

Supporting evidence: 83.33% overall coverage; **97.06% (66/68) on exactly the residual population
AFLDB lacks**; 100% on ordinary decade controls; a single, perfectly uniform URL form; 100 distinct
identities with **zero collisions, zero ambiguity, zero malformed forms and zero failures**; and a
coherent mechanism — a link exists whenever DraftGuru reports senior games, so the absences are
concentrated in never-played persons rather than scattered unpredictably.

Why not **A**: coverage is measured, **correctness is not yet**. Nothing so far tests whether a
DraftGuru-asserted AFL Tables identity agrees with the identity AFLDB already holds; a
systematically wrong-but-confident link would look identical in this profile. Also, the bridge is
structurally silent on never-played persons, and it resolves only one side of each convergence
pair — so it cannot by itself separate the historical convergence cases that motivated ISSUE-093.

Why not **C**: the evidence is the opposite of inconsistent — one URL form, no ambiguity, no
collisions.

Why not **D**: no further *acquisition* experiment is needed. The remaining uncertainty is not
about DraftGuru; it is about agreement with AFLDB, which is answered by reading AFLDB, not by
crawling more pages.

**Recommended next approved step: the bounded read-only `afldb_dev` reconciliation of §30.9** —
pass the observed `(player_url → normalised afltables path)` pairs in as a `VALUES` list under the
§30.4 safety envelope and return **aggregate categories only** (same / absent / contradicts /
not-linked), with no name, id or `external_id` egress. That measures the false/contradictory rate,
which is the one input the A/B/C/D decision still lacks.

**HALTING for user review. Stage B2 is not started and is not self-approved; no importer work; no
database command has been run.**

### 31.17 FINAL B1 GATE — bounded read-only reconciliation: prepared, **awaiting user run**

**File created:** `tools/rebuild/draftguru/reconcile_person_bridge.py` (new, ~200 lines). No other
file changed. `psql` is not installed on this host, so the runner uses the project virtualenv
(`.venv/Scripts/python.exe`, Python 3.12.10) with **psycopg 3.3.4**.

**Question:** when AFLDB already holds enough identity evidence to compare a DraftGuru person with
an AFL Tables identity, does the person-page bridge **agree**?

**Input:** only the observed Stage B1 pairs `player_url → normalised AFL Tables path`, read offline
from the accepted `parsed/person_profile.jsonl`. Verified offline before issuing: **120 pairs, 100
with a bridge, 20 without**, every path of the `players/…` form. Matching is by `player_url` and by
normalised path — **names are never used**.

**Category definitions (frozen before the run):**

| Category | Meaning |
|---|---|
| `same` | AFLDB holds an AFL Tables identity for this person and the observed bridge **matches it exactly** |
| `contradicts` | AFLDB holds an AFL Tables identity and the observed bridge names a **different** one |
| `absent` | the person is linked to a canonical player, but AFLDB holds **no** AFL Tables identity for that player — the bridge is **new information** |
| `not_linked` | AFLDB knows this DraftGuru person but has no canonical player for it — nothing to compare |
| `person_absent` | AFLDB has no `draft_persons` row for that `player_url` at all |
| `no_bridge_observed_afldb_has_identity` | DraftGuru exposes no AFL Tables link, but AFLDB already holds one |
| `no_bridge_observed` | DraftGuru exposes no link and AFLDB holds none either |

Each category is additionally split by **provenance**, kept deliberately separate:
`explicit_admin_decision` (a `player_link_resolutions` row of action `linked` or
`confirmed_unlinked` exists for a `draft_picks` row of that person) versus `automatic_only`, plus
the AFLDB `link_status`. **An old automatic link is reconciliation evidence, never identity truth**;
nothing is replayed, repaired or modified.

**Safety envelope (mirrors §30.4):** `AFLDB_OWNER_DATABASE_URL` parsed out of `.env` (never sourced,
never printed); URL path hard-guarded to `/afldb_dev` and `afldb_test_pre_rebuild*` refused by name;
`default_transaction_read_only=on` set at connect time; connection `read_only`,
`REPEATABLE READ`; in-session verification of `current_database()`, `transaction_read_only`,
`default_transaction_read_only` and isolation, each refusing on mismatch; exactly one SELECT, then
`ROLLBACK`; **zero writes**; no legacy embedded store. **Egress is aggregate categories, provenance
classes and counts only** — no canonical player id, player name, external id or row detail.

**Exact command issued**

```bash
cd /d/dev/afldb && .venv/Scripts/python.exe tools/rebuild/draftguru/reconcile_person_bridge.py
```

#### Attempt 1 — **FAIL: implementation defect before any reconciliation result**

```text
UndefinedColumn: column "dg_id" does not exist
LINE 36:     WHEN dg_id IS NULL
```

**This is a runner SQL defect, NOT evidence for or against the bridge.** No reconciliation result
was produced, and none is recorded. The bridge measurements of §31.15 are unaffected.

Safety behaved correctly up to the failure — the pre-query evidence was exactly as contracted:

```text
observed pairs: 120 persons, 100 with a bridge, 20 without
db=afldb_dev  user=afldb_owner  txn_ro=on  default_ro=on  isolation=repeatable read
```

so the guards, the read-only envelope and the offline input load are all proven; only the final
statement was malformed. Nothing was written and the transaction did not commit.

**Root cause (proven by reading the query, not guessed):** the final `SELECT` of `RECONCILE_SQL`
had **no `FROM j` clause**. The `j` CTE does define `dg_id` (`SELECT dp.id AS dg_id …` in `dg`,
re-selected as `dg.dg_id` in `j`), but with no table in the outer `FROM`, every column reference in
that `SELECT` is unresolvable; PostgreSQL reports the first one it reaches, `dg_id`, which made the
error look like a scope/alias problem when it was a missing `FROM`.

**Minimal fix applied — two edits, no semantic change:**

1. added the missing `FROM j` between the outer select list and `GROUP BY 1, 2, 3`;
2. hardened teardown: `conn.rollback()` now runs in a `finally` (itself wrapped so the close always
   happens) so a failed SELECT — or a guard refusal — rolls back and closes the connection
   deterministically rather than relying on the success path.

Category definitions, provenance separation, the safety envelope, aggregate-only egress and the
identity rules are all unchanged. The rest of the query was re-read line by line: `j` exposes
`dg_id`, `player_id`, `link_status`, `observed_path`, `afldb_identities`, `exact_matches`,
`admin_linked` and `admin_unlinked`, and every outer reference resolves against them.

#### Attempt 2 — command reissued, **awaiting output**

```bash
cd /d/dev/afldb && .venv/Scripts/python.exe tools/rebuild/draftguru/reconcile_person_bridge.py
```

#### Attempt 2 — **PASS**

Same command, after the `FROM j` repair. Pre-query evidence unchanged and correct
(`120 persons, 100 with a bridge, 20 without`; `db=afldb_dev user=afldb_owner txn_ro=on
default_ro=on isolation=repeatable read`), and the run ended `ROLLBACK completed — nothing was
written.`

**Reconciliation categories (aggregate only — no id, name or external_id was emitted)**

| Category | Persons |
|---|---:|
| `same` | **33** |
| `contradicts` | **0** (category not emitted) |
| `absent` | **66** |
| `not_linked` | **15** |
| `no_bridge_observed_afldb_has_identity` | **4** |
| `no_bridge_observed` | **2** |
| **TOTAL** | **120** |

**Headline: comparable 33 / agreement 33 / contradictions 0 → contradiction rate 0.00%;
new information 66.**

**Provenance breakdown (automatic history kept strictly separate from explicit decisions)**

| Category | Provenance | `link_status` | Persons |
|---|---|---|---:|
| `same` | automatic_only | `unique` | 30 |
| `same` | automatic_only | `resolved` | 3 |
| `absent` | automatic_only | `unique` | 60 |
| `absent` | automatic_only | `resolved` | 5 |
| `absent` | explicit_admin_decision | `resolved` | 1 |
| `no_bridge_observed` | explicit_admin_decision | `resolved` | 2 |
| `no_bridge_observed_afldb_has_identity` | automatic_only | `unique` | 4 |
| `not_linked` | automatic_only | `unmatched` | 14 |
| `not_linked` | automatic_only | `implausible` | 1 |

**Historical automatic links remain evidence only and must never be promoted to identity truth
merely because they exist. Explicit human/admin decisions remain a distinct provenance class and
must be preserved.**

---

## 32. STAGE B1 — **COMPLETE**. FINAL DECISION: **B**. (2026-08-26)

### 32.1 Final recommendation — **B: the bridge is useful but incomplete**

Use the person-page bridge **where present**, and require another deterministic path for the
identities it does not cover. Rationale, entirely from measured evidence:

1. **97.06% (66/68)** coverage over the exact residual population AFLDB lacks;
2. all 100 observed bridges share one uniform form
   `http://afltables.com/afl/stats/players/<A>/<Name>.html`;
3. all 100 reduced identities are **distinct**;
4. **0** malformed links, **0** multiple-candidate pages, **0** non-reducing real hosts, **0** parse
   errors, **0** collisions, **0** failures, **0** redirects, **0** self-link disagreements;
5. **every independently comparable bridge agreed: same 33, contradicts 0 — a 0.00% contradiction
   rate**;
6. the bridge contributes **66 AFL Tables identities AFLDB does not currently hold** for
   already-linked canonical players;
7. it is nevertheless incomplete: 20/120 expose no bridge, `zero_game_control` is 0/14, 15 sampled
   persons are linked to no canonical player, and **every convergence pair is bridged on one side
   only** — so the bridge cannot independently resolve every DraftGuru person.

### 32.2 What Stage B1 **DID** prove

- DraftGuru person pages carry a **deterministic** `player_url → AFL Tables identity` bridge where
  a link is present, in a single uniform URL form that reduces under the **existing**
  `normalise_profile_url()` canonicaliser without broadening it;
- the bridge is **highly available for people who actually played AFL football** — of the 96 sampled
  persons DraftGuru reports with games > 0, **96 carry a bridge and 0 do not**;
- **66 of the 68** historical residual DraftGuru persons gain the external identity AFLDB is missing;
- **every** case that could be checked against an identity AFLDB already holds **agreed** (33/33,
  0.00% contradiction);
- **no ambiguity, no collision and no contradiction was observed anywhere** in the 120-person sample.

### 32.3 What Stage B1 **DID NOT** prove

- **not** complete identity for every DraftGuru person (20/120 expose nothing);
- **not** identity for never-played draftees (`zero_game_control` 0/14) — AFL Tables has no profile
  for a person who never played, so absence here is semantically correct and permanent;
- **not** identity for the no-link side of any historical convergence pair;
- **not** the correctness of historical automatic DraftGuru links **as a class** — the 33 agreements
  are a bounded sample, and `absent`/`not_linked` cases were never independently verified;
- **not** permission to replay old automatic links — they remain audit/reconciliation evidence that
  must be independently re-earned;
- **not** permission to implement or import anything. No importer, no migration, no write.

### 32.4 Preserved accepted artifacts and hashes (authoritative)

| Artifact | Value |
|---|---|
| Stage A manifest | `docs/rebuild-manifests/draftguru/annual-html-20260826.json` |
| Stage A manifest sha256 | `d06bf6be358663ad3c44a56066c9096fbc4bdf4760349ed181a642476d374652` |
| Stage B1 manifest | `docs/rebuild-manifests/draftguru/person-html-20260826.json` |
| Stage B1 manifest sha256 | `bca69a59b1492ae81c180119789bf2fd751e3888945fa325f51955b0b1bf43a7` |
| Frozen sample | `data/sources/draftguru/person-html-20260826/sample.json` |
| Sample sha256 | `d8d743fbcfca39a4c9e708a1198c7e34592270d32628d4fc0003aea88068db28` |
| Residual census sha256 | `df6c9a7559bceb649e8e28e457fbe91d3351d8c1737a9042f233b1f1e3c5e841` (68 lines, 3,580 bytes) |
| `parsed/person_profile.jsonl` sha256 | `2a40399a9e5d74765c9a134b68743a319d0c20655b25d753a3c48cb68825aca2` (120 records) |
| `parsed/afltables_link_profile.json` sha256 | `d608e6f2291bba5d9c2cb0308d15674be7db81ed8145fbffa688f7113ef3ed60` |
| robots.txt sha256 | `d3bdd06996b60f3806e7ebe732d8c12951b9a4b640706bbbfb77d258a695413b` |
| Acquisition window | `2026-08-26T09:20:10Z` → `09:23:12Z` |
| Test baseline | `tests/draftguru-acquisition.test.ts` **87/87 PASS** |

### 32.5 Files created/changed across the Stage B1 execution sessions

```text
tools/rebuild/draftguru/stage_b1_sample.py            (new)
tools/rebuild/draftguru/acquire_persons.py            (new)
tools/rebuild/draftguru/profile_person_pages.py       (new)
tools/rebuild/draftguru/reconcile_person_bridge.py    (new)
tools/rebuild/draftguru/draftguru-contract.json       (additive person_stage block only)
tests/draftguru-acquisition.test.ts                   (Stage B1 cases appended; 34 Stage A tests untouched)
tests/fixtures/draftguru/person_brad_miller_1_real_excerpt.html   (new, trimmed real source)
tests/fixtures/draftguru/person_brad_miller_2_real_excerpt.html   (new, trimmed real source)
docs/rebuild-manifests/draftguru/person-html-20260826.json        (new accepted B1 manifest)
AFLDB-ISSUE-093-DRAFTGURU-ACQUISITION-HANDOFF.md      (§31, §32)
AFLDB-ISSUE-093-DRAFTGURU-B2-HANDOFF.md               (new planning handoff)
```

Stage A remains untouched and read-only throughout. No Git command was run by the agent.
`IssuesIndex.md` and `CHANGELOG.md` remain deferred per §28.

### 32.6 Phase boundary

**Stage B1 is COMPLETE.** Continuation is planning-only and moves to
`AFLDB-ISSUE-093-DRAFTGURU-B2-HANDOFF.md`. Stage B2 is **not** approved, not started, and must not
be self-approved.
