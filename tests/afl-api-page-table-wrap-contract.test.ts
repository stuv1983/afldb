import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Regression test for AFLDB-ISSUE-235 S8 phone validation: the AFL API provider list and
 * detail pages applied `className="table-wrap"` directly to `<table>` instead of wrapping
 * the table in a `.table-wrap` container div. `src/styles/globals.css` documents
 * `.table-wrap` as the scrolling CONTAINER — `overflow-x: auto` on the container is what
 * keeps a wide table's horizontal scroll inside itself instead of the page body; putting
 * the class on the `<table>` element itself does not create that containment, which is
 * what produced the observed root overflow on a phone viewport (P2/P4).
 */
describe('AFLDB-ISSUE-235 afl-api pages — .table-wrap container contract', () => {
  const root = process.cwd();
  const listPath = join(root, 'src/app/admin/player-links/afl-api/page.tsx');
  const detailPath = join(root, 'src/app/admin/player-links/afl-api/[providerId]/page.tsx');
  const listSource = readFileSync(listPath, 'utf-8');
  const detailSource = readFileSync(detailPath, 'utf-8');

  function tableWrapAssertions(source: string, label: string, expectedTableCount: number) {
    it(`${label}: no <table> carries className="table-wrap" directly`, () => {
      expect(source).not.toMatch(/<table\s+className=["']table-wrap["']/);
    });

    it(`${label}: every <table> is wrapped in a <div className="table-wrap">`, () => {
      const tableOpenTags = source.match(/<table\b[^>]*>/g) ?? [];
      expect(tableOpenTags.length).toBe(expectedTableCount);

      // For each <table> tag, the nearest preceding JSX-element open tag must be the
      // `.table-wrap` div — i.e. nothing else sits between the wrapper and the table.
      const wrapperThenTable = /<div\s+className=["']table-wrap["']>\s*<table\b/g;
      const matches = source.match(wrapperThenTable) ?? [];
      expect(matches.length).toBe(expectedTableCount);
    });
  }

  tableWrapAssertions(listSource, 'list page', 1);
  tableWrapAssertions(detailSource, 'provider-detail page', 3);
});
