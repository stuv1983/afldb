---
name: afldb-ui-playwright-debug
description: Reproduce and fix AFLDB browser/UI defects with Playwright, including responsive behaviour, forms, filters, search interactions, navigation, loading/pending states, accessibility-visible behaviour, console errors, hydration symptoms, and differences between server output and the real rendered page.
---

# AFLDB UI and Playwright Debugging

Use a real browser when the bug depends on user interaction or rendered state.

## Guardrails

- Work only in the local working copy.
- Inspect before editing.
- Do not run Git commands unless explicitly requested.
- Do not use destructive admin actions against production.
- Do not paper over browser errors by suppressing console output.
- Prefer role/label/text selectors over fragile CSS selectors.

## Reproduce the user journey

Record:

- URL and query string;
- viewport/device class;
- exact interaction sequence;
- expected visible state;
- actual visible state;
- console/page errors;
- failed network requests;
- whether a reload changes the outcome.

If desktop passes and mobile fails, preserve the mobile viewport in the regression.

## Capture evidence before fixing

For intermittent faults collect:

- screenshot at failure;
- console messages;
- page errors;
- relevant network status;
- DOM/visible text;
- server-rendered HTML when hydration is suspected;
- same-question or same-route clean control where useful.

Do not reduce a varied corpus/concurrency problem to one repeated input unless evidence shows the input is irrelevant.

## Distinguish UI from server failure

Check whether:

- the server action/query returned correctly;
- the browser received the expected response;
- pending state cleared;
- navigation/revalidation completed;
- the DOM committed the returned state;
- only presentation is stale.

## Patch strategy

- Fix the component/state/lifecycle boundary that owns the defect.
- Preserve keyboard and accessible-name behaviour.
- Keep URL-backed filters shareable.
- Avoid arbitrary sleeps/timeouts in tests.
- Wait on observable product state, not implementation timing.
- Do not make a test pass by weakening its assertion unless the old assertion was factually wrong.

## Regression

Add the shortest Playwright test that proves the user-visible contract. For admin forms, verify mutation return, pending clearance, and live UI update separately. For search, verify the rendered answer, not merely an HTTP 200.

Run `npm run typecheck` for TS/TSX changes and the smallest relevant E2E target before broadening.
