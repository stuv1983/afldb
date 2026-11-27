# Tuesday sitting record: RECONSTRUCTED FIXTURE (not a real record, never a sitting record)

Reconstructed by the r5 implementer from Astra's written description of her reproduction (27 Nov 2026, review of f92d6e29):
valid evidence for a released outcome (build check, promotion, the owner's restart, an accepting P5), followed by the rollback
wrapper's links-mode output up to the line release.mjs prints once it has switched the links. The wrapper was interrupted
there: it never printed its pass line, the events.log tail or its own links-switched result line. Astra's own text was not
available; every record line below is the text the scripts print (the Tuesday scripts r1-p3b-build-check, r1-p4-gate-promote,
r1-p5-accept and r1-rollback, plus deploy/release.mjs cmdVerify and cmdRollback), with the fixture IDs of cases/f1-handoff.sh.
Expected: the f92d6e29 parser certifies tue:released (exit 0, a false PASS); the r5 parser STOPs (exit 1).
This header deliberately avoids the tokens the parser scans for. The file is a parser fixture, passed only by explicit
path, never by a glob.

G0 PROD RESULT PASS: fixture
P1 RESULT PASS

```
P3b RESULT BUILD PASS 17822b29e6de-fixtureBuild0123456789
```

```
P4 RESULT PROMOTED 2026-11-24T00:12:03Z: OWNER NOW: RESTART block (runbook section 4.2), no later than 11:35 AEDT
```

Owner restart 11:33.

```
PASS running invocation = the owner's restart aaaaaaaaaaaaaaaaaaaaaaaaaaaa0001
PASS 1 status --expect 17822b29e6de-fixtureBuild0123456789
P5 RESULT ACCEPT PASS (1-4)
```

Later the owner decided to roll back. The wrapper was started in links mode and was interrupted:

```
== R1 rollback links 2026-11-24T01:03:44Z
current before: releases/17822b29e6de-fixtureBuild0123456789
release: VERIFY PASS 7d92042fd110-XWruOm_9nLCSMY8nGPqYU (revision 7d92042fd11010eaa20966e2f49ae7a93e286568, BUILD_ID XWruOm_9nLCSMY8nGPqYU, 1234 files)
release: ledger: database ledger head not supplied (--ledger-head): compatibility NOT checked
release: ROLLED BACK to 7d92042fd110-XWruOm_9nLCSMY8nGPqYU (no rebuild); previous is now 17822b29e6de-fixtureBuild0123456789.
```

R6-HANDOFF tuesday-outcome released
R6-HANDOFF current-id 17822b29e6de-fixtureBuild0123456789
R6-HANDOFF attested-invocation aaaaaaaaaaaaaaaaaaaaaaaaaaaa0001
