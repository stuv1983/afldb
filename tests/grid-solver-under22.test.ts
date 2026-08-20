import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    text: strings.join('?').replace(/\s+/g, ' ').trim(),
    values,
  })),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/db/client', () => ({ sql: mocks.sql }));

import { compileAxis } from '@/db/queries/grid-solver';

describe('22Under22 grid criterion', () => {
  it('compiles to the fixed award slug and trusts only linked player ids', () => {
    const fragment = compileAxis({ builder: 'under_22_selection', params: {} }) as unknown as {
      text: string;
      values: unknown[];
    };

    expect(fragment.values).toEqual([]);
    expect(fragment.text).toContain("a.slug = '22-under-22'");
    expect(fragment.text).toContain('w.player_id IS NOT NULL');
    expect(fragment.text).toContain("w.link_status_value IN ('unique', 'resolved')");
  });

  it('gives super admins a direct player-links queue preset for this source', () => {
    const page = readFileSync(
      join(process.cwd(), 'src', 'app', 'admin', 'player-links', 'page.tsx'),
      'utf8',
    );
    expect(page).toContain('table=award_winners&q=22%20Under%2022');
    expect(page).toContain('>22Under22</');
  });
});
