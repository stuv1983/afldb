// ISSUE-363 run 3, scope `integ`: compare the 52-id failure universe (+ the "war years" id) against vitest JSON reports.
//
//   node verdicts.js <baseline-integ-failures.tsv> <vitest.json>...
//
// One output line per id: `<observations>\t<file>\t<test full name>`, where observations is a comma list of
// `PASS|FAIL|SKIP@<json file name>` (an id seen in several reports lists every one; the war-years id is expected in several),
// or `ABSENT` when no report contains it. A file-level id (`<file-level>`) is FAIL when the file failed without a failing test
// (a refusal or hook error), PASS otherwise. `settle-afl-api-state-b` is owned by the stateb scope and is skipped.
// Plain Node, no dependencies; reads only the files named.
const fs = require("fs");

const base = fs.readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean).map((l) => l.split("\t"));
const seen = new Map(); // "<file>\t<name>\t<json>" -> status
for (const p of process.argv.slice(3)) {
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  const label = p.replace(/^.*\//, "");
  for (const f of j.testResults) {
    const n = f.name.replace(/\\/g, "/").replace(/^.*\/tests\//, "tests/");
    const bad = f.assertionResults.filter((a) => a.status === "failed");
    const put = (name, v) => seen.set(n + "\t" + name + "\t" + label, v);
    put("<file-level>", f.status === "failed" && bad.length === 0 ? "FAIL" : "PASS");
    for (const a of f.assertionResults) put(a.fullName, a.status === "passed" ? "PASS" : a.status === "failed" ? "FAIL" : "SKIP");
  }
}
const ids = base.filter(([f]) => !f.includes("settle-afl-api-state-b")).map(([f, n]) => f + "\t" + n);
ids.push("tests/integration/database.test.ts\tBrownlow correctness separates the war years from merely uncollected seasons");
for (const k of ids) {
  const hits = [];
  for (const [kk, v] of seen) if (kk.startsWith(k + "\t")) hits.push(v + "@" + kk.slice(k.length + 1));
  console.log((hits.length ? hits.join(",") : "ABSENT") + "\t" + k.slice(0, 200));
}
