# D-336-3: classification of the 187 revised origin paths (2026-11-11)

Read-only. No database, DEV or production host was touched. The owner's CSVs were only read, and nothing in this
folder changes a decision: the data authority for production remains the owner's choice (OD-5).

## 1. Inputs and their provenance

| Input | Where | Proof |
|---|---|---|
| Owner DraftGuru CSVs, 35 files, 1991–2025 | `C:\Users\stuar\OneDrive\Desktop\New folder` (owner location, 2026-11-11) | All 35 SHA-256 equal the 2026-11-05 inventory (`../csv-inventory.txt`): 35/35 match, 0 mismatch. `SHA256SUMS.owner-csv` here (sha256 of that list `c495599b…09a7c0`) |
| Retained copy of the CSVs (raw, byte-identical, read-only) | streamanator `/mnt/ssd/afldb/records/d3363-owner-draftguru-csv-20261111/` (dir mode 500, files 444) | `sha256sum -c SHA256SUMS` PASS on the copy. The originals were re-hashed afterwards: unchanged |
| Stored rows (the 2026-11-04 production dump, restored on an isolated `_test` cluster on 2026-11-05) | streamanator `/mnt/ssd/afldb/workspaces/i336-draft-20261105/evidence/draft-export.json.gz` | sha256 `c41bb4a759cdb813e48fe14fb425f817797221bd60f81c3b3a5e101b49d64526`, identical after copy |

**Reproduction first.** `../csv_inventory.py` and `../reconcile.py`, re-run unchanged on these inputs, reproduce
`../csv-inventory.txt` and `../reconcile-before.txt` byte-for-byte (BOM and CR aside): the same 5,931 matched rows, the
same 187 `original_club_raw` differences, the same 46 "CSV extends stored" count. The classification below therefore
reuses the recorded matcher verbatim (`scripts/extract_pairs.py` executes `reconcile.py` and keeps its `matched` list).

## 2. Method (`scripts/classify.py`)

Each origin path is split on `/` into segments. For each of the 187 rows:
- **INSERT_SCHOOL / INSERT_CLUB**: the stored segments are an ordered subsequence of the CSV segments, so every stored
  segment is kept and DraftGuru added one or more. School versus club is decided by the added segment's name (College,
  Grammar, SHS, HS, SC, SS, School, …). The 89 distinct school segments were then checked by hand: all are schools.
  The position (prefix, interior, suffix) is recorded.
- **RENAME_EXPAND**: same length, one segment differs, and the CSV segment is a longer form of the stored one.
- **REPLACE_CLUB**: same length, one segment differs, and it is a different name. This is the only class in which a
  correction would remove a stored value.

Per-row evidence (`classification.json`, also `classification.tsv`): row id, year, category, player, pick, club,
`player_id`, stored and CSV paths, class, added and removed segments, their position, how often each added segment
is used elsewhere in the stored data and in the CSVs, whether every stored segment is retained, and the same
player's other stored events with their origins. Aggregate output: `classify-output.txt`.

## 3. Result

| Class | All 187 | of the original 46 | **of the 141** | Rows (draft_picks.id) |
|---|---|---|---|---|
| INSERT_SCHOOL, interior | 130 | 0 | **130** | see `classification.tsv` |
| INSERT_SCHOOL, suffix (school appended) | 5 | 0 | **5** | 6255, 6631, 6646, 6724, 6770 |
| INSERT_SCHOOL, prefix | 39 | 39 | 0 | 6144, 6171, 6236, 6268, 6272, 6345, 6350, 6351, 6399, 6479, 6488, 6491, 6495, 6497, 6498, 6503, 6505, 6545, 6632, 6641, 6644, 6650, 6653, 6655, 6656, 6659, 6660, 6661, 6664, 6667, 6705, 6708, 6709, 6717, 6720, 6721, 6735, 6749, 6752 |
| INSERT_CLUB (earlier junior clubs prepended) | 7 | 7 | 0 | 1097, 1388, 1753, 3795, 3912, 4163 (Tasmanian, 1991–2009); 5965 (three Melbourne junior clubs) |
| RENAME_EXPAND `Brighton` → `Brighton Districts & Old Scholars` | 3 | 0 | **3** | 6445, 6590, 6601 |
| REPLACE_CLUB | 3 | 0 | **3** | 5961 and 6784 (Finlay Macrae, 2020 National and 2025 Post-Draft: `Surrey Park` → `Kew Rovers`); 6626 (Blake Leidler, 2024 Rookie: `Collegians` → `Surrey Park`) |

**The 141, classified:** 135 add one school between the junior club and the representative/state-league club (130)
or after it (5); 3 expand an ambiguous `Brighton` to the SA club's full name; 3 replace a junior club.

**Correction to the run 8 record.** Of the original 46 "CSV extends stored" rows, only 7 prepend earlier junior clubs;
39 prepend a school. Across all 187: **174 add a school, 7 add junior clubs, 3 canonicalise a name, 3 conflict.**

Supporting facts:
- **Systematic back-fill, not drift.** National-draft rows whose path names a school, stored → CSV: 2021 41 → 55 of 65;
  **2022 2 → 41 of 59**; 2023 60 → 62 of 64; **2025 0 → 45 of 58**; 2018–2020 and 2024 identical. DraftGuru added
  school history to cohorts that lacked it when the acquisition snapshot was taken. 181 of the 187 rows are 2020–2025.
- 132 of the 174 school insertions use a school name the stored data already uses elsewhere; 33 inserted names are
  new to the stored vocabulary (listed in `classify-output.txt`).
- **RENAME_EXPAND is a consistency fix.** Nine other stored rows already spell this club `Brighton Districts & Old
  Scholars` (ids 2247, 2655, 2706, 2740, 4648, 4978, 5090, 5156, 6267). The CSVs keep a bare `Brighton` only once, in a
  Tasmanian path (2011, Jimmy Webster), where it means a different club.
- **Same-player consistency.** No player among the 187 has another stored event whose origin differs from this row's
  stored origin, and where a player has two affected events (Plain 1388/1753, Macrae 5961/6784, Horne-Francis
  6085/6219) the CSV revises both identically. One sibling lies outside the CSV range: Daryn Cresswell's 1988 event
  (id 233, `North Hobart`), which a 1991–2025 CSV correction would not reach.
- **Effect on the origin filter (`ILIKE`).** For the 181 insertion rows every stored segment survives, and for the 3
  renames `Brighton` remains a substring, so no current match would be lost; rows would only start matching the added
  school or club names. Only the 3 REPLACE_CLUB rows would change which junior-club filters they match.
- 39 of the 187 rows have no linked `player_id`. Origin is display text and plays no part in identity or linking.

## 4. Refined recommendation (the owner decides the data authority)

The classification removes the main uncertainty of run 8: 184 of 187 (98.4%) stored values are **incomplete, not
wrong**, and only 3 are genuine conflicts between the acquisition-time and current DraftGuru.

- **Recommended, unchanged in substance: (A) now, then (B) at the next planned full DraftGuru acquisition**, with
  this classifier as that acquisition's origin-review gate: INSERT_* and RENAME_EXPAND accepted as source enrichment,
  REPLACE_CLUB rows listed for an explicit owner check rather than accepted silently.
  - Why not a write now: the gap is presentational (no identity, link, count, pick, category or NULL-semantics effect),
    a correction cannot remove any current filter match apart from 3 rows, and any production writer for 184 text
    values needs a new tool, review, rehearsal and GAP-029 stage on the same `draft_picks` seal as D-336-2.
  - What the owner accepts with (A): the 2022 and 2025 draft pages keep showing origin paths without schools (stored
    school coverage 2/59 and 0/58 National picks against 41/59 and 45/58 in DraftGuru), and an origin search for
    one of the 89 schools misses these 174 rows, until the acquisition.
- **If the owner wants the recent cohorts corrected before then: (C′), a bounded additive correction of 184 rows**
  (the 174 + 7 insertions and 3 renames, with the CSV export as the authority), **excluding the 3 REPLACE_CLUB rows**,
  which wait for (B) or an explicit owner ruling. It is smaller and safer than the run 8 (C) (187 rows) because it
  never removes a stored segment. It still needs a new stage tool, review and rehearsal, it should follow D-336-2
  rather than interleave with it, and it leaves the 1988 Cresswell row unrevised.
- **(C) as originally framed (all 187, CSV authority) is not recommended**: it would settle the 3 conflicts on the
  CSV's word alone.
- **For a single row, no new tool is needed.** The admin draft editor's "Player details" group
  (`saveSourcePickFields`, `src/db/queries/admin-draft.ts:677`, group `player_info`) already corrects
  `original_club_raw` on a source-owned selection, under the importer connection, and stores the change as a delta
  `data_overrides` row that is replayed across reloads. That suits an owner ruling on the 3 REPLACE_CLUB rows if one is
  wanted before (B). It does not suit 184 rows, and each override **pins** its value against later DraftGuru revisions,
  so (B) would keep the owner's value for that row. It needs the row's reload key (`player_url` and `draft_kind`).

## 5. Reproduce

```bash
python -I ../csv_inventory.py "<owner CSV folder>" <work>/csv_rows.json
cp <draft-export.json.gz> <work>/
python -I ../reconcile.py <work>                      # = ../reconcile-before.txt
python -I scripts/extract_pairs.py .. <work>          # 187
python -I scripts/classify.py <work>                  # = classify-output.txt, writes d3363-classification.json
```

## 6. Owner decision (2026-11-11)

**D-336-3 = option (A).** The stored origin values are kept; no production write. This classification is preserved for the next planned
DraftGuru acquisition (the Nov–Dec re-acquisition), tracked as **AFLDB-ISSUE-348**. The three REPLACE_CLUB rows are listed separately for
adjudication in `replacements-for-adjudication.tsv`.
