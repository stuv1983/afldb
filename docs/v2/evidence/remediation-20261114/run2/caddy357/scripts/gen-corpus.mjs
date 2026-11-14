// caddy357: build the test corpora. usage: node gen-corpus.mjs <src/app dir> <sitemap-urls.txt> <outdir>
// Writes legit.tsv (all must pass unchanged), deny.tsv (all must be refused), legit-head.tsv, deny-head.tsv.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [appDir, sitemapFile, outDir] = process.argv.slice(2);

// ---- route patterns of the app, from the file tree --------------------------------------------------------------
function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc); else acc.push(p);
  }
  return acc;
}
const patterns = new Set();
for (const f of walk(appDir)) {
  const rel = f.slice(appDir.length).replace(/\\/g, '/');
  const m = /^(.*)\/(page\.tsx|route\.ts|sitemap\.ts|robots\.ts|opengraph-image\.tsx|icon\.svg)$/.exec(rel);
  if (!m) continue;
  let pat = m[1] || '/';
  if (m[2] === 'sitemap.ts') pat = `${m[1]}/sitemap.xml`;
  if (m[2] === 'robots.ts') pat = `${m[1]}/robots.txt`;
  if (m[2] === 'opengraph-image.tsx') pat = `${m[1]}/opengraph-image`;
  if (m[2] === 'icon.svg') pat = `${m[1]}/icon.svg`;
  patterns.add(pat || '/');
}

// ---- one legitimate instance (or more) of every pattern ----------------------------------------------------------
const TOKEN = 'dGVzdC1pbnZpdGUtdG9rZW4tMDEyMzQ1Njc4OWFiY2RlZg';          // 43-char base64url, the invite token shape
const named = {
  '/players/[slug]': ['/players/scott-pendlebury-11724', '/players/gary-ablett-jr-5', '/players/x-2147483647', '/players/a-1'],
  '/players/[slug]/matches': ['/players/scott-pendlebury-11724/matches', '/players/scott-pendlebury-11724/matches?season=2024&page=2'],
  '/matches/[id]': ['/matches/1', '/matches/17274', '/matches/99999', '/matches/12345'],
  '/seasons/[year]': ['/seasons/1897', '/seasons/2024', '/seasons/2026', '/seasons/2100'],
  '/brownlow/[year]': ['/brownlow/1924', '/brownlow/2024', '/brownlow/2100'],
  '/clubs/[slug]': ['/clubs/carlton', '/clubs/greater-western-sydney', '/clubs/compare-x'],
  '/venues/[slug]': ['/venues/mcg', '/venues/docklands'],
  '/venues/[slug]/matches': ['/venues/mcg/matches', '/venues/mcg/matches?season=2024'],
  '/honour-teams/[slug]': ['/honour-teams/afl-vfl-team-of-the-century'],
  '/awards/[slug]': ['/awards/all-australian', '/awards/rising-star?season=2024'],
  '/awards/[slug]/[season]': ['/awards/all-australian/2024', '/awards/rising-star/1999'],
  '/records/[category]': ['/records/most-games', '/records/most-goals-in-a-season?club=carlton'],
  '/coaches/[slug]': ['/coaches/alastair-clarkson-12', '/coaches/some-name-3?x=1'],
  '/draft/[year]': ['/draft/2024', '/draft/1986'],
  '/aflw/clubs/[code]': ['/aflw/clubs/CAR'],
  '/aflw/matches/[key]': ['/aflw/matches/2024-s1-r01-g1'],
  '/aflw/players/[slug]': ['/aflw/players/Aasta_O%2527Connor', '/aflw/players/Aasta_O%27Connor', '/aflw/players/Some_Name'],
  '/aflw/seasons/[key]': ['/aflw/seasons/2024'],
  '/api/coaches/[id]/opponent-record': ['/api/coaches/12/opponent-record', '/api/coaches/12/opponent-record?opponent=carlton'],
  '/admin/invite/[token]': [`/admin/invite/${TOKEN}`],
  '/admin/audit/entity/[table]/[rowId]': ['/admin/audit/entity/players/11724'],
  '/admin/awards/hall-of-fame/[id]': ['/admin/awards/hall-of-fame/3'],
  '/admin/awards/honour-teams/[id]': ['/admin/awards/honour-teams/3'],
  '/admin/awards/winners/[id]': ['/admin/awards/winners/3'],
  '/admin/brownlow/[season]': ['/admin/brownlow/2024'],
  '/admin/brownlow/[season]/[round]': ['/admin/brownlow/2024/3'],
  '/admin/coaches/[id]': ['/admin/coaches/12'],
  '/admin/content/asset/[...path]': ['/admin/content/asset/img/a.png', '/admin/content/asset/a/b/c.jpg'],
  '/admin/draft/[id]': ['/admin/draft/9'],
  '/admin/fixtures/[season]/[fixtureKey]': ['/admin/fixtures/2026/2026-r1-x-v-y'],
  '/admin/fixtures/[season]': ['/admin/fixtures/2026'],
  '/admin/fixtures/[season]/new': ['/admin/fixtures/2026/new'],
  '/admin/nl-search/[id]': ['/admin/nl-search/55'],
  '/admin/operations/awards/[id]': ['/admin/operations/awards/7'],
  '/admin/player-links/afl-api/[providerId]': ['/admin/player-links/afl-api/CD_I1234'],
  '/admin/records/after-the-siren/[id]': ['/admin/records/after-the-siren/4'],
  '/admin/records/first-kick-goal/[id]': ['/admin/records/first-kick-goal/4'],
  '/admin/season-lists/[season]': ['/admin/season-lists/2026'],
  '/admin/season-lists/[season]/[club]': ['/admin/season-lists/2026/carlton'],
  '/admin/submissions/[id]': ['/admin/submissions/8'],
  '/sitemap-index.xml': ['/sitemap-index.xml'],
  '/sitemap.xml': ['/sitemap.xml', '/sitemap/0.xml', '/sitemap/1.xml', '/sitemap/100.xml', '/sitemap/200.xml', '/sitemap/300.xml'],
  '/beta/verify': ['/beta/verify?token=PROBE-MAGIC-aaa111'],
  '/robots.txt': ['/robots.txt'],
  '/': ['/'],
};
const legit = [];
const covered = [];
for (const pat of [...patterns].sort()) {
  if (named[pat]) { legit.push(...named[pat]); covered.push(pat); continue; }
  if (/\[/.test(pat)) { console.error(`UNCOVERED dynamic pattern: ${pat}`); process.exitCode = 2; continue; }
  legit.push(pat); covered.push(pat);                                   // a static route is its own instance
}
console.error(`route patterns in src/app: ${patterns.size}; instantiated: ${covered.length}`);
writeFileSync(`${outDir}/route-patterns.txt`, `${[...patterns].sort().join('\n')}\n`);

// ---- extras that are not app routes but must pass -----------------------------------------------------------------
const extras = [
  '/_next/static/chunks/app/players/%5Bslug%5D/page-0123456789abcdef.js',
  '/_next/static/chunks/app/seasons/%5Byear%5D/page-0123456789abcdef.js',
  '/_next/static/css/0123456789abcdef.css', '/_next/static/media/font.woff2',
  '/_next/image?url=%2Ffavicon.svg&w=64&q=75', '/_next/data/BUILDID/players/x-1.json',
  '/api/health', '/api/search/autocomplete?q=pendlebury', '/favicon.ico', '/apple-touch-icon.png', '/icon-192.png',
  '/samples/x.csv', '/search?q=Michael+Tuck', '/search?q=who+kicked+the+most+goals+in+a+season+for+carlton&page=2',
  '/players', '/players?page=3&sort=games', '/clubs', '/seasons', '/brownlow', '/venues', '/awards', '/records',
  '/players/compare', '/players/compare?a=1&b=2', '/clubs/compare', '/clubs/compare?a=carlton&b=essendon',
  '/records/after-the-siren', '/records/father-son', '/records/first-kick-goal', '/records/family', '/records/coaches',
  '/match-search?season=2024', '/advanced-search', '/grid-solver', '/aflw', '/aflw/players', '/aflw/players?q=o%27connor',
  '/beta', '/beta?from=%2Fplayers', '/admin/login', '/admin',
];
legit.push(...extras);

// sitemap segments: every URL, origin stripped
const sm = readFileSync(sitemapFile, 'utf8').split('\n').filter(Boolean);
const smPaths = [];
for (const u of sm) {
  const m = /^https?:\/\/[^/]+(\/.*)?$/.exec(u);
  smPaths.push(m ? (m[1] ?? '/') : u);
}
// AFLW %27 slugs: both the linked form (%2527) and the single-encoded form (%27)
const aflw = smPaths.filter((p) => p.startsWith('/aflw/players/') && p.includes('%2527'));
const aflw27 = aflw.map((p) => p.replace('%2527', '%27'));
console.error(`sitemap URLs: ${smPaths.length}; AFLW %2527 slugs: ${aflw.length}`);

// query strings appended to every page instance
const queries = ['?q=a%20b&page=2&sort=name', '?_rsc=1abcd', '?season=2024&club=carlton&x=%2F..%2F%00', '?'];
const base = [...new Set([...legit.map((p) => p.split('?')[0])])].filter((p) => !p.startsWith('/_next/') && !p.includes('.xml'));
const withQ = [];
for (const p of base) for (const q of queries) withQ.push(p + q);

const all = [...new Set([...legit, ...smPaths, ...aflw27, ...withQ])];
// every byte outside the printable ASCII range is percent-encoded so the raw request target is valid HTTP
const enc = (t) => [...Buffer.from(t, 'utf8')].map((b) => (b < 0x21 || b > 0x7e ? `%${b.toString(16).toUpperCase().padStart(2, '0')}` : String.fromCharCode(b))).join('');
const row = (m, t, e) => `${m}\t${enc(t)}\t${e}`;
writeFileSync(`${outDir}/legit.tsv`, `${all.map((t) => row('GET', t, 'pass')).join('\n')}\n`);
writeFileSync(`${outDir}/legit-head.tsv`, `${[...new Set([...legit, ...aflw, ...aflw27])].map((t) => row('HEAD', t, 'pass')).join('\n')}\n`);
writeFileSync(`${outDir}/legit-post.tsv`, `${['/players/scott-pendlebury-11724', '/seasons/2024', '/api/early-access', '/beta', '/admin/login'].map((t) => row('POST', t, 'pass')).join('\n')}\n`);
console.error(`legit GET: ${all.length}`);

// ---- bypass / junk variants that must be refused -----------------------------------------------------------------
const deny = new Set();
function addVariants(prefix, canon, extraBad) {
  // prefix like '/seasons', canon is the canonical last segment like '2024'
  const seg = canon;
  const c1 = prefix.charCodeAt(1); // first letter of the route name, for encoded-prefix aliases
  const bad = [
    `${prefix}/${seg}/`, `${prefix}//${seg}`, `/${prefix}/${seg}`, `/.${prefix}/${seg}`, `/x/..${prefix}/${seg}`, `${prefix}/${seg}/x/..`, `//${prefix}/${seg}`,
    `/${prefix.slice(1)}//${seg}`, `/${prefix.slice(1)}/./${seg}`, `${prefix}/./${seg}`, `${prefix}/x/../${seg}`, `${prefix}/${seg}/.`, `${prefix}/${seg}/..`,
    `${prefix}/${seg}/x`, `${prefix}/${seg}/.x`, `${prefix}/${seg}.`, `${prefix}/${seg}..`, `${prefix}/${seg}.json`, `${prefix}/${seg}.rsc`, `${prefix}/${seg}.html`,
    `${prefix}/${seg}.txt`, `${prefix}/${seg}.segments/_tree.segment.rsc`, `${prefix}/${seg}/__next._tree.txt`,
    `${prefix}%2F${seg}`, `${prefix}/${seg}%2F`, `${prefix}/${seg}%2f`, `${prefix}%2f${seg}`, `${prefix}/${seg}%2F..`, `${prefix}/..%2F${prefix.slice(1)}/${seg}`,
    `${prefix}/${seg};a=1`, `${prefix}/${seg};jsessionid=x`, `${prefix}/${seg}%3Ba=1`, `${prefix}/${seg}%3b`, `${prefix}/;/${seg}`,
    `${prefix}/${seg}+`, `${prefix}/+${seg}`, `${prefix}/-${seg}`, `${prefix}/${seg}%2B`, `${prefix}/%2B${seg}`, `${prefix}/%2b${seg}`, `${prefix}/${seg}%20`, `${prefix}/%20${seg}`,
    `${prefix}/${seg}%00`, `${prefix}/${seg}%00.html`, `${prefix}/${seg}%0a`, `${prefix}/${seg}%0d%0a`, `${prefix}/${seg}%09`, `${prefix}/%00${seg}`,
    `${prefix}/${seg}%5C`, `${prefix}%5C${seg}`, `${prefix}/${seg}%u0030`, `${prefix}/${seg}%`, `${prefix}/${seg}%2`, `${prefix}/${seg}%zz`, `${prefix}/%`,
    `${prefix}/%25${seg}`, `${prefix}/%2525${seg}`,
    `/%${c1.toString(16)}${prefix.slice(2)}/${seg}`, `/%${c1.toString(16).toUpperCase()}${prefix.slice(2)}/${seg}`, `/%25${c1.toString(16)}${prefix.slice(2)}/${seg}`,
    `/%${(c1 - 32).toString(16)}${prefix.slice(2)}/${seg}`,
    `${prefix}/${seg.toUpperCase()}`.replace(`${prefix}/${seg}`, ""),
    `${prefix}/${seg}/${seg}`, `${prefix}/${seg}//`, `${prefix}/${seg}/?x=1`, `${prefix}/ /${seg}`.replace(' ', '%20'),
    `${prefix}/%C0%AF${seg}`, `${prefix}/%c0%ae${seg}`, `${prefix}/%E0%80%AF${seg}`, `${prefix}/%F0%80%80%AF${seg}`, `${prefix}/%C0%80${seg}`, `${prefix}/%C1%9C${seg}`,
    `${prefix}/${seg}%C0%AE%C0%AE`, `${prefix}/${seg}%EF%BC%8F`, `${prefix}/%EF%BC%92${seg}`,
    `${prefix}/${seg}?x=1`.replace(`/${seg}?x=1`, `%3Fx=1/${seg}`), `${prefix}/${seg}%3Fx=1`, `${prefix}/${seg}%23`, `${prefix}/${seg}%23x`,
    ...extraBad,
  ].filter((b) => b && b !== `${prefix}/${seg}`);   // seg.toUpperCase() is the canonical segment itself for digits
  for (const b of bad) deny.add(b);
  // a query string appended to a non-canonical path does not make it canonical
  for (const b of extraBad.concat([`${prefix}/${seg}/`, `${prefix}/%32${seg.slice(1)}`])) {
    deny.add(`${b}?x=1`); deny.add(`${b}?token=PROBE-DENY-aaa999`); deny.add(`${b}?`); deny.add(`${b}?/${prefix.slice(1)}/${seg}`);
  }
}
// percent-encode one character of the canonical segment, in every position, both hex cases
function encodedPositions(prefix, seg) {
  const out = [];
  for (let i = 0; i < seg.length; i += 1) {
    const hex = seg.charCodeAt(i).toString(16);
    out.push(`${prefix}/${seg.slice(0, i)}%${hex}${seg.slice(i + 1)}`);
    out.push(`${prefix}/${seg.slice(0, i)}%${hex.toUpperCase()}${seg.slice(i + 1)}`);
    out.push(`${prefix}/${seg.slice(0, i)}%25${hex}${seg.slice(i + 1)}`);
  }
  out.push(`${prefix}/${[...seg].map((c) => `%${c.charCodeAt(0).toString(16)}`).join('')}`);
  return out;
}
const numericBad = (n) => [
  `0${n}`, `00${n}`, `000${n}`, `0000${n}`, `+${n}`, `-${n}`, `${n}.0`, `${n}.`, `.${n}`, `${n}e0`, `${n}E0`, `0x${Number(n).toString(16)}`, `0X${Number(n).toString(16)}`, `0b1`, `0o7`,
  `${n}a`, `a${n}`, `${n}-`, `-${n}-`, `${n}x`, `${n}_1`, `1_${n}`, `${n}%`, `Infinity`, `NaN`, `null`, `undefined`, `true`, `-0`, `0`, `00`, '', `${n} `, ` ${n}`, `${n}${n}${n}${n}${n}${n}`,
  '9999999999999999999999', '2147483648', '4294967296', '9007199254740993', '1e3', '2.024e3', '١٢٣', '٢٠٢٤', '%D9%A2%D9%A0%D9%A2%D9%A4', 'a'.repeat(600), '1'.repeat(520),
];
// seasons / brownlow years: syntactically canonical but out of the app's range are also refused
for (const route of ['/seasons', '/brownlow']) {
  const bad = [...numericBad('2024'), '1896', '2101', '1000', '3000', '10000', '0001', '999'];
  addVariants(route, '2024', bad.map((b) => `${route}/${b}`).map((p) => p.replace(`${route}/${route}`, route)));
  for (const p of encodedPositions(route, '2024')) deny.add(p);
  for (const b of bad) deny.add(`${route}/${b}`);
}
// match ids: canonical but beyond the 5-digit cap are refused too
{
  const bad = [...numericBad('12345'), '100000', '999999', '2147483647', '123456'];
  addVariants('/matches', '12345', bad.map((b) => `/matches/${b}`));
  for (const p of encodedPositions('/matches', '12345')) deny.add(p);
  for (const b of bad) deny.add(`/matches/${b}`);
}
// player entity: slug-id
{
  const slug = 'scott-pendlebury'; const id = '11724';
  const bad = [
    `${slug}-0${id}`, `${slug}-00${id}`, `${slug}-+${id}`, `${slug}--${id}`.replace('--', '-+'), `${slug}-${id}.0`, `${slug}-${id}e0`, `${slug}-0x2dcc`, `${slug}-${id}a`, `${slug}-a${id}`,
    `${slug}-2147483648`, `${slug}-4294967296`, `${slug}-99999999999999`, `${slug}-0`, `${slug}-00`, `${slug}`, `${slug}-`, `-${id}`, `${id}`, `${slug}_${id}`, `${slug}${id}`,
    `Scott-Pendlebury-${id}`, `SCOTT-PENDLEBURY-${id}`, `scott-Pendlebury-${id}`, `scott-pendlebury-${id}%20`, `scott%2Dpendlebury-${id}`, `scott-pendlebury%2D${id}`, `scott-pendlebury%2d${id}`,
    `scott-pendlebury-%31${id.slice(1)}`, `scott-pendlebury-${id.slice(0, 4)}%34`, `scott-pendlebury-%25${id}`, `scott pendlebury-${id}`.replace(' ', '%20'), `scott.pendlebury-${id}`, `scott_pendlebury-${id}`,
    `${'a'.repeat(101)}-${id}`, `${'a'.repeat(600)}-${id}`, `${slug}-${'1'.repeat(520)}`, `sc%C3%B6tt-${id}`, `scött-${id}`.replace('ö', '%C3%B6'),
    `${slug}-${id}/matches/`, `${slug}-${id}/matches/x`, `${slug}-${id}/MATCHES`, `${slug}-${id}/matches%2F`, `${slug}-${id}/match`, `${slug}-${id}/matches.json`, `${slug}-${id}/matches;a=1`,
    `${slug}-0${id}/matches`, `${slug}/matches`, `${slug}-${id}/../${slug}-0${id}`, `compare/`, `compare/x`, `COMPARE`, `compare%2F`,
  ];
  addVariants('/players', `${slug}-${id}`, bad.map((b) => `/players/${b}`));
  for (const p of encodedPositions('/players', `${slug}-${id}`)) deny.add(p);
  for (const b of bad) deny.add(`/players/${b}`);
}
// slug routes
for (const [route, slug, extra] of [
  ['/clubs', 'carlton', []], ['/venues', 'mcg', ['mcg/matches/', 'mcg/matches/x', 'mcg/MATCHES']], ['/honour-teams', 'afl-vfl-team-of-the-century', []],
]) {
  const bad = [
    `${slug.toUpperCase()}`, `${slug[0].toUpperCase()}${slug.slice(1)}`, `${slug}_x`, `${slug}.x`, `${slug} x`.replace(' ', '%20'), `${slug}+x`, `${slug}%2Dx`, `%${slug.charCodeAt(0).toString(16)}${slug.slice(1)}`,
    `${slug}%25`, `${slug}x`.padEnd(120, 'x'), 'a'.repeat(81), 'a'.repeat(600), `${slug}/`, `${slug}//`, `${slug}/x/y/z`, `${slug};a=1`, `${slug}%3Ba=1`, `.${slug}`, `${slug}..`,
    `%c3%a9${slug}`, `${slug}%e2%80%8b`, '..', '.', '%2e', '%2e%2e', `%2e%2e/${slug}`, ...extra,
  ];
  // sanity: a 1-char slug and 80-char slug are canonical and are in the legit corpus below, not here
  addVariants(route, slug, bad.map((b) => `${route}/${b}`));
  for (const p of encodedPositions(route, slug)) deny.add(p);
  for (const b of bad) deny.add(`${route}/${b}`);
}
// implausibly long raw paths on routes that are NOT protected by a prefix rule
for (const p of ['/' + 'a'.repeat(600), '/aflw/players/' + 'A'.repeat(600), '/search/' + 'x'.repeat(520), '/' + 'a/'.repeat(300), '/admin/content/asset/' + 'a'.repeat(600)]) deny.add(p);
// sitemap segments: /sitemap/<0..999>.xml only
for (const p of ['/sitemap/abc.xml', '/sitemap/1000.xml', '/sitemap/0.xml.gz', '/sitemap/0.XML', '/sitemap/-1.xml', '/sitemap/1.5.xml', '/sitemap/%31.xml', '/sitemap/1.xml/', '/sitemap/1.xml/x', '/sitemap/1;a.xml',
  '/sitemap/x', '/sitemap/.xml', '/sitemap/0xff.xml', '/sitemap/' + '1'.repeat(520) + '.xml']) deny.add(p);
// requests the allow-lists deliberately leave to the application (they must pass through byte-identical):
//  - list pages with a trailing slash (Next answers 308, nothing persisted)
//  - the two routes that read searchParams and are therefore rendered per request (0 files measured): awards, records
//  - the residual: well-formed paths that name nothing (shape-valid unknown ids and slugs) - Next 404s and persists them
//  - aliases of the route prefix that Next does not route (404, nothing persisted): upper case, a ';' in the prefix segment
const openPass = [
  '/seasons/', '/brownlow/', '/players/', '/clubs/', '/venues/', '/seasons/?x=1', '/players/?page=2', '/awards/', '/records/', '/matches/', '/honour-teams/',
  '/awards/ALL/2024', '/awards/x/1896', '/awards/x/2101', '/awards/x/02024', '/awards/all-australian/%32024', '/awards/x-y/2024/z', '/records/Most_Games', `/records/${'a'.repeat(100)}`, '/records/most-games?club=carlton',
  '/players/-scott-pendlebury-11724', '/players/wrongslug-11724', '/players/probe-x-900001', '/players/probe-x-900001/matches', '/clubs/-carlton', '/clubs/probeclub1', '/clubs/carlton-', '/venues/probevenue1', '/honour-teams/probeteam1',
  '/matches/99998', '/seasons/2099', '/brownlow/2099', '/seasons/1897?x=1', '/clubs/compare', '/players/compare',
  '/seasons;a=1/2024', '/players;a=1/x-1', '/Seasons/2024', '/SEASONS/02024', '/Players/x-011724', '/CLUBS/Carlton',
];
writeFileSync(`${outDir}/open.tsv`, `${openPass.map((t) => row('GET', t, 'pass')).join('\n')}\n`);

// the exact boundaries of the int4 range for players, and the cap boundaries (these are legit; they go to legit-boundaries)
const boundaryPass = [
  '/players/a-1', '/players/a-9', '/players/a-10', '/players/a-99999', '/players/a-999999999', '/players/a-1000000000', '/players/a-1999999999', '/players/a-2000000000',
  '/players/a-2099999999', '/players/a-2100000000', '/players/a-2139999999', '/players/a-2140000000', '/players/a-2146999999', '/players/a-2147000000', '/players/a-2147399999',
  '/players/a-2147400000', '/players/a-2147479999', '/players/a-2147480000', '/players/a-2147482999', '/players/a-2147483000', '/players/a-2147483599', '/players/a-2147483600',
  '/players/a-2147483639', '/players/a-2147483640', '/players/a-2147483647', `/players/${'a'.repeat(100)}-1`, `/players/${'a-'.repeat(49)}a-1`,
  '/matches/1', '/matches/9', '/matches/10', '/matches/99', '/matches/100', '/matches/9999', '/matches/10000', '/matches/99999',
  '/seasons/1897', '/seasons/1898', '/seasons/1899', '/seasons/1900', '/seasons/1999', '/seasons/2000', '/seasons/2099', '/seasons/2100', '/brownlow/1897', '/brownlow/2100',
  `/clubs/${'a'.repeat(80)}`, '/clubs/a', `/venues/${'a'.repeat(80)}/matches`, `/honour-teams/${'a'.repeat(80)}`,
  '/' + 'a'.repeat(511), '/search/' + 'x'.repeat(504), '/sitemap/0.xml', '/sitemap/9.xml', '/sitemap/99.xml', '/sitemap/100.xml', '/sitemap/999.xml', '/sitemap/300.xml?x=1',
];
const boundaryDeny = [
  '/players/a-2147483648', '/players/a-2147483649', '/players/a-2147483650', '/players/a-2147483700', '/players/a-2147484000', '/players/a-2150000000', '/players/a-2200000000', '/players/a-3000000000',
  '/players/a-9999999999', '/players/a-10000000000', '/players/a-0', '/players/a-01', `/players/${'a'.repeat(101)}-1`,
  '/matches/100000', '/matches/0', '/matches/099999', '/seasons/1896', '/seasons/2101', '/seasons/0', '/brownlow/1896', '/brownlow/2101',
  `/clubs/${'a'.repeat(81)}`, `/venues/${'a'.repeat(81)}/matches`, `/honour-teams/${'a'.repeat(81)}`, '/' + 'a'.repeat(512), '/search/' + 'x'.repeat(505), '/sitemap/1000.xml', '/sitemap/0.xml.gz',
];
writeFileSync(`${outDir}/boundary.tsv`, `${boundaryPass.map((t) => row('GET', t, 'pass')).concat(boundaryDeny.map((t) => row('GET', t, 'deny'))).join('\n')}\n`);

// anything in the deny set that is byte-identical to a legit path is a corpus bug
const legitSet = new Set(all);
const clash = [...deny].filter((d) => legitSet.has(d));
if (clash.length) { console.error(`CORPUS BUG: deny/legit clash: ${clash.slice(0, 5).join(' ')}`); process.exitCode = 3; }
// by design left to the application (see openPass): list pages with a trailing slash, and shape-valid slugs that start with '-'
const byDesign = /^\/(seasons|brownlow|matches|players|clubs|venues|honour-teams)\/(\?.*)?$|^\/(players|clubs|venues|honour-teams)\/-[a-z0-9-]*$/;
const denyList = [...deny].filter((d) => d.startsWith('/') && !legitSet.has(d) && !byDesign.test(d));
writeFileSync(`${outDir}/deny.tsv`, `${denyList.map((t) => row('GET', t, 'deny')).join('\n')}\n`);
writeFileSync(`${outDir}/deny-head.tsv`, `${denyList.map((t) => row('HEAD', t, 'deny')).join('\n')}\n`);
writeFileSync(`${outDir}/deny-post.tsv`, `${denyList.slice(0, 150).map((t) => row('POST', t, 'deny')).join('\n')}\n`);
console.error(`deny GET: ${denyList.length}`);
