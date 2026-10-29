# D-V2-LOCK-1 — owner decisions, integration and artifact lock (approved 2026-10-29)

**Production: NO-GO.** This record carries the owner's D-V2-LOCK-1 approval of 2026-10-29, given against the
[consolidated decision package](release-decision-package-final-2026-10-29.md) §9 with the owner's own wording, and
what was executed under it. It authorises nothing beyond that approval.

## 1. The approval, as given

| Item | Owner's wording (condensed only where marked) |
|---|---|
| Scope | Work only in `D:\dev\afldbV2` |
| 1. D-V2-VISUAL-1 | "I ACCEPT ALL screens and states presented for acceptance in docs/v2/owner-visual-review-candidate-2026-10-29.md. This covers the corrected candidate and the synthetic UI evidence. It does not claim authentic provider reconciliation or production acceptance." Close V2-GAP-022, recount the register, update directly affected records |
| 2. Hostname (O-2, P1) | "V2 will serve at beta.afldb.com through the existing Caddy route. The apex launch remains separate. Do not change Caddy here." |
| 3. Ordering (O-3, RISK-27) | "Withdraw 'release after C5'. Stages A/B need not wait for 2027 evidence. A-AFLT remains required before the production schema/code installation, but its execution is not authorised here." |
| 4. Git and artifact (O-4, D-V2-PUSH-1) | Git inspection and fetch; selective local commits; push `v2/rebuild` to its verified existing origin; merge into `main` by a normal history-preserving merge, `--no-ff` where applicable; push the resulting `main` without force. Start from the accepted candidate `610bea5f` with its application tree from `7670441b`, including this visual-acceptance record. Preserve unrelated and staged work; no reset, stash or discard. Stop for an unexpected repository identity, a protected-branch refusal or a material conflict needing a new product decision |
| 5. Build | Lock and record the actual merge commit; one production-configured build by the established release-build procedure with installed tools; record platform, build identity and artifact hash. No substitute environment; no Linux claim from a Windows build. Reuse accepted validation; repeat checks only for actual merge changes or build failures |
| Not authorised | Deployment, DEV/PROD access or mutation, host changes, writer retirement, activation/deactivation, Brownlow operations, data rebuilds. EXEC, frozen P/H, source `D:\dev\afldb` and parked ISSUE-327 preserved |

## 2. D-V2-VISUAL-1 — recorded verdict (V2-GAP-022 closed)

```text
D-V2-VISUAL-1 — owner visual review of docs/v2/owner-visual-review-candidate-2026-10-29.md (corrected candidate,
application tree of 7670441b; build XtSgl4BOQZXC2G8qIWJdV).
ACCEPT: ALL screens and states presented for acceptance: every §1a, §1b and §1c item, every §2 row and every §3 item.
        Covers the corrected candidate and the synthetic UI evidence (§1b).
REJECT: none.
NOT REVIEWED / OUT OF SCOPE (owner's wording): authentic provider reconciliation and production acceptance.
        The other §4 item (a submitted "Revise approved winner" action) was not presented for acceptance and is not
        accepted; the revision panel itself (§3) is. Appendix D is diagnostic history, not for acceptance.
```

- **V2-GAP-022 is CLOSED** by this owner decision: every row and item presented for acceptance is accepted, and
  the remainder is out of scope by the owner's wording. Register recount: **38 total / 23 closed / 15 open**.
- Not claimed: authentic Brownlow provider reconciliation (gate 7; V2-GAP-016, 023's production step, 030, 031),
  production acceptance, or any rendering of production data. The images remain synthetic-fixture evidence on
  disposable isolated clones.

## 3. Hostname and ordering — recorded

- **O-2 / P1:** V2 serves at **`beta.afldb.com`** through the existing Caddy route to `127.0.0.1:3100`. No Caddy
  change was made here, and none is part of the lock. The apex launch is a later, separate decision. HC-1 (installing
  the repository Caddyfile) stays an independent, unapproved option (O-6).
- **O-3 / RISK-27:** "release after C5" is **withdrawn**. Stages A and B do not wait for 2027 evidence. **A-AFLT stays
  required before production schema/code installation** (the cutover preflight's `legacy-writers` check refuses the
  release until it is done); its execution is not authorised by D-V2-LOCK-1. The completed D-316-1 final acquisition
  (2026-10-21) means no AFL Tables acquisition precondition remains for it.

## 4. Git integration and lock

Recorded in §4 after execution (repository inspection, merge, locked execution commit, push status).

## 5. Production-configured build

Recorded in §5 after execution.
