# ISSUE-316 v4 authorised execution — stopped before preflight

Owner accepted v4 validation and independent GO on 2026-10-25 Sydney and authorised one exact frozen production metadata-repair attempt, conditional on all gates. F-001 through F-005 accepted resolved for this execution path. F-006 LOW remains retained; package unchanged.

Final exact-byte verification PASS: 40 manifest members, eight external validation-evidence pins, Node/SSH runtime pins, manifest `829fc30ae553106baa2281710bb7ba5c9288ccd331c0e846e18ed408848ecf84`, decision `39e71a77aa6e26127369647ab2f09a9c25f53af3567567372dc1d86e04a913a2`, report `c36dc24a0d4fac7f5aa5374e7a5b0a6ed7f9442334cad390a4cf078322374712`. No prior attempt marker or execution directory existed. Exact reviewed manifest and review files are copied here.

At 2026-10-24T20:07:59.245Z (2026-10-25 Sydney), the separate fail-closed host observation STOPPED. Host identity was positively established as afldb-prod / arm. The first process producer, `sudo -n /usr/bin/ps -eww -o pid=,ppid=,comm=,args=`, failed: `sudo: a password is required`; SSH exit 1. No process observation is inferred from absent output. Systemd and PostgreSQL-session observations were not reached. Command arguments and credentials were not printed. Raw safe stdout/stderr, transport status and the submitted observation are retained.

The external launcher required a successful, well-formed observation before invoking the exact frozen wrapper. It stopped and did not retry. No production database connection, frozen preflight, wrapper, reviewed transaction or postcheck occurred. No ATTEMPT.json or package execution directory was created. The transaction attempt is unconsumed; no production write occurred. Protected production-state before/after evidence and linked audit identity are unavailable because execution was never reached. The note hash was verified locally only.

U3 remains unconfirmed; U4 Route B; Brownlow untouched; overall production NO-GO. No census, seal/rollover, successor activation, apply, deployment, rebuild, push or Brownlow write. The next production-readiness decision is not advanced.

Next action: owner resolves/adjudicates the failed noninteractive read-only host-observation privilege gate. No workaround, grant, password request, alternate producer or further production contact was attempted. Any later resumed execution must repeat every pre-execution gate; this report authorises no retry.

Changelog unchanged: this was a failed operational gate with no production or application behaviour change. ISSUE-316 remains OPEN.
