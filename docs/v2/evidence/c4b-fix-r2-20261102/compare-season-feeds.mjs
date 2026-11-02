#!/usr/bin/env node
// ISSUE-316: structural comparison of two AFL API season-match feed files (offline: reads two local files, contacts nothing, writes nothing
// unless --out is given). Built for the retained 2027 feed (21fd12e7..., 1 Nov) versus the live capture of the first C4b run (1a51317b..., 2 Nov).
//
//   node compare-season-feeds.mjs <retained.json> <captured.json> [--out report.json]
//
// Reports: bytes and sha256; whether the two are the same JSON modulo formatting; meta differences; match-id set differences;
// per-match changed leaf paths grouped by path (array indexes collapsed) with counts; status, date/time and venue changes with the
// affected match ids; fields present on only one side; and the verdict flags that matter to the C4b assumptions.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args[outIdx + 1] : null;
const [fa, fb] = args.filter((a, i) => !a.startsWith('--') && (outIdx < 0 || i !== outIdx + 1));
if (!fa || !fb) { console.error('usage: node compare-season-feeds.mjs <retained.json> <captured.json> [--out report.json]'); process.exit(2); }

const read = (p) => { const buf = readFileSync(p); return { path: p, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex'), json: JSON.parse(buf.toString('utf8')) }; };
const A = read(fa), B = read(fb);

const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => (p < q ? -1 : p > q ? 1 : 0))) : x));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Leaf-level differences between two JSON values, as [path, a, b, kind]; kind is changed | only-a | only-b. */
function diff(a, b, path, acc) {
  if (isObj(a) && isObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in a)) acc.push([`${path}.${k}`, undefined, b[k], 'only-b']);
      else if (!(k in b)) acc.push([`${path}.${k}`, a[k], undefined, 'only-a']);
      else diff(a[k], b[k], `${path}.${k}`, acc);
    }
  } else if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (i >= a.length) acc.push([`${path}[${i}]`, undefined, b[i], 'only-b']);
      else if (i >= b.length) acc.push([`${path}[${i}]`, a[i], undefined, 'only-a']);
      else diff(a[i], b[i], `${path}[${i}]`, acc);
    }
  } else if (canon(a) !== canon(b)) acc.push([path, a, b, 'changed']);
}
const pattern = (p) => p.replace(/\[\d+\]/g, '[]');

const ma = Array.isArray(A.json.matches) ? A.json.matches : [];
const mb = Array.isArray(B.json.matches) ? B.json.matches : [];
const key = (m) => m.providerId ?? String(m.id);
const ia = new Map(ma.map((m) => [key(m), m])), ib = new Map(mb.map((m) => [key(m), m]));
const onlyA = [...ia.keys()].filter((k) => !ib.has(k)), onlyB = [...ib.keys()].filter((k) => !ia.has(k));
const duplicates = { retained: ma.length - ia.size, captured: mb.length - ib.size };

const metaDiffs = []; diff(A.json.meta ?? null, B.json.meta ?? null, 'meta', metaDiffs);
const topKeys = { onlyRetained: Object.keys(A.json).filter((k) => !(k in B.json)), onlyCaptured: Object.keys(B.json).filter((k) => !(k in A.json)) };

const perPath = new Map(); // pattern -> { count, matches:Set, examples:[] }
const perMatch = new Map();
for (const [k, m1] of ia) {
  const m2 = ib.get(k); if (!m2) continue;
  const acc = []; diff(m1, m2, '', acc);
  if (acc.length) perMatch.set(k, acc);
  for (const [p, x, y, kind] of acc) {
    const pp = `${pattern(p)} [${kind}]`;
    const e = perPath.get(pp) ?? { path: pp, count: 0, matches: new Set(), examples: [] };
    e.count++; e.matches.add(k); if (e.examples.length < 3) e.examples.push({ match: k, retained: x, captured: y });
    perPath.set(pp, e);
  }
}
const groups = [...perPath.values()].sort((p, q) => q.count - p.count).map((e) => ({ path: e.path, leafDifferences: e.count, matchesAffected: e.matches.size, examples: e.examples }));

const statusOf = (m) => m?.status ?? null;
const statusCounts = (arr) => arr.reduce((o, m) => ((o[statusOf(m)] = (o[statusOf(m)] ?? 0) + 1), o), {});
const statusChanges = [...ia].filter(([k, m]) => ib.has(k) && statusOf(m) !== statusOf(ib.get(k))).map(([k, m]) => ({ match: k, retained: statusOf(m), captured: statusOf(ib.get(k)) }));
const timeLike = (p) => /(time|date|start|end)/i.test(p);
const dateChanges = [...perMatch].flatMap(([k, acc]) => acc.filter(([p, , , kind]) => kind === 'changed' && timeLike(p)).map(([p, x, y]) => ({ match: k, path: p, retained: x, captured: y })));
const venueChanges = [...perMatch].flatMap(([k, acc]) => acc.filter(([p]) => /^\.venue\b/.test(p)).map(([p, x, y, kind]) => ({ match: k, path: p, kind, retained: x, captured: y })));
const teamChanges = [...perMatch].flatMap(([k, acc]) => acc.filter(([p]) => /^\.(home|away)\b/.test(p)).map(([p, x, y, kind]) => ({ match: k, path: p, kind, retained: x, captured: y })));
const roundChanges = [...perMatch].flatMap(([k, acc]) => acc.filter(([p]) => /^\.round\b/.test(p)).map(([p, x, y, kind]) => ({ match: k, path: p, kind, retained: x, captured: y })));
const distinctVenues = (arr) => new Set(arr.map((m) => m.venue?.providerId ?? null)).size;
const distinctTeams = (arr) => new Set(arr.flatMap((m) => [m.home?.team?.providerId, m.away?.team?.providerId])).size;

const sameJson = canon(A.json) === canon(B.json);
const report = {
  files: { retained: { path: A.path, bytes: A.bytes, sha256: A.sha256 }, captured: { path: B.path, bytes: B.bytes, sha256: B.sha256 }, byteDelta: B.bytes - A.bytes },
  sameJsonModuloFormatting: sameJson,
  identicalBytes: A.sha256 === B.sha256,
  topLevelKeys: topKeys,
  meta: { differences: metaDiffs.map(([p, x, y, kind]) => ({ path: p, retained: x, captured: y, kind })) },
  matches: { retained: ma.length, captured: mb.length, duplicateKeys: duplicates, onlyInRetained: onlyA, onlyInCaptured: onlyB, matchesWithAnyDifference: perMatch.size },
  statusCounts: { retained: statusCounts(ma), captured: statusCounts(mb) },
  statusChanges, dateChanges, venueChanges, teamChanges, roundChanges,
  distinct: { venues: { retained: distinctVenues(ma), captured: distinctVenues(mb) }, teams: { retained: distinctTeams(ma), captured: distinctTeams(mb) } },
  changedPathGroups: groups,
  // The assumptions the C4b rehearsal and its readiness gate rest on (cutover readiness: season identity, round vocabulary, venue/team/round coverage):
  assumptionFlags: {
    sameMatchCount: ma.length === mb.length, sameMatchIdSet: onlyA.length === 0 && onlyB.length === 0,
    sameStatusDistribution: canon(statusCounts(ma)) === canon(statusCounts(mb)), noStatusChange: statusChanges.length === 0,
    noDateOrTimeChange: dateChanges.length === 0, noVenueChange: venueChanges.length === 0, noTeamChange: teamChanges.length === 0, noRoundChange: roundChanges.length === 0,
    sameDistinctVenues: distinctVenues(ma) === distinctVenues(mb), sameDistinctTeams: distinctTeams(ma) === distinctTeams(mb),
  },
};

const text = JSON.stringify(report, (_k, v) => (v instanceof Set ? [...v] : v), 2);
if (out) writeFileSync(out, text + '\n');
console.log(text);
