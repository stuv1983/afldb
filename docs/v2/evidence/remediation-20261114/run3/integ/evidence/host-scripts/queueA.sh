#!/usr/bin/env bash
# rem3-integ phase A queue: runs sequentially, each step logged to evidence/a/. Continues after a failing step.
set -u
W=/mnt/ssd/afldb-rem3-integ-20261114
A="bash $W/in/phaseA.sh"; BL="bash $W/in/brownlow.sh"; EV=$W/evidence/a
mkdir -p $EV
say() { echo "$(date -u +%FT%TZ) QUEUE $*" | tee -a $EV/queue.log; }
STATE="SELECT year||' '||status::text FROM seasons WHERE year=2026; SELECT stat_key||' '||season||' '||coverage::text FROM stat_availability WHERE season=2026 AND stat_key LIKE 'brownlow%' ORDER BY 1;"
FINDGO() { :; }

# ---- 1. war years: mechanism. settle-afl-api-brownlow (SEASON 2026) then the war-years case, on one fresh snapshot copy
say "1 mechanism"
$A mkq afldb_v2_rem3integ_m1_test
{ echo "--- before"; $A q afldb_v2_rem3integ_m1_test "$STATE"; } > $EV/mech-state-0.txt 2>&1
$A vt afldb_v2_rem3integ_m1_test mech-war-alone 1200 tests/integration/database.test.ts -t "separates the war years"
$A vt afldb_v2_rem3integ_m1_test mech-settle-brownlow 2400 tests/integration/settle-afl-api-brownlow.test.ts
{ echo "--- after settle-afl-api-brownlow"; $A q afldb_v2_rem3integ_m1_test "$STATE"; } > $EV/mech-state-1.txt 2>&1
$A vt afldb_v2_rem3integ_m1_test mech-war-after-settle 1200 tests/integration/database.test.ts -t "separates the war years"
$A drop afldb_v2_rem3integ_m1_test

# ---- 2. war years: database.test.ts alone, shared mode, three fresh copies; and once per-file
for n in 1 2 3; do
  say "2 war shared $n"
  $A mkq afldb_v2_rem3integ_w${n}_test
  $A vt afldb_v2_rem3integ_w${n}_test war-shared-$n 1800 tests/integration/database.test.ts
  $A drop afldb_v2_rem3integ_w${n}_test
done
say "2 war per-file"
$A mkq afldb_v2_rem3integ_wpf_test
$A pf afldb_v2_rem3integ_wpf_test war-perfile 1800 tests/integration/database.test.ts
$A drop afldb_v2_rem3integ_wpf_test

# ---- 3. snapshot-oracle baseline: the six files, per-file MODE=all, one fresh copy
say "3 oracle6 baseline"
$A mkq afldb_v2_rem3integ_o6_test
HEAVY=1 $A pf afldb_v2_rem3integ_o6_test oracle6-snapshot 5400 tests/integration/club-comparison.test.ts tests/integration/database.test.ts tests/integration/draft-linkage.test.ts tests/integration/admin-brownlow.test.ts tests/integration/gridley-corpus.test.ts tests/integration/release-gates.test.ts
$A drop afldb_v2_rem3integ_o6_test

# ---- 4. data-editor (shared, snapshot copy: raw failure text and the authority aggregate)
say "4 data-editor"
$A mkq afldb_v2_rem3integ_de_test
{ $A q afldb_v2_rem3integ_de_test "SELECT 'player_match_stats authority rows='||count(*) FROM data_overrides WHERE entity_type='player_match_stats'"; } > $EV/de-precondition.txt 2>&1
$A vt afldb_v2_rem3integ_de_test data-editor-snapshot 3000 tests/integration/data-editor.test.ts
$A drop afldb_v2_rem3integ_de_test

# ---- 5. awards-reload-links (shared, snapshot copy) + the aggregate that decides 47 vs 46
say "5 awards"
$A mkq afldb_v2_rem3integ_aw_test
{ $A q afldb_v2_rem3integ_aw_test "SELECT 'coleman rows='||count(*)||' seasons='||count(DISTINCT w.season)||' minseason='||min(w.season)||' maxseason='||max(w.season) FROM award_winners w JOIN awards a ON a.id=w.award_id WHERE a.slug='coleman'; SELECT 'coleman season '||w.season||' rows='||count(*) FROM award_winners w JOIN awards a ON a.id=w.award_id WHERE a.slug='coleman' AND (w.season>=2025 OR w.season IN (SELECT w2.season FROM award_winners w2 JOIN awards a2 ON a2.id=w2.award_id WHERE a2.slug='coleman' GROUP BY w2.season HAVING count(*)>1)) GROUP BY w.season ORDER BY 1; SELECT 'coleman by source '||s.key||' '||count(*) FROM award_winners w JOIN awards a ON a.id=w.award_id JOIN sources s ON s.id=w.source_id WHERE a.slug='coleman' GROUP BY s.key; SELECT 'awards coleman first/last='||first_season||'/'||last_season FROM awards WHERE slug='coleman'; SELECT 'season2026 '||status::text FROM seasons WHERE year=2026;"; } > $EV/awards-aggregates.txt 2>&1
$A vt afldb_v2_rem3integ_aw_test awards-snapshot 3600 tests/integration/awards-reload-links.test.ts
{ $A q afldb_v2_rem3integ_aw_test "SELECT 'coleman rows after run='||count(*) FROM award_winners w JOIN awards a ON a.id=w.award_id WHERE a.slug='coleman'"; } >> $EV/awards-aggregates.txt 2>&1
$A drop afldb_v2_rem3integ_aw_test

# ---- 6. coleman publication: documented base = schema-only database (migrations + privileges), then on a snapshot copy
say "6 coleman"
bash $W/in/coleschema.sh > $EV/coleschema.out 2>&1
$A mkq afldb_v2_rem3integ_cp_test
$A pf afldb_v2_rem3integ_cp_test coleman-snapshot 1800 tests/integration/v2-coleman-publication.test.ts
$A drop afldb_v2_rem3integ_cp_test

# ---- 7. issue276 on a snapshot copy (records the conflicting row); OD-5 on a dedicated afldb_v2_rb_*_test clone
say "7 issue276"
$A mkq afldb_v2_rem3integ_276_test
{ $A q afldb_v2_rem3integ_276_test "SELECT 'm.id='||m.id||' key='||m.match_key FROM matches m WHERE m.id=17266"; } > $EV/issue276-conflict.txt 2>&1
$A pf afldb_v2_rem3integ_276_test issue276-snapshot 1800 tests/integration/settle-afl-api-issue276.test.ts
$A drop afldb_v2_rem3integ_276_test
say "7 od5"
$A mkq afldb_v2_rb_rem3io5_test
$A vt afldb_v2_rb_rem3io5_test od5-snapshot-rbname 3600 tests/integration/settle-afl-api.test.ts -t "OD-5 reinstate (rolled back, no rebuild)"
$A drop afldb_v2_rb_rem3io5_test

# ---- 8. Brownlow dedicated clones from the documented recipe and retained artefacts
say "8 brownlow template"
$BL tmpl
say "8 brownlow clones"
$BL clone afldb_v2_brownlow_tristate_twelve_test
$BL run afldb_v2_brownlow_tristate_twelve_test b2-eligibility-2025 3000
$BL clone afldb_v2_brownlow_policy_final_test
$BL run afldb_v2_brownlow_policy_final_test b1-production-correction 5400
say "QUEUE DONE"
