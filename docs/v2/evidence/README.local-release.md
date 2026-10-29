# Local release evidence index

The owner-review entry point is `../local-release-review.md`.

Authoritative final evidence:

- `local-delivery-summary.json`: exact failures/skips, original-gap suites and every retained file
  changed from `36679a1e`; input report filenames are embedded.
- `local-supported-tests-delivered.json`: final complete serial workflow on the correctly prepared
  target: 13,740 passed / 9 failed / 31 skipped, no setup/teardown-only failure. Not green.
- `local-coleman-complete.json`: 27/27, including the commit-boundary lock regression, on its separate schema-only database.
- `local-import-role-lock-final.json`: explicitly selected restricted-role row-lock probe.
- `local-frozen-source-final.json`: required accepted fitzRoy/DraftGuru source checks.
- `local-lint-delivered.json`: changed-file lint versus the starting revision; inherited
  findings remain visible. Older lint reports can contain subsequently repaired findings.
- `local-brownlow-history-final.json`: all 98 locally available seasons, read-only determination.
- `local-data-coverage-final.json`: local horizon, exact membership digests under multiple
  collations, and linked coaches lacking local match evidence.
- `local-gridley-delivered.json`: final strict corpus detail, including coverage/cell failures.
- `local-reference-oracles-final.json`: independent SQL confirms both current membership cohorts;
  current durable identity lists retained, expected digest pins unchanged.
- `local-deadlock-contract-final.json`: 46/46 cases after correcting unsupported victim prediction.
- `local-brownlow-complete-final.json`: 324/324, including all canonical public criteria and unresolved/joint publication.
- `local-final-isolation-repairs.json`: 313/313 focused checks after the final reference/oracle/fixture repairs.
- `local-rollback-1-previous.json` through `local-rollback-10-v2-final-capture.json`: local standalone
  return-to-previous/forward-again checks with statistical/audit hashes.
- `local-visual/`: four final affected Brownlow captures, opened and inspected.
- `local-secret-scan-delivered.json`: final retained inputs checked against all six current local
  credentials without displaying them. Earlier `local-secret-scan.json` is an intermediate scan.

`local-repository-lint-complete.json` records 234 errors/131 warnings (inherited debt), not a pass.
The two aborted delivery/candidate runs produced no completed report; their databases were
retained and a fresh final target prepared. They were stopped for actual concurrency/public
canonical-path repairs, not to hide failures. Unrelated `.codex/` state is preserved separately
and is not read/scanned/staged as task evidence.

Earlier attempts are deliberately preserved, not silently overwritten or deleted. Names such
as `local-supported-tests-final.json`, `local-contract-repairs.json` or earlier `*-final.json`
are intermediate checkpoints, NOT a green final release gate. Their failures led to the retained
repairs. `local-verification-initial.json` preserves the exact original 14 historical failures;
`local-complete-tests.json` preserves the first broad run. Production remains NO-GO.
`local-supported-tests-release.json` and `local-test-summary.json` are also intermediate:
their missing-bridge/order/oracle failures were fixed before the fresh delivery run.
`local-supported-tests-complete.json` and `local-final-test-summary.json` preserve the subsequent
full run with ten failures; the deadlock fixture was corrected and the workflow rerun. Neither
file is the final delivery verdict.
