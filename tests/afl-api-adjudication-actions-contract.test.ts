import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Regression test for AFLDB-ISSUE-235 S8 V5: `actions.ts` is a `'use server'` module, and such a
 * module may only export async functions (plus types, which are erased at compile time) as
 * runtime values. It used to also re-export a plain object, `AFL_API_ADJUDICATION_INITIAL_STATE`
 * — legal TypeScript, but Next's Server Reference bundling rejects it at request time with
 * `Error: A "use server" file can only export async functions, found object`, so every submit of
 * `AflApiAdjudicationForm` 500'd. This proves the shape directly from source, not from a mocked
 * unit test that would not exercise the real bundling rule.
 */
describe('AFLDB-ISSUE-235 afl-api adjudication actions — "use server" export contract', () => {
  const root = process.cwd();
  const actionsPath = join(root, 'src/app/admin/player-links/afl-api/actions.ts');
  const formPath = join(root, 'src/app/admin/player-links/afl-api/AflApiAdjudicationForm.tsx');
  const actionsSource = readFileSync(actionsPath, 'utf-8');
  const formSource = readFileSync(formPath, 'utf-8');

  it('actions.ts is a real "use server" module', () => {
    expect(actionsSource.trimStart().startsWith("'use server';")).toBe(true);
  });

  it('every non-type top-level export in actions.ts is an async function', () => {
    const exportStatements = actionsSource.match(/^export\s+(?!type\b).+$/gm) ?? [];
    expect(exportStatements.length).toBeGreaterThan(0); // the file must still export something
    for (const statement of exportStatements) {
      expect(statement).toMatch(/^export async function\b/);
    }
  });

  it('AFL_API_ADJUDICATION_INITIAL_STATE is not exported from actions.ts', () => {
    expect(actionsSource).not.toMatch(/export\s*\{[^}]*AFL_API_ADJUDICATION_INITIAL_STATE/);
    expect(actionsSource).not.toMatch(/export\s+const\s+AFL_API_ADJUDICATION_INITIAL_STATE/);
  });

  it('AflApiAdjudicationForm.tsx defines its own initial state and does not import it from ./actions', () => {
    expect(formSource).toMatch(/const AFL_API_ADJUDICATION_INITIAL_STATE\s*:\s*AflApiAdjudicationActionState\s*=\s*\{\s*\}/);
    const actionsImport = formSource.match(/import\s*\{([^}]*)\}\s*from\s*'\.\/actions'/);
    expect(actionsImport).not.toBeNull();
    expect(actionsImport![1]).not.toContain('AFL_API_ADJUDICATION_INITIAL_STATE');
  });
});
