# AFLDB-ISSUE-377 · Player matching recall test passes without measuring recall

**Open · Medium · 22 November 2026.** Recorded production revision and candidate, test-only at review target `b445ba7f`.

The known-link recall test returns successfully below 20 trusted links before candidate retrieval or the 95% assertion. A similar return drops conflict coverage. Empty fixtures or a broken evidence query can make the tests green. The earlier apostrophe regression exercised a different assertion.

Source anchors — `tests/integration/player-matching.test.ts:243,259,394`.

## Correction and acceptance

Seed sufficient known synthetic identities for a mandatory recall/control test. Make empirical corpus unavailability an explicit skip with a reason. Assert a deliberately empty result fails the seeded control.

[Independent review](../reviews/AFLDB-FULL-REVIEW-2026-11-22.md)
