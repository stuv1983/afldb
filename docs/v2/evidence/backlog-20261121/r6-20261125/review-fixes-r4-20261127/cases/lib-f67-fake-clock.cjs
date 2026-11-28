// FIXTURE ONLY (suite f6). A wall clock for a Node process under test, loaded by the fixture with
// NODE_OPTIONS=--require <this file>; never by a script under test and never on a real host.
// The clock file (F67_CLOCK, default /fx/clock) may hold one line "node frozen <epoch ms>" (Date.now() is that constant)
// or "node offset <ms>" (Date.now() is the real clock plus that offset, so time still passes). With no such line the real
// clock is left alone. Only Date.now() and `new Date()` with no argument change; Date.UTC, Date.parse and dates built
// from arguments are the real ones.
'use strict';
const { readFileSync } = require('node:fs');
const RealDate = Date;
let mode = null;
let value = 0;
try {
  for (const line of readFileSync(process.env.F67_CLOCK || '/fx/clock', 'utf8').split('\n')) {
    const m = /^node (frozen|offset) (-?[0-9]+)$/.exec(line);
    if (m) { mode = m[1]; value = Number(m[2]); }
  }
} catch { /* no clock file: real clock */ }
if (mode) {
  const now = () => (mode === 'frozen' ? value : RealDate.now() + value);
  class FixtureDate extends RealDate {
    constructor(...args) { if (args.length === 0) super(now()); else super(...args); }
    static now() { return now(); }
  }
  globalThis.Date = FixtureDate;
}
