# ISSUE-316 historical narrative hash adjudication (2026-10-25)

Later repository audit/tracking record, outside all frozen snapshots. The owner
accepted these three discrepancies as non-blocking after verification. Each is:

**EXPECTED HISTORICAL VERSION DRIFT — point-in-time hash retained; narrative subsequently amended; not evidence corruption.**

All paths in the table are relative to
`issues/open/AFLDB-ISSUE-316-u3-correction-20261024/`.

| Hash set | Affected narrative path | Historically expected SHA-256 | Current SHA-256 |
|---|---|---|---|
| `SHA256SUMS` | `METADATA-REPAIR-V4-RECORD.md` | `b51c595a24b15d7cf08483f8925bfb2bdd2a11d77663a9d59c3d52eae0074c3a` | `b8651d388b4e42bdc28c751162156e610b64e92b946198192d5e7e033c287b32` |
| `SHA256SUMS.before-adjudication` | `RECORD.md` | `5b809fcb87f1f96ade57249e1a14533ab4719614084fff0c68fbaee12df1a99f` | `efea58aacfa9da833f3bd90c9d28fbd005e3a2268514aebcfe9c940eddf2a429` |
| `SHA256SUMS.before-metadata-review` | `RECORD.md` | `9f8fe692c1294c18bf35f3b1fffe0eb5d9a6f7bd44d356f52bc1367df1a59a05` | `efea58aacfa9da833f3bd90c9d28fbd005e3a2268514aebcfe9c940eddf2a429` |

For row 1, the later amendment is the expressly labelled production execution
STOP in [METADATA-REPAIR-V4-RECORD.md](../AFLDB-ISSUE-316-u3-correction-20261024/METADATA-REPAIR-V4-RECORD.md),
lines 3–17. The frozen [owner execution authority](../AFLDB-ISSUE-316-u3-correction-20261024/metadata-repair-v4-production-20261024T200631Z/OWNER-EXECUTION-AUTHORITY.md),
lines 3–9, requires evidence/tracking for the conditional attempt. The frozen
[execution report](../AFLDB-ISSUE-316-u3-correction-20261024/metadata-repair-v4-production-20261024T200631Z/REPORT.md),
lines 3–11, corroborates that stopped observation. This is a later authorised
narrative update; every immutable entry in the historical set still matches.

For each of rows 2 and 3, the later amendments are the expressly dated owner
adjudication and conditional metadata-repair authority in
[RECORD.md](../AFLDB-ISSUE-316-u3-correction-20261024/RECORD.md), lines 11–34.
The [read-only adjudication report](../AFLDB-ISSUE-316-u3-correction-20261024/ADJUDICATION-READONLY-REPORT.md),
lines 1–14, corroborates the accepted correction and verification. The frozen
[v2 owner ruling](../AFLDB-ISSUE-316-u3-correction-20261024/metadata-repair-v2/OWNER-RULING.md),
lines 3–14 and 34–35, retains the owner's acceptance and explicit evidence and
tracking authority. Later historical sets pin the current `RECORD.md` hash.
For each discrepancy, every immutable entry in its historical set still matches.

Independent verification parsed the original **16 inventories/hash sets** and
rehashed **771 entries: 768 exact matches and these three narrative-only
discrepancies**, with no additional drift from the preceding audit. All package
manifests (v2 24, v3 46, v4 40, v5 43 members), both eight-member validation
inventories and all four bound execution/prerequisite/observation inventories
PASS. Immutable SQL, manifests, preflight, transaction, postcheck and canonical
execution artefacts remain unchanged. The [machine audit](U3-HASH-AUDIT.json)
retains each expected/current hash and separately classifies the accepted drift;
raw hash mismatches remain recorded as mismatches.

All six historical hash-list files remain unchanged. Five older lists also
match their pins in later historical sets. Root `SHA256SUMS` currently hashes to
`3eb39253d1bdcd472a198990163d0707114970b9413d9f1497a13d5d4835d583`.
The lists were not in implementation commit `c438f844`, so that commit cannot
independently establish their original bytes. The audit anchors their current
bytes and preserves the pre-existing lists; it does not invent an older root
list pin. No old list or narrative was rewritten/restored to force PASS.

The excluded failed synthetic log
`metadata-repair-v5-validation-GFhNS5/PG-SERVER.log` has reference SHA-256
`d89be782577adeeb6d548317a6ded116639831906084f78d1baaaf349828e451`.
It is absent from the 16 binding inventories; canonical v5
[validation evidence](../AFLDB-ISSUE-316-u3-correction-20261024/metadata-repair-v5/VALIDATION-EVIDENCE.json)
calls that failed run retained, not pinned. It remains excluded because it is
obsolete and contains a test-only password literal. Only its hash/reference is
recorded here; no sanitised copy is represented as original.

U3 **CONFIRMED**; U4 **Route B**; Brownlow untouched; production **NO-GO**.
These discrepancies block neither the evidence commit nor eventual structural
closure. The separate [local gate](LOCAL-GATE.md) still applies.
