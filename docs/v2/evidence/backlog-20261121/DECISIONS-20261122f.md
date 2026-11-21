# Owner decisions, round 5 (22 November 2026): publication, Tuesday PREP, ISSUE-348 groups (f)-(k), the 12 January window, R6 gates

**Status.** Records only. Written by the main session after the push; **local commit, not published** (see §6). Nothing here
executes anything. Sources: the owner's round-5 message of 22 Nov 2026; `issue348-acquisition/LOAD-WINDOW-PROPOSAL.md` §2a, §2b, §3a
(the group table and detection are quoted from §2a, not re-derived); `ATTENDED-PLAN-R6-20261125.md`.

## 1. Publication (done, verified)

The owner approved the fast-forward `da4cc0c4` -> `ae51cd8d913a7523dd89fb638279e7f910054b79` (the nine reviewed commits), on
condition that the live remote and the local tip were re-read immediately before the push. Re-read: live `origin/main` =
`da4cc0c459f469d3b1a798302f8fe394962a395f`, local tip = `ae51cd8d913a7523dd89fb638279e7f910054b79`. Pushed without force. Verified
by `git ls-remote origin refs/heads/main` = **`ae51cd8d913a7523dd89fb638279e7f910054b79`**.

## 2. Tuesday 24 November 2026 (A1 and A2): pins as approved

- **PREP = `ae51cd8d913a7523dd89fb638279e7f910054b79`.** Check at session start (verified in the main session on 22 Nov before the
  push): its parent is `fb2629e03d066819b26235dc67516448d26be24b`, and the only difference from that parent is
  `docs/v2/evidence/backlog-20261121/FRESH-SESSION-PROMPT-A1A2.md`. Any mismatch is reported to the owner before anything else.
- **Application: build `7d92042fd11010eaa20966e2f49ae7a93e286568`** (pinned by `git archive`; executable tree equal to `cf158d60`).
- Timing T-1 (start 09:20 AEDT), the 10:45 latest-restart rule and the attended A1/A2 runbook are unchanged.
- **Consequence for later commits:** PREP must stay the live tip until A1 has started. Records written after this push (this file
  included) stay LOCAL until the owner approves a further push, which is not to happen before the Tuesday session has read its PREP.

## 3. ISSUE-348: groups (f)-(k) are in the January rehearsal scope

**Owner decision (22 Nov, round 5).** Groups **(f)-(k) are included in the January rehearsal.** This is a scope decision for the
rehearsal and the re-seal. It is **not** approval of any production write: the owner will approve the exact production write set
after the refreshed rehearsal and re-seal (§4). **ISSUE-348 stays OPEN until the load and the post-load checks pass.**

The owner's eight named columns are groups (a)-(e); (f)-(k) are the rest. Rows are the November rehearsal's (reh1 = reh2 = reh3;
`F2-DECISION-REVIEW.md` §2/§4); the January rehearsal measures them again against the then-current start state and **any difference
from these counts is reported, not absorbed**.

### 3a. Every group: tables, columns, expected rows, what can stop a mismatch BEFORE COMMIT

| Group | Table.column | Expected rows (Nov rehearsal) | Can stop a mismatch BEFORE COMMIT | Verified only AFTER COMMIT |
|---|---|---|---|---|
| (a) | `draft_persons.name_key` | 31 | yes: effect digest `ff8ef1b8…` refuses before any write (`reload_guard.py:467`, called at `import_draftguru.py:1479`, before the batch opens at `:1481`); pinned inputs (`verify`); R0 start state (`digest pre`) | `digest post`; `i348-postload-check.sh` |
| (b) | `draft_picks.source_record_id` | 1,472 | **no** (only indirect: identical pinned inputs + identical start state + a deterministic importer) | `digest post`; postload `compare` |
| (c) | `draft_picks.draft_age` | 101 (each -1) | **no** (indirect only) | `digest post`; postload `compare` |
| (d) | `draft_picks.height_cm` | 8 | **no** (indirect only) | `digest post`; postload `compare` |
| (e) | `draft_picks.reported_games` / `reported_goals`; `draft_persons.reported_games` / `reported_goals` | 362 / 178; 270 / 138 | **no** (indirect only) | `digest post`; postload `compare` |
| (f) | `dg_person_id` on `draft_picks` and `draft_persons` | 6,676 / 4,967 | **only for the 35 protected persons** (effect digest); no for the rest | `digest post`; postload `compare` |
| (g) | `confidence_notes` on `draft_picks` / `draft_persons` | 35 / 31 | **no** | `digest post`; postload `compare` (not in the sealed link digest) |
| (h) | `draft_picks.competition` (NULL -> AFL) | 35 | yes: effect digest (protected rewrites) | `digest post`; postload `compare` |
| (i) | `draft_picks.original_club_raw` | 191 (three owner-ruled: 5961, 6784, 6626) | yes: effect digest covers every change | `digest post`; postload `compare`, the three rulings byte for byte |
| (j) | `external_identities` (source `draftguru`) | +31 `unmatched` rows; `notes` relabel on 5,057 | **no** | `digest post` (`facts_idents`, `link_idents`); postload `compare` |
| (k) | `draft_picks.import_batch_id` | 6,845 | **no** | postload `compare` **only** (excluded from the sealed digest) |
| not a lettered group | `import_batches` | +1 row (`completed`, `records_rejected` 0) | **no** (the `running` row is committed at batch open, before the data) | postload `compare` **only** |
| not a lettered group | `player_link_resolutions` | 0 changes (read at `import_draftguru.py:650-668`, never written) | **no** (the importer only reads it) | postload `compare` **only** (count and md5 unchanged) |
| link state on every existing pick, person and identity | existing link columns | 0 changes in either direction | start state (`digest pre`, `link_*`) | `digest post` (`link_*`); postload `compare` |

### 3b. What can only be verified afterwards

- **Detected only after COMMIT:** (b), (c), (d), (e), (g), (j), (f) for all but the 35 protected persons, (k), `import_batches` and
  `player_link_resolutions`. Before COMMIT these rest on identical pinned inputs, an identical start state and a deterministic
  importer (three byte-identical rehearsals), not on a check of the written values.
- **`import_batches`** is checked after the load by `i348-postload-check.sh`: exactly +1 row, status `completed`, `records_rejected` 0.
  **`player_link_resolutions`** is checked there too: row count and md5 unchanged. Neither is in any sealed digest.
  `i348-postload-check.sh` is therefore a **required** step of the load sitting, not optional.
- **Recovery** after a post-COMMIT detection is restoring the pre-load backup, an owner decision that also discards later writes.
- A true pre-COMMIT assertion would mean an in-transaction check in the pinned importer: a new tool blob, a re-seal and a
  re-rehearsal. Described in `LOAD-WINDOW-PROPOSAL.md` §2a, not proposed, not applied.
- Read access of the checker's role was verified on 22 Nov (SELECT on all 9 relations, no write privilege): `LOAD-WINDOW-PROPOSAL.md`
  §2b. It is re-read at the load sitting; the January role state is not assumed.

## 4. The reserved window and what the owner will be shown

**Tuesday 12 January 2027, 11:00 AEDT is RESERVED for the attended load** (the owner is available from Thu 7 Jan). Before it, per
`LOAD-WINDOW-PROPOSAL.md` §3a: refresh the rehearsal against the then-current production start state (new backup, new restores, new
`digest pre`), re-seal the plan, and show the owner: **the full digests** (manifest, effect, reconciliation, tar, `SHA256SUMS`,
runner, digest SQL, plus `expected-pre`/`expected-post`) **and every difference from the November rehearsal** (row counts per group
above, start-state digests, anything newly changed since R0). The owner then approves the exact production write set. If the
refresh shows a difference nobody has explained, the load does not run on 12 Jan.

## 5. R6 (Wed 25 Nov 2026): the gates are binding

The documented DigitalOcean recovery path (Recovery Console access, the power-cycle path, snapshot restore) is **documentation only**:
nothing was rehearsed on a droplet, and DigitalOcean's restore-snapshot page returned 404 when fetched. It needs **operator
verification** by the owner before the reboot. The runbook's NO-GO matrix applies without exception: **no reboot** without usable
console access, a verified kernel 137 fallback path (the temporary `GRUB_DEFAULT=saved` arrangement, and the check that `/boot` is
not on LVM or MD and the `save_env next_entry` block is present), a verified snapshot or backup, and the pre-checks passing. If
boot recovery is still uncertain, pause before rebooting (the fallback window is 14:00-15:00 AEDT).

## 6. Open after this round

- ISSUE-348: open (load and post-load checks outstanding; January refresh, re-seal and the owner's approval of the exact write set).
- R6: the owner's operator verification of console, snapshot and the 137 fallback; the reboot only if no NO-GO applies.
- Publication of this file and of the trackers' round-5 lines: **local only**, pending a further owner push approval after PREP has
  been used on Tuesday.
