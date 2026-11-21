// Release 7 revision 3 (R7R3), A3 = rendered Brownlow acceptance in the OWNER'S signed-in browser on https://beta.afldb.com, run by
// Claude through the Playwright MCP (`browser_evaluate` with this function, the page open on any beta.afldb.com URL). Read-only: same-
// origin GETs with the browser's own cookies, parsed with DOMParser; nothing is posted and no cookie value is read or printed.
// Set MODE to 'pending' (after P10 pending) or 'published' (>= 65 min after the owner's publication), and INELIGIBLE to the published
// list's slug-ids (empty for 'pending'). The same expectations as r7r3-p10-brownlow.sh; the browser result is recorded separately.
async () => {
  const MODE = 'published';
  const INELIGIBLE = [];   // e.g. ['jason-horne-francis-6841', ...] exactly as decided in D-370-1
  const TOOLTIP = 'AFLDB has not yet verified and published the Brownlow results for this season.';
  const FORBIDDEN = [/Not yet awarded/, /Results not loaded/, /No medal/, /has been awarded/, /have not been loaded yet/];
  const P = MODE === 'pending';
  const doc = async (path) => {
    const r = await fetch(path, { credentials: 'same-origin', redirect: 'manual', cache: 'no-store' });
    return { code: r.status, doc: new DOMParser().parseFromString(await r.text(), 'text/html') };
  };
  const txt = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const bv = (d, re) => {
    const out = [];
    for (const t of d.querySelectorAll('table')) {
      const heads = [...t.querySelectorAll('thead tr:last-child th')].map((th) => txt(th).replace(/[^A-Za-z]/g, ''));
      const i = heads.indexOf('BV'); if (i < 0) continue;
      for (const tr of t.querySelectorAll('tbody tr')) {
        const cells = [...tr.querySelectorAll('td,th')]; const text = cells.map(txt).join(' | ');
        if (re.test(text)) out.push({ text, bv: txt(cells[i]), title: cells[i]?.getAttribute('title') ?? null });
      }
    }
    return out;
  };
  const rows = (d) => [...d.querySelectorAll('tbody tr')].map((tr) => ({ text: [...tr.querySelectorAll('td,th')].map(txt).join(' | '),
    href: (tr.querySelector('a[href^="/players/"]')?.getAttribute('href') ?? '').replace('/players/', '') }));
  const cell = (d, y) => bv(d, new RegExp(`^${y}\\b`))[0] ?? {};
  const sum = (r) => r.reduce((s, x) => s + (/^\d+$/.test(x.bv) ? Number(x.bv) : 0), 0);
  const forb = (d) => FORBIDDEN.filter((re) => re.test(txt(d.body))).map(String);
  const out = { mode: MODE, at: new Date().toISOString(), url: location.origin, checks: {} };
  const check = (k, ok, detail) => { out.checks[k] = { ok, detail }; };

  for (const [who, slug, v26, v25] of [['pendlebury', 'scott-pendlebury-11724', '5', '2'], ['daicos', 'nick-daicos-9910', '47', '32']]) {
    const { code, doc: d } = await doc(`/players/${slug}`);
    const c26 = cell(d, 2026), c25 = cell(d, 2025);
    check(`player-${who}`, code === 200 && forb(d).length === 0 && c25.bv === v25
      && (P ? c26.bv === 'Awaiting verification' && c26.title === TOOLTIP : c26.bv === v26), { code, c26, c25, forbidden: forb(d) });
    const g = await doc(`/players/${slug}/matches?season=2026`); const gr = bv(g.doc, /^/);
    const polled = gr.filter((r) => /^[123]$/.test(r.bv)).map((r) => `${(r.text.match(/\bR\d+\b/) || ['?'])[0]}=${r.bv}`);
    check(`gamelog-${who}-2026`, g.code === 200 && gr.length > 0 && sum(gr) === (P ? 0 : Number(v26))
      && (P || who !== 'pendlebury' || polled.sort().join(',') === 'R21=2,R8=3'), { code: g.code, polled, sum: sum(gr) });
  }
  for (const [id, want] of [[17247, '3'], [17151, '2']]) {
    const { code, doc: d } = await doc(`/matches/${id}`); const r = bv(d, /Scott Pendlebury/);
    check(`match-${id}`, code === 200 && (P ? r.length === 0 : r.length === 1 && r[0].bv === want), { code, pendlebury: r.map((x) => x.bv) });
  }
  {
    const { code, doc: d } = await doc('/seasons/2026');
    const blocks = [...d.querySelectorAll('details')].filter((x) => /Brownlow votes/.test(txt(x))).map(txt);
    const pend = blocks.map((t) => (t.match(/Scott Pendlebury\s*Collingwood\s*(\d)/) || [])[1]).filter(Boolean);
    const nv = /No votes recorded for 2026/.test(txt(d.body));
    check('season-2026', code === 200 && (P ? blocks.length === 0 && nv : blocks.length === 25 && !nv && pend.join(',') === '3,2'), { code, blocks: blocks.length, novotes: nv, pend });
  }
  {
    const { code, doc: d } = await doc('/brownlow');
    const links = d.querySelectorAll('a[href="/brownlow/2026"]').length; const r26 = rows(d).find((r) => /^2026 \|/.test(r.text))?.text ?? null;
    check('brownlow-index', code === 200 && (P ? links === 0 && !r26 : links >= 1 && /^2026 \| Nick Daicos \| Collingwood \| 47$/.test(r26 ?? '')), { code, links, r26 });
  }
  {
    const { code, doc: d } = await doc('/brownlow/2026');
    if (P) check('brownlow-2026', code === 404, { code });
    else {
      const rs = rows(d); const f = (n) => rs.find((r) => r.text.includes(` | ${n} | `)); const v = (n) => f(n)?.text.split(' | ')[2];
      const marked = rs.filter((r) => /Recorded ineligible/i.test(r.text)).map((r) => r.href).sort();
      const won = /Won by Nick Daicos with 47 votes/.test(txt(d.body));
      check('brownlow-2026', code === 200 && won && /Winner/.test(f('Nick Daicos')?.text ?? '') && v('Nick Daicos') === '47' && v('Bailey Smith') === '36'
        && v('Marcus Bontempelli') === '34' && v('Scott Pendlebury') === '5' && marked.join(',') === [...INELIGIBLE].sort().join(','),
      { code, won, daicos: v('Nick Daicos'), smith: v('Bailey Smith'), bont: v('Marcus Bontempelli'), pend: v('Scott Pendlebury'), marked });
    }
  }
  {
    const { code, doc: d } = await doc('/brownlow/2025'); const rs = rows(d); const v = (n) => rs.find((r) => r.text.includes(` | ${n} | `))?.text.split(' | ')[2];
    const rowell = rs.find((r) => r.text.includes(' | Matt Rowell | '))?.text ?? null;
    check('brownlow-2025', code === 200 && /Winner/.test(rowell ?? '') && v('Matt Rowell') === '39' && v('Nick Daicos') === '32' && v('Scott Pendlebury') === '2', { code, rowell });
  }
  { const { code, doc: d } = await doc('/matches/16677'); const n = bv(d, /^/).filter((r) => /^[123]$/.test(r.bv)).length; check('match-16677-2025', code === 200 && n === 3, { code, polled: n }); }
  out.pass = Object.values(out.checks).every((c) => c.ok);
  return JSON.stringify(out);
}
