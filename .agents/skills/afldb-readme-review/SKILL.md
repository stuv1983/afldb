---
name: afldb-readme-review
description: Review the AFLDB codebase and replace README.md with a new README derived from the current repository. Preserve the existing README as docs/archive/README.old.md. Work only in the local working directory and do not make Git changes.
---

# AFLDB README Review and Replacement

Use this skill when the AFLDB README needs to be reviewed against the current codebase and replaced with an accurate, current README.

## Scope

Work only in the current local AFLDB working directory.

The task is to:

1. Review the existing `README.md`.
2. Review the current repository structure, source code, configuration, scripts, tests, deployment files, and documentation needed to understand the project.
3. Rename the existing `README.md` to `docs/archive/README.old.md`.
4. Create a new `README.md` based on the repository as it exists now.
5. Preserve useful information from the old README only when it is still supported by the current codebase.

The existing README is a reference source only. Do not treat it as authoritative when it conflicts with the code.

## Hard rules

- Work only in the local working directory.
- Do not edit files outside the repository.
- Do not use the Linux/dev server as the editing location.
- Do not make Git changes.
- Do not run `git add`, `git commit`, `git push`, `git pull`, `git checkout`, `git switch`, `git reset`, `git restore`, `git clean`, `git stash`, `git merge`, `git rebase`, or create/delete branches or tags.
- Do not modify `.git`.
- Read-only Git metadata is not required for this task. Avoid Git entirely unless the user explicitly asks for it.
- Do not modify application source code.
- Do not fix bugs discovered during the review.
- Do not change package versions, configuration, tests, deployment files, database files, migrations, scripts, or generated artifacts.
- Only rename the existing README and create the replacement README.
- Do not delete the old README content. Preserve it as `docs/archive/README.old.md`.
- Do not overwrite an existing `docs/archive/README.old.md` without first reporting that it already exists.
- Do not invent features, commands, architecture, data coverage, deployment behavior, or environment variables.
- If something cannot be verified from the repository, either omit it or label it clearly as unverified.
- Never place passwords, access codes, API keys, database credentials, SMTP credentials, secrets, private URLs, or session material in the README.

## Repository review

Before writing the new README, inspect enough of the repository to understand the actual application.

At minimum review, where present:

- `README.md`
- `package.json`
- lockfile
- `src/`
- `src/app/`
- `src/components/`
- `src/search/`
- `src/db/`
- `tests/`
- `tools/`
- `deploy/`
- `docs/`
- configuration files
- Playwright configuration
- Vitest configuration
- TypeScript configuration
- Next.js configuration
- environment-variable examples
- database/schema files
- service/deployment files
- scripts referenced by `package.json`

Use targeted searches rather than blindly reading every file.

Important areas to establish include:

- what AFLDB is;
- supported competitions/data;
- application architecture;
- natural-language search architecture;
- database;
- framework/runtime;
- local development workflow;
- test commands;
- stress/UI test tooling;
- deployment model;
- important project invariants;
- repository layout;
- environment/configuration requirements;
- known limitations that belong in public project documentation.

## Source-of-truth priority

When information conflicts, use this order:

1. Current executable source/configuration
2. Current package scripts and test configuration
3. Current database/schema/deployment code
4. Current project documentation
5. Existing `README.md`

Do not copy stale README claims merely because they are already documented.

## Existing README review

Review the current `README.md` and classify its useful content internally as:

- still accurate;
- partially accurate;
- stale;
- unsupported by the current repository;
- useful but requiring rewritten wording.

Do not produce a separate review document unless the user asks for one.

The goal is a replacement README, not an annotated edit of the old README.

## Rename procedure

Before creating the replacement:

1. Confirm `README.md` exists.
2. Confirm whether `docs/archive/README.old.md` already exists.
3. If `docs/archive/README.old.md` does not exist:
   - rename `README.md` to `docs/archive/README.old.md`.
4. If `docs/archive/README.old.md` already exists:
   - stop before overwriting it;
   - report the conflict to the user.

Use a filesystem rename, not Git commands.

After the rename:

- `docs/archive/README.old.md` must contain the original README unchanged.
- create a new `README.md`.

## New README requirements

Write the new README for someone encountering AFLDB for the first time.

Prefer concise, factual documentation over marketing language.

A good structure is:

# AFLDB

Short description of the project and its purpose.

## What it covers

Describe the competitions, historical range, and major data areas only when verified.

## Key features

Document major user-facing and technical capabilities that are present now.

## Natural-language search

Explain the deterministic search pipeline at a useful level.

Where verified, describe the flow such as:

`canonicalise -> parse -> plan -> validate -> compile -> PostgreSQL -> answer -> describe/render`

Make clear that the search is deterministic/LLM-free if the current code confirms this.

## Tech stack

List only currently used technologies and versions that can be verified.

## Architecture

Briefly explain important application, search, database, and deployment boundaries.

## Repository structure

Provide a compact directory map of important folders.

Do not list every folder.

## Requirements

Document actual runtime/development prerequisites.

## Configuration

Document environment-variable names and purpose where safe.

Never include real secret values.

Use placeholders only when needed.

## Development

Use commands from the current `package.json`.

Include setup/run commands only when verified.

## Testing

Document the real test commands.

Where present, distinguish:

- type checking;
- unit/regression tests;
- integration tests;
- NL stress tests;
- NL UI tests;
- comparison/audit tooling.

If integration tests contain a safety guard requiring a test database suffix such as `_test`, document that safeguard.

## Database and data notes

Document important verified data rules/invariants where useful, such as:

- NULL versus zero semantics;
- authoritative data sources within the schema;
- stable identifiers;
- tie handling;
- explicit historical club identity handling.

Only include rules supported by the current repository.

## Deployment

Describe the current deployment model only to the level supported by repository files.

Avoid publishing private infrastructure details, internal IP addresses, passwords, access codes, or operational secrets.

## Data sources / acknowledgements

Preserve or add acknowledgements only when the repository supports them.

Do not make legal conclusions that are not already intentionally documented.

## Status / limitations

Mention important public-facing limitations where they help users understand the project.

Do not dump the internal issue ledger into the README.

## Contributing / development notes

Only include this section if the repository currently supports a meaningful contribution workflow.

Do not invent one.

## Licence

Only state a licence if a licence file or current project documentation clearly establishes it.

If no licence exists, do not invent one.

## Writing style

Use:

- Australian English;
- direct technical language;
- short paragraphs;
- useful headings;
- concise tables where they genuinely improve clarity;
- fenced code blocks for commands;
- backticks for file paths, commands, environment variables, and code identifiers.

Avoid:

- exaggerated marketing claims;
- emojis unless already part of deliberate project style;
- filler;
- fake badges;
- unverified performance claims;
- obsolete screenshots;
- enormous directory listings;
- internal troubleshooting notes;
- issue-ledger history;
- credentials or private operational details.

## Verification before finishing

After creating `README.md`, verify:

1. `docs/archive/README.old.md` exists.
2. `docs/archive/README.old.md` still contains the original README content unchanged.
3. New `README.md` exists.
4. Commands shown in the README exist in `package.json` or the repository.
5. Referenced paths exist.
6. Environment-variable names are accurate.
7. No secrets were copied into the README.
8. No application/source/configuration files were modified.
9. No Git mutation was performed.

Optionally run harmless read-only checks needed to validate README claims.

Do not run broad application test suites merely to write documentation unless the user explicitly asks.

## Reporting

At completion report:

- that the existing README was preserved as `docs/archive/README.old.md`;
- that a new `README.md` was created;
- the main areas reviewed;
- any claims intentionally omitted because they could not be verified;
- the exact files changed.

Expected changed files:

- `README.md`
- `docs/archive/README.old.md`

If anything else changed, stop and explain why before proceeding.

Do not commit or stage the result.

The user will review the local files before any Git action.
