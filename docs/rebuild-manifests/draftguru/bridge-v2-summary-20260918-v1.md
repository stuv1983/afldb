# AFLDB-ISSUE-222 — bridge v2 source-evidence parent (20260918-v1 summary)

Generated from the COMPLETED Phase 3 operator adjudication (83/83 rows). No database connection, network request, importer run, DEV/PROD action or Git command occurred.

## 1. Lineage

| Quantity | v1 | v2 | Delta |
|---|---:|---:|---:|
| Accepted bridges (persons) | 3564 | 3562 | -2 |
| Withheld (persons) | 1493 | 1495 | +2 |
| Distinct persons accepted | 3564 | 3562 | -2 |
| Distinct AFL Tables targets accepted | 3564 | 3562 | -2 |

| Action | Rows |
|---|---:|
| unchanged (no verdict touched the row) | 3481 |
| confirmed (verdict confirmed the existing mapping, content identical) | 74 |
| corrected (structured corrected target applied) | 7 |
| added | 0 |
| removed / withheld | 2 |
| **content-unchanged total** | **3555** |

Decisions incorporated: **83** (81 eligible, 2 withheld, 0 uncertain). By verdict: `agree` 30, `approve_manual_curation` 7, `different_person_wrong_href` 2, `same_person_valid_href` 2, `same_person_valid_relisting` 42.

The net accepted change is **-2**, not +81: 74 positive decisions confirmed an existing mapping without changing it, 7 corrected a target in place, 0 promoted a previously withheld row, and 2 rejected a mapping.

## 2. Withheld (different_person_wrong_href)

| DraftGuru person | Rejected AFL Tables target | Reason |
|---|---|---|
| Craig Somerville (`https://www.draftguru.com.au/players/craig_somerville/1`) | `players/C/Craig_Somerville.html` | `different_person_wrong_href` |
| David Sullivan (`https://www.draftguru.com.au/players/david_sullivan/1`) | `players/D/David_Sullivan.html` | `different_person_wrong_href` |

The rejected target is recorded for audit only; it is never an accepted link, no alternative identity is guessed, and no accepted v2 row can reintroduce it.

## 3. Event reconciliation (no event-level bridge file exists)

- Stage A events: 6810 across 5057 persons; 0 duplicate immutable event identities; 0 orphan event persons.
- Persons holding more than one draft/listing event: 1473, of which 74 include a repeat event at the same club (a same-club re-draft remains valid and is preserved).
- All 42 `same_person_valid_relisting` persons hold exactly one v2 parent row (5 of them carry several events, 0 at the same club).
- 2 event(s) belong to the 2 withheld person(s) and therefore resolve to no accepted link.

## 4. afldb_test child — NOT generated

`child_status` = `requires --resolve-against afldb_test`.

- v1 resolved child accepted: 3463.
- v1 rows eligible for unchanged carry-forward after removing the 2 rejected link(s): 3461.
- Corrected parent targets pending database resolution: 7.
- These are planning figures only. No prediction is made that all 7 will resolve, no final v2 child accepted/withheld count is published, and no child artefact was generated.

## 5. Artefacts

| Artefact | sha256 |
|---|---|
| `docs/rebuild-manifests/draftguru/bridge-v2-parent-20260918-v1.csv` | `8405de83ccf03d0771ad01c3523a82e19e3419222bf0d590c09ea09a11faeee9` |
| `data/reference/draftguru-person-bridge-20260918-v2.json` | `ad25d965cba72b97be895451dc488bf03a1899421e902394baa52a620abe8e57` |
| `docs/rebuild-manifests/draftguru/bridge-v2-reconciliation-20260918-v1.json` | `01b7c65f63152a3458af7a10c3572478cd7cda570fbe9aad0a299a06ed8f100c` |
| `docs/rebuild-manifests/draftguru/bridge-v2-withheld-20260918-v1.csv` | `d57cbda472e1477710f0634df258822170ca48e7290d6ee35472e0667820774f` |
| `docs/rebuild-manifests/draftguru/bridge-v2-withheld-20260918-v1.json` | `3fb2903d18180d687fa54fe75c6fc0ec4e49b6932d1fa8e3b426414a9ab3c9bc` |

## 6. Status

Bridge v2 source-evidence parent generated and validated; afldb_test-resolved child deferred pending backed-up database target resolution.

Bridge v2 is **not** deployment-ready until the child is generated through the existing `--resolve-against afldb_test` path. Phase 3 is not marked accepted by this artefact and AFLDB-ISSUE-222 is not complete.
