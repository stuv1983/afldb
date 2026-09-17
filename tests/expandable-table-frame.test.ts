import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { ExpandableTableFrame } from '@/components/ExpandableTableFrame';

/**
 * AFLDB-ISSUE-172 — the reusable expanded-table primitive's static render
 * contract: the collapsed markup an initial server render produces.
 *
 * Rendered via `createElement`, not called directly the way most fixtures
 * in this repo's `tests/*.test.ts` convention are (`Component({...props})`
 * fed straight to `renderToStaticMarkup`): those are plain Server
 * Components with no hooks of their own, so invoking them as an ordinary
 * function works. This component keeps real React state (`useState`,
 * `useEffect`, `useId`), which needs React's actual render dispatcher —
 * only active when React itself calls the function, i.e. via a real
 * element, not a bare JS call.
 *
 * The interactive half (expanding, Escape-to-close, the focus trap,
 * body-scroll locking, focus restored to the trigger) needs a real mounted
 * DOM and keyboard/focus events, which this repo's `tests/*.test.ts`
 * convention does not provide (`vitest.config.mts` runs these in a plain
 * Node environment, `renderToStaticMarkup` only). That half is proved in
 * `tests/e2e/journeys.spec.ts`, the same split already used for
 * `SiteNav.tsx`'s "More" sheet (`tests/e2e/responsive-nav.spec.ts`).
 */
describe('ExpandableTableFrame — collapsed initial render', () => {
  it('renders its children unchanged, with no dialog role until expanded', () => {
    const html = renderToStaticMarkup(
      createElement(ExpandableTableFrame, { title: 'Coaches', children: 'the table content' }),
    );
    expect(html).toContain('the table content');
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('aria-modal');
  });

  it('offers the "Expand table" control, collapsed', () => {
    const html = renderToStaticMarkup(
      createElement(ExpandableTableFrame, { title: 'Coaches', children: null }),
    );
    expect(html).toContain('Expand table');
    expect(html).not.toContain('Close expanded view');
    expect(html).toContain('aria-expanded="false"');
  });

  it('points aria-controls at the id of the region it toggles', () => {
    const html = renderToStaticMarkup(
      createElement(ExpandableTableFrame, { title: 'Coaches', children: 'rows' }),
    );
    const controls = html.match(/aria-controls="([^"]+)"/)?.[1];
    expect(controls).toBeTruthy();
    expect(html).toContain(`id="${controls}"`);
  });
});
