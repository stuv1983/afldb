# AFLDB Codex Debugging Skills

A focused collection of 11 Agent Skills for debugging and fixing the AFLDB codebase.

## Included skills

| Skill | Primary use |
|---|---|
| `afldb-bug-triage` | Unknown or cross-layer defects; routes diagnosis to the right layer |
| `afldb-nextjs-rsc-debug` | Next.js 15, RSC, Server Actions, rendering, revalidation |
| `afldb-db-query-debug` | PostgreSQL/application query correctness and SQL semantics |
| `afldb-data-integrity-debug` | Historical-statistics correctness, coverage, provenance, identity |
| `afldb-nl-search-debug` | Deterministic NL parser, plans, compilers, SQL and answer logic |
| `afldb-ui-playwright-debug` | Real browser reproduction, responsive UI, forms, hydration evidence |
| `afldb-admin-mutation-debug` | Admin writes, pending state, revalidation and live UI commit |
| `afldb-auth-security-debug` | Auth, beta gate, MFA, roles, sessions and fail-closed controls |
| `afldb-performance-debug` | Intermittent failures, stress, concurrency, query/runtime performance |
| `afldb-runtime-deploy-debug` | systemd, Caddy, standalone runtime, env, DB privileges and restore |
| `afldb-regression-gate` | Post-fix validation and blast-radius test selection |

## Recommended usage

Keep these as separate skill folders so Codex loads only the relevant workflow.

For a personal Codex installation on Windows, the normal global location is:

```text
%USERPROFILE%\.codex\skills\<skill-name>\SKILL.md
```

You can copy only the skills you want. This package intentionally does not create a repository `.agents` folder.

After installing, start a new Codex session if the skills are not discovered immediately.

## Suggested combinations

- Vague defect: `afldb-bug-triage`
- Wrong statistical result: `afldb-db-query-debug` + `afldb-data-integrity-debug`
- Wrong NL answer: `afldb-nl-search-debug`, then `afldb-db-query-debug` only if the plan is correct but SQL/result is wrong
- Hydration/form hang: `afldb-nextjs-rsc-debug` + `afldb-ui-playwright-debug`
- Admin action hangs after DB write: `afldb-admin-mutation-debug` + `afldb-nextjs-rsc-debug`
- Intermittent corpus/browser failure: `afldb-performance-debug` + the relevant NL/UI skill
- Before considering a fix complete: `afldb-regression-gate`

## Shared safety posture

The skills deliberately instruct Codex to:

- inspect before editing;
- work only in the current local working copy;
- avoid Git operations unless explicitly requested;
- avoid production mutation/credentials;
- preserve AFLDB's documented data invariants;
- avoid `tools/migration/**` and `*.py` changes unless explicitly requested;
- make the smallest defensible fix;
- prove fixes with targeted regression evidence.
