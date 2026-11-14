// softlist.js <json> : for every failed test, every soft failure with its source line:  line | message-first-line
const fs = require("fs");
const j = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
for (const f of j.testResults) for (const a of f.assertionResults) if (a.status === "failed") {
  console.log("### " + a.fullName.slice(0, 140));
  for (const m of a.failureMessages) {
    const clean = String(m).replace(/\x1b\[[0-9;]*m/g, "");
    const first = clean.split("\n")[0].slice(0, 170);
    const loc = (clean.match(/zz-soft-[^:\s]+:(\d+):\d+/) || [])[1] || "?";
    console.log("  L" + loc + " | " + first);
  }
}
