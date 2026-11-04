// ISSUE-333 second visibility probe (-r2): pure selector for ONE coach row inside a club page's coaching table. No I/O, no network.
//
// The first probe's selector read "the first <tr> containing the text 'Josh Carr'", which on /clubs/port-adelaide is the 2000-2010 PLAYER row
// (`Josh Carr | 2000-2010 | 124 | 65`), and it expected wins/draws/losses in separate cells on pages that print them as "7 - 16 - 0".
// This selector instead:
//   1. finds the coaching table by its header row (exactly the seven names Coach, Span, Games, W, D, L, Win %) and its caption
//      ("Every coach of <club>, with their record for the club"), as rendered by src/components/ClubCoachRecords.tsx;
//   2. finds the row INSIDE that table whose anchor href is exactly the coach profile path (e.g. /coaches/josh-carr-243);
//   3. reads each value by its header name, never by position or by "is this number somewhere in the row";
//   4. REFUSES (does not guess) when there is not exactly one such table or not exactly one such row, or the row has the wrong shape.

export const COACH_TABLE_HEADERS = ['Coach', 'Span', 'Games', 'W', 'D', 'L', 'Win %'] as const;
export const COACH_TABLE_CAPTION = /^Every coach of .+, with their record for the club$/;

export type Expected = { href: string; name: string; span: string; games: string; wins: string; draws: string; losses: string };

export type Refusal = {
  status: 'refused';
  /** `no-coaching-table` and `no-row` can change between requests (stale page); the other three are deterministic markup problems. */
  reason: 'no-coaching-table' | 'ambiguous-table' | 'no-row' | 'ambiguous-row' | 'bad-shape';
  detail: string;
};
export type RowResult = {
  status: 'row';
  headers: string[];
  cells: string[];
  byHeader: Record<string, string>;
  /** Header name -> the expected value it was compared with (only the compared columns). */
  compared: Record<string, { expected: string; seen: string; ok: boolean }>;
  matches: boolean;
};
export type Selection = Refusal | RowResult;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: "'", lsquo: "'", ndash: '–', mdash: '—' };
function decode(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m);
}
/** Cell text: React comment markers and the sort-indicator glyph span removed, tags stripped, entities decoded, whitespace collapsed. */
export function cellText(html: string): string {
  return decode(
    html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<span\b[^>]*\bsort-indicator\b[^>]*>[\s\S]*?<\/span>/g, '')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
}
const stripNonContent = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[\s\S]*?<\/script>/g, '').replace(/<style\b[\s\S]*?<\/style>/g, '');

function sameHeaderSet(headers: string[]): boolean {
  const want = [...COACH_TABLE_HEADERS].sort();
  const got = [...headers].sort();
  return got.length === want.length && got.every((h, i) => h === want[i]);
}

export function selectCoachRow(html: string, expected: Expected): Selection {
  const doc = stripNonContent(html);
  const tables = [...doc.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/g)].map((m) => m[1]);
  const coaching = tables.filter((t) => {
    const caption = /<caption\b[^>]*>([\s\S]*?)<\/caption>/.exec(t);
    if (!caption || !COACH_TABLE_CAPTION.test(cellText(caption[1]))) return false;
    const thead = /<thead\b[^>]*>([\s\S]*?)<\/thead>/.exec(t);
    if (!thead) return false;
    return sameHeaderSet([...thead[1].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((c) => cellText(c[1])));
  });
  if (coaching.length === 0) return { status: 'refused', reason: 'no-coaching-table', detail: `no table with the coaching caption and headers among ${tables.length} tables` };
  if (coaching.length > 1) return { status: 'refused', reason: 'ambiguous-table', detail: `${coaching.length} tables match the coaching caption and headers` };

  const table = coaching[0];
  if (/<table\b/.test(table)) return { status: 'refused', reason: 'bad-shape', detail: 'nested table inside the coaching table' };
  const headers = [...(/<thead\b[^>]*>([\s\S]*?)<\/thead>/.exec(table)?.[1] ?? '').matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((c) => cellText(c[1]));
  const tbody = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/.exec(table)?.[1] ?? '';
  const rows = [...tbody.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
  const hrefRe = /<a\b[^>]*?\shref="([^"]*)"/g;
  const hit = rows.filter((r) => [...r.matchAll(hrefRe)].some((a) => a[1] === expected.href));
  if (hit.length === 0) return { status: 'refused', reason: 'no-row', detail: `coaching table has ${rows.length} rows and none links to ${expected.href}` };
  if (hit.length > 1) return { status: 'refused', reason: 'ambiguous-row', detail: `${hit.length} rows link to ${expected.href}` };

  const cells = [...hit[0].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((c) => cellText(c[1]));
  if (cells.length !== headers.length) return { status: 'refused', reason: 'bad-shape', detail: `row has ${cells.length} cells for ${headers.length} headers` };
  const byHeader = Object.fromEntries(headers.map((h, i) => [h, cells[i]]));
  const want: Record<string, string> = { Coach: expected.name, Span: expected.span, Games: expected.games, W: expected.wins, D: expected.draws, L: expected.losses };
  const compared = Object.fromEntries(Object.entries(want).map(([h, e]) => [h, { expected: e, seen: byHeader[h], ok: byHeader[h] === e }]));
  return { status: 'row', headers, cells, byHeader, compared, matches: Object.values(compared).every((c) => c.ok) };
}

/** The exact expectation for this probe: Port Adelaide, Josh Carr, 2026, 23 games, 7 wins, 0 draws, 16 losses. */
export const EXPECTED_CARR: Expected = { href: '/coaches/josh-carr-243', name: 'Josh Carr', span: '2026', games: '23', wins: '7', draws: '0', losses: '16' };

/** Built-in fixture used by the probe's pre-flight (before any token exists) and by the unit test. */
export function fixtureClubPage(opts: { carrRow?: string; extraCarrRow?: boolean } = {}): string {
  const th = (l: string) => `<th scope="col" class="num" aria-sort="none"><button type="button" class="sort-control"><span class="sort-content">${l}<span class="sort-indicator" aria-hidden="true">↕</span></span></button></th>`;
  const carr = opts.carrRow ?? '<tr><td class="wide"><a href="/coaches/josh-carr-243">Josh Carr</a></td><td class="num nowrap">2026</td><td class="num">23</td><td class="num">7</td><td class="num">0</td><td class="num">16</td><td class="num">30.4</td></tr>';
  return `<html><body>
<table><caption>Players</caption><thead><tr><th>Player</th><th>Span</th><th>Games</th><th>Goals</th></tr></thead><tbody><tr><td><a href="/players/josh-carr-7">Josh Carr</a></td><td>2000<!-- -->–<!-- -->2010</td><td>124</td><td>65</td></tr></tbody></table>
<table><caption>Captains</caption><thead><tr><th>Season</th><th>Captain</th></tr></thead><tbody><tr><td>2004</td><td>Josh Carr</td><td>19</td><td>3</td><td>11</td></tr></tbody></table>
<table><caption>Every coach of Port Adelaide, with their record for the club</caption><thead><tr>${['Coach', 'Span', 'Games', 'W', 'D', 'L', 'Win %'].map(th).join('')}</tr></thead><tbody>
<tr><td class="wide"><a href="/coaches/ken-hinkley-101">Ken Hinkley</a></td><td class="num nowrap">2013–2025</td><td class="num">1<!-- -->,<!-- -->20</td><td class="num">1</td><td class="num">0</td><td class="num">1</td><td class="num">50.0</td></tr>
${carr}${opts.extraCarrRow ? carr : ''}
</tbody></table></body></html>`;
}

/** Throws if the selector does not behave as specified. The probe calls this BEFORE it creates any token. */
export function selfTest(): void {
  const good = selectCoachRow(fixtureClubPage(), EXPECTED_CARR);
  if (good.status !== 'row' || !good.matches || good.byHeader['Win %'] !== '30.4') throw new Error('selector self-test: good fixture was not matched');
  const wrong = selectCoachRow(fixtureClubPage({ carrRow: '<tr><td><a href="/coaches/josh-carr-243">Josh Carr</a></td><td>2026</td><td>22</td><td>7</td><td>0</td><td>15</td><td>1</td></tr>' }), EXPECTED_CARR);
  if (wrong.status !== 'row' || wrong.matches) throw new Error('selector self-test: wrong values were accepted');
  const dup = selectCoachRow(fixtureClubPage({ extraCarrRow: true }), EXPECTED_CARR);
  if (dup.status !== 'refused' || dup.reason !== 'ambiguous-row') throw new Error('selector self-test: ambiguous rows were not refused');
  if (selectCoachRow('<html></html>', EXPECTED_CARR).status !== 'refused') throw new Error('selector self-test: empty page was not refused');
}
