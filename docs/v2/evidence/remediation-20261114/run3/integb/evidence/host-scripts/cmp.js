// cmp.js <snapshot.json[.gz]> <rebuild.json[.gz]> [fileFilter]  : per test that fails in either, show both outcomes
const fs = require("fs"), zlib = require("zlib");
function load(p) { let b = fs.readFileSync(p); if (p.endsWith(".gz")) b = zlib.gunzipSync(b); return JSON.parse(b.toString("utf8")); }
function index(j) {
  const m = new Map();
  for (const f of j.testResults) {
    const file = f.name.replace(/\\/g, "/").replace(/^.*\/tests\//, "tests/");
    for (const a of f.assertionResults) m.set(file + "\t" + a.fullName, a.status === "failed" ? "FAIL " + String(a.failureMessages[0] || "").split("\n")[0].replace(/\x1b\[[0-9;]*m/g, "").slice(0, 150) : a.status.toUpperCase());
    if (f.status === "failed" && !f.assertionResults.some((a) => a.status === "failed")) m.set(file + "\t<file-level>", "FAIL " + String(f.message || "").split("\n")[0].slice(0, 150));
  }
  return m;
}
const A = index(load(process.argv[2])), B = index(load(process.argv[3])), filt = process.argv[4] || "";
const keys = [...new Set([...A.keys(), ...B.keys()])].sort();
for (const k of keys) {
  if (filt && !k.includes(filt)) continue;
  const a = A.get(k) || "ABSENT", b = B.get(k) || "ABSENT";
  if (a.startsWith("FAIL") || b.startsWith("FAIL")) console.log(k.replace("tests/integration/", "").slice(0, 150) + "\n   SNAP: " + a + "\n   REB : " + b);
}
