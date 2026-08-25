# AFLDB-ISSUE-091 — Migration checksum comparison is line-ending sensitive, causing false drift on a Windows checkout

**This file is the durable, implementation-ready runbook for ISSUE-091.** A fresh session
must be able to execute from `CLAUDE.md`, `WORKFLOW.md`, this file, `issues.md` and
`IssuesIndex.md` alone. Do not rely on chat history.

## Status / handoff (2026-08-25, current)

```
Plan:                APPROVED (2026-08-25)
Implementation:      COMPLETE (2026-08-25)
Validation:          PASS (2026-08-25) — all three §6 gates green, see §13
Status:              RESOLVED (2026-08-25)
Production:          NOT TOUCHED
AFLDB-ISSUE-090:     UNBLOCKED with respect to AFLDB-ISSUE-091 (see §13). Migration 072
                     remains CREATED, NOT APPLIED — applying it is ISSUE-090's own next
                     action, not this issue's.
Parent release:      Still HALTED on AFLDB-ISSUE-090's own remaining work; no longer
                     halted by this issue.
```

The plan revision that closed the reverse-direction compatibility gap (§1.3, §3, §4) is the
version approved. No part of the checksum contract has changed since approval. A fresh
implementation session should execute §3 (module + `migrate.ts` integration) and §5 (tests)
exactly as written, then follow the validation sequence in §6.

---

## 1. Confirmed root cause and evidence

All evidence below was gathered read-only, across this session and the prior `AFLDB-ISSUE-090`
session that discovered the defect. Nothing has been changed, applied, or mutated.

1. `git status --porcelain`, scoped to the six flagged migrations, is clean. No uncommitted
   Git-visible edit exists for any of them.
2. Raw Windows-worktree SHA-256 (as `tools/db/migrate.ts` computes it today) differs from the
   HEAD git-blob SHA-256, for all six files.
3. Stripping CR bytes from the Windows-worktree content makes its SHA-256 match the HEAD blob
   SHA-256 exactly, for all six files.
4. A read-only query against `afldb_test`'s `afldb_meta.schema_migrations.checksum` for the six
   returned a value that exactly equals the HEAD/LF hash from point 3, for all six.

This chain rules out every alternative explanation and conclusively establishes:

- **not** an uncommitted edit (git status clean);
- **not** a committed content change since the migration was applied (ledger checksum equals
  the *current* HEAD content's LF hash, not some other historical content);
- **not** a stale/incorrect ledger checksum (it is exactly the LF-normalized hash of the
  current, unmodified, committed content);
- **is** a line-ending identity problem: `tools/db/migrate.ts:113-116` hashes raw checked-out
  bytes (`sha256(readFileSync(path, 'utf8'))`) with no line-ending normalization. These six
  migrations were originally applied to `afldb_test` from LF bytes. This Windows checkout
  materializes the same committed content as CRLF, producing a different, non-representative
  checksum. The runner (`migrate.ts:142-151`) then refuses to apply **any** pending migration
  — not just ones touching the six files — while that drift is reported.

### 1.1 This is not an isolated one-off

`issues.md` records the identical failure mode occurring twice before, in unrelated contexts:

- **`AFLDB-ISSUE-027` validation (2026-08-22):** *"the `afldb_test` migration ledger checksums
  are LF-based; a snapshot taken from the Windows working tree carries CRLF and must be
  LF-normalised before `db:migrate:test` will verify the applied prefix."* This was worked
  around manually (normalize the snapshot by hand before running the command), not fixed in
  tooling.
- **`AFLDB-ISSUE-044` (2026-08-22), `tests/under-22-importer.test.ts`:** the same class of bug —
  a Windows CRLF checkout defeated a raw-byte `indexOf`/marker check that passed on Linux. The
  established, already-shipped repository fix pattern was: *normalize CRLF to LF at the file's
  read boundary in the consuming code* (`readFileSync(...).replace(/\r\n/g, '\n')`), leaving the
  underlying file and its behavioural meaning unchanged. `IssuesIndex.md`/`issues.md` explicitly
  record this as the intended follow-up pattern for this class of defect.

ISSUE-091 applies the same established pattern to `tools/db/migrate.ts`, with an added
backward-compatibility requirement the test-fixture case did not have: an existing production
ledger already contains checksums computed under the old, unnormalized contract, and those must
keep validating.

### 1.2 Why only 6 of 71 applied migrations currently drift (explicitly not resolved, and not required)

It is unresolved *why* only six specific already-applied migrations show drift on this exact
Windows checkout rather than all 71 (a plausible explanation is that `core.autocrlf` conversion
only re-materializes a file's line endings when Git actually rewrites it in the working tree —
e.g. on a `checkout`/`merge`/`pull` that touches that file — so files untouched since the
worktree was created could still be LF on disk; `.git/config` in this repository sets no
repo-local `core.autocrlf`, so the effective value is inherited from the user's global Git
config, which is outside the repository boundary and was not inspected). This question is
**explicitly not answered by this runbook**, and the chosen design (§3) does not depend on the
answer: it is proven safe (§4) for every one of the 71 already-applied migrations regardless of
which historical scenario produced each one's stored checksum.

### 1.3 Reverse-direction compatibility hole found during plan review (2026-08-25)

**The first approved-pending design (raw-byte checksum + single canonical LF-normalized
checksum, accept either) was asymmetric and did not fully satisfy "deterministic across
supported development platforms."** This was caught during user review before approval and is
recorded here rather than silently corrected, per this repository's practice of preserving
rejected/amended plans (`AFLDB-ISSUE-090.md`'s "Workflow rule for future sessions").

The original design computed, from the *current* file content, only two representations:

```
checksum       = sha256(canonicalLF(current))     # normalized
legacyChecksum = sha256(current)                  # raw, whatever the current checkout produced
```

and accepted a stored ledger value that matched either. Walk the case that was not
covered:

```
Historical apply:  a migration is applied from a CRLF checkout.
                    stored checksum = sha256(raw CRLF bytes)

Later validation:  the same, unedited, committed migration is checked out on a
                    genuine LF platform (e.g. Linux/CI).
                    current raw bytes           = LF
                    current canonicalLF(current) = LF   (normalizing already-LF content is a no-op)
```

Neither `sha256(current raw)` nor `sha256(canonicalLF(current))` can equal
`sha256(raw CRLF bytes)` — both of the original design's representations are LF-shaped for an
LF checkout, and the stored value is CRLF-shaped. **This is a false positive in the opposite
direction from the one this issue exists to fix**, and it is not hypothetical-only: it is the
exact mirror image of the confirmed Windows-CRLF-vs-LF-stored case, just with the historical
apply and the later validation swapped. The original design's §4 backward-compatibility
argument was scoped to *"every one of the 71 already-applied migrations, as observed on this
one Windows checkout, today"* — a narrower claim than the issue's own stated goal of platform
determinism, and it did not generalize to a future Linux/CI validation of a migration whose
ledger checksum happens to have been CRLF-recorded.

This is corrected in §3 below by deriving, from the current content, **both** possible
line-ending-normalized forms (not just LF), plus the raw bytes as read — three representations
of the same current logical content, any of which may legitimately equal a historically stored
checksum depending on which checkout originally applied that migration.

---

## 2. Current checksum contract

`tools/db/migrate.ts`:

- **Read (`loadMigrations`, `:103-117`):** every `*.sql` file in `src/db/migrations/` is read via
  `readFileSync(path, 'utf8')`, raw, with no transformation.
- **Compute (`:114-116`):** `checksum = sha256(rawFileContent)` — one hash per migration, over
  exactly the bytes materialized by the current checkout.
- **Store (`main`, `:175-178`):** on successful apply, `checksum` is written verbatim into
  `afldb_meta.schema_migrations.checksum` (`text NOT NULL`), keyed by filename.
- **Verify (`main`, `:142-151`):** on every run (`db:migrate` and `db:status` alike, via the
  shared `statusOnly` branch that runs *after* this check), every already-applied migration's
  freshly computed `checksum` is compared for exact string equality against the stored value.
  Any mismatch is reported as `"modified since they ran"` and the process exits non-zero
  **before** any pending migration (including 072) is considered, regardless of whether the
  drifted file is otherwise unrelated to the pending work.

The contract today is: **checksum identity = exact byte identity of the file as materialized by
whichever checkout produced it.** This is not tamper detection in the intended sense — it is
raw-byte-checkout-provenance detection, which is a strictly stronger and platform-fragile
property than what the tool's stated purpose (`:12-14` doc comment: *"Editing an already-applied
migration is refused"*) actually requires.

---

## 3. Corrected checksum contract (revised design)

**Design chosen: three bounded representations of the current file's logical content — exact
raw bytes, canonical all-LF, canonical all-CRLF — with the stored ledger checksum accepted if
it equals any one of the three. Exactly one of those three (canonical all-LF) is ever written
for a new ledger row.** This is the synthesis the user's review requested: a hybrid of Option B
(legacy raw compatibility) and Option C (a narrowly bounded representation set), corrected to be
symmetric in both the LF→CRLF and CRLF→LF directions.

### 3.1 New pure module — `tools/db/migration-checksum.ts` (new file, zero side effects)

```ts
import { createHash } from 'node:crypto';

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Collapse every CRLF sequence to LF. Only the two-byte \r\n sequence is
 * touched. A bare \r with no following \n, a trailing-newline difference,
 * or any other byte is untouched and remains a real, detected difference.
 */
function toCanonicalLf(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

/**
 * Expand every LF to CRLF, starting from the canonical-LF form (not from
 * the raw input) so a file that is already CRLF, already LF, or a mix of
 * both collapses through the same LF intermediate before re-expanding.
 * This is what makes the derived CRLF form independent of which style the
 * CURRENT checkout happens to have materialized. A bare \r with no
 * following \n is still untouched here, for the same reason as above.
 */
function toCanonicalCrlf(content: string): string {
  return toCanonicalLf(content).replace(/\n/g, '\r\n');
}

export type MigrationChecksumRepresentations = {
  /** Exact bytes as read from disk by the current checkout. */
  raw: string;
  /** The same logical content, canonically normalized to LF-only line endings. */
  canonicalLf: string;
  /** The same logical content, canonically normalized to CRLF-only line endings. */
  canonicalCrlf: string;
};

export function computeChecksumRepresentations(
  rawSql: string,
): MigrationChecksumRepresentations {
  return {
    raw: sha256(rawSql),
    canonicalLf: sha256(toCanonicalLf(rawSql)),
    canonicalCrlf: sha256(toCanonicalCrlf(rawSql)),
  };
}

/**
 * A stored ledger checksum is accepted if it equals ANY of the three bounded
 * representations of the current content. It is never accepted merely
 * because it differs by non-line-ending bytes — see the compatibility
 * matrix in AFLDB-ISSUE-091.md §4.
 */
export function matchesStoredChecksum(
  stored: string,
  reps: MigrationChecksumRepresentations,
): boolean {
  return stored === reps.raw || stored === reps.canonicalLf || stored === reps.canonicalCrlf;
}
```

This file has **no** filesystem, environment, or database access — it is pure string/hash logic,
safely importable by a unit test with no risk of touching `afldb_test` or any other database.

### 3.2 `tools/db/migrate.ts` changes

- `Migration` type gains a `reps: MigrationChecksumRepresentations` field in place of the single
  `checksum` string; `sql` stays the **raw, untouched** file content — the text actually
  executed via `tx.unsafe(m.sql)` at `:174` is deliberately unchanged, so migration *execution*
  semantics (e.g. any string literal inside a migration that is line-ending-sensitive) are not
  altered by this fix. Only checksum *computation* changes.
- `loadMigrations()` (`:103-117`) calls `computeChecksumRepresentations(sql)` from the new
  module instead of hashing inline.
- Drift filter (`:142-145`) changes from strict equality to `matchesStoredChecksum`:

  ```ts
  const drifted = migrations.filter(
    (m) => appliedByName.has(m.name)
      && !matchesStoredChecksum(appliedByName.get(m.name)!, m.reps),
  );
  ```

- Apply-time INSERT (`:175-178`) writes `m.reps.canonicalLf` — **exactly one** deterministic
  value, **never** `raw` or `canonicalCrlf`. See §3.5 for why LF specifically, and why this
  must not remain platform-dependent.
- No other behaviour changes. `db:status` and `db:migrate` continue to share this exact code
  path unmodified (the drift check already runs once, before the `statusOnly` branch at
  `:153-161`) — this is preserved by construction, not re-implemented per entry point. The same
  `matchesStoredChecksum` function is used for every migration on every run, whether that
  migration was historically applied under the old raw-only contract or the new canonical
  contract — there is no separate "legacy" code path to keep in sync.

### 3.3 Why three representations, not two

The originally-approved-pending design (§1.3) computed only `raw` and `canonicalLf`. That is
sufficient for a stored checksum that is LF-shaped (matched via `canonicalLf`, from any current
checkout style) or that happens to equal the current raw bytes exactly (matched via `raw`, the
"nothing has changed since" case) — but it has no representation that is CRLF-shaped and
*independent of the current checkout's actual style*. Adding `canonicalCrlf`, derived through
the LF intermediate (§3.1) rather than from the current raw bytes directly, closes that gap: it
is deterministically "this logical content, entirely CRLF" regardless of whether the current
checkout happens to be LF, CRLF, or (in the unevidenced worst case) mixed. See §4 for the full
matrix this now covers.

### 3.4 Why this is not simply "accept everything" — alternatives re-considered

- **(A) One canonical LF checksum only, always, no fallback:** rejected — this is exactly the
  design whose CRLF→LF-validation gap motivated §1.3; it only tolerates a stored checksum that
  was itself LF-shaped.
- **(B) Legacy raw + single canonical checksum, accept either — the originally-approved-pending
  design:** rejected per §1.3 — asymmetric, misses the stored-CRLF/current-LF case.
- **(C) A narrowly bounded set of safe representations of the current content — chosen,
  specialized to exactly `{raw, canonicalLf, canonicalCrlf}`.** This is deliberately not a
  larger or open-ended set: it contains only the representations that a normal Git checkout can
  legitimately produce for one committed logical migration (LF, CRLF, or — for an untouched file
  — whatever the current raw bytes already are). It does **not** include, for example, a
  whitespace-trimmed or BOM-stripped representation — see §3.5.
- **(D) Any other design:** not needed; (C) satisfies the platform-determinism requirement in
  both directions (§4) without new machinery (no new ledger column, no migration of historical
  checksums, no per-file special-casing, no expansion beyond line-ending equivalence).

### 3.5 Apply-time storage semantics for NEW migrations (explicit)

**Exactly one checksum is written for a newly applied migration: `sha256(canonicalLf(content))`
— the all-LF-normalized form.** Never `raw`, never `canonicalCrlf`.

- **Why LF and not CRLF:** `CLAUDE.md` §11 states Linux is the supported runtime; the observed
  evidence (§1, §2) shows the existing `afldb_test` ledger is already overwhelmingly LF-recorded
  (all six directly-queried stored checksums are LF-shaped); and LF is genuinely native to this
  Git repository — there is no `.gitattributes` forcing CRLF, and a from-scratch Linux/CI
  checkout of any migration file materializes LF with zero conversion. Choosing CRLF as the
  canonical form would make the *common* (Linux) case the one requiring a conceptual detour
  through a Windows-specific representation, which is backwards.
- **Why not platform-dependent (e.g. "whatever the applying checkout's raw bytes are"):** that
  is the status quo this issue exists to fix. A platform-dependent stored checksum is exactly
  what produces false drift the next time a *different* platform validates the same migration —
  which is the general form of both the originally-reported bug (§1) and the reverse-direction
  gap found in review (§1.3). Storing one deterministic canonical value for every future apply,
  regardless of which platform performed it, is what stops this defect class from recurring.
- **Consequence:** from the point this fix ships, applying the same unedited migration file from
  a Windows CRLF checkout or a Linux LF checkout writes the **identical** checksum to
  `afldb_meta.schema_migrations`. Historical rows (LF- or CRLF-recorded, per §1.3) are left
  exactly as they are — nothing is rewritten — and continue to validate via whichever of the
  three representations they happen to match (§4).

### 3.6 Explicitly excluded from normalization (and why)

- **BOM stripping:** no evidence any migration file carries a byte-order mark, and no drift
  symptom in the observed evidence is explained by a BOM. Not included — adding it would widen
  the tolerance beyond what evidence justifies.
- **Trailing-whitespace stripping:** would weaken genuine-edit detection (a trailing-whitespace
  edit to an applied migration is still an edit) and is not implicated by any observed evidence.
  Not included.
- **Final-newline normalization:** would weaken genuine-edit detection for the same reason. Not
  included — a file gaining or losing its trailing newline remains a real, detected byte
  difference under this design (see the explicit test in §5, item 7).
- **Mixed line endings within one file:** not special-cased with an exclusion rule, but not
  silently tolerated either — `toCanonicalLf`/`toCanonicalCrlf` apply the same substitution
  regardless of whether a file is uniformly CRLF, uniformly LF, or a mix; each `\r\n` occurrence
  is normalized independently, and a stored checksum that does not correspond to any of the
  three derived representations still fails closed. See the matrix item 8 in §4 and the
  explicit test in §5, item 6.
- **Lone CR (`\r` not followed by `\n`):** not treated as an EOL character at all — the
  `\r\n`-only regex never matches it, so it survives identically, byte-for-byte, in `raw`,
  `canonicalLf`, and `canonicalCrlf` alike. A lone CR is not a Git/checkout line-ending
  representation (Git's `core.autocrlf` only ever converts between `\n` and `\r\n`), so
  tolerating it would not be "justified as checkout representation" per the security
  requirement — it remains a real, detected difference. See matrix item 9.
- **BOM/encoding differences:** no evidence any migration file carries a byte-order mark. A BOM
  character is untouched by the `\r\n`-only substitutions, so it remains a real, detected
  difference in all three representations if one is ever introduced or removed. Not tolerated —
  see matrix item 10.

---

## 4. Backward-compatibility model and full line-ending compatibility matrix

### 4.1 Why this is safe for the existing `afldb_test` ledger

Every one of the 71 already-applied migrations falls into exactly one of two states **today**,
under the *current* (unfixed) code, on *this* checkout:

| State | Meaning | Under the new design |
|---|---|---|
| **Currently passes** (65 files) | `sha256(currentRawBytes) === storedChecksum` | Still passes: `raw` is defined as exactly this same hash, and `matchesStoredChecksum` accepts a match on `raw` unconditionally. Zero behaviour change for these files. |
| **Currently fails** (6 files, confirmed) | `sha256(currentRawBytes) !== storedChecksum`, but `sha256(CR-stripped bytes) === storedChecksum` (proven in §1, points 3-4) | Now passes: `canonicalLf` equals `sha256(toCanonicalLf(currentRawBytes))`, which — since the confirmed evidence shows CR-stripping and CRLF-normalization agree on these six files (their drift is uniform CRLF, not mixed or exotic) — equals the stored value. |

The design additionally covers a **third, not-yet-observed** state — a migration whose stored
checksum is CRLF-shaped, later validated from a genuine LF checkout — via `canonicalCrlf`. That
state does not exist in the currently-observed `afldb_test` evidence (§1.2), but §1.3 shows it
is a real, structurally-possible case the issue's own stated goal ("deterministic across
supported development platforms") requires covering, not merely a hypothetical to dismiss. The
design does not need to distinguish *why* a given migration's stored checksum takes the shape it
does — `raw`, `canonicalLf`, and `canonicalCrlf` are all computed from the current content and
checked unconditionally, in both directions.

### 4.2 Full compatibility matrix (stored vs. current)

`L` = a pure-LF logical migration content; `C` = the same logical content, pure CRLF. Read
`stored X / current Y` as "the ledger's recorded checksum was originally computed from
representation `X`; the current checkout being validated materializes representation `Y` of the
**same, unedited** committed migration" unless the row is explicitly an edit case.

| # | Case | Result | Why |
|---|---|---|---|
| 1 | stored `sha256(L)` / current `L` | **PASS** | `raw = sha256(L)` matches directly — the ordinary same-platform case, unchanged from today. |
| 2 | stored `sha256(L)` / current `C` | **PASS** | `canonicalLf = sha256(toCanonicalLf(C)) = sha256(L)` matches. This is the originally-confirmed bug (§1) — Windows CRLF checkout, LF-recorded ledger. |
| 3 | stored `sha256(C)` / current `L` | **PASS** | `canonicalCrlf = sha256(toCanonicalCrlf(L)) = sha256(C)` matches. This is the reverse-direction gap found in review (§1.3) — closed by deriving `canonicalCrlf` through the LF intermediate rather than from current raw bytes. |
| 4 | stored `sha256(C)` / current `C` | **PASS** | `raw = sha256(C)` matches directly — the symmetric case to #1, e.g. a migration applied and always re-validated from CRLF checkouts. |
| 5 | genuine SQL/content edit (a token changes, not just an EOL byte) | **FAIL (correctly detected)** | The edit changes the underlying logical content, so `raw`, `canonicalLf`, and `canonicalCrlf` of the *edited* file all differ from their pre-edit counterparts. None can equal `sha256(pre-edit content)` in any representation without a SHA-256 preimage collision. Drift is reported exactly as it is today. |
| 6 | whitespace edit other than line endings (e.g. added trailing space, changed indentation) | **FAIL (correctly detected)** | `toCanonicalLf`/`toCanonicalCrlf` only touch `\r\n` sequences; any other byte difference propagates unchanged into all three representations, so none matches the pre-edit stored value. This is deliberate — see §3.6, and the security requirement that only line-ending equivalence is tolerated. |
| 7 | final-newline edit (trailing newline added or removed) | **FAIL (correctly detected)** | Normalization converts existing EOL *style*, it does not add or remove an EOL. A file differing only in whether it ends with a trailing newline produces different `raw`/`canonicalLf`/`canonicalCrlf` hashes than the version with the newline present. Explicitly not tolerated (§3.6) — matches the runbook's non-goal of not normalizing final-newline differences. |
| 8 | mixed line endings (file genuinely contains both `\n` and `\r\n`, unedited since apply) | **PASS if unchanged; FAIL-CLOSED if the mixed pattern itself changes between checkouts** | If the current raw bytes are byte-identical to what was originally hashed (the ordinary case — Git does not partially re-convert a file checkout to checkout without an intervening edit), `raw` matches directly (case 1/4's logic). `canonicalLf`/`canonicalCrlf` still reduce/expand deterministically from whatever mix is currently present. No evidence any migration file is actually mixed today — the six confirmed-drifted files were shown to be uniformly resolved by a single CRLF-strip (§1, point 3), not partially. If a future mixed-EOL scenario produced a *different* mixed byte pattern than was originally stored (not modeled by a clean LF/CRLF conversion), none of the three representations would match, and the migration would correctly fail closed rather than silently pass — conservative behaviour, not a gap, per the security requirement. |
| 9 | lone CR (`\r` with no following `\n`) present in current or historical content | **FAIL unless byte-identical to what was stored** | A lone CR is never touched by `toCanonicalLf`/`toCanonicalCrlf` (§3.6) — it is not a Git/checkout line-ending representation, so tolerating it is not justified. It remains a literal, distinguishing byte in all three representations; any difference in lone-CR usage between the stored and current content causes drift to be (correctly) reported. |
| 10 | BOM/encoding difference (e.g. a UTF-8 BOM present in one representation and absent in another) | **FAIL unless byte-identical to what was stored** | No evidence any migration file carries a BOM (§3.6). A BOM character is untouched by the `\r\n`-only substitutions, so its presence/absence remains a literal, distinguishing difference across all three representations. Not tolerated — out of scope, and correctly conservative absent evidence justifying it as checkout representation. |

Rows 1-4 are the platform-determinism cases this issue exists to fix, in both directions. Rows
5-10 are exactly the cases that must continue to fail closed, confirming the design does not
broaden compatibility beyond line-ending equivalence.

### 4.3 Why real tampering is still detected

A genuine future content edit to an already-applied migration changes the underlying logical
content, so `raw`, `canonicalLf`, and `canonicalCrlf` of the edited file all differ from their
pre-edit counterparts (matrix rows 5-7, 9-10). None can coincidentally equal a stored checksum
of the *original* content without a SHA-256 preimage collision. Tampering — including a
deliberate attempt to disguise a content edit as a line-ending change — is only unpunished in
the one case where the *only* difference between two representations of otherwise
byte-identical content is CRLF-vs-LF line-ending style (matrix rows 1-4), which is precisely the
class this issue defines as a false positive, not tampering.

**No historical migration file and no `afldb_meta.schema_migrations` row is read, written, or
otherwise touched by this design.** The compatibility is achieved entirely in how `migrate.ts`
*computes and compares* checksums at read time, never by rewriting stored state.

---

## 5. Exact tests to add

No existing suite is a sensible home: the only test files referencing `migrate`/`checksum`
(`tests/integration/database.test.ts`, `fk-indexes.test.ts`, `privileges.test.ts`,
`dob-enrichment-issues.test.ts`) merely mention `npm run db:migrate:test` in assertion messages
or read the same ledger table for an unrelated purpose (§10 gating in `AFLDB-ISSUE-090`); none
exercises checksum computation or comparison. A new file is justified under CLAUDE.md's "no
sensible semantic home" exception.

**New file: `tests/migration-checksum.test.ts`** (plain Vitest unit test — no database, no
filesystem, no `afldb_test` dependency; imports only the new pure module). Mirrors the existing
project unit-test import style (`import { describe, expect, it } from 'vitest';`, `@/`-style or
relative import of the module under test).

Use only synthetic migration-like content (e.g. a small `CREATE TABLE ...;` string), per the
runbook instruction to prefer synthetic content over the six historical files.

| # | Requirement (from the ISSUE-091 planning brief) | Test |
|---|---|---|
| 1 | Equivalent LF and CRLF content validates identically | `computeChecksumRepresentations(lf).canonicalLf === computeChecksumRepresentations(crlf).canonicalLf` for `crlf = toCanonicalCrlf(lf)` |
| 2 | Existing LF-derived ledger checksum validates against a CRLF worktree | `matchesStoredChecksum(sha256(lf), computeChecksumRepresentations(crlf))` is `true` — matrix row 2 |
| 3 | Reverse direction: existing CRLF-derived ledger checksum validates against an LF worktree | `matchesStoredChecksum(sha256(crlf), computeChecksumRepresentations(lf))` is `true` — matrix row 3, the case found during review (§1.3) |
| 4 | Backward compatibility is safe for existing databases (raw match preserved, same-platform case) | `matchesStoredChecksum(sha256(lf), computeChecksumRepresentations(lf))` is `true` and `matchesStoredChecksum(sha256(crlf), computeChecksumRepresentations(crlf))` is `true` — matrix rows 1 and 4 |
| 5 | A genuine SQL/content edit still fails | mutate a token in `lf` (e.g. `TABLE x` -> `TABLE y`) and assert `matchesStoredChecksum(sha256(lf), computeChecksumRepresentations(mutated))` is `false` — matrix row 5 |
| 6 | Non-EOL whitespace/content changes remain detected | append a trailing space to one line of `lf`; assert `matchesStoredChecksum(sha256(lf), computeChecksumRepresentations(withTrailingSpace))` is `false` — matrix row 6 |
| 7 | Mixed line-ending behaviour is explicitly defined and tested | build content with some lines `\n` and others `\r\n`; assert its `canonicalLf` equals the fully-LF version's `canonicalLf`, and its `canonicalCrlf` equals the fully-CRLF version's `canonicalCrlf` — matrix row 8 |
| 8 | Final-newline behaviour is explicitly defined and tested | `computeChecksumRepresentations(lf)` vs `computeChecksumRepresentations(lf + '\n')` must differ in **all three** fields (`raw`, `canonicalLf`, `canonicalCrlf`) — proves final-newline changes are deliberately *not* normalized away — matrix row 7 |
| 9 | Lone CR is not treated as EOL-equivalent | build content containing a lone `\r` with no following `\n`; assert `matchesStoredChecksum` is `false` against a stored checksum computed from the same content with that lone `\r` removed — matrix row 9 |
| 10 | `db:status` and `db:migrate` use identical checksum semantics | structural, not runtime: both call the same `matchesStoredChecksum`/`computeChecksumRepresentations` functions from the one shared drift-check block in `migrate.ts` (`:142-151`, which runs before the `statusOnly` branch at `:153-161`) — verified by code inspection during review, reinforced by this same unit suite asserting the shared functions are deterministic and side-effect-free (calling them twice with identical input yields identical output) |
| 11 | New migrations get deterministic treatment | `computeChecksumRepresentations(lf).canonicalLf === computeChecksumRepresentations(crlf).canonicalLf` (same assertion as #1) — proves a migration applied from either platform is recorded under the same canonical value, and that value is specifically `canonicalLf` (assert the apply-time INSERT path in `migrate.ts` writes `m.reps.canonicalLf`, not `raw` or `canonicalCrlf` — a source-level/structural check, since `main()`'s DB-writing path is not itself unit-tested per §6) |
| 12 | No existing migration or ledger mutation is required | design property, not a runtime assertion — no test writes to `afldb_meta.schema_migrations`; validated operationally in §6 by a read-only `db:status` run showing zero drift with the ledger untouched |
| 13 | Failure remains fail-closed for unexplained mismatches | same as #5/#6/#9 — any content difference not explained by CRLF/LF line-ending equivalence still fails `matchesStoredChecksum` |

All thirteen are covered by unit-level assertions in a single new file except #12, which is a
design invariant validated operationally (§6) rather than unit-tested, since there is nothing to
assert against without a live database, and adding one would violate CLAUDE.md's "smallest test
that proves the change" and "do not request state-changing database commands unless required."
Of the ten compatibility-matrix rows (§4.2), nine are directly exercised by tests #1-#9 above;
only matrix row 10 (BOM) is covered by reasoning in §4.2 rather than a dedicated test, since no
repository evidence motivates constructing a BOM fixture and the reasoning ("untouched by the
`\r\n`-only substitutions, therefore still a literal distinguishing byte") is structurally
identical to the lone-CR case that test #9 does exercise directly.

---

## 6. Validation sequence (user-executed; Claude does not run these)

Ordered smallest-to-largest, per CLAUDE.md §10/§14:

1. **Focused unit test (no database):**
   ```
   npm test -- tests/migration-checksum.test.ts
   ```
   Proves the checksum/compatibility logic in isolation. This alone does not touch `afldb_test`.

2. **Typecheck** (new file + `migrate.ts` changes):
   ```
   npm run typecheck
   ```

3. **Read-only re-verification against the real drifted ledger state** — the exact command that
   originally surfaced this issue, now expected to report zero drift and, critically, to make
   **no** write:
   ```
   AFLDB_MIGRATE_TARGET=test npm run db:status
   ```
   Expected: `72 migration file(s), 71 already applied`, **no** `"modified since they ran"`
   error, `1 pending` (migration 072). This step performs no mutation (`--status` returns before
   any apply); if it still reports drift for any of the six files, or reports drift for a
   *different* file, STOP (see §9) — do not proceed to apply 072 until that is understood, since
   it would mean the fix does not actually close the gap this issue exists to close.

4. Only after step 3 is clean does `AFLDB-ISSUE-090.md`'s own next-session task (apply migration
   072 via `npm run db:migrate:test`, dump first per its §26) become unblocked. That apply step
   belongs to ISSUE-090, not ISSUE-091 — see §8.

Do not run the full `npm test` suite or `npm run build` for this change; neither is implicated,
per CLAUDE.md §11's "use it when build/framework behaviour is affected" — a checksum comparison
change in a standalone CLI script is not build/framework behaviour.

---

## 7. Rollback / recovery considerations

- The change touches **only** checksum computation/comparison in `migrate.ts` plus one new pure
  module. It does not touch `sql.begin()`/`tx.unsafe()` execution, the `schema_migrations` table
  schema, or any migration file.
- If validation (§6 step 3) shows unexpected results, reverting is a plain source revert of the
  two changed/added files — there is no ledger or schema state to unwind, because this design
  performs zero writes to `afldb_meta.schema_migrations` beyond the pre-existing apply-time
  INSERT path (unchanged in shape, only the *value* written for `checksum` changes going
  forward, to the canonical/normalized hash instead of the raw one — itself a no-op on Linux).
- Because the canonical checksum is written for every migration applied *after* this fix ships,
  there is no future re-drift risk introduced by this change itself for anything applied going
  forward, on any platform.
- Nothing about this fix is destructive or hard to reverse. No user-executed rollback procedure
  beyond normal Git revert is required.

---

## 8. Impact on blocked `AFLDB-ISSUE-090`

- `AFLDB-ISSUE-090` remains **HALTED** exactly as recorded in `AFLDB-ISSUE-090.md` until this
  issue is implemented and validated (§6, step 3 clean).
- This runbook does **not** apply migration 072, does **not** touch
  `tests/integration/dob-enrichment-issues.test.ts`, `enrich_birth_dates.py`,
  `enrich_birth_dates_from_club_lists.py`, or `072_dob_conflict_ownership.sql`. Those remain
  exactly as `AFLDB-ISSUE-090.md`'s "Implementation files currently changed" list describes them
  — CREATED, NOT APPLIED, no other file touched.
- Once §6 step 3 is clean, `AFLDB-ISSUE-090.md`'s own "Next-session task" §1-3 (apply 072, rerun
  the full `dob-enrichment-issues.test.ts` including migration tests 15-18 and the unfiltered
  test 22, then `privileges.test.ts`) becomes the correct next action — owned by ISSUE-090, not
  by this issue. This runbook explicitly does not redesign or re-scope that sequence.
- No change proposed here alters D1-D5, importer behaviour, migration 072's SQL, or any
  release-gate expected value.

---

## 9. HALT conditions

Stop and report — do not improvise a workaround — if any of the following occurs during
implementation or validation:

1. §6 step 3 (`db:status` against `afldb_test`) still reports drift for any of the six files
   after the fix is applied — it means the CRLF-hypothesis, though conclusively proven for the
   raw-byte evidence in §1, does not fully explain the drift as measured through the new code
   path (e.g. an implementation mistake, or content that isn't purely CRLF/LF-different despite
   the CR-stripped-hash match in §1 point 3).
2. §6 step 3 reports drift for a migration **not** among the original six — a new, unexplained
   mismatch, which must not be treated as another instance of this same root cause without new
   evidence.
3. Any test in §5 requires touching a real database, `.env`, or `process.exit` path to pass —
   that would mean the extraction into a pure module (§3.1) failed to actually isolate the
   logic, and the module boundary needs to be fixed before tests are trusted.
4. Implementing this fix is found to require editing any file in
   `src/db/migrations/*.sql` (historical or otherwise) — out of scope and forbidden by the
   original ISSUE-090 safety constraints this issue inherits.

---

## 10. Explicit non-goals

- Rewriting, re-checksumming, or re-applying any historical migration.
- Rewriting any row of `afldb_meta.schema_migrations`.
- Special-casing the six named filenames anywhere in `migrate.ts` or the new module — the fix is
  general (applies uniformly to checksum computation for every migration file, past or future),
  not a filename allowlist.
- Resolving §1.2 (why exactly six of 71 currently drift on this checkout) — interesting, not
  required for a safe fix, and not investigated further here.
- Normalizing BOM, trailing whitespace, or final-newline differences (§3.4) — deliberately out
  of scope; each remains a real, detected difference.
- Applying `AFLDB-ISSUE-090`'s migration 072, or any part of its post-migration validation
  sequence (§8) — owned by that issue.
- Any change to `.gitattributes` or `core.autocrlf` policy. Repository inspection confirmed no
  `.gitattributes` file exists at the repository root (only an unrelated one inside
  `node_modules/nodemailer`) and no `.editorconfig` exists. Introducing repository-wide
  line-ending enforcement (e.g. a root `.gitattributes` with `*.sql text eol=lf`) was considered
  and rejected as out of scope for this issue: it would change checkout behaviour for every
  contributor and every file type repository-wide, a materially larger blast radius than fixing
  one tool's checksum logic, and CLAUDE.md directs against broadening a focused tooling defect
  into unrelated repository-wide policy. It may be worth a separate, narrowly-scoped follow-up
  issue if this class of defect recurs elsewhere, but is not proposed here.
- Any production database action. Production is not touched by this issue, as it was not
  touched by `AFLDB-ISSUE-090`.

---

## 11. Acceptance criteria

1. `tools/db/migration-checksum.ts` exists, exports `computeChecksumRepresentations` and
   `matchesStoredChecksum`, returns/accepts all **three** representations (`raw`, `canonicalLf`,
   `canonicalCrlf`), and has no filesystem/env/DB dependency.
2. `tools/db/migrate.ts` uses the new module for checksum computation and drift comparison; the
   raw `sql` text used for actual migration execution (`tx.unsafe(m.sql)`) is unchanged; the
   apply-time INSERT writes exactly `reps.canonicalLf`, never `raw` or `canonicalCrlf`.
3. `tests/migration-checksum.test.ts` exists and covers all thirteen points in §5's table (twelve
   as direct unit assertions, #12 explicitly deferred to operational validation), including the
   reverse-direction case (matrix row 3 / test #3) that the original pending design missed.
4. `npm test -- tests/migration-checksum.test.ts` passes.
5. `npm run typecheck` passes.
6. `AFLDB_MIGRATE_TARGET=test npm run db:status` reports zero drift for all 71 already-applied
   migrations and correctly reports migration 072 as the sole pending migration, with no write
   to `afldb_meta.schema_migrations`.
7. No historical migration file and no `afldb_meta.schema_migrations` row was edited to reach
   this state.
8. The full compatibility matrix in §4.2 (10 rows) is reflected in the test suite — nine rows
   directly (tests #1-#9) — or explicitly justified as reasoning-only (row 10/BOM, per §5's
   closing note) — no row is left unaddressed.
9. `issues.md` and `IssuesIndex.md` are updated to Resolved only after criteria 4-6 are
   evidenced, per CLAUDE.md §5's resolution rule (root cause, fix, and validation must all be
   recorded from genuine evidence, not asserted).
10. `CHANGELOG.md` is updated only at resolution, once genuinely validated — not during planning
    or mid-implementation, per CLAUDE.md and this runbook's explicit instruction not to touch it
    while ISSUE-091 remains Open.

---

## 12. Exact files to change (summary)

| File | Change |
|---|---|
| `tools/db/migration-checksum.ts` | **New.** Pure checksum/normalization/compatibility functions (§3.1). |
| `tools/db/migrate.ts` | Use the new module in `loadMigrations()`, the drift filter, and the apply-time INSERT (§3.2). No change to migration execution (`tx.unsafe`), env loading, or target resolution. |
| `tests/migration-checksum.test.ts` | **New.** Unit tests per §5. |
| `issues.md` / `IssuesIndex.md` | Updated at resolution only, per §11 criterion 9 — not during this planning session. |
| `CHANGELOG.md` | Updated at resolution only, per §11 criterion 10 — not during this planning session. |

No other file is proposed for change. In particular: no migration file, no
`afldb_meta.schema_migrations` row, no `AFLDB-ISSUE-090.md` content, no test file owned by
`AFLDB-ISSUE-090`.

---

## 13. Resolution and validation evidence (2026-08-25)

Implementation matched this runbook exactly (§3, §5): `tools/db/migration-checksum.ts` (new,
pure), `tools/db/migrate.ts` (narrow integration only — `tx.unsafe(m.sql)` execution untouched),
`tests/migration-checksum.test.ts` (new, 12 assertions covering §5's matrix). All three §6
validation gates were run by the user and are green.

### 13.1 Gate 1 — focused unit tests (no database)

```
npm test -- tests/migration-checksum.test.ts
```

Result: 1 test file passed, 12/12 tests passed, 0 failures. Coverage confirmed: LF-stored vs
CRLF-current, CRLF-stored vs LF-current (the reverse-direction case closed in §1.3), same-platform
LF/LF and CRLF/CRLF, genuine SQL edit rejected, non-EOL whitespace edit rejected, mixed
line-ending behaviour, final-newline difference rejected, lone-CR difference rejected,
deterministic canonical-LF checksum generation for new migrations.

### 13.2 Gate 2 — typecheck

```
npm run typecheck
```

Result: PASS, no TypeScript errors.

### 13.3 Gate 3 — operational re-verification against the real drifted ledger

```
AFLDB_MIGRATE_TARGET=test npm run db:status
```

Result: `72 migration file(s), 71 already applied`. All 71, including the six previously
false-positive-drifted migrations (`026_aflw_read_model.sql`, `053_player_achievements.sql`,
`058_data_edits_editor_entities.sql`, `059_honour_team_member_identity.sql`,
`060_wikipedia_22_under_22_source.sql`, `061_award_winner_sort_order.sql`), now report `applied`
with no `"modified since they ran"` error. The sole pending migration is
`072_dob_conflict_ownership.sql` — `1 pending.` `--status` performs no write; no
`afldb_meta.schema_migrations` row and no migration file were read-write touched by this step.

### 13.4 Root cause and fix, as confirmed

Root cause: `migrate.ts` hashed raw checked-out file bytes with no line-ending normalization, so
checksum identity was checkout-platform-dependent rather than a property of the migration's
logical content. Fix: checksum computation/comparison extracted into a pure module producing
three bounded representations (`raw`, `canonicalLf`, `canonicalCrlf`) of the current content; a
stored ledger checksum is accepted if it matches any of the three; exactly one deterministic
value (`canonicalLf`) is written for every future apply, regardless of applying platform. No
historical migration file and no `afldb_meta.schema_migrations` row was read-write modified to
reach this result — the fix is entirely in how `migrate.ts` computes and compares checksums.

### 13.5 Effect on AFLDB-ISSUE-090

`AFLDB-ISSUE-090` is now unblocked specifically with respect to this issue: the checksum drift
that prevented `npm run db:migrate:test` from applying any pending migration is resolved.
Migration 072 (`072_dob_conflict_ownership.sql`) itself remains **CREATED, NOT APPLIED** — applying
it, per `AFLDB-ISSUE-090.md`'s own next-session task (dump `afldb_test` first per its §26, then
`npm run db:migrate:test`, then rerun `dob-enrichment-issues.test.ts` and `privileges.test.ts`),
is owned by and remains entirely the responsibility of `AFLDB-ISSUE-090`, not this issue.

### 13.6 Remaining ISSUE-091 work

None. All acceptance criteria in §11 are evidenced. This issue is RESOLVED.
