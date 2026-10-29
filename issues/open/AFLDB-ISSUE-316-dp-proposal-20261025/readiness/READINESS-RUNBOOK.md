# ISSUE-316 approved readiness proof — 27 October 2026

**Owner-approved for read-only readiness proof. Production NO-GO pending a separate apply decision.**
Structural gate CLOSED / ACCEPTED. U3 CONFIRMED; U4 Route B; Brownlow untouched.
This runbook records the owner's 2026-10-25 ruling, without reopening the accepted
activation-separation gate or changing the candidate.

| Binding | Approved value |
|---|---|
| D | `2026-10-27` |
| Readiness/proof window | `2026-10-27 02:00–04:00 UTC` |
| Melbourne | `2026-10-27 13:00–15:00 AEDT` |
| Exact source P | `def676517da3955aa18db3606785463aac464188` |
| Implementation | `c438f8449e65c28cf9f00879aaa045131b5f0d3a` |
| Transition SHA-256 | `d55875cbfa686ac47511eca2e2ac7026cfadefd1fd4e7ab1b31c322f7359644b` |
| Canonical tuple SHA-256 | `a78d36ee7e689b7bb5978335bff5e6bdd54f368572df5f2f01d10caf35a373aa` |
| Inactive rebuild pin | `320960e482699e33afb112f8a765d711bd21c6c032ce464d5f18d39d8956ccc8` |
| Projected active rebuild pin | `ab7349470d5de859e83763fb8b9b07c9d4fce1db817046dc3e8a741f65bc3338` |
| Activation authority file hash | `1d133580f526131cf31136df042b372047b170e9925db525a21ef80c5658f65f` |
| Deactivation authority file hash | `fc45063484cfd6a07b0c716345898399298d2cc62d6b4c406846f554b96dee8c` |
| Migration binding | 117 files, last `117_brownlow_provider_eligibility_unknown.sql`, set `647c3fb39ca66a572664e1dae9028e4fad4d6b121226d6bdf208e6738af45f72` |

[Machine-readable approval and complete frozen artifact hashes](APPROVAL.json),
[current proof status](STATUS.json), [seven base/final pins](../PIN-TABLE.json),
[accepted proposal](../PROPOSAL.md),
[reviewed procedure](../../../../docs/v2/issue316-production-readiness-decision-2026-10-24.md).
The authority files retain their exact reviewed `PROPOSED` names and contents:
they bind the readiness projection and grant no activation/deactivation execution.
A later documentation/evidence commit is never substituted for P.

## Before the window

Local documentation, integrity checks and the documentation/evidence commit are
authorised now. Fresh proof has not run. Do not take the day-D censuses early,
reuse expired J2 host policy as current, or imply that a planned command ran.

The approved package's original 201-member manifest is retained as
`APPROVED-PACKAGE.sha256` (SHA-256
`b708d8eb0b1fe198a1fd7677e0ba5a3b739c93a48f6883d710217f77126fb8b6`).
It binds the pre-approval package as reviewed; subsequent approval/tracking updates
have a refreshed outer package manifest. Never rewrite the frozen structural inputs.

## At 02:00 UTC on D: entry and native/host proof

Confirm the clock is inside the approved window and D is unchanged. Recheck the
frozen artifact hashes, exact P source and inactive rebuild pin. The execution
checkout must be a **new mode-700 checkout at P**, using the reviewed bundle chain
and hash-bound inputs; never run from the later documentation-commit HEAD or reuse
J2 apply roots. Hash-verify the source and `FILE_ORIGINS.json` inputs before use.
Preserve complete before/after source inventories and normal transaction-leftover
checks. No pending journal, rollover temporary file or activation temporary file
may be present; preserve evidence and STOP rather than cleaning one up.

Establish actual current streamanator identity, native inventory, process visibility,
provenance controls and execution isolation immediately before proof. Record exact
UTC start/end, inventory bytes/hash, current policy bytes/hash, enforcement tooling
hashes and normal enforcement/self-check results. Bind an already-reviewed current
policy only if the actual host matches it exactly. J2's policy/record expired.

If drift exists, derive a new policy from the actual current host in a fresh proof
root, retain the exact inventory and policy hash, run the normal enforcement and
self-check, then obtain independent read-only review. CRIT/HIGH stop. MED affecting
enforcement completeness, process visibility, provenance or isolation stops and
returns to the owner. Fully captured ordinary version drift with review GO may
proceed under this ruling. There is no permission to install packages, hold OS
packages, change timers, permissions, services or production configuration.

Use the reviewed native-policy/auditor procedure from decision §6 and its named
G/J2 evidence as procedural references; expired runtime paths/pins are not current
authority. Resolve the actual reviewed host paths and record the exact executed
argv after current observation. Do not invent paths, replay the historical rebuild
harness, or turn a missing prerequisite into a passing record.

## Fresh read-only censuses, then nightly/canonical and health checks

Use the reviewed seven-file census bundle/wrapper identified in decision §5,
re-verified against P. All census SQL must run in a read-only transaction; credentials
stay in the existing protected environment/credential channel, never argv or logs.
The established command shape is:

```text
node node_modules/tsx/dist/cli.mjs tools/db/afl-api-ownership-census.ts --database <bound database> --dsn-env <existing protected variable> --through-season 2026 --out <new evidence JSON>
```

The wrapper, not this illustrative command alone, supplies the reviewed transport,
read-only transaction and identity checks. Record the actual argv and tool hashes.

| Target | Required identity from the reviewed decision |
|---|---|
| `afldb-prod` / `afldb_prod` | system `7674454702926115004`, DB OID `66668`; existing `afldb_backup` role |
| `streamanator` / `afldb_dev` | system `7673872117032104869`, DB OID `202860` |
| `streamanator` / `afldb_test` | system `7673872117032104869`, DB OID `45428` |

All three must pass, report zero candidate totals and zero refusal/error totals,
cover `1897..2026` without exclusions, and match the intended host/database identity.
Record each exact UTC start/end, database identity, complete output/hash, total and
refusal/error count. Take all on D, preferably together in the approved window.
The production census must be **no more than six hours old at dry-run start**;
prefer the same bound for all three. Record the actual age calculation, not merely
the presence of a timestamp. Failure, missing result, nonzero total or identity
drift stops; no repair, settle or canonical write is authorised.

Before dry run, read the latest authorised AFL Tables nightly/canonical state and
production identity/health evidence required by decision §§5–6. Compare it with the
candidate preparation baseline and retain observations, timestamps and hashes.
An expected nightly with no candidate-affecting change may be recorded and proceed.
Any unexplained change affecting pins, manifests, expected counts, transition
material or successor evidence **STOPs**. Present exact drift to the owner; never
silently regenerate the candidate. Do not pause a writer or change a service under
this read-only authority. Contention that prevents the required proof is a STOP.

## Enforced dry run only

Once all prerequisites are green, execute the reviewed production-readiness CLI
under the day's bound native auditor/policy, at exact P, with the unchanged approved
transition, D and three fresh census files. Derive the exact command from the
reviewed procedure and verified current runtime paths; retain it and its complete
stdout/stderr/exit status. **No `--apply`**, no successor-activation invocation that
writes, no deployment, no rebuild and no production mutation.

Require all of the following:

- exit 0; all three pre-apply gates PASSED;
- club-season transition `1622 → 1640`, renumbered `4`, final checks `91`;
- all seven final pins match `PIN-TABLE.json` and the approved transition;
- `tools/db/rebuild-test.ts` is bound read-only and remains at the inactive pin;
- B's successor tuple remains absent and its rebuild profile ineligible;
- projected C's active pin and tuple hash match the approved activation authority;
- no unexpected native-policy refusal;
- source checkout remains P and its inventoried bytes are unchanged;
- exact census outputs, identities, timestamps, hashes and fresh ages are bound;
- no pending rollover/activation transaction or temporary artifact;
- no production write, with the complete read-only/enforcement evidence retained.

Any missing criterion is STOP. Freeze the original candidate; keep failed evidence.
No silent re-pinning, missing-output acceptance or substitution is permitted after
the window begins. If the date slips or P changes for a product/test/structural
reason, the approval expires: STOP and return for owner adjudication.

## Return for the separate production-apply decision

Assemble D/P, current policy hash/review, all census identities/times/hashes/totals,
nightly/canonical comparison, full enforced dry-run result, seven exact final pins,
both authority hashes, source/transaction checks, current production identity/health
and every stop condition. Include the proposed recovery procedure below. Record
NOT RUN or blocked facts candidly. Request apply approval only after this actual
proof package is complete; a dry-run PASS grants no apply authority.

For this read-only phase, stop on failure and retain its new evidence root without
changing production or cleaning up unexplained transaction artifacts. No production
data rollback is needed or authorised because no production data write is allowed.

For a later separately authorised apply, the proposed recovery stays decision §8:
preserve a journal and all seven paths before owner-directed recovery; never recover
activation through the rollover journal. If C was separately authorised, recovery
order is C→B by deactivation first, then B→A rollover recovery. Deactivation is not
authorised now. Never revert the switch alone; deployment rollback remains separate.

If apply is later approved and succeeds, validate B before requesting any activation
decision. Brownlow's three 2026 decisions remain the separate audited post-seal
Route B workflow. No Brownlow settlement or correction belongs in this run.
