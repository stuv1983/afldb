// Builds the snapshot the pin's nightly ACQUIRE step would write for season 2027 today (status CONCLUDED selects 0 of 218), from the
// RETAINED AUTHENTIC feed bytes of the 2026-11-01 capture (sha256 21fd12e7…c84d). Only the manifest wrapper is reconstructed, from
// acquire-afl-api.ts's non-fixtures branch (acquisition_kind 'afl_api_match_snapshot', fixtures_only false); the provider is NOT
// contacted. Usage: node build-match-snapshot.mjs <retained dir> <checkout>
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const [src, co, labelOverride] = process.argv.slice(2);
const fixtureManifest = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8'));
const feed = readFileSync(join(src, '00-season-matches.json'));
const sha = createHash('sha256').update(feed).digest('hex');
if (sha !== '21fd12e7704b7c7146cfbab414352352f3cfaa53e7ef5038f4411fa789e4c84d') throw new Error(`feed sha ${sha}`);
if (fixtureManifest.files[0].sha256 !== sha) throw new Error('manifest/feed mismatch');
// A second simulated night re-uses the same authentic bytes under the next night's label (an unchanged feed, as on production).
const label = labelOverride ?? fixtureManifest.label;
if (!/^afl-api-2027-\d{4}-\d{2}-\d{2}-\d{6}$/.test(label)) throw new Error(`bad label ${label}`);
const dir = join(co, 'data', 'sources', 'afl_api', 'matches', label);
if (existsSync(dir)) throw new Error(`${dir} exists`);
mkdirSync(dir, { recursive: true });
copyFileSync(join(src, '00-season-matches.json'), join(dir, '00-season-matches.json'));
writeFileSync(join(dir, 'token.meta.json'), JSON.stringify({ issued_at: fixtureManifest.acquisition_started_at, reissued: false }, null, 2));
const manifest = { ...fixtureManifest, label, acquisition_kind: 'afl_api_match_snapshot', fixtures_only: false };
writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ label, dir, feed_sha256: sha, feed_bytes: feed.length, matches_in_feed: manifest.counts.matches_in_feed, matches_selected: manifest.counts.matches_selected, selection: manifest.selection }));
