// caddy357: fetch the live sitemap index and every segment from the served app; print one <loc> per line.
// usage: node sitemap-urls.mjs <port>
const port = process.argv[2];
const get = async (p) => (await fetch(`http://127.0.0.1:${port}${p}`)).text();
const idx = await get('/sitemap.xml');
const locs = [...idx.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const out = [];
for (const loc of locs) {
  const p = new URL(loc).pathname;
  const xml = await get(p);
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) out.push(m[1].replace(/&amp;/g, '&'));
  console.error(`${p}: ${[...xml.matchAll(/<loc>/g)].length}`);
}
console.log(out.join('\n'));
