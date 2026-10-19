# GAP-029: remaining source requests

2026-10-20; derived only from committed `ed4c429c` evidence. No additional source search.
**50 findings remain unapproved: 42 event cells + eight dated membership cells.** Both
strict parity and approved-policy conformance remain failed. Missing membership is UNKNOWN,
not an empty set. Full criterion pairs, expected memberships and identity references are in
`evidence/gap-029-gridley-residual-inventory.json` and its linked strict snapshots.

## 1. Exact marquee-match labels (42 cells)

Request an owner-supplied, provenance-bearing export of canonical match identities and exact
event labels: Anzac Day (Collingwood/Essendon series), Dreamtime (Richmond/Essendon), and
Queen's/King's Birthday including Big Freeze (Melbourne/Collingwood, Big Freeze since 2015).
Cover every relevant edition through the frozen corpus cutoff 2026-09-01, including explicit
non-occurrence/exclusion evidence, particularly the 2020 exception and 2021 SCG relocation.
Earlier editions needed by Anzac/Dreamtime are not limited to the dates of these boards.

Acceptable: the retained legacy SQLite `matches` event-label export, supplied locally with
source/version/hash and stable match keys; or a complete per-edition official league/club
schedule/history set that explicitly names the event. The documented remote legacy path is
in `evidence/gap-029-targeted-recovery.json`; this task does not access it. Dates, clubs,
venues, answer keys and partial histories alone do not establish event membership.

Known exact candidates (not applied): 1995-04-25 R4 Collingwood 111–Essendon 111 at MCG
(Anzac Day); 2021-06-14 R13 Melbourne 63–Collingwood 80 at SCG (Big Freeze/Queen's Birthday).
All other exact fixture identities must come from the requested artifact; the present
evidence cannot enumerate them reliably. Do not fill that uncertainty with calendar rules.

| Event criterion | Boards and dates | Cells on each board |
|---|---|---|
| Big Freeze | 330 (2024-06-10), 1058 (2026-06-08) | 2-0, 2-1, 2-2 |
| Big Freeze | 694 (2025-06-09), 933 (2026-02-03) | 0-0, 0-1, 0-2 |
| Big Freeze | 787 (2025-09-10), 1050 (2026-05-31) | 0-2, 1-2, 2-2 |
| Dreamtime | 677 (2025-05-23), 1040 (2026-05-21) | 0-2, 1-2, 2-2 |
| Anzac played | 738 (2025-07-23), 948 (2026-02-18), 1009 (2026-04-20), 1019 (2026-04-30) | 0-2, 1-2, 2-2 |
| Anzac played | 793 (2025-09-16) | 0-1, 1-1, 2-1 |
| Anzac won | 1014 (2026-04-25) | 0-2, 1-2, 2-2 |

Validate artifact hash/provenance and completeness by edition; resolve each fixture uniquely
by season, round, date, canonical clubs, venue and scores; reject ambiguity or conflicting
labels. Verify 2020 and 2021 explicitly. Normalize historical Queen's Birthday to the existing
King's Birthday series only with documented evidence. Import via a reviewed, transactional,
audited exact-ID update to `matches.match_event`, retaining raw source and before/after values.
Dry-run on an isolated clone first; verify participants and winners against existing match
rows. A separate import task must prove family completeness before enabling the current
any-label presence probe. Re-evaluate all 42 cells and retain any genuine external disagreement.

## 2. Board-date registrations and senior participation (eight cells)

Request authentic canonical registrations and complete senior AFL match participant/stat
snapshots sufficient to reconstruct each intersection as of the board date, with acquisition
timestamp, timezone/cutoff, source hashes, stable official player/match/club IDs and transfers.

| Board/date | Player (official ID), club | Cells / other criterion |
|---|---|---|
| 990 / 2026-04-01 | Willem Duursma (11955), West Coast | 1-0 WC; 1-1 career goals <20; 1-2 2020s |
| 992 / 2026-04-03 | Jagga Smith (9351), Carlton | 1-0 CA; 1-1 disposals25; 1-2 finals0 |
| 1000 / 2026-04-11 | Malcolm Rosas (2602), Sydney | 1-0 SY |
| 1035 / 2026-05-16 | Finnbar Maley (8920), Adelaide | 1-0 AD |

Acceptable: frozen official match reports/lineups with actual participation and statistics,
plus registration/identity evidence for the missing 2026 debutants Duursma and Smith. Include
all teammates and the histories required by the other axis, not only the four named players.
The current `teammate_of` builder joins the same club and season in
`player_club_season_stats`; it does not require a shared match. Derive those season/club sets
from qualifying senior participation through the cutoff, preserving that existing contract.
Selection announcements corroborate affiliation but cannot replace actual senior participation;
September rosters cannot establish April/May membership. State-league and preseason games
do not qualify. Do not infer missing stable profiles or manufacture registrations.

Validate stable-ID bijections, effective dates, competition, match identity and full participant
sets, substitutions and stat coverage. Reconcile against the frozen board cutoff and existing
canonical rows. Stage through the existing registration/player-identity and participant/stat
ingestion paths, review unresolved links, then dry-run and transactionally promote with audit
on an isolated clone. Verify idempotence and all eight intersections. No import is authorized
or performed by this source request; no registration or participation evidence is invented.
