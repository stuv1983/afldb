// msg.js <json[.gz]> <substring of fullName> [maxLines]
const fs = require("fs"), zlib = require("zlib");
let b = fs.readFileSync(process.argv[2]); if (process.argv[2].endsWith(".gz")) b = zlib.gunzipSync(b);
const j = JSON.parse(b.toString("utf8")); const n = Number(process.argv[4] || 30);
for (const f of j.testResults) for (const a of f.assertionResults) if (a.status === "failed" && a.fullName.includes(process.argv[3])) {
  console.log("### " + f.name.replace(/^.*\/tests\//, "tests/") + " :: " + a.fullName);
  console.log(String(a.failureMessages[0] || "").replace(/\x1b\[[0-9;]*m/g, "").split("\n").slice(0, n).join("\n"));
}
