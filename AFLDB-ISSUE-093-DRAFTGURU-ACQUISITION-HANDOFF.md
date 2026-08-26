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
