# V2-GAP-029: bounded acceptance instruction

Provenance: owner instruction in this Codex session on 2026-10-20, repository
`D:\dev\afldbV2`, branch `v2/rebuild`, expected and verified starting HEAD `ed4c429c`.
Decision identifier: **D-GAP029-21**.

> Accept only the 21 enumerated sibling differences as external eligibility-population disagreements; retain games > 0 and every strict mismatch.

The owner explicitly limits approval to the 21 findings already enumerated in committed
evidence at `ed4c429c`, with no exception for other cells, players or criteria. Approved
disagreements are **not matching data**. Expected verified counts: 149 strict, 99 approved
(78 existing deferrals + 21 disagreements), 50 unapproved. No remaining source finding is waived.

The approval manifest hash-binds the unchanged original evidence (whose `ownerApproved: false`
records its historical state). The policy requires exact board/cell/criterion pair, player
profile, external ID, mismatch direction and sole lacking `has_brother` builder. Duplicate
findings also fail. Classification and strict reporting remain separate from approval.

The same instruction authorizes dedicated local credential rotation only after process-owner
verification on 55433, focused tests, local commits and this handoff. It prohibits connections
through 55432, shared credential changes, SSH changes, production access, pushes/deployments,
repeated source hunting, workflow/history/screenshot/rollback reruns and release-policy waivers.
Any decision to stop treating Gridley parity as a backend migration blocker requires a
**separate owner decision**. No such release-policy change is granted here.
