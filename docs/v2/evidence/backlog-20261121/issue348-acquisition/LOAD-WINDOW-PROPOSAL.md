# ISSUE-348: sealed digests, drift coverage and a proposed load window (prepared 22 Nov 2026, run d; NOT EXECUTED)

**Owner decision 6 of 2026-11-22 (round 3):** F-1 and the F-2 change groups are ACCEPTED as the scope reviewed in rehearsal, including
the reported games and goals changes on both picks and persons. Before production execution is requested: quote the sealed digests in
full, say which digest covers the F-2 writes and how the live run detects drift outside it, propose a separate attended load window with
a fresh backup first and post-load checks. **No production load is requested or executed by this document.**

## 1. The sealed digests, quoted in full from `SEALED-PLAN.md` §1 and recomputed

Recomputed in run d from the committed Git blobs (LF; reviewer F-012) on the workstation with `sha256sum`; every tracked value matches.

| Item | sha256 (full) | Recomputed |
|---|---|---|
| Stage A manifest `docs/rebuild-manifests/draftguru/annual-html-20261122.json` | `26ca190b3f0f9c7120c506289319b75118a79305c55767f9db7540d6ef22a27c` | equal (tracked) |
| Reload-guard **effect digest** (inside the reconciliation and the guard report as `effect_digest`) | `ff8ef1b8ef900d9ab5b17c89b2f0f85d5b3091e9493456a45b2a5f67cf766452` | equal (read from both files) |
| Reconciliation `sealed/reconciliation-annual-html-20261122.json` | `cf49f6a5671155c174d60497372fbf9c1fd15fce01bd9f0d3f3dab8619e0de4e` | equal (tracked) |
| Guard report `sealed/guard-report-annual-html-20261122.json` | `91d1da0e9f394f26df513df8e8f03835b93623867bc1cd995fa0a719754150a4` | equal (tracked) |
| Transfer archive `i348-transfer.tar` | `478d4f809204f329251e9f58d03f1ab8a7491cb51f710c90a5b27f51aea77afb` | **not tracked**: on streamanator `/mnt/ssd/afldb-backlog-20261122b-348/seal/i348-transfer.tar` (preserved workspace); recomputed there read-only in run d (§1a) |
| `sealed/i348-transfer.SHA256SUMS` (92 lines) | `632aefe9024253acd86e967d9285f3f81656788cc20bdbc5a893d3d3de951326` | equal (tracked) |
| Runner `sealed/i348-load.sh` | `61f44acb10cd63bbc7465e56289759b3a8bddd49713228ebc358683c10429c0d` | equal (tracked) |
| Digest SQL `sealed/draftguru-surface-digest.sql` | `ae742dcc1cae5f5429e1e8c6a022b27c960ab1f89761f2d90b7456d9746e1dd0` | equal (tracked) |
| Contract pin parsed rows (`parsed/rows.jsonl`) | `7f73f2cc3fa7fdfb14345868891ef09f9ae58d3e448e231afc0fec1174fd6f40` | inside the transfer tar (checked by the runner's `verify` against `SHA256SUMS`) |
| Pin robots.txt | `d3bdd06996b60f3806e7ebe732d8c12951b9a4b640706bbbfb77d258a695413b` | inside the transfer tar |
| Bridge child (GAP-029 S2) | `d6251609b12f48ad1c48a8bd33482820e606e123f9b12fa16a3769e6b7f15d6e` | inside the transfer tar; the runner checks it |
| R0 dump (rehearsal base) `afldb_prod-20261122-025248.dump` | `26db476126b8a2e5474a452d5bfdb9b790031a11e797481065e37041c1761d8b` | from the R0 record; not recomputed |
| Tool blobs (the runner checks these, not the commit id): `import_draftguru.py` | `fd7b0abba14bba5de2f2436e60c5ddc6cc52a703204905075fe9750a980e19a2` | equal at HEAD (published in `731a5025`) |
| `reload_guard.py` | `af3874e77b9e0c7ebb0ee2fc6a9905c53df217aa802c9a194788b60b8968b21e` | equal |
| `parse_draft_snapshot.py` | `6f2faa37ad44e0b8d548d71672ec33da49ba1df7f5c9e4cc1af5f7080621a046` | equal |
| `draftguru-contract.json` | `cc5e0858c60499c61330363c82996b48ad52034b9e0b0177d638d99e1ee44296` | equal |
| `sealed/expected-pre.txt` / `expected-post.txt` (not in SEALED-PLAN §1; the runner diffs against them) | `97a3230ea2791f85b610dfbec381f7e91c904afaebc077cd7fba4ebeef6daeec` / `454b67e564532387c105bdd5cde882b9205558c30b81ab174e276839d1151ef0` | computed in run d |

### 1a. Transfer tar on streamanator

Read-only on streamanator, 2026-11-22 20:08Z (run d): `/mnt/ssd/afldb-backlog-20261122b-348/seal/i348-transfer.tar` 14,694,400 B,
mtime 2026-11-22T04:39:01, sha256 `478d4f809204f329251e9f58d03f1ab8a7491cb51f710c90a5b27f51aea77afb` (**equal**); its sibling
`i348-transfer.SHA256SUMS` sha256 `632aefe9024253acd86e967d9285f3f81656788cc20bdbc5a893d3d3de951326` (equal to the tracked copy); 103 tar
entries (92 files plus directories).

## 2. Which digest covers which write, and how drift is detected

The load has three independent protections. What each one covers, read from `sealed/i348-load.sh`, `sealed/draftguru-surface-digest.sql`
and `tools/rebuild/draftguru/reload_guard.py` (module docstring `:1-44`, `effects_digest` `:351-354`, the refusal `:460-468`):

1. **Before the write, inputs:** `verify` pins the transfer tar, all 92 transferred files, the five tool blobs, the pages, the
   reconciliation and the bridge child byte for byte. Same inputs as the rehearsal, or STOP.
2. **Before the write, start state:** `digest pre` must equal `expected-pre.txt`: whole-row md5 of every DraftGuru pick, person and
   identity (all columns except `import_batch_id`, `created_at`, `updated_at`, and the identity `id`), the link columns, the 8
   non-DraftGuru picks, and the whole `data_edits`, `data_overrides` and `players` tables. Same start state as R0, or STOP.
3. **During the write, before COMMIT, the reload guard's effect digest** (`ff8ef1b8…`): the importer recomputes, from the live database,
   the set of reviewed effects and refuses unless its sha256 equals the reconciliation's. It covers exactly: (i) deletions (0 picks,
   0 persons), (ii) source-owned column changes on **protected** picks (rows with an audit trail: 35 audited picks; in this load only
   `competition` NULL→AFL changes on them), (iii) `dg_person_id`/name/`name_key` changes on **protected** persons (35 rank changes, 31 of
   them also `name_key`), (iv) **every** `original_club_raw` change on any pick (191, including the three owner-ruled REPLACE_CLUB rows
   5961, 6784, 6626). Measured from the sealed guard report: 35 `competition`, 35 `dg_person_id`, 31 `name_key`, 191 origin changes.
4. **After COMMIT:** `digest post` must equal `expected-post.txt` (the same whole-surface digests, rehearsed identical in reh1, reh2 and
   the runner rehearsal reh3).

**F-2 groups by protection** (group letters as in `F2-DECISION-REVIEW.md` §2):

| Group | Rows | Effect digest (pre-COMMIT refusal) | Start-state digest + pinned inputs (pre-write) | `digest post` (post-COMMIT) |
|---|---|---|---|---|
| (a) `name_key` | 31 persons | **yes** | yes | yes |
| (b) `source_record_id` | 1,472 picks | no | yes | yes |
| (c) `draft_age` −1 | 101 picks | no | yes | yes |
| (d) `height_cm` | 8 picks | no | yes | yes |
| (e) `reported_games`/`reported_goals` | picks 362/178, persons 270/138 | no | yes | yes |
| (f) `dg_person_id` | picks 6,676; persons 4,967 | **only the 35 protected persons** | yes | yes |
| (g) `confidence_notes` | 35 picks / 31 persons | no | yes | yes |
| (h) `competition` | 35 picks | **yes** | yes | yes |
| (i) `original_club_raw` | 191 picks (3 ruled) | **yes** | yes | yes |
| (j) identities +31, `notes` relabel 5,057 | — | no | yes | yes (`facts_idents`, `link_idents`) |
| (k) `import_batch_id` 6,845; 1 `import_batches` row | — | no | no (excluded as bookkeeping) | **no**: not in any sealed digest |
| link state (`player_id`, link status, match method) on picks, persons, identities | must be 0 changes | no | yes (`link_*`) | yes (`link_*`) |

**The plain answer.** The F-2 *re-baseline* writes (b), (c), (d), (e), (g), (j) and most of (f) are **not covered by any pre-COMMIT
refusal**. Before the write they are protected only indirectly: the inputs are pinned and the start state must equal R0, and the
importer is deterministic on those (three rehearsals gave byte-identical after-states). Their actual values are checked **only after
COMMIT**, by `digest post`; a mismatch there cannot be undone mechanically (recovery = restore the pre-load backup, an owner decision
that also discards later writes). Group (k) is covered by **no** sealed digest at all (bookkeeping), only by the importer's exit code.
Tables outside the digest SQL that the load could touch (`import_batches`, `player_link_resolutions`) are likewise unchecked by the seal.

**Smallest addition, without changing the sealed plan (recommended):** the read-only `i348-postload-check.sh` (this folder; outside
`sealed/`, so no sealed digest changes and no re-seal or re-rehearsal is needed). `snap pre` runs immediately before `load`, `snap post`
after `digest post`, and `compare` checks per group the changed-row count and the sha256 of the sorted changed-id list against the
rehearsed values, the three rulings' exact bytes, zero link changes on every existing row, the 31 new identities, `import_batches` +1
completed and `player_link_resolutions` unchanged. It adds group-level diagnosis and covers (k) and the two extra tables; it does not
add a pre-COMMIT refusal. A true pre-COMMIT check of the re-baseline groups would need an in-transaction assertion inside
`import_draftguru.py`: that changes a pinned tool blob, so it means a re-seal, a re-publish of the tool and a new rehearsal. **Not
proposed:** the start-state digest already pins everything those groups are computed from, so the risk it would remove is only
non-determinism, which three identical rehearsals argue against.

**The post-load check, dry-run (run d).** `i348-postload-check.sh` (sha256 `d75def8c673664e1194b04fd2204a6ad7e44374d2272aa1250f3926feb3323bc`,
log `postload-dryrun-20261122d.log` sha256 `358b5d91df17ab489a5099884253fb51c643b51e5ba87f6d23f75b3f3dec0296`): `snap pre|post <outdir>` (one
REPEATABLE READ READ ONLY transaction as `afldb_backup`; COPY text, so NULL stays NULL and is never read as 0), `compare` (offline),
`derive`. 146 checks: every group (a)-(k) by changed-row count **and** the sha256 of the sorted changed-id list (pinned constants,
identical for reh1, reh2 and reh3, counts equal to `F2-DECISION-REVIEW.md` §4), the three rulings byte for byte (zero-width spaces
included), zero link changes on every existing pick, person and identity, 31 new unmatched identities, no inserted or deleted
picks/persons, `players`, `data_edits`, `data_overrides` and `player_link_resolutions` unchanged, `import_batches` +1 completed, and a
per-row residual md5 over every column outside the accepted groups. Dry run on a `cp -a` copy of the 22b-348 rehearsal PGDATA
(reviewer F-007; the 22b workspace listing hash and the `sealed/` hash identical before and after; the copy deleted): the sealed digest
SQL on the copies reproduced `expected-pre/post.txt`; **reh1, reh2, reh3: PASS 146/146**; six negative cases (pre/pre, swapped, one
altered link, altered sums, the 6626 ruling bytes, a NULL/0 coercion) each **FAIL** as intended. **Not verified:** the production path
(env-file credentials, host check) was exercised only through its refusals, and `afldb_backup`'s SELECT on `import_batches`,
`player_link_resolutions` and `sources` on production is unverified (`snap pre` runs before the load, so a denial surfaces before any
write). The new batch id is not pinned (it will differ from the rehearsal's); only its count and state are.

## 3. Proposed attended load window (separate from A1/A2 and from any reboot)

**The decisive constraint (reviewer F-008).** `digest pre` must equal the R0 state of 22 Nov 2026 across every DraftGuru row and the whole
`players`, `data_edits` and `data_overrides` tables. Any admin edit to those (for example entering the 2026 national draft, held in late
November, through the admin draft editor) or any import that touches them makes the sitting STOP at `digest pre`; the load then needs a
fresh backup, a new rehearsal on it and new `expected-pre/post.txt` (a re-seal of those two files and of `expected-*` in the runner's
folder; the guard's effect digest may change too). The longer the wait, the more likely that becomes.

| | **Wed 25 Nov 2026** | **From Thu 7 Jan 2027** (proposed: Tue 12 Jan 2027, 11:00 AEDT, after the weekly slot, not inside it) |
|---|---|---|
| Seal still valid? | very likely (three days after R0; STOP and re-plan if not) | **probably not**: about seven weeks of possible admin edits and the 2026 national draft entries; cost a re-rehearsal and re-seal of `expected-pre/post` (about half a day on streamanator, then owner re-approval of the new expected files) |
| Owner load | the day after A1/A2 (and a possible R6 reboot, `r6-kernel-check-20261122/README.md`), the eve of six weeks' leave | fresh, with the week to observe |
| If the result is questioned | the only recovery is a restore of the pre-load backup, an owner decision, and the owner leaves the next day; public `/draft/<year>` pages show the re-baselined values for six weeks unattended | the owner is present for follow-up |
| Season deadlines | none for 348 | must finish well before R8's capture (Fri 19 Feb 2027) and the opening (Tue 23 Feb; ISSUE-350 G0 by 2027-03-10, Opening Round 2027-03-17), so the capture includes the reloaded draft data and the two operations never overlap |
| Prerequisites | A2 R3 done (scheduled backups and an off-host copy), plus all of §4 | the same |

**Recommendation: from Thu 7 Jan 2027, proposed Tue 12 Jan 2027 11:00 AEDT**, accepting a probable re-rehearsal first. ISSUE-348 has no
deadline; loading on the eve of a six-week absence leaves any objection to the re-baselined values (the 8 heights, 101 ages, career
totals) without an owner to decide on recovery, and Wed 25 Nov is already the candidate day for the R6 reboot. If the owner prefers
25 Nov, it should be the only attended operation that day and must not share a morning with R6.

## 4. Sitting L: steps (when approved)

1. **Fresh backup first** (precondition 4): R0's command with a new directory (`backup.sh --dir <new> --keep 1000`, never bare), sidecar
   hash, off-host copy verified on streamanator (after A2 the daily pull and `a2-r3-firstcopy-restore.sh` exist for this).
2. Preconditions 1-7 of `SEALED-PLAN.md` §3 (owner approval with the full digests of §1 above; tool blobs published, they are since
   `731a5025`; transfer and seal copied; admin draft editor quiet; no writer unit running; production python has psycopg).
3. `bash i348-load.sh verify` → `VERIFY OK`; `bash i348-load.sh digest pre` → `DIGEST pre MATCHES` (else STOP, §3).
4. `bash i348-postload-check.sh snap pre /home/arm/ops/i348/postcheck/pre`.
5. `bash i348-load.sh load` → `import rc=0` (the single write; never re-run).
6. `bash i348-load.sh digest post` → `DIGEST post MATCHES` (the acceptance).
7. `bash i348-postload-check.sh snap post /home/arm/ops/i348/postcheck/post`, then `compare` → `POSTLOAD RESULT PASS`: the eight F-2
   groups as the owner named them and every other lettered group (a)-(k), the three club rulings (5961, 6784, 6626) byte-equal to the
   owner CSV, unchanged identity links on every existing row.
8. Public `/draft/2020`, `/draft/2024`, `/draft/2025` render (ISR may show old values until revalidated; no restart).

**Approval text (to fill; replaces F2-DECISION-REVIEW §7 for the load):**
> I approve the ISSUE-348 DraftGuru reload of `annual-html-20261122` with the F-2 groups (a)-(k) as rehearsed, against the full digests in
> `LOAD-WINDOW-PROPOSAL.md` §1 (manifest `26ca190b3f0f9c7120c506289319b75118a79305c55767f9db7540d6ef22a27c`, effect
> `ff8ef1b8ef900d9ab5b17c89b2f0f85d5b3091e9493456a45b2a5f67cf766452`, reconciliation `cf49f6a5671155c174d60497372fbf9c1fd15fce01bd9f0d3f3dab8619e0de4e`,
> tar `478d4f809204f329251e9f58d03f1ab8a7491cb51f710c90a5b27f51aea77afb`, SHA256SUMS `632aefe9024253acd86e967d9285f3f81656788cc20bdbc5a893d3d3de951326`,
> runner `61f44acb10cd63bbc7465e56289759b3a8bddd49713228ebc358683c10429c0d`, digest SQL `ae742dcc1cae5f5429e1e8c6a022b27c960ab1f89761f2d90b7456d9746e1dd0`)
> (or the re-sealed values if §3's re-rehearsal was needed), in an attended window on ____________, after a fresh verified backup.
