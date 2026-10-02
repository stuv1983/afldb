// AFLDB-ISSUE-225 evidence probe E1 (DB-free, read-only).
//
// Question: for the 15 players behind the 37 `incorrect known answer` cells, does
// Gridley's own answer key give the SAME answer to the SAME criterion pairing on
// every board that asks it? All 37 cells sit on 2026 boards, which the corpus suite
// classified `time of board` until afldb_test carried season 2026
// (tests/integration/gridley-corpus.test.ts, the `boardYear > gaps.maxSeason` arm), so
// an earlier board that asked the same pairing is the only independent read of the
// key from before then.
//
// Reads only the two tracked fixtures; touches no database and writes nothing.
// Run from the repository root:
//   node issues/closed/AFLDB-ISSUE-225-gridley-key-probe.mjs
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';

const dir = join(process.cwd(), 'tests', 'fixtures', 'gridley');
const { boards } = JSON.parse(readFileSync(join(dir, 'corpus.json'), 'utf8'));
const answers = JSON.parse(gunzipSync(readFileSync(join(dir, 'corpus-answers.json.gz'))).toString('utf8'));

// [gridley id, afldb id (afldb_test), name, criteria probed, other-axis ids to pair with]
// For the captain targets the other axes are those of both captains' ISSUE-225 cells
// (Bruce also carries May's grandfinals1 / allAus1953 / premier1x, where Gridley's
// 2026 key lists May but not Bruce). `null` = report every pairing of the criteria
// (each is small in the corpus).
const TARGETS = [
  [1350, 2489, 'Cameron Bruce', ['captain'],
    ['disposals30', 'clubbestfairest', 'risingStarNomination', 'HW', 'disposals20avgseason', 'ME', 'mcg-played-50', '2010s', 'games200',
      'grandfinals1', 'allAus1953', 'premier1x']],
  [6788, 12093, 'Steven May', ['captain'],
    ['grandfinals1', 'ME', 'mcg-played-50', 'premier1x', 'allAus1953', '2010s', 'games200']],
  [1359, 2502, 'Cameron Mooney', ['teammates-100', 'teammates-150'], null],
  [3211, 5927, 'Hugh Greenwood', ['teammates-100', 'teammates-150'], null],
  [41, 59, 'Adam Simpson', ['teammates-100', 'teammates-150'], null],
  [6173, 11061, 'Robbie Tarrant', ['teammates-100', 'teammates-150'], null],
  [1141, 2126, 'Braydon Preuss', ['teammates-100', 'teammates-150'], null],
  [4287, 7870, 'Josh Gibson', ['teammates-100', 'teammates-150'], null],
  [1846, 3305, 'Darcy Tucker', ['teammates-100', 'teammates-150'], null],
  [1130, 2111, 'Brandon Matera', ['teammates-100', 'teammates-150'], null],
  [1128, 2109, 'Brandon Ellis', ['teammates-100', 'teammates-150'], null],
  [3507, 6461, 'Jack Newnes', ['teammates-100', 'teammates-150'], null],
  [379, 669, 'Angus Brayshaw', ['teammates-100', 'teammates-150'], null],
  [2012, 3581, 'David Swallow',
    ['games100sameclub', 'games150sameclub', 'games200sameclub', 'games250sameclub', 'games300sameclub', 'games200', 'games250', 'games300'], null],
  [2269, 4006, 'Dylan Shiel', ['games50clubs2', 'games100clubs2'], null],
];

console.log(`AFLDB-ISSUE-225 E1 -- ${boards.length} boards, ${Object.keys(answers).length} answer keys`);

for (const [gid, afldb, name, criteria, controls] of TARGETS) {
  const hits = [];
  for (const b of boards) {
    const key = answers[String(b.board)];
    if (!key) continue;
    b.rows.forEach((row, r) => b.cols.forEach((col, c) => {
      for (const [crit, other] of [[row.id, col.id], [col.id, row.id]]) {
        if (!criteria.includes(crit)) continue;
        if (controls && !controls.includes(other)) continue;
        hits.push({ board: b.board, date: b.date, cell: `${r}-${c}`, crit, other, listed: key[r][c].includes(gid) });
      }
    }));
  }

  console.log(`\n== gridley ${gid} = afldb ${afldb} ${name} -- ${criteria.join(', ')}`);
  for (const h of hits) {
    console.log(`  #${h.board} ${h.date} ${h.cell} ${h.crit} x ${h.other}: ${h.listed ? 'LISTED' : 'omitted'}`);
  }

  // The same pairing answered both ways on different dates is a change in Gridley's key.
  const byPair = new Map();
  for (const h of hits) {
    const k = `${h.crit} x ${h.other}`;
    if (!byPair.has(k)) byPair.set(k, { listed: [], omitted: [] });
    byPair.get(k)[h.listed ? 'listed' : 'omitted'].push(h.date);
  }
  for (const [pair, v] of byPair) {
    if (v.listed.length && v.omitted.length) {
      console.log(`  KEY CHANGED ${pair}: listed ${v.listed.join(' ')} / omitted ${v.omitted.join(' ')}`);
    }
  }
  const tally = (pre) => {
    const s = hits.filter((h) => (h.date < '2026') === pre);
    return `${s.filter((h) => h.listed).length} listed / ${s.filter((h) => !h.listed).length} omitted`;
  };
  console.log(`  summary: before 2026 ${tally(true)}; 2026 ${tally(false)}`);
}
