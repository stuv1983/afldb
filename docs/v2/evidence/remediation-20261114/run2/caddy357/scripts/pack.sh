#!/usr/bin/env bash
# caddy357: gather the committed evidence copy (small raw outputs, as .txt/.tsv) and a sha256 manifest of the host originals.
source /mnt/ssd/afldb-rem2-caddy357-20261114/env.sh
cd "$W"
P=$W/pack; rm -rf "$P"; mkdir -p "$P/raw" "$P/corpus" "$P/matrix" "$P/viacaddy" "$P/deploy-files-under-test"
for f in exp1-system exp1-2.11.4 matrix-prod-2.11.9 matrix-prod-2.11.4 matrix-dev-2.11.9 matrix-dev-2.11.4 final-matrix-summary final-caddyfile-sha256 measure-100 rate-1 rate-8 rate-24 rate-gate-on slugstats ss-before path-lengths prunetest cleanup-proof sitemap-fetch viacaddy-2.11.4; do
  [ -f evidence/$f.txt ] && cp evidence/$f.txt "$P/raw/$f.txt"
done
for f in persist-direct-open persist-direct-open2 persist-gate-on; do cp evidence/$f.tsv "$P/raw/$f.tsv"; done
grep -v '^find:' evidence/step3.txt | cut -c1-400 > "$P/raw/step3-persist-fresh-and-prune.txt"
cp evidence/viacaddy-v2.11.4/compare.tsv evidence/viacaddy-v2.11.4/persist-via-caddy.tsv evidence/viacaddy-v2.11.4/urls-compare.txt "$P/viacaddy/"
cp evidence/viacaddy-v2.11.4/browse/pages.tsv evidence/viacaddy-v2.11.4/browse/summary.txt evidence/viacaddy-v2.11.4/browse/requests.txt "$P/viacaddy/" 2>/dev/null
cp evidence/viacaddy-v2.11.4/browse/last.png "$P/viacaddy/browse-last.png" 2>/dev/null
cp corpus/boundary.tsv corpus/deny.tsv corpus/deny-post.tsv corpus/open.tsv corpus/route-patterns.txt "$P/corpus/"
cp in/cf/Caddyfile.production in/cf/Caddyfile "$P/deploy-files-under-test/"
for l in prod-2.11.9 prod-2.11.4; do
  mkdir -p "$P/matrix/$l"
  cp matrix/$l/hook.out matrix/$l/result-deny.tsv matrix/$l/result-boundary.tsv matrix/$l/result-open.tsv matrix/$l/result-deny-post.tsv matrix/$l/result-legit-head.tsv matrix/$l/recheck-deny-head.tsv "$P/matrix/$l/"
done
{
  echo "# sha256 of the HOST originals (workspace $W); the committed copies are a subset"
  sha256sum caddy-bin/caddy-system caddy-bin/caddy-2.11.4 caddy-bin/dl/*.tar.gz
  sha256sum in/cf/Caddyfile.production in/cf/Caddyfile corpus/*.tsv corpus/route-patterns.txt in/sitemap-urls.txt
  for l in prod-2.11.9 prod-2.11.4 dev-2.11.9 dev-2.11.4; do sha256sum matrix/$l/result-*.tsv matrix/$l/hook.out matrix/$l/adapted.json matrix/$l/adapted-unmodified.json matrix/$l/Caddyfile.test matrix/$l/upstream.jsonl 2>/dev/null; done
  sha256sum evidence/*.txt evidence/*.tsv evidence/viacaddy-v2.11.4/*.tsv evidence/viacaddy-v2.11.4/*.txt evidence/viacaddy-v2.11.4/browse/*
} > "$P/MANIFEST-host-sha256.txt"
echo "cand HEAD $(cd cand && git rev-parse HEAD) porcelain-lines $(cd cand && git status --porcelain | wc -l)" >> "$P/MANIFEST-host-sha256.txt"
tar -czf "$W/pack.tgz" -C "$P" . && ls -l "$W/pack.tgz" && du -sh "$P"
