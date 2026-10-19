# legacy/offline -- quarantined offline tools

**Offline only. Never scheduled. Never imported by the application. Never wired to an admin button.**

This directory holds tools that AFLDB V2 retired from runtime but kept as diagnostic evidence
(plan D10, ADR 0010, review resolution R-006). Governing documents:

- `docs/v2/legacy-disposition.md` -- what is quarantined, what stays, and why;
- `docs/v2/adr/0010-legacy-disposition.md` -- the decision.

## What is here

| Path | What it is | Why it is kept |
|---|---|---|
| `tools/current-season/update-current-season.ts` | The Squiggle / Kali current-season refresh CLI | The only reader of the staged Squiggle/Kali observations (`staging.external_current_matches`), kept as diagnostic evidence for AFLDB-ISSUE-122/128. Squiggle and Kali are retired sources. |

## Rules (enforced by `tests/v2-module-boundaries.test.ts`)

1. Only `legacy/**` may import `legacy/**` (ESLint `no-restricted-imports` and the boundary checker).
2. No `package.json` script and nothing under `deploy/` (systemd units, timers, shell scripts,
   Caddy, supervisor) may reference `legacy/`.
3. Nothing under `src/` or `packages/*/src/` may import `legacy/**`; the public web layer
   (`src/app` except the admin tree, and `src/components`) reaches nothing under `tools/` or `legacy/`.
4. A quarantined tool never gains a default source, a scheduler or a runtime caller. Changing that
   needs an owner decision recorded against ADR 0010.

## Running a quarantined tool deliberately

Run by hand, from the repository root, with the environment you intend (it reads `DATABASE_URL`
from `.env`). It stages observations only and cannot write canonical matches.

```text
npx tsx legacy/offline/tools/current-season/update-current-season.ts --report --year 2026
npx tsx legacy/offline/tools/current-season/update-current-season.ts --source squiggle --year 2026
```

There is no default `--source`: a refresh that does not name `squiggle`, `kali` or `all` is
refused. `npm run current-season:update` no longer runs the tool; it prints the retirement notice
and exits 1 (`tools/v2/retired-entry.ts`, registry `RETIRED_ENTRIES` in `@afldb/domain`).
