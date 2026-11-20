# AFLDB closeout worktree inventory, 21 November 2026

Before review records and before Git approval. Paths are the registered absolute worktree paths. Git reported no locked or prunable registration. The comparison ref was `refs/remotes/origin/main` at `b82a6b04a6138207bfb6483b3a4fa4ed143fbe74`, independently checked against the live server. Counts are behind / ahead by commit ancestry, then staged / unstaged / untracked files / ignored entries. Ignored directories count as one entry under Git's matching mode. Zero counts reflect the repository and nested ignore rules visible to Git. The sandbox could not read the user-global ignore file; an otherwise unclassified file still appears as untracked and disqualifies removal. Only the six removal candidates also received a tracked index flag check. None had assume-unchanged or skip-worktree flags. Git status lists paths, without reading the contents of ignored files.

| Path | Local branch | Full HEAD | Behind / ahead | S / U / ? / ignored | Disposition |
|---|---|---|---:|---:|---|
| `D:/dev/afldb` | `claude/issue-339-deploy-preflight` | `549c5892d7e31a962380c9bd0128ae99969f3b75` | 218 / 3 | 0 / 35 / 371 / 219 | Retain primary checkout and local work |
| `D:/dev/afldb-b2b5-publish` | `claude/records-b2b5-published-20261109` | `98a4b1987313bea84e31bed4d64ed6458bb2f509` | 204 / 0 | 0 / 0 / 0 / 0 | Remove upon approval |
| `D:/dev/afldb-catchup-20261111` | `claude/records-d3362-plan-20261112` | `de640826d13489c58392563e7ae1ff62403ed293` | 182 / 0 | 0 / 0 / 0 / 3 | Retain ignored evidence |
| `D:/dev/afldb-enh-20261116` | `claude/enh-season-rounds-player-h2h-20261116` | `2d83738d83b53883b5543762755b8d3f3616050f` | 6 / 11 | 0 / 0 / 0 / 0 | Retain parked enhancement |
| `D:/dev/afldb-i336-packet-r2` | `claude/records-i336-packet-r2-20261109` | `12aa6e29d51099eb6d3fbc901bbe488c5dbd7ab3` | 203 / 0 | 0 / 0 / 8 / 0 | Retain unpublished evidence |
| `D:/dev/afldb-i339-publish` | `claude/issue-339-gate-publish` | `8d122f629df6a610ae4e95805e39583cc2ab8aaf` | 213 / 0 | 0 / 0 / 0 / 0 | Remove upon approval |
| `D:/dev/afldb-i340-345-336` | `claude/issue-340-345-336` | `c1c4b22ee15007111eab66f6d354e0b9ecbb2ade` | 215 / 0 | 0 / 0 / 0 / 0 | Remove upon approval |
| `D:/dev/afldb-i346` | `claude/issue-346-gated-migrate` | `0c47ca0466f9ce493a1661c9912865119c900bfc` | 203 / 3 | 0 / 0 / 0 / 1 | Retain unique commit IDs (0 without patch-ID match) |
| `D:/dev/afldb-records-20261109` | `claude/records-closure-20261109` | `c5959bbf6e2eae9b80467180a20919367afc9475` | 209 / 0 | 0 / 0 / 0 / 0 | Remove upon approval |
| `D:/dev/afldb-release-records-20261112` | `claude/records-release-20261111` | `e751b87fa36d4565a6b6b4390e1f48d157a1a137` | 202 / 0 | 0 / 0 / 0 / 0 | Remove upon approval |
| `D:/dev/afldb-rem-20261114` | `claude/remediation-20261114` | `b82a6b04a6138207bfb6483b3a4fa4ed143fbe74` | 0 / 0 | 0 / 0 / 6 / 8 | Retain release record, local agent files and evidence |
| `D:/dev/afldb-rem-admin` | `claude/rem-admin-20261114` | `c50f2d7be0c213907f7a786059f9f1690f7f16d7` | 181 / 4 | 0 / 0 / 0 / 0 | Retain unique commit IDs (0 without patch-ID match) |
| `D:/dev/afldb-rem-answers` | `claude/rem-answers-20261114` | `63876fa3e0968ef03147aadef2724846aa9c1ee6` | 181 / 3 | 0 / 0 / 0 / 0 | Retain unique commit IDs (0 without patch-ID match) |
| `D:/dev/afldb-rem-auth` | `claude/rem-auth-20261114` | `5e7f5a9cb25b2d8a02661e8c311e1b8aa529b9de` | 181 / 5 | 0 / 0 / 0 / 0 | Retain unique commit IDs (0 without patch-ID match) |
| `D:/dev/afldb-rem-draftguru` | `claude/rem-draftguru-20261114` | `53dd7fe650eb34c05d0634b6d01efe62f99601fe` | 181 / 2 | 0 / 0 / 0 / 0 | Retain unique commit IDs (0 without patch-ID match) |
| `D:/dev/afldb-rem-hostops` | `claude/rem-hostops-20261114` | `234869e183bbfb7e7d1ee506772c27fd63827496` | 181 / 5 | 0 / 0 / 0 / 0 | Retain unique commit IDs (0 without patch-ID match) |
| `D:/dev/afldb-rem-nl` | `claude/rem-nl-20261114` | `38261fd4dccf1ce2ccaf040f042fb885cf99bb90` | 181 / 4 | 0 / 0 / 0 / 0 | Retain unique commit IDs (0 without patch-ID match) |
| `D:/dev/afldb-rem-perf` | `claude/rem-perf-20261114` | `701a84f130208ebd0f08d1e10c117b2b86f32ab3` | 181 / 4 | 0 / 0 / 0 / 0 | Retain unique commit IDs (0 without patch-ID match) |
| `D:/dev/afldb-rem-pins` | `claude/rem-pins-20261114` | `70c1010a14d82bec8354ec6eae94de5b40df9f95` | 181 / 6 | 0 / 0 / 0 / 0 | Retain unique commit IDs (0 without patch-ID match) |
| `D:/dev/afldb-rem-rollover` | `claude/rem-rollover-20261114` | `27f7b13ffa8ea5b2932450f8f643ca3bc8a612a8` | 181 / 6 | 0 / 0 / 0 / 0 | Retain unique commit IDs (0 without patch-ID match) |
| `D:/dev/afldb-rem-routes` | `claude/rem-routes-20261114` | `1207024c8d32b5de6db37134d06fe5190b547f94` | 181 / 4 | 0 / 0 / 0 / 0 | Retain unique commit IDs (0 without patch-ID match) |
| `D:/dev/afldb-rem-tests` | `claude/rem-tests-20261114` | `27b8f3a57c2545fa80b99342a61277f9965aa47c` | 181 / 5 | 0 / 0 / 0 / 0 | Retain unique commit IDs (0 without patch-ID match) |
| `D:/dev/afldb-rem2-admin` | `claude/rem2-admin-20261114` | `985c9a59daacc914e038d7e2a93601fce050573c` | 122 / 5 | 0 / 0 / 0 / 0 | Retain unique commit IDs (0 without patch-ID match) |
| `D:/dev/afldb-rem2-caddy357` | `claude/rem2-caddy357-20261114` | `ee60f0d5b446a67860a33dc1a900077ac6d2031a` | 122 / 2 | 0 / 0 / 0 / 0 | Retain unique commit IDs (0 without patch-ID match) |
| `D:/dev/afldb-rem2-evidence` | `claude/rem2-evidence-20261114` | `ff2c8181c8cd3c1358892b3a46ddc113da0e69e4` | 122 / 7 | 0 / 0 / 0 / 0 | Retain unique commit IDs (1 without patch-ID match) |
| `D:/dev/afldb-rem2-fixtures` | `claude/rem2-fixtures-20261114` | `2d1a45ab6541e66de5ef7c8d951293370ad958d8` | 122 / 1 | 0 / 0 / 0 / 0 | Retain unique commit IDs (0 without patch-ID match) |
| `D:/dev/afldb-rem2-lint364` | `claude/rem2-lint364-20261114` | `118a4a71a1e4b3c7fac3b63043366b6e9d40817c` | 122 / 3 | 0 / 0 / 0 / 0 | Retain unique commit IDs (0 without patch-ID match) |
| `D:/dev/afldb-rem2-ops` | `claude/rem2-ops-20261114` | `6fdc99afa9237bb5efd4ecc87f92f3d7e2bc8bb8` | 122 / 3 | 0 / 0 / 0 / 0 | Retain unique commit IDs (0 without patch-ID match) |
| `D:/dev/afldb-rem2-public` | `claude/rem2-public-20261114` | `77b4c2d8bd04295d9c8e26f854dc9dd46c0c065f` | 122 / 10 | 0 / 0 / 0 / 0 | Retain unique commit IDs (0 without patch-ID match) |
| `D:/dev/afldb-rem2-tests363` | `claude/rem2-tests363-20261114` | `c85784e196934865c0009c84ca77c38ad9ac0f03` | 122 / 6 | 0 / 0 / 0 / 0 | Retain unique commit IDs (0 without patch-ID match) |
| `D:/dev/afldb-rem3-integ` | `claude/rem3-integ-20261114` | `72eabb6380681463780906b234e7480d4774ae5f` | 69 / 1 | 0 / 0 / 0 / 0 | Retain unique commit IDs (0 without patch-ID match) |
| `D:/dev/afldb-rem3-integb` | `claude/rem3-integb-20261114` | `6245b1cc059c1c1829751826b76866809e8b40d5` | 63 / 6 | 0 / 0 / 0 / 0 | Retain unique commit IDs (0 without patch-ID match) |
| `D:/dev/afldb-rem3-qual` | `claude/rem3-qual-20261114` | `6575bc95f6c53a0c16e10a7c1fbdbb5a28a6e549` | 54 / 0 | 0 / 0 / 0 / 0 | Remove upon approval |
| `D:/dev/afldb-rem3-rebuild` | `claude/rem3-rebuild-20261114` | `ccd6568b30e4ec108c914f1a54104a1098eb1edb` | 69 / 1 | 0 / 0 / 0 / 0 | Retain unique commit IDs (0 without patch-ID match) |
| `D:/dev/afldb-rem3-stateb` | `claude/rem3-stateb-20261114` | `1cd090d1b9a90b88a601d6e782ff6718ed678d12` | 69 / 3 | 0 / 0 / 0 / 0 | Retain unique commit IDs (0 without patch-ID match) |
| `D:/dev/afldb-rem4-baseline` | `claude/rem4-baseline-20261115` | `93c667f402dd4bd0620716fe0245dba2a392d554` | 48 / 1 | 0 / 0 / 0 / 0 | Retain unique commit IDs (0 without patch-ID match) |
| `D:/dev/afldb-rem4-brownlow` | `claude/rem4-brownlow-20261115` | `6a24e3f9e61bb56b0714fb248d55f3beb30de79b` | 48 / 4 | 0 / 0 / 0 / 0 | Retain unique commit IDs (0 without patch-ID match) |
| `D:/dev/afldb-rem4-clubcmp` | `claude/rem4-clubcmp-20261115` | `1a22434f2e06bc633a2d95160780b603684ec264` | 48 / 2 | 0 / 0 / 0 / 0 | Retain unique commit IDs (0 without patch-ID match) |
| `D:/dev/afldb-rem4-coleman276` | `claude/rem4-coleman276-20261115` | `8d33874757ed94045dcfa81ef7901565551c21b0` | 48 / 2 | 0 / 0 / 0 / 0 | Retain unique commit IDs (0 without patch-ID match) |
| `D:/dev/afldb-rem4-evidence` | `claude/rem4-evidence-20261115` | `4c452d88e42e4b0e2bb306180a52ec522a455eff` | 48 / 1 | 0 / 0 / 0 / 0 | Retain unique commit IDs (0 without patch-ID match) |
| `D:/dev/afldb-rem4-fixloop` | `claude/rem4-fixloop-20261115` | `ba77ae3be9dbfe44cc61a260e2e072caa5ece2c9` | 16 / 1 | 0 / 0 / 0 / 0 | Retain unique commit IDs (0 without patch-ID match) |
| `D:/dev/afldb-rem4-fixup` | `claude/rem4-fixup-20261115` | `512507df84d1bae3e9c20b0f26fca4c7d69cfee2` | 33 / 3 | 0 / 0 / 0 / 0 | Retain unique commit IDs (0 without patch-ID match) |
| `D:/dev/afldb-rem4-gates` | `claude/rem4-gates-20261115` | `f315a8c6f1952655de52fb9f5d84d1361f9d828f` | 48 / 2 | 0 / 0 / 0 / 0 | Retain unique commit IDs (0 without patch-ID match) |
| `D:/dev/afldb-rem4-leaks` | `claude/rem4-leaks-20261115` | `53b512604b9cb65deaf9c5eb57dabc1a19c12d72` | 48 / 2 | 0 / 0 / 0 / 0 | Retain unique commit IDs (0 without patch-ID match) |
| `D:/dev/afldb-rem4-qual` | `claude/rem4-qual-20261115` | `83d1e83fd183dadb90bbff7c1b09025c74453769` | 21 / 2 | 0 / 0 / 0 / 0 | Retain unique commit IDs (0 without patch-ID match) |
| `D:/dev/afldb-rem4-rbfail` | `claude/rem4-rbfail-20261115` | `77e47c423b327ecfae5a95f6a8317342559d7e19` | 48 / 2 | 0 / 0 / 0 / 0 | Retain unique commit IDs (0 without patch-ID match) |
| `D:/dev/afldb-rem4-shared` | `claude/rem4-shared-20261115` | `1ab94dd9bc2acbd2fb1b49d4ec8c04e35f148434` | 48 / 4 | 0 / 0 / 0 / 0 | Retain unique commit IDs (0 without patch-ID match) |
| `D:/dev/afldb-review-20261114` | `claude/review-full-20261114` | `5035ed96d04261cc4733d8d8de7b8395a5866d20` | 181 / 0 | 0 / 0 / 0 / 17 | Retain ignored evidence |
| `D:/dev/afldbV2/.local-release/issue316-readiness-20261027/execution-P` | detached HEAD | `def676517da3955aa18db3606785463aac464188` | 441 / 0 | 0 / 0 / 0 / 0 | Retain historical release-readiness checkout pending owner disposition |

## Local files to preserve

Exact names from the pre-edit Git status follow. These are preservation records, without a decision to integrate or discard the files. Each line starts with its Git status code. Ignored directories are listed at their boundary to avoid opening their contents.

<details><summary>D:/dev/afldb</summary>

```text
 M CHANGELOG.md
 M IssuesIndex.md
 M blockers.md
 M docs/v2/afl-api-2027-season-operations-successor-2026-11-02.md
 M issues.md
 M issues/open/AFLDB-ISSUE-336-DEV-DEPLOYMENT.md
 M issues/open/AFLDB-ISSUE-336.md
 D issues/open/AFLDB-ISSUE-339.md
 M src/app/admin/admins/password-actions.ts
 M src/app/admin/draft/page.tsx
 M src/app/admin/login/actions.ts
 M src/app/admin/password/actions.ts
 M src/app/draft/[year]/page.tsx
 M src/app/players/[slug]/page.tsx
 M src/app/seasons/[year]/page.tsx
 M src/db/queries/admin-draft.ts
 M src/db/queries/draft.ts
 M src/db/queries/players.ts
 M src/db/queries/rounds.ts
 M src/lib/auth/audience.ts
 M src/lib/auth/session.ts
 M src/styles/globals.css
 M tests/afl-api-ingestion-safety.test.ts
 M tests/auth.test.ts
 M tests/catalogue-lookups.test.ts
 M tests/gap029-ops.test.ts
 M tests/integration/admin-draft.test.ts
 M tests/integration/admin-lifecycle.test.ts
 M tests/integration/database.test.ts
 M tests/integration/player-family-and-coaching.test.ts
 M tests/python/draftguru_bridge_operator_review_contract.py
 M tools/current-season/settle-afl-api-fixture-schedule.ts
 M tools/current-season/settle-afl-api-fixtures.ts
 M tools/maintenance/restore-test.sh
 M tools/v2/gap029-ops/prod-stage.sh
?? .codex/agents/afldb-closure.toml
?? .codex/agents/afldb-mechanic.toml
?? .codex/agents/afldb-orchestrator.toml
?? .codex/agents/afldb-reviewer.toml
?? .codex/agents/afldb-worker.toml
?? .codex/config.toml
?? .local-stepg-20261113/browser-console-attempt1-timeout.txt
?? .local-stepg-20261113/browser-console.txt
?? .local-stepg-20261113/browser/desktop-2008-predraft.png
?? .local-stepg-20261113/browser/desktop-2008.png
?? .local-stepg-20261113/browser/desktop-2009.png
?? .local-stepg-20261113/browser/desktop-2025-predraft.png
?? .local-stepg-20261113/browser/desktop-2025.png
?? .local-stepg-20261113/browser/mobile-2008-predraft.png
?? .local-stepg-20261113/browser/mobile-2008.png
?? .local-stepg-20261113/browser/mobile-2009.png
?? .local-stepg-20261113/browser/mobile-2025-predraft.png
?? .local-stepg-20261113/browser/mobile-2025.png
?? .local-stepg-20261113/browser/result.json
?? .local-stepg-20261113/csv-inventory.txt
?? .local-stepg-20261113/csv/1991_AFL_Draft_and_Trade_Period_Table_1.csv
?? .local-stepg-20261113/csv/1992_AFL_Draft_and_Trade_Period_Table_1.csv
?? .local-stepg-20261113/csv/1993_AFL_Draft_and_Trade_Period_Table_1.csv
?? .local-stepg-20261113/csv/1994_AFL_Draft_and_Trade_Period_Table_1.csv
?? .local-stepg-20261113/csv/1995_AFL_Draft_and_Trade_Period_Table_1.csv
?? .local-stepg-20261113/csv/1996_AFL_Draft_and_Trade_Period_Table_1.csv
?? .local-stepg-20261113/csv/1997_AFL_Draft_and_Trade_Period_Table_1.csv
?? .local-stepg-20261113/csv/1998_AFL_Draft_and_Trade_Period_Table_1.csv
?? .local-stepg-20261113/csv/1999_AFL_Draft_and_Trade_Period_Table_1.csv
?? .local-stepg-20261113/csv/2000_AFL_Draft_and_Trade_Period_Table_1.csv
?? .local-stepg-20261113/csv/2001_AFL_Draft_and_Trade_Period_Table_1.csv
?? .local-stepg-20261113/csv/2002_AFL_Draft_and_Trade_Period_Table_1.csv
?? .local-stepg-20261113/csv/2003_AFL_Draft_and_Trade_Period_Table_1.csv
?? .local-stepg-20261113/csv/2004_AFL_Draft_and_Trade_Period_Table_1.csv
?? .local-stepg-20261113/csv/2005_AFL_Draft_and_Trade_Period_Table_1.csv
?? .local-stepg-20261113/csv/2006_AFL_Draft_and_Trade_Period_Table_1.csv
?? .local-stepg-20261113/csv/2007_AFL_Draft_and_Trade_Period_Table_1.csv
?? .local-stepg-20261113/csv/2008_AFL_Draft_and_Trade_Period_Table_1.csv
?? .local-stepg-20261113/csv/2009_AFL_Draft_and_Trade_Period_Table_1.csv
?? .local-stepg-20261113/csv/2010_AFL_Draft_and_Trade_Period_Table_1.csv
?? .local-stepg-20261113/csv/2011_AFL_Draft_and_Trade_Period_Table_1.csv
?? .local-stepg-20261113/csv/2012_AFL_Draft_and_Trade_Period_Table_1.csv
?? .local-stepg-20261113/csv/2013_AFL_Draft_and_Trade_Period_Table_1.csv
?? .local-stepg-20261113/csv/2014_AFL_Draft_and_Trade_Period_Table_1.csv
?? .local-stepg-20261113/csv/2015_AFL_Draft_and_Trade_Period_Table_1.csv
?? .local-stepg-20261113/csv/2016_AFL_Draft_and_Trade_Period_Table_1.csv
?? .local-stepg-20261113/csv/2017_AFL_Draft_and_Trade_Period_Table_1.csv
?? .local-stepg-20261113/csv/2018_AFL_Draft_and_Trade_Period_Table_1.csv
?? .local-stepg-20261113/csv/2019_AFL_Draft_and_Trade_Period_Table_1.csv
?? .local-stepg-20261113/csv/2020_AFL_Draft_and_Trade_Period_Table_1.csv
?? .local-stepg-20261113/csv/2021_AFL_Draft_and_Trade_Period_Table_1.csv
?? .local-stepg-20261113/csv/2022_AFL_Draft_and_Trade_Period_Table_1.csv
?? .local-stepg-20261113/csv/2023_AFL_Draft_and_Trade_Period_Table_1.csv
?? .local-stepg-20261113/csv/2024_AFL_Draft_and_Trade_Period_Table_1.csv
?? .local-stepg-20261113/csv/2025_AFL_Draft_and_Trade_Period_Table_1.csv
?? .local-stepg-20261113/csv_rows.json
?? .local-stepg-20261113/draft-export.json.gz
?? .local-stepg-20261113/expected.json
?? .local-stepg-20261113/export.sh
?? .local-stepg-20261113/export.stderr
?? .local-stepg-20261113/reconcile-detail.json
?? .local-stepg-20261113/reconcile.txt
?? .local-stepg-20261113/release-status.txt
?? .local-stepg-20261113/stepg.cjs
?? .local-stepg-20261113/summary.json
?? docs/v2/evidence/open-issues-closure-20261108/branchA-merge/merge-ready-340.txt
?? docs/v2/evidence/open-issues-closure-20261108/branchA-merge/merge-ready-345.txt
?? docs/v2/evidence/open-issues-closure-20261108/branchA-merge/preflight-merge.txt
?? docs/v2/evidence/open-issues-closure-20261108/branchA-merge/result.txt
?? docs/v2/evidence/open-issues-closure-20261108/branchA/bra.out
?? docs/v2/evidence/open-issues-closure-20261108/branchA/bundle-heads.txt
?? docs/v2/evidence/open-issues-closure-20261108/branchA/bundle.sha256
?? docs/v2/evidence/open-issues-closure-20261108/branchA/lock.sha256
?? docs/v2/evidence/open-issues-closure-20261108/branchA/result.txt
?? docs/v2/evidence/open-issues-closure-20261108/branchA/tested-sha.txt
?? docs/v2/evidence/open-issues-closure-20261108/ev339/result.txt
?? docs/v2/evidence/open-issues-closure-20261108/ev339/run-output.txt
?? docs/v2/evidence/open-issues-closure-20261108/ev341/c1-1.rc
?? docs/v2/evidence/open-issues-closure-20261108/ev341/c1-2.rc
?? docs/v2/evidence/open-issues-closure-20261108/ev341/c1-3.rc
?? docs/v2/evidence/open-issues-closure-20261108/ev341/c1-4.rc
?? docs/v2/evidence/open-issues-closure-20261108/ev341/c1-5.rc
?? docs/v2/evidence/open-issues-closure-20261108/ev341/c1-6.rc
?? docs/v2/evidence/open-issues-closure-20261108/ev341/c1-7.rc
?? docs/v2/evidence/open-issues-closure-20261108/ev341/c1-8.rc
?? docs/v2/evidence/open-issues-closure-20261108/ev341/c1-9.rc
?? docs/v2/evidence/open-issues-closure-20261108/ev341/c2.rc
?? docs/v2/evidence/open-issues-closure-20261108/ev341/c3.rc
?? docs/v2/evidence/open-issues-closure-20261108/ev341/hostile.pg_service.conf
?? docs/v2/evidence/open-issues-closure-20261108/ev341/result.txt
?? docs/v2/evidence/open-issues-closure-20261108/ev341/run-output.txt
?? docs/v2/evidence/open-issues-closure-20261108/ev341/s0.bys
?? docs/v2/evidence/open-issues-closure-20261108/ev341/s0.rt
?? docs/v2/evidence/open-issues-closure-20261108/ev341/s0.src
?? docs/v2/evidence/open-issues-closure-20261108/ev341/s1.bys
?? docs/v2/evidence/open-issues-closure-20261108/ev341/s1.rt
?? docs/v2/evidence/open-issues-closure-20261108/ev341/s1.src
?? docs/v2/evidence/open-issues-closure-20261108/ev341/s2.bys
?? docs/v2/evidence/open-issues-closure-20261108/ev341/s2.rt
?? docs/v2/evidence/open-issues-closure-20261108/ev341/s2.src
?? docs/v2/evidence/open-issues-closure-20261108/ev341/s3.bys
?? docs/v2/evidence/open-issues-closure-20261108/ev341/s3.rt
?? docs/v2/evidence/open-issues-closure-20261108/ev341/s3.src
?? docs/v2/evidence/open-issues-closure-20261108/ev341/tokens.txt
?? docs/v2/evidence/open-issues-closure-20261108/ev342/c4-activity-at-kill.txt
?? docs/v2/evidence/open-issues-closure-20261108/ev342/c4-parity-restore-at-kill.txt
?? docs/v2/evidence/open-issues-closure-20261108/ev342/c4-parity-source.txt
?? docs/v2/evidence/open-issues-closure-20261108/ev342/c4.rc
?? docs/v2/evidence/open-issues-closure-20261108/ev342/result.txt
?? docs/v2/evidence/open-issues-closure-20261108/ev342/run-output.txt
?? docs/v2/evidence/open-issues-closure-20261108/ev343/ACQ26.post.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/ACQ26.post.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/ACQ26.pre.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/ACQ26.pre.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/ACQ26.stub
?? docs/v2/evidence/open-issues-closure-20261108/ev343/ACQ27.post.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/ACQ27.post.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/ACQ27.pre.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/ACQ27.pre.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/ACQ27.stub
?? docs/v2/evidence/open-issues-closure-20261108/ev343/W1.post.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/W1.post.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/W1.pre.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/W1.pre.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/W1.stub
?? docs/v2/evidence/open-issues-closure-20261108/ev343/W1b.post.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/W1b.post.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/W1b.pre.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/W1b.pre.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/W1b.stub
?? docs/v2/evidence/open-issues-closure-20261108/ev343/W2.post.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/W2.post.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/W2.pre.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/W2.pre.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/W2.stub
?? docs/v2/evidence/open-issues-closure-20261108/ev343/W3.post.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/W3.post.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/W3.pre.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/W3.pre.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/W3.stub
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.D1.post.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.D1.post.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.D1.pre.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.D1.pre.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.D1.stub
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.M1.post.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.M1.post.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.M1.pre.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.M1.pre.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.M1.stub
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.M2.post.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.M2.post.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.M2.pre.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.M2.pre.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.M2.stub
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.M3.post.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.M3.post.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.M3.pre.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.M3.pre.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.M3.stub
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.OK1.post.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.OK1.post.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.OK1.pre.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.OK1.pre.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.OK1.stub
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.OK2.post.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.OK2.post.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.OK2.pre.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.OK2.pre.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.OK2.stub
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.S1.post.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.S1.post.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.S1.pre.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.S1.pre.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.S1.stub
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.U1.post.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.U1.post.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.U1.pre.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.U1.pre.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.U1.stub
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.U2.post.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.U2.post.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.U2.pre.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.U2.pre.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.U2.stub
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.U3.post.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.U3.post.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.U3.pre.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.U3.pre.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.U3.stub
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.V.post.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.V.post.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.V.pre.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.V.pre.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.V.stub
?? docs/v2/evidence/open-issues-closure-20261108/ev343/result.txt
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.D1.post.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.D1.post.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.D1.pre.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.D1.pre.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.D1.stub
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.M1.post.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.M1.post.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.M1.pre.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.M1.pre.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.M1.stub
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.M2.post.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.M2.post.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.M2.pre.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.M2.pre.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.M2.stub
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.M3.post.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.M3.post.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.M3.pre.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.M3.pre.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.M3.stub
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.OK1.post.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.OK1.post.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.OK1.pre.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.OK1.pre.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.OK1.stub
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.OK2.post.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.OK2.post.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.OK2.pre.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.OK2.pre.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.OK2.stub
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.S1.post.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.S1.post.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.S1.pre.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.S1.pre.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.S1.stub
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.U1.post.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.U1.post.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.U1.pre.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.U1.pre.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.U1.stub
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.U2.post.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.U2.post.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.U2.pre.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.U2.pre.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.U2.stub
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.U3.post.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.U3.post.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.U3.pre.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.U3.pre.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.U3.stub
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.V.post.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.V.post.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.V.pre.A
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.V.pre.B
?? docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.V.stub
?? docs/v2/evidence/open-issues-closure-20261108/harness/cluster-up.sh.txt
?? docs/v2/evidence/open-issues-closure-20261108/harness/env.sh.txt
?? docs/v2/evidence/open-issues-closure-20261108/harness/gen343.ts.txt
?? docs/v2/evidence/open-issues-closure-20261108/harness/q339.sh.txt
?? docs/v2/evidence/open-issues-closure-20261108/harness/q341.sh.txt
?? docs/v2/evidence/open-issues-closure-20261108/harness/q342.sh.txt
?? docs/v2/evidence/open-issues-closure-20261108/harness/q343db.sh.txt
?? docs/v2/evidence/open-issues-closure-20261108/harness/q343ev.sh.txt
?? docs/v2/evidence/open-issues-closure-20261108/harness/q343ev2.sh.txt
?? docs/v2/evidence/open-issues-closure-20261108/harness/q343recon.sh.txt
?? docs/v2/evidence/open-issues-closure-20261108/harness/q343run.sh.txt
?? docs/v2/evidence/open-issues-closure-20261108/harness/q343ws.sh.txt
?? docs/v2/evidence/open-issues-closure-20261108/harness/qlib.sh.txt
?? docs/v2/evidence/open-issues-closure-20261108/harness/r338.sh.txt
?? docs/v2/evidence/open-issues-closure-20261108/harness/run.ps1.txt
?? docs/v2/evidence/open-issues-closure-20261108/harness/run2-bra.sh.txt
?? docs/v2/evidence/open-issues-closure-20261108/harness/run2-lib2.sh.txt
?? docs/v2/evidence/open-issues-closure-20261108/harness/run2-stop.sh.txt
?? docs/v2/evidence/open-issues-closure-20261108/harness/run2-w339.sh.txt
?? docs/v2/evidence/open-issues-closure-20261108/harness/run3-g336.sh.txt
?? docs/v2/evidence/open-issues-closure-20261108/harness/run3-mr.sh.txt
?? docs/v2/evidence/open-issues-closure-20261108/harness/setup-ws.sh.txt
?? docs/v2/evidence/open-issues-closure-20261108/harness/v343.sh.txt
?? docs/v2/evidence/open-issues-closure-20261108/harness/v343b.sh.txt
?? docs/v2/evidence/open-issues-closure-20261108/i336-nightly/journal-2026-11-08.txt
?? docs/v2/evidence/open-issues-closure-20261108/i336-nightly/journal-2026-11-09.txt
?? docs/v2/evidence/open-issues-closure-20261108/i336-pin/gap029.txt
?? docs/v2/evidence/open-issues-closure-20261108/i336-pin/lock.sha256
?? docs/v2/evidence/open-issues-closure-20261108/i336-pin/result.txt
?? docs/v2/evidence/open-issues-closure-20261108/i336-pin/tested-sha.txt
?? docs/v2/evidence/open-issues-closure-20261108/i339-publish/harness/mr339.sh.txt
?? docs/v2/evidence/open-issues-closure-20261108/i339-publish/harness/q339cand.sh.txt
?? docs/v2/evidence/open-issues-closure-20261108/i339-publish/merge-ready-339.txt
?? docs/v2/evidence/open-issues-closure-20261108/i339-publish/preflight-merge.txt
?? docs/v2/evidence/open-issues-closure-20261108/i339-publish/result.txt
?? docs/v2/evidence/open-issues-closure-20261108/w339/r2/G-after-A.ledger
?? docs/v2/evidence/open-issues-closure-20261108/w339/r2/G-after-B.ledger
?? docs/v2/evidence/open-issues-closure-20261108/w339/r2/G-before-A.ledger
?? docs/v2/evidence/open-issues-closure-20261108/w339/r2/G-before-B.ledger
?? docs/v2/evidence/open-issues-closure-20261108/w339/r2/G1.txt
?? docs/v2/evidence/open-issues-closure-20261108/w339/r2/G2.txt
?? docs/v2/evidence/open-issues-closure-20261108/w339/r2/N1-after-A.ledger
?? docs/v2/evidence/open-issues-closure-20261108/w339/r2/N1-after-B.ledger
?? docs/v2/evidence/open-issues-closure-20261108/w339/r2/N1-before-A.ledger
?? docs/v2/evidence/open-issues-closure-20261108/w339/r2/N1-before-B.ledger
?? docs/v2/evidence/open-issues-closure-20261108/w339/r2/W1-after-A.ledger
?? docs/v2/evidence/open-issues-closure-20261108/w339/r2/W1-after-B.ledger
?? docs/v2/evidence/open-issues-closure-20261108/w339/r2/W1-before-A.ledger
?? docs/v2/evidence/open-issues-closure-20261108/w339/r2/W1-before-B.ledger
?? docs/v2/evidence/open-issues-closure-20261108/w339/r2/W1-gate-block.sh
?? docs/v2/evidence/open-issues-closure-20261108/w339/r2/W1-gate/20261108T103435Z-streamanator-549c5892d7e3-w339-968427.txt
?? docs/v2/evidence/open-issues-closure-20261108/w339/r2/W1-transition-record.txt
?? docs/v2/evidence/open-issues-closure-20261108/w339/r2/W2-after-A.ledger
?? docs/v2/evidence/open-issues-closure-20261108/w339/r2/W2-after-B.ledger
?? docs/v2/evidence/open-issues-closure-20261108/w339/r2/W2-before-A.ledger
?? docs/v2/evidence/open-issues-closure-20261108/w339/r2/W2-before-B.ledger
?? docs/v2/evidence/open-issues-closure-20261108/w339/r2/W2-parity/20261108T103446Z-streamanator-549c5892d7e3-w339-parity-972512.txt
?? docs/v2/evidence/open-issues-closure-20261108/w339/r2/bundle-heads.txt
?? docs/v2/evidence/open-issues-closure-20261108/w339/r2/bundle.sha256
?? docs/v2/evidence/open-issues-closure-20261108/w339/r2/clone-head.txt
?? docs/v2/evidence/open-issues-closure-20261108/w339/r2/fingerprints.txt
?? docs/v2/evidence/open-issues-closure-20261108/w339/r2/lock.sha256
?? docs/v2/evidence/open-issues-closure-20261108/w339/r2/m118-checksum.txt
?? docs/v2/evidence/open-issues-closure-20261108/w339/r2/result.txt
?? docs/v2/evidence/open-issues-closure-20261108/w339/r2/template.txt
?? docs/v2/evidence/open-issues-closure-20261108/w339/run1-harness-defect/G-afldb_v2_w339_gb_test-A.ledger
?? docs/v2/evidence/open-issues-closure-20261108/w339/run1-harness-defect/G-afldb_v2_w339_gb_test-B.ledger
?? docs/v2/evidence/open-issues-closure-20261108/w339/run1-harness-defect/G1.txt
?? docs/v2/evidence/open-issues-closure-20261108/w339/run1-harness-defect/G2.txt
?? docs/v2/evidence/open-issues-closure-20261108/w339/run1-harness-defect/N1-afldb_v2_w339_n1b_test-A.ledger
?? docs/v2/evidence/open-issues-closure-20261108/w339/run1-harness-defect/N1-afldb_v2_w339_n1b_test-B.ledger
?? docs/v2/evidence/open-issues-closure-20261108/w339/run1-harness-defect/W1-afldb_v2_w339_w1b_test-A.ledger
?? docs/v2/evidence/open-issues-closure-20261108/w339/run1-harness-defect/W1-afldb_v2_w339_w1b_test-B.ledger
?? docs/v2/evidence/open-issues-closure-20261108/w339/run1-harness-defect/W1-gate-block.sh
?? docs/v2/evidence/open-issues-closure-20261108/w339/run1-harness-defect/W1-gate/20261108T103238Z-streamanator-549c5892d7e3-w339-959374.txt
?? docs/v2/evidence/open-issues-closure-20261108/w339/run1-harness-defect/W1-transition-record.txt
?? docs/v2/evidence/open-issues-closure-20261108/w339/run1-harness-defect/W2-afldb_v2_w339_w2b_test-A.ledger
?? docs/v2/evidence/open-issues-closure-20261108/w339/run1-harness-defect/W2-afldb_v2_w339_w2b_test-B.ledger
?? docs/v2/evidence/open-issues-closure-20261108/w339/run1-harness-defect/W2-parity/20261108T103250Z-streamanator-549c5892d7e3-w339-parity-963519.txt
?? docs/v2/evidence/open-issues-closure-20261108/w339/run1-harness-defect/bundle-heads.txt
?? docs/v2/evidence/open-issues-closure-20261108/w339/run1-harness-defect/bundle.sha256
?? docs/v2/evidence/open-issues-closure-20261108/w339/run1-harness-defect/clone-head.txt
?? docs/v2/evidence/open-issues-closure-20261108/w339/run1-harness-defect/fingerprints.txt
?? docs/v2/evidence/open-issues-closure-20261108/w339/run1-harness-defect/lock.sha256
?? docs/v2/evidence/open-issues-closure-20261108/w339/run1-harness-defect/m118-checksum.txt
?? docs/v2/evidence/open-issues-closure-20261108/w339/run1-harness-defect/result.txt
?? docs/v2/evidence/open-issues-closure-20261108/w339/run1-harness-defect/template.txt
?? docs/v2/evidence/open-issues-closure-20261108/w339/w339-r2.out
?? docs/v2/evidence/open-issues-closure-20261108/w339/w339-run1-harness-defect.out
?? docs/v2/issue336-337-340-345-release-packet-2026-11-09.md
?? issues/closed/AFLDB-ISSUE-338-341-342-INDEX-SECTION-20261108.md
?? issues/closed/AFLDB-ISSUE-338.md
?? issues/closed/AFLDB-ISSUE-339-INDEX-SECTION-20261109.md
?? issues/closed/AFLDB-ISSUE-339.md
?? issues/closed/AFLDB-ISSUE-340-345-INDEX-SECTION-20261108.md
?? issues/closed/AFLDB-ISSUE-340.md
?? issues/closed/AFLDB-ISSUE-341.md
?? issues/closed/AFLDB-ISSUE-342.md
?? issues/closed/AFLDB-ISSUE-343-INDEX-SECTION-20261108.md
?? issues/closed/AFLDB-ISSUE-343.md
?? issues/closed/AFLDB-ISSUE-344-INDEX-SECTION-20261108.md
?? issues/closed/AFLDB-ISSUE-344-evidence/V-344-admin-desktop.png
?? issues/closed/AFLDB-ISSUE-344-evidence/V-344-admin-mobile.png
?? issues/closed/AFLDB-ISSUE-344-evidence/V-344-public-desktop.png
?? issues/closed/AFLDB-ISSUE-344-evidence/V-344-public-mobile.png
?? issues/closed/AFLDB-ISSUE-344-evidence/prod/run1-nocapture/results.json
?? issues/closed/AFLDB-ISSUE-344-evidence/prod/run2-capture/V-344-prod-admin-desktop.png
?? issues/closed/AFLDB-ISSUE-344-evidence/prod/run2-capture/V-344-prod-admin-mobile.png
?? issues/closed/AFLDB-ISSUE-344-evidence/prod/run2-capture/V-344-prod-public-desktop.png
?? issues/closed/AFLDB-ISSUE-344-evidence/prod/run2-capture/V-344-prod-public-mobile.png
?? issues/closed/AFLDB-ISSUE-344-evidence/prod/run2-capture/results.json
?? issues/closed/AFLDB-ISSUE-344-evidence/results.json
?? issues/closed/AFLDB-ISSUE-344.md
?? issues/closed/AFLDB-ISSUE-345.md
?? issues/open/OPEN-ISSUES-CLOSURE-RUN-20261108.md
?? src/app/api/players/[id]/opponent-record/route.ts
?? src/components/PlayerOpponentHistoryClient.tsx
?? src/db/queries/admin-credentials.ts
?? src/lib/player-opponent-history.ts
?? tests/restore-test.test.sh
!! .claude/scheduled_tasks.lock
!! .env
!! .local-release/
!! .next/
!! .phaneslight/returns/
!! .playwright-mcp/
!! artifacts/
!! data/records/first-kick-goal.csv
!! data/sources/All-Australian_team/
!! "data/sources/Hall of Fame/"
!! data/sources/afl_api/
!! data/sources/afltables/club_lists/
!! data/sources/afltables/coaches/coaches-20260905/coaches-20260905-raw.tar
!! data/sources/afltables/fitzroy_core/
!! data/sources/draftguru/
!! "data/sources/representative teams/"
!! docs/v2/evidence/block-c-c4b-20261102/acquire.log
!! docs/v2/evidence/block-c-c4b-20261102/run.log
!! docs/v2/evidence/block-c-c4b-20261102/settle-dry-run.log
!! docs/v2/evidence/c4b-fix-r2-20261102/linux-qualification/p0_resources.log
!! docs/v2/evidence/c4b-fix-r2-20261102/linux-qualification/p13_final.log
!! docs/v2/evidence/c4b-fix-r2-20261102/linux-qualification/p1_verify_inputs.log
!! docs/v2/evidence/c4b-fix-r2-20261102/linux-qualification/p3_typecheck.log
!! docs/v2/evidence/c4b-fix-r2-20261102/linux-qualification/p4_cluster.log
!! docs/v2/evidence/c4b-fix-r2-20261102/linux-qualification/p5_db.log
!! docs/v2/evidence/c4b-fix-r2-20261102/linux-qualification/p6_unit.log
!! docs/v2/evidence/c4b-fix-r2-20261102/linux-qualification/p7_c4b.log
!! docs/v2/evidence/c4b-fix-r2-20261102/linux-qualification/run.log
!! docs/v2/evidence/gap016-recon-20261102/capture-recon.log
!! docs/v2/evidence/gap016-recon-20261102/reconciliation-run.log
!! docs/v2/evidence/gap016-recon-20261102/restore-verify.log
!! docs/v2/evidence/gap029-hardening-20261103/linux-q1-421de2ba/asm-1.log
!! docs/v2/evidence/gap029-hardening-20261103/linux-q1-421de2ba/py-contract.log
!! docs/v2/evidence/gap029-hardening-20261103/linux-q1-421de2ba/tsc.log
!! docs/v2/evidence/gap029-hardening-20261103/linux-q1-421de2ba/vitest-editor.log
!! docs/v2/evidence/gap029-hardening-20261103/linux-q1-421de2ba/vitest-focused.log
!! docs/v2/evidence/gap029-hardening-20261103/linux-q2/asm-1.log
!! docs/v2/evidence/gap029-hardening-20261103/linux-q2/py-contract.log
!! docs/v2/evidence/gap029-hardening-20261103/linux-q2/tsc.log
!! docs/v2/evidence/gap029-hardening-20261103/linux-q2/vitest-editor.log
!! docs/v2/evidence/gap029-hardening-20261103/linux-q2/vitest-focused.log
!! docs/v2/evidence/gap029-hardening-20261103/linux-q4/asm-1.log
!! docs/v2/evidence/gap029-hardening-20261103/linux-q4/py-contract.log
!! docs/v2/evidence/gap029-hardening-20261103/linux-q4/tsc.log
!! docs/v2/evidence/gap029-hardening-20261103/linux-q4/vitest-editor.log
!! docs/v2/evidence/gap029-hardening-20261103/linux-q4/vitest-focused.log
!! docs/v2/evidence/gap029-s1-prep-20261103/prepare-s1.log
!! docs/v2/evidence/gap029-s1-prep-20261103/sim/apply-e2.log
!! docs/v2/evidence/gap029-s1-prep-20261103/sim/e3-S1-apply.log
!! docs/v2/evidence/gap029-s1-prep-20261103/sim/e4-S1-apply.log
!! docs/v2/evidence/gap029-s1-prep-20261103/sim/e5-S1-apply.log
!! docs/v2/evidence/gap029-s1-prep-20261103/sim/e5-S2-apply.log
!! docs/v2/evidence/gap029-s1-prep-20261103/sim/e5-S3-apply.log
!! docs/v2/evidence/gap029-s1-prep-20261103/sim/e5-S4-apply.log
!! docs/v2/evidence/gap029-s1-prep-20261103/sim/e8-S1-apply.log
!! docs/v2/evidence/gap029-s1-prep-20261103/sim/e8-S2-apply.log
!! docs/v2/evidence/gap029-s1-prep-20261103/sim/e8-S3-apply.log
!! docs/v2/evidence/gap029-s1-prep-20261103/sim/e8-S4-apply.log
!! docs/v2/evidence/issue336-draft-categories-20261105/dev-preview-20261106/preview-run.log
!! docs/v2/evidence/issue336-draft-categories-20261105/dev-preview-20261106/unit-focused.log
!! docs/v2/evidence/issue336-draft-categories-20261105/prod-tool-rehearsal/rehearsal.log
!! docs/v2/evidence/issue336-draft-categories-20261105/q-q1_cand.log
!! docs/v2/evidence/issue336-draft-categories-20261105/q-q2_typecheck.log
!! docs/v2/evidence/issue336-draft-categories-20261105/q-q3_unit.log
!! docs/v2/evidence/issue336-draft-categories-20261105/q-q4_red.log
!! docs/v2/evidence/issue336-draft-categories-20261105/q-q5_db.log
!! docs/v2/evidence/issue336-draft-categories-20261105/q-q6_build.log
!! docs/v2/evidence/issue336-draft-categories-20261105/q-q7_start.log
!! docs/v2/evidence/open-issues-closure-20261108/branchA/admin-lifecycle.log
!! docs/v2/evidence/open-issues-closure-20261108/branchA/auth.log
!! docs/v2/evidence/open-issues-closure-20261108/branchA/gap029.log
!! docs/v2/evidence/open-issues-closure-20261108/branchA/migrate.log
!! docs/v2/evidence/open-issues-closure-20261108/branchA/privileges.log
!! docs/v2/evidence/open-issues-closure-20261108/branchA/typecheck.log
!! docs/v2/evidence/open-issues-closure-20261108/ev341/c1-1.log
!! docs/v2/evidence/open-issues-closure-20261108/ev341/c1-2.log
!! docs/v2/evidence/open-issues-closure-20261108/ev341/c1-3.log
!! docs/v2/evidence/open-issues-closure-20261108/ev341/c1-4.log
!! docs/v2/evidence/open-issues-closure-20261108/ev341/c1-5.log
!! docs/v2/evidence/open-issues-closure-20261108/ev341/c1-6.log
!! docs/v2/evidence/open-issues-closure-20261108/ev341/c1-7.log
!! docs/v2/evidence/open-issues-closure-20261108/ev341/c1-8.log
!! docs/v2/evidence/open-issues-closure-20261108/ev341/c1-9.log
!! docs/v2/evidence/open-issues-closure-20261108/ev341/c2.log
!! docs/v2/evidence/open-issues-closure-20261108/ev341/c3.log
!! docs/v2/evidence/open-issues-closure-20261108/ev342/c4.log
!! docs/v2/evidence/open-issues-closure-20261108/ev342/c5.log
!! docs/v2/evidence/open-issues-closure-20261108/ev343/ACQ26.log
!! docs/v2/evidence/open-issues-closure-20261108/ev343/ACQ27.log
!! docs/v2/evidence/open-issues-closure-20261108/ev343/W1.log
!! docs/v2/evidence/open-issues-closure-20261108/ev343/W1b.log
!! docs/v2/evidence/open-issues-closure-20261108/ev343/W2.log
!! docs/v2/evidence/open-issues-closure-20261108/ev343/W3.log
!! docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.D1.log
!! docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.M1.log
!! docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.M2.log
!! docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.M3.log
!! docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.OK1.log
!! docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.OK2.log
!! docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.S1.log
!! docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.U1.log
!! docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.U2.log
!! docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.U3.log
!! docs/v2/evidence/open-issues-closure-20261108/ev343/fixtures.V.log
!! docs/v2/evidence/open-issues-closure-20261108/ev343/migrate-afldb_v2_i343a_test.log
!! docs/v2/evidence/open-issues-closure-20261108/ev343/migrate-afldb_v2_i343b_test.log
!! docs/v2/evidence/open-issues-closure-20261108/ev343/privileges-afldb_v2_i343a_test.log
!! docs/v2/evidence/open-issues-closure-20261108/ev343/privileges-afldb_v2_i343b_test.log
!! docs/v2/evidence/open-issues-closure-20261108/ev343/run.log
!! docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.D1.log
!! docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.M1.log
!! docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.M2.log
!! docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.M3.log
!! docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.OK1.log
!! docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.OK2.log
!! docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.S1.log
!! docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.U1.log
!! docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.U2.log
!! docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.U3.log
!! docs/v2/evidence/open-issues-closure-20261108/ev343/schedule.V.log
!! docs/v2/evidence/open-issues-closure-20261108/ev343/stub-requests.log
!! docs/v2/evidence/open-issues-closure-20261108/i338-python.log
!! docs/v2/evidence/open-issues-closure-20261108/i338-vitest.log
!! docs/v2/evidence/open-issues-closure-20261108/i339-publish/linux-harness.log
!! docs/v2/evidence/open-issues-closure-20261108/i339-publish/windows-static.log
!! docs/v2/evidence/open-issues-closure-20261108/w339/r2/N1-child.log
!! docs/v2/evidence/open-issues-closure-20261108/w339/r2/W1-run.log
!! docs/v2/evidence/open-issues-closure-20261108/w339/r2/W2-child.log
!! docs/v2/evidence/open-issues-closure-20261108/w339/r2/W2-parity.log
!! docs/v2/evidence/open-issues-closure-20261108/w339/r2/tpl-migrate.log
!! docs/v2/evidence/open-issues-closure-20261108/w339/run1-harness-defect/N1-child.log
!! docs/v2/evidence/open-issues-closure-20261108/w339/run1-harness-defect/W1-run.log
!! docs/v2/evidence/open-issues-closure-20261108/w339/run1-harness-defect/W2-child.log
!! docs/v2/evidence/open-issues-closure-20261108/w339/run1-harness-defect/W2-parity.log
!! docs/v2/evidence/open-issues-closure-20261108/w339/run1-harness-defect/tpl-migrate.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/controls-run3-final/H1.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/controls-run3-final/H10.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/controls-run3-final/H11.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/controls-run3-final/H12.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/controls-run3-final/H12c.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/controls-run3-final/H12d.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/controls-run3-final/H12e.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/controls-run3-final/H12f.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/controls-run3-final/H12g.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/controls-run3-final/H13.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/controls-run3-final/H2a.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/controls-run3-final/H2b.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/controls-run3-final/H3a.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/controls-run3-final/H3b.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/controls-run3-final/H3c.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/controls-run3-final/H3d.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/controls-run3-final/H3e.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/controls-run3-final/H4.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/controls-run3-final/H5.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/controls-run3-final/H5b.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/controls-run3-final/H6.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/controls-run3-final/H6b.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/controls-run3-final/H7.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/controls-run3-final/H7b.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/controls-run3-final/H8.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/controls-run3-final/H8b.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/controls-run3-final/RB3.prev-build.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/controls-run3-final/RB4.prev-server.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/controls-run3-final/RB5.runtime.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/controls-run3-final/RB6.prev-brownlow.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/controls-run3-final/RB7.prev-privileges.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/controls-run3-final/controls.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/failed-controls-run1-reserve-stop/diskwatch.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/failed-controls-run2-h-harness/diskwatch.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/logs/
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/rehearsal-evidence/AM.default-app.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/rehearsal-evidence/AM.default-import.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/rehearsal-evidence/AM.migrate.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/rehearsal-evidence/AM.privileges.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/rehearsal-evidence/B.default-app.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/rehearsal-evidence/B.default-import.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/rehearsal-evidence/B.migrate.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/rehearsal-evidence/B.privileges.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/rehearsal-evidence/B.restore.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/rehearsal-evidence/T.stderr.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/rehearsal-evidence/T.stdout.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/rehearsal-evidence/after.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/rehearsal-evidence/rehearse.log
!! docs/v2/evidence/production-execution-20261030/run-20261030T020000Z/rehearsal-evidence/release-gates.stderr.log
!! issues/open/AFLDB-ISSUE-316-dp-proposal-20261025/simulation-objects/
!! issues/open/AFLDB-ISSUE-316-dp-proposal-20261025/simulation.index
!! issues/open/AFLDB-ISSUE-316-dp-proposal-20261025/simulations/
!! issues/open/AFLDB-ISSUE-316-u3-correction-20261024/deployed-derived-read.stderr.log
!! issues/open/AFLDB-ISSUE-316-u3-correction-20261024/deployed-derived-read.stdout.log
!! issues/open/AFLDB-ISSUE-316-u3-correction-20261024/metadata-investigation.stderr.log
!! issues/open/AFLDB-ISSUE-316-u3-correction-20261024/metadata-investigation.stdout.log
!! issues/open/AFLDB-ISSUE-316-u3-correction-20261024/metadata-repair-v4-validation-rsfO5W/PG-TRANSPORT.stderr.log
!! issues/open/AFLDB-ISSUE-316-u3-correction-20261024/metadata-repair-v4-validation-rsfO5W/PG-TRANSPORT.stdout.log
!! issues/open/AFLDB-ISSUE-316-u3-correction-20261024/metadata-repair-v5-validation-2RK1Lx/PG-SERVER.log
!! issues/open/AFLDB-ISSUE-316-u3-correction-20261024/metadata-repair-v5-validation-2RK1Lx/PG-TRANSPORT.stderr.log
!! issues/open/AFLDB-ISSUE-316-u3-correction-20261024/metadata-repair-v5-validation-2RK1Lx/PG-TRANSPORT.stdout.log
!! issues/open/AFLDB-ISSUE-316-u3-correction-20261024/metadata-repair-v5-validation-GFhNS5/PG-SERVER.log
!! issues/open/AFLDB-ISSUE-316-u3-correction-20261024/metadata-repair-v5-validation-GFhNS5/PG-TRANSPORT.stderr.log
!! issues/open/AFLDB-ISSUE-316-u3-correction-20261024/metadata-repair-v5-validation-GFhNS5/PG-TRANSPORT.stdout.log
!! issues/open/AFLDB-ISSUE-316-u3-correction-20261024/metadata-repair-v5-validation-HgahMt/PG-SERVER.log
!! issues/open/AFLDB-ISSUE-316-u3-correction-20261024/metadata-repair-v5-validation-HgahMt/PG-TRANSPORT.stderr.log
!! issues/open/AFLDB-ISSUE-316-u3-correction-20261024/metadata-repair-v5-validation-HgahMt/PG-TRANSPORT.stdout.log
!! issues/open/AFLDB-ISSUE-316-u3-correction-20261024/metadata-repair-v5-validation-NABjAE/PG-SERVER.log
!! issues/open/AFLDB-ISSUE-316-u3-correction-20261024/metadata-repair-v5-validation-NABjAE/PG-TRANSPORT.stderr.log
!! issues/open/AFLDB-ISSUE-316-u3-correction-20261024/metadata-repair-v5-validation-NABjAE/PG-TRANSPORT.stdout.log
!! issues/open/AFLDB-ISSUE-316-u3-correction-20261024/sandbox-precheck.stderr.log
!! issues/open/AFLDB-ISSUE-316-u3-correction-20261024/sandbox-precheck.stdout.log
!! legacy/offline/tools/email_intake/__pycache__/
!! legacy/offline/tools/rebuild/afltables/__pycache__/
!! legacy/offline/tools/rebuild/draftguru/__pycache__/
!! next-env.d.ts
!! node_modules/
!! tests/python/__pycache__/
!! tools/migration/__pycache__/
!! tools/rebuild/afltables/__pycache__/
!! tools/rebuild/draftguru/__pycache__/
!! tools/rebuild/fitzroy/__pycache__/
!! tools/v2/__pycache__/
!! tsconfig.tsbuildinfo
```

</details>

<details><summary>D:/dev/afldb-catchup-20261111</summary>

```text
!! docs/v2/evidence/issue336-d3362-apply-20261112/run/apply-1.log
!! docs/v2/evidence/issue336-d3362-apply-20261112/run/apply-wrapper.log
!! docs/v2/evidence/issue336-d3362-apply-20261112/run/verify-1.log
```

</details>

<details><summary>D:/dev/afldb-i336-packet-r2</summary>

```text
?? docs/v2/evidence/issue336-337-340-345-release-r2-20261109/post-publication-evidence-UNCOMMITTED/merge-ready-336.txt
?? docs/v2/evidence/issue336-337-340-345-release-r2-20261109/post-publication-evidence-UNCOMMITTED/offline-d0d1.txt
?? docs/v2/evidence/issue336-337-340-345-release-r2-20261109/post-publication-evidence-UNCOMMITTED/pkg-a.sh.txt
?? docs/v2/evidence/issue336-337-340-345-release-r2-20261109/post-publication-evidence-UNCOMMITTED/pkg-a2.sh.txt
?? docs/v2/evidence/issue336-337-340-345-release-r2-20261109/post-publication-evidence-UNCOMMITTED/pkg-b.sh.txt
?? docs/v2/evidence/issue336-337-340-345-release-r2-20261109/post-publication-evidence-UNCOMMITTED/pre-publication-n5n6-rerun.txt
?? docs/v2/evidence/issue336-337-340-345-release-r2-20261109/post-publication-evidence-UNCOMMITTED/pre-publication.txt
?? docs/v2/evidence/issue336-337-340-345-release-r2-20261109/post-publication-evidence-UNCOMMITTED/preflight-merge.txt
```

</details>

<details><summary>D:/dev/afldb-i346</summary>

```text
!! .phaneslight/returns/
```

</details>

<details><summary>D:/dev/afldb-rem-20261114</summary>

```text
?? .codex/agents/afldb-closure.toml
?? .codex/agents/afldb-mechanic.toml
?? .codex/agents/afldb-orchestrator.toml
?? .codex/agents/afldb-reviewer.toml
?? .codex/agents/afldb-worker.toml
?? docs/v2/evidence/remediation-20261114/run7/sitting-exec-20261120/README.md
!! .phaneslight/returns/
!! docs/v2/evidence/remediation-20261114/run2/qualification-2/build-next.log
!! docs/v2/evidence/remediation-20261114/run2/qualification-2/build-standalone.log
!! docs/v2/evidence/remediation-20261114/run2/qualification-2/lint-gate.log
!! docs/v2/evidence/remediation-20261114/run2/qualification-2/restore-test.test.sh.log
!! docs/v2/evidence/remediation-20261114/run2/qualification-2/sync-dev-remote.test.sh.log
!! docs/v2/evidence/remediation-20261114/run2/qualification-2/typecheck.log
!! docs/v2/evidence/remediation-20261114/run2/qualification-2/unit-stagea2.log
```

</details>

<details><summary>D:/dev/afldb-review-20261114</summary>

```text
!! docs/v2/evidence/full-review-20261114/baseline/build-standalone.log
!! docs/v2/evidence/full-review-20261114/baseline/mkdbs.log
!! docs/v2/evidence/full-review-20261114/baseline/p0_resources.log
!! docs/v2/evidence/full-review-20261114/baseline/p1_clone.log
!! docs/v2/evidence/full-review-20261114/baseline/p2_deps.log
!! docs/v2/evidence/full-review-20261114/baseline/p3_typecheck.log
!! docs/v2/evidence/full-review-20261114/baseline/p3b_lint.log
!! docs/v2/evidence/full-review-20261114/baseline/p4_cluster.log
!! docs/v2/evidence/full-review-20261114/baseline/p5_template.log
!! docs/v2/evidence/full-review-20261114/baseline/p6_unit.log
!! docs/v2/evidence/full-review-20261114/baseline/p7_integration.log
!! docs/v2/evidence/full-review-20261114/baseline/p7b_shell.log
!! docs/v2/evidence/full-review-20261114/baseline/p8_build.log
!! docs/v2/evidence/full-review-20261114/baseline/p9_stop.log
!! docs/v2/evidence/full-review-20261114/baseline/restore-test-sh.log
!! docs/v2/evidence/full-review-20261114/baseline/run.log
!! docs/v2/evidence/full-review-20261114/baseline/sync-dev-remote-sh.log
```

</details>
