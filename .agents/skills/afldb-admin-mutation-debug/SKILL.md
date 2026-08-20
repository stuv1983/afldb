---
name: afldb-admin-mutation-debug
description: Diagnose and fix AFLDB admin Server Actions, mutations, forms, pending states, revalidation, redirects, role-gated admin surfaces, CSV/intake actions, player-link review actions, or cases where the database changes but the admin UI hangs or fails to update.
---

# AFLDB Admin Mutation Debugging

Treat a successful database write and a successful UI transaction as separate requirements.

## Guardrails

- Work only in the local working copy.
- Inspect before editing.
- Do not run Git commands unless explicitly requested.
- Never test irreversible mutations against production.
- Use reversible development/test targets where possible.
- Preserve role and MFA checks.
- Do not bypass the statistical import/write path to make a mutation convenient.

## Trace the complete transaction

For the failing action identify:

1. form/client component;
2. Server Action;
3. authorisation check;
4. validation;
5. database role/connection used;
6. write/query;
7. audit write if applicable;
8. `revalidatePath`, `revalidateTag`, redirect, or refresh;
9. component tree expected to re-render;
10. pending/error/success state in the browser.

## Verify four outcomes independently

A mutation is healthy only if all relevant outcomes hold:

1. database state changed correctly;
2. Server Action returned or redirected correctly;
3. client pending state cleared;
4. UI reflected the new state without an unnecessary manual refresh.

A write that succeeds while the form remains pending is still a product defect.

## Revalidation hazards

Before changing revalidation globally, test whether the failure depends on the revalidated tree unmounting the submitting form or changing component identity. Compare a healthy admin action using the same pattern.

Prefer the narrowest invalidation that refreshes the data dependency. Do not perform a blanket rewrite of all self-revalidation patterns based on one failing surface.

## Player-link review

Preserve:

- trusted/untrusted identity states;
- append-only audit history;
- original reader-tip text;
- deliberate human resolution;
- later source refresh retaining a manual link where designed.

Do not automatically resolve `ambiguous`, `unmatched`, or `implausible` rows by name similarity.

## Regression

For each changed action, test the actual browser workflow when practical. If a destructive action has no safe target, do not fabricate live verification; cover the server/action logic with tests and report the browser gap explicitly.
