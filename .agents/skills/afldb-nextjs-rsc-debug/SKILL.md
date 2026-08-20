---
name: afldb-nextjs-rsc-debug
description: Diagnose and fix AFLDB Next.js 15 App Router, React 19, React Server Component, Server Action, route-handler, rendering, caching, revalidation, navigation, or client/server boundary defects. Use for stale UI, server/client divergence, unexpected remounts, form commits, route refresh problems, metadata/rendering faults, or RSC-specific regressions.
---

# AFLDB Next.js and RSC Debugging

Debug the application as a Next.js App Router application with React Server Components by default.

## Guardrails

- Work only in the local working copy.
- Inspect before editing.
- Do not run Git commands unless explicitly requested.
- Do not modify `tools/migration/**` or `*.py` unless explicitly requested.
- Do not use production credentials or mutate production data.
- Avoid blanket client-component conversions or broad cache/revalidation rewrites.

## Trace the render boundary

1. Identify the route under `src/app/`.
2. Map Server Components, Client Components, Server Actions, route handlers, and database calls involved.
3. Mark every `'use client'` and `'use server'` boundary in the failing path.
4. Determine whether the observed problem happens:
   - during server render;
   - during hydration;
   - after a client event;
   - while a Server Action is pending;
   - during navigation/refresh;
   - after revalidation causes a new tree to commit.

## Check common AFLDB failure modes

- A Server Action revalidates or redirects a tree that contains/unmounts the submitting form.
- A pending form or optimistic state depends on component identity that changes after revalidation.
- A Server Component returns data that differs between initial HTML and hydration.
- Client-only values such as time, random values, browser APIs, or unstable ordering enter initial render.
- Search params or URL state are interpreted differently on server and client.
- A database result has unstable ordering when ties exist.
- A Client Component receives non-serialisable or shape-changing props.
- Error/loading boundaries mask the real server-side exception.
- Revalidation is broader than the data dependency it is intended to refresh.

## Evidence

For hydration or commit defects, capture both:

- the server-rendered HTML/data state;
- the post-hydration DOM or browser console state.

A repeated-query test that passes does not disprove a varied-traffic or tree-shape-specific fault. Preserve the conditions of the real failing workload.

## Patch strategy

- Fix ownership at the smallest boundary.
- Prefer precise revalidation, stable keys, deterministic ordering, and stable serialisable props.
- Keep server-only data access on the server.
- Do not add `'use client'` merely to make an error disappear.
- Do not disable hydration warnings unless a difference is intentional and documented.
- When changing a Server Action, verify both database mutation and client commit.

## Validate

Use the narrowest applicable checks:

- targeted Vitest test;
- `npm run typecheck`;
- direct dev-server reproduction;
- Playwright for hydration, navigation, pending-state, and post-action rendering.

For mutation paths, verify four separate facts:

1. database changed as intended;
2. action returned;
3. pending state cleared;
4. rendered UI updated without a manual refresh.

Report any step that was not exercised.
