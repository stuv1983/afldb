# Owner packet: production-operations backlog (prepared 21 November 2026)

**Status: PREPARATION ONLY.** Nothing in this packet has run on production. There was no SSH, HTTP probe or other contact with
production while it was prepared. Every production fact below is quoted from a dated record and cited. Where a fact may have
changed, the request lists the read-only probe that must re-read it first. streamanator was inspected read-only (`ls`, `du`,
`find`, `sha256sum`, `ps`) on 2026-11-21 at 09:20Z. Nothing was stopped, moved or deleted there.

| Pin | Value | Source |
|---|---|---|
| Serving release | `c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC`: promoted 2026-11-21 06:05:44Z, owner restart 06:17:12Z (InvocationID `0f8ca9f3…`) | `docs/v2/evidence/remediation-20261114/run7r3/sitting-exec-20261121/README.md:52-53,32` |
| Rollback target (`previous`) | `a2e6ea9995a4-aKAYwf0qC4go6JJWiHhv5`. It serves the published 2026 season correctly. | same `:84-85`; `run7r3/RELEASE-PACKET-7R3.md` §8.1 |
| Serving checkout | `/home/arm/projects/afldb` fast-forwarded to `c8d4202a` at P2 | sitting `:49`; `run7r2/RELEASE-PACKET-7R2.md:27` |
| `origin/main` | `40fb1c68`, a records-only commit. `git diff c8d4202a 40fb1c68 -- deploy tools src next.config.ts package.json` is empty, verified for this packet. | this branch |
| 2026 Brownlow | published revision 3 (audit 207, 07:26:25Z), with the 14 D-370-1 ids ineligible | sitting `:72` |
| Newest production backup | D1 `/home/arm/backups/afldb-r7r3-20261121T060018Z/afldb_prod-20261121-171827.dump`, sha256 `ec907085…b287`, taken **before** the D4 attachment and both publications | sitting `:59,63,65,68,72` |

**Prerequisites are met in the serving tree.** Every file the procedures install or run is present at `c8d4202a`
(`git ls-tree c8d4202a`). The sha256 values below were computed from `git show c8d4202a:<path>` and are the values to
compare on the host:

| File | sha256 at `c8d4202a` |
|---|---|
| `deploy/host-policy/needrestart-afldb-hold.conf` | `183691d90ff3777ce199b8d3d154c812532aad6be4c195f324cc3141b506350e` |
| `deploy/host-policy/apt-52-afldb-unattended.conf` | `4a277b8b6e7c7c8b8d2cb347f8949260941327cd24dbd5f3664b317611648810` |
| `deploy/afldb-settle-failure-status.sh` | `d80838cbb7162c3877ab9bf0c87d70a575b55fbc7f902bcc74d4bc6f9e65abd8` |
| `deploy/afldb-settle-failure@.service` | `4463e1e046e34c1729675d7cf45a213fdbb8128cb667d5479adfe69360c2d3fb` |
| `deploy/afldb-settle-afl-api.service.d/on-failure.conf` | `63d6271883879028e8ea945323c79da2f225cc74a83d29f4a33d17b5652df26a` |
| `deploy/afldb-backup.service` / `.timer` | `edf00291…bbdc8` / `76a7ab3a…78d84` |
| `deploy/afldb-backup-verify.service` / `.timer` | `797581e3…212ea` / `377cf2ec…8836b` |
| `deploy/afldb-backup-failed.service` | `c6a5b5fe…f8b61` |
| `tools/maintenance/scheduled-backup.sh` | `c318c4a5c0a7b0e2398a6cfa55368efbc023d13c52c8bc2d671676cd52a26b21` |
| `tools/maintenance/restore-test.sh` | `8a0ac676455523e484c78602cdb7a04197625348b55fa5950d9497e9a43955e8` |
| `tools/maintenance/backup.sh` | `776d066e9525f6a5bbb02fcb16f2b1099ce104814bb7797875f1dcdf3fa31311` (still prunes to 7 when run bare: `:40-41`, `:123-127`) |
| `tools/maintenance/offhost-pull.sh` | `ea48205a02e6383c2fe87a9e896afed422ff44834231270cbd22dc78c305de9b` (it has the durable `.retention-hold`) |
| `deploy/Caddyfile.production` | `f00859d5c834be09f064d516ea4fa12612da379e377128e784b3523016a6086d`, **equal** to the run-2 value (`run2/caddy357/README.md` §11) |
| `tools/v2/issue350-season-open-production.ts` | `26e7c5e6580e30040a64feee293e2e5daed8b51706db87308f1348aa9ff6aeea` |
| `tools/v2/season-opening-check.ts` | `5ebd2ef85fd61634c70fd317ffabb69f2ff48ae4323dcd397919400e14452bc8` |
| `docs/v2/evidence/remediation-20261114/rollover/reverse-opening.sql` | `063768e4f4b3cc27cb37cbfd35d48ece553eb2909173719cc801280b7dc60cf9` |

The remediation commits these requests rely on are all ancestors of `c8d4202a`. That was checked with
`git merge-base --is-ancestor` for 68f8c0da, cb025bbd, b44090cf, e905915a, a434a4a4, 87615e80, b607d09f, c3364559, e51df369,
19164095, 2797d8ad, e9554f81, e03d0d5b, cdf2bce5, 5a354cb9, 8015f590, c79d7d06, 773182ea, 102c4226, 35bbc67f, 24940377,
532dcd77 and 3ec73bcf. The migration ledger head in the tree is unchanged: `118_fixtures_unconfirmed_participants.sql`
(`profile.production.env:20-21`).

---

## 1. Decision register

### 1.1 Already decided, cited verbatim (context only; nothing to answer here)

| Item | Recorded decision (verbatim) | Where |
|---|---|---|
| D-336-3, which governs D-348 (3) | "Owner decision **D-336-3 = option (A)**, 2026-11-11: keep the stored `original_club_raw` values now. Preserve the 187-row classification for the next planned DraftGuru acquisition, and present the three club replacements separately for adjudication." | `issues.md:54849` |
| The ISSUE-332 gate register G1–G7 (D-332-1 sits beside it) | "Adopted decisions (G1-G7, 2026-11-04 items) are unchanged." The 2026-11-04 record reads: "**D-316-5** accepted … **D-316-8** accepted … **D-316-9** accepted … **D-316-10** accepted … **C7:** criteria 1 to 7 approved …" | `issues.md:53849`, `:53837` |
| D-HO-4 `--attended`: **exercised but never recorded as a decision** | Approval R7 contains "Confirm I am present and ready before promoting with --attended." 7R3 P4 then promoted through the gated `promote` (`HOST GATE PASS`). | `run7/sitting-exec-20261120/README.md:13`; `run7r3/sitting-exec-20261121/README.md:52` |
| D-350-2 settle behaviour (not in this packet's list) | The `season_row_missing` HALT is in code and live in `c8d4202a` | `rollover/README.md` §11 |

**Nothing else in this packet's list is decided.** `blockers.md:19` names as "Awaiting owner decision": "D-332-1 amendment
(pull check) and G0b/G0c; … ISSUE-357 O-1 residual and prune job; ISSUE-362 O-1 pre-fix logs; ISSUE-364 O-2 acceptance;
D-350-1; D-HO-1..7". The ledger says the same for 332 (`issues.md:53849` "Proposed, not adopted"), 348 (`:54884`), 350
(`:54919` "D-350-1 remains the owner's"), 351 (`:54936`), 352 (`:54964`), 357 (`:55043`), 362 (`:55123`) and 364 (`:55196`).
The operating record marks G0/G0b "PROPOSED, not adopted" (`docs/v2/afl-api-2027-season-operations-successor-2026-11-02.md:129`).
No later packet records an answer: packets 3, 4 and 5 (`run5/APPROVAL-PACKET-5.md:101-113`), the 6R record, R7, 7R2 and 7R3.

### 1.2 Decisions still needed

Each question gives the recommendation, what each option leads to, and what can run once you answer. "Runs next" means an
approval request in §3. Answering a question authorises nothing on production.

**Q1. ISSUE-332: failed-nightly visibility (D-332-1, its amendment, and the gate IDs).**
- (a) **D-332-1 amendment, option A (recommended).** An hourly read-only pull check from a host you own, over a forced-command
  key, with an alarm sent to a channel you already watch. It detects a failed run, a stalled timer and a dead host, and needs
  no change to any production unit. Delivery counts only after one deliberate test alarm arrives. Blind spots: a reboot
  resets `Result`, and an off-season `AMBIGUOUS:0` run reads OK (procedure 04 §8).
  - Option B, the push transport unit: never run under systemd, and it needs production egress.
  - Option E, a manual check each round (the status quo): a failed nightly can go unseen.
  - The original D-332-1 (install the notifier, then pick a transport) cannot deliver anything. The notifier runs with
    `PrivateNetwork=true` (procedure 04 §1).
- (b) **Notifier template and drop-in:** optional, for the local marker only. Recommended: install it in the same sitting
  (one `daemon-reload`, nothing else changes).
- (c) **Gate IDs, recommended adopt.** G0 = 2027 open by 2027-03-10. G0b = failure visibility (option A delivering).
  G0c = the first nightly after opening applies with no `season_row_missing` HALT. Without this, `G0b` keeps its two
  meanings (`issues.md:53849`). The replacement register text is in §5.
- **Runs next:** R2 (needs the owner host and channel from you).

**Q2. ISSUE-348: the DraftGuru re-acquisition (calendar: Nov–Dec).**
- (a) **Keep the reload guard as the enforced gate (recommended: yes).** It is in code and live (`773182ea` and `102c4226`
  are in `c8d4202a`). "No" means relying on a manual gate, and an unguarded full reload would delete the 35 audited D-336-2
  picks and their 31 persons (`issues.md:54875`).
- (b) **Re-baseline the contract at the acquisition (recommended: yes, to the acquisition's own reviewed counts).** Production
  holds 6,845 DraftGuru picks against the frozen 6,810 (`issues.md:54872`, `:54881`).
  - Yes: `draftguru-contract.json` `total_rows`, `DRAFTGURU_EXPECTED` (`tools/db/rebuild-test.ts`), `EXPECT_STAGE_A_EVENTS`
    and the linkage SQL move with the load.
  - No: the `afldb_test` rebuild contract keeps differing from production by the audited rows.
- (c) **The three REPLACE_CLUB rows: 5961, 6784 (Finlay Macrae) and 6626 (Blake Leidler).** Recommended: accept the incoming
  value at the acquisition, **only if** the fresh DraftGuru value equals the 2026-11-05 CSV value exactly
  (`Kew Rovers/…` for 5961 and 6784, `Surrey Park/Wesley College/Oakleigh U18` for 6626). If it differs, present the row
  again. The reference to record is the CSV hash in `SHA256SUMS.owner-csv`.
  - The guard accepts only `{id, decision: "accept_incoming", reference}` (`tools/rebuild/draftguru/reload_guard.py:519-526`).
  - Keeping the stored value has no mechanical path. You would have to correct the incoming row before load, or set an
    admin-editor override afterwards, which pins that value against later reloads (`issues.md:54873`).
- **How the acquisition would run.** This is a later, separately approved production data write, not one of this packet's
  requests:
  1. Obtain the fresh export.
  2. Re-run `scripts/classify.py` with `extract_pairs.py` against the export and the then-current production rows.
  3. Run `tools/rebuild/draftguru/import_draftguru.py --dry-run --guard-report <new.json>`. It refuses and prints
     `effect_digest`, writing nothing.
  4. Build the reconciliation (`afldb-draftguru-reconciliation/1`), with `origin_review` rows for the auto-accepted classes
     and `owner_rulings` for the REPLACE_CLUB, OTHER and INSERT_MIXED rows.
  5. Review it.
  6. Run with `--reconciliation FILE --reconciliation-sha256 <sha>`, with the admin draft editor quiet (TOCTOU,
     `issues.md:54883`).
  7. Re-baseline per (b).

  Procedure: `tools/rebuild/draftguru/README.md:1353-1380`.

**Q3. ISSUE-350: when to open 2027 (D-350-1).**
- (b) **Recommended: open in an attended daytime window in the week of 2027-02-15 to 2027-03-03.** That is after Q1/R2 and R3
  are working, leaves a week of slack before G0 (2027-03-10), and is well before Opening Round (2027-03-17).
- (a) **Open now.** Safe, but for the whole off-season it publishes an empty `/seasons/2027`, a provisional 2027 comparison
  option and a 2027 admin ceiling (`rollover/README.md` §5).
- (c) **Never.** The nightly HALTs `season_row_missing` from the first concluded 2027 match. This is fail-closed, but no 2027
  result is ingested.
- **Runs next:** R8 in the chosen window. The capture, isolated restore and plan steps can run a few days before.

**Q4. ISSUE-351: host policy, `--attended`, and the pending reboot.**
- **D-HO-1 (recommended: install both files, plus a weekly owned 30-minute window; give the day and time).**
  - Install: security updates keep installing. Only the automatic restarts of `afldb` and PostgreSQL stop, along with
    unattended PostgreSQL server upgrades.
  - Cost: held PostgreSQL updates and stale-library restarts are yours, in the window. Without the window this is an
    unbounded security debt (procedure 02 §2-§3).
  - Not installing: every libc or PostgreSQL update keeps restarting the site for about 5 s, as on 2026-11-14. The
    unattended-activation risk applies only while a promoted release awaits its restart, which is not the case today.
- **D-HO-4 (recommended: record acceptance).** It is already exercised (see §1.1). Nothing runs.
- **D-HO-6 (recommended: one attended reboot as its own operation).** Do it after R0, R1 and R2, and after a verified
  off-host copy exists. Confirm DigitalOcean console access first, and take a snapshot if the panel offers one.
  - P4 of 7R3 still reports the reboot pending, about 97 days since the 2026-08-16 boot.
  - Declining leaves the kernel patches unapplied. The policy reports "reboot pending" until the reboot is done.
- **Runs next:** R1, then R6.

**Q5. ISSUE-352: backups.**
- **D-HO-2 (recommended: install the units).** First runs attended, then `status` exit 0, then enable the timers.
- **D-HO-3 (recommended: option A, a pull to a host you own; name it).**
  - The host needs `rsync` and `pg_restore` 16, must run the job daily, and must be treated as holding production secrets.
  - streamanator qualifies technically: `/usr/bin/rsync` 3.2.7 and `/usr/bin/pg_restore` 16.15, read 2026-11-21. But it is
    a DEV host with its own maintenance (procedure 04 §3).
  - Option B: object storage plus `gpg`. Option C: a mounted volume. C does not survive droplet loss.
- **D-HO-5 (recommended: not yet).** An extra dump after each settle. The cost of waiting is up to about 29 h of nightly
  writes, all re-derivable.
- **D-HO-7 (recommended: drop the five stale `afldb_prod_*` databases, but only after R3's first verified off-host copy).**
  `afldb_prod_auth_recovery`, two `afldb_prod_candidate_*` and two `afldb_prod_pre_rebuild_*` (`hostops/README.md:208-209`).
  If you want forensic copies, archive one `pg_dump` of each, encrypted, first.
- **Runs next:** R0 now (independent of these answers), then R3, then R7.

**Q6. ISSUE-357: the O-1 residual.** Recommended: install the deny (R4) and keep the beta gate on. Before any public launch, add
both a bound (the prune job, or allow-lists for clubs, venues and honour teams) and a disk alert.
- The consequence once the gate is off without a bound: about 76 KiB per well-formed unknown slug, so 45 GB lasts about
  3.4 h at the measured 51 paths/s (`issues.md:55048`).
- Alternative: install and add the prune job now. Its script exists only under
  `docs/v2/evidence/remediation-20261114/run2/caddy357/scripts/` (finding F-10).
- **Runs next:** R4. The prune job and alert become a later request.

**Q7. ISSUE-362: O-3 and O-1.**
- **O-3 (recommended: install, as the single combined Caddy install, R4).**
- **O-1 (recommended: option b after R4).** First check that `admin_invites` holds no live invite. Then delete the rolled
  `.log.gz` files and truncate the two live logs.
  - Choose option d (an encrypted archive copied to your host, then delete) if you want access history kept for incident
    review.
  - `rm` and `truncate` are not secure erasure.
- **Runs next:** R4, then R5.

**Q8. ISSUE-364 O-2.** Recommended: accept the merge-time ratchet. `lint:gate` runs in `preflight` and `merge:ready`, allowing
338 errors in 43 files, and qualified rc 0 at 7R3 (`run7r3/DEV-QUALIFICATION-SUMMARY.txt:7`). Accepting resolves ISSUE-364,
which is published (`c79d7d06` is in `c8d4202a`). The alternative is to also gate release and CI, which is a larger change.
Nothing runs on production.

### 1.3 Suggested single reply (edit the blanks)

> Q1 adopt D-332-1 option A, owner host ________, channel ________, notifier template yes, adopt G0/G0b/G0c as proposed;
> Q2 guard enforced yes, re-baseline at acquisition yes, 5961/6784/6626 accept_incoming if unchanged;
> Q3 (b), I350 window ________ (2027-02-15..03-03);
> Q4 D-HO-1 yes, weekly window ________ (day/time AEDT), D-HO-4 accepted, D-HO-6 yes after console check;
> Q5 D-HO-2 yes, D-HO-3 A to ________, D-HO-5 not yet, D-HO-7 drop after the first verified off-host copy;
> Q6 accept residual with beta gate on; prune job and disk alert before launch;
> Q7 O-3 yes, O-1 option b;
> Q8 accept the merge-time ratchet.

---

## 2. Findings against the procedures (graded)

| ID | Grade | Where | Finding |
|---|---|---|---|
| F-01 | **MED** | sitting `:59,65,68,72`; `issues.md:54956-54957` | **No backup holds the published 2026 state.** The newest backup (D1, 06:18Z) predates the D4 attachment (audit 205) and both publications (206, 207). Scheduled backups are not installed. If the host were lost, rebuilding would need the D4 re-run and an owner re-publication. Request **R0** closes this. Its dump also satisfies procedure 03 prerequisite 3 for the reboot. |
| F-02 | **MED** | `issues.md:54936` points to "the hostops README §6a"; `hostops/README.md:152-165` | **The ledger points D-HO-6 at a stale procedure.** §6a still says "installed 138-149" and "select the previous kernel (137) from GRUB". Procedure 03 §1 corrects both: only 137 and 149 are installed, and GRUB is hidden with timeout 0, so the menu is not reachable. **Use procedure 03, never §6a.** The ledger pointer should change (§5). |
| F-03 | LOW | `issues.md:54967`; procedure 03 `:40-42`; procedure 05 `:65-66`; packet 2 B6 | The bare-`backup.sh` warning names checkout `c1c4b22e`. It **is still true at `c8d4202a`**: `backup.sh` is unchanged and prunes `~/backups/afldb` to `KEEP=7`. Only the attribution is stale. Every command here passes `--dir <new dir> --keep 1000`. |
| F-04 | LOW | `issues.md:55122`; packet 2 B7 | "production Caddyfile sha256 `f00859d5…6d`" means the **repository** file `deploy/Caddyfile.production`. It is unchanged at `c8d4202a`. The **installed** `/etc/caddy/Caddyfile` was last read on 2026-11-14 as `4f6972ec…7af036` (procedure 06 §1). R4 re-reads it first, and any other value is a stop. |
| F-05 | LOW | procedure 02 §7; `hostops/README.md:169-173` | The weekly window uses the legacy unbound `--confirm-attended-restart`. `c8d4202a` provides `status --confirm-restart-invocation <InvocationID>` (`deploy/release.mjs:25`, ISSUE-366 item 5), which binds the attestation to one restart. Use that. |
| F-06 | LOW | procedure 03 §4; `tools/v2/gap029-ops/profile.production.env:24-25` | The reboot stops only `afldb-settle-afl-api.timer`. The other writer timers (AFL Tables settle, Brownlow, email intake) are not addressed. R6 lists every active `afldb*` timer and stops each writer timer. |
| F-07 | LOW | procedure 05 §6, §8 vs `offhost-pull.sh:72-100` | Procedure 05 predates the durable `.retention-hold` (published `a3c8c67c`). After the first seeding pull, any run that verifies more than 3 new dumps (for example, the owner host was off for 4 days) sets a hold. While the hold exists the pull exits 1 and prunes nothing, until you review the batch and `rm <dest>/.retention-hold`. R3 includes this disposition. |
| F-08 | LOW | operating record `:134` | The G0b row still states the original D-332-1 ("notifier … with a transport configured"), and G0c is missing. If Q1 is answered as recommended, the row text changes (§5). |
| F-09 | LOW | `run2/caddy357/scripts/prune-not-found.sh` | The ISSUE-357 prune script exists only as a docs evidence file. A cron job would execute a file under `docs/`. Before Q6's prune job is installed, promote the script to `tools/maintenance/` with a test. |
| F-10 | INFO | `run7r3/dev/BLOCKS-SELFTEST.md:13-14`; `DEV-QUALIFICATION.md:17` | streamanator runs an isolated cluster from 7R3 qualification: `/mnt/ssd/afldb-r7r3-20261121/pg/data`, port 61470, PID 906726, up since 14:49 AEDT. It holds a source-only rebuild with no production data (§4.2 row S2). |
| F-11 | INFO | §4.3, §4.4 | Production dump copies are spread wider than the named items. streamanator holds about 70 `afldb_prod-*.dump` files plus restored clusters, dated 19 Oct to 21 Nov. The workstation `D:\tmp` holds 27 such files, dated 1 to 18 Nov. All contain authentication and audit data. The cost of keeping them is privacy, not disk: streamanator has 516 GB free. |

No procedure was found to be **wrong** for the serving tree, apart from F-02 (the stale §6a, already superseded by
procedure 03). The prerequisite "release B1 first, the checkout is `c1c4b22e`" in procedures 02, 04 and 05 is now satisfied.

---

## 3. Scoped approval requests (dependency order)

**Common rules.** The owner does every `sudo` step. The `arm` steps run from `/home/arm/projects/afldb` at `c8d4202a`, clean.
No secret goes on a command line: role DSNs stay in the checkout `.env` and are read only by the tools.

Avoid these times (AEDT):
- 02:10–02:40, and Wednesday 03:20–03:45, once R3 is installed;
- 04:50–05:45, the nightly settle;
- 05:45–07:15, `apt-daily-upgrade` plus up to 60 min of random delay.

**Read-only pre-checks.** One probe per sitting, run first as `arm`. Its output is recorded, and any difference from the
expected values is a stop:

```
cd /home/arm/projects/afldb && git rev-parse HEAD && git status --porcelain | wc -l   # c8d4202a4cb3cf0ccdd1cad01e1227a1610c2d76, 0
node deploy/release.mjs status                                                       # current c8d4202a…, previous a2e6ea99…, no restart pending
node deploy/release.mjs host-gate                                                    # expect PASS; warnings: reboot pending, hold missing
uname -r; uptime -s; ls -l /var/run/reboot-required*; cat /var/run/reboot-required.pkgs
dpkg -l 'linux-image-*' | awk '/^(ii|rc)/{print $1,$2}'; ls /boot | grep -E '^(vmlinuz|initrd)'
grep -hE '^GRUB_(TIMEOUT|TIMEOUT_STYLE|RECORDFAIL_TIMEOUT|DEFAULT)' /etc/default/grub /etc/default/grub.d/*.cfg
ls -l /etc/needrestart/conf.d/ /etc/apt/apt.conf.d/52-afldb-unattended 2>&1
systemctl list-timers 'afldb*' 'apt-daily*' --all --no-pager
systemctl is-active afldb postgresql@16-main caddy; systemctl show -p InvocationID,NRestarts,ActiveEnterTimestamp afldb
sh deploy/afldb-settle-failure-status.sh; echo "status_rc=$?"                       # read-only; 14 Nov: AFLDB_SETTLE_STATUS OK
df -h / ; ls -la /home/arm/afldb-releases/releases/ /home/arm/afldb-releases/builds/; readlink /home/arm/afldb-releases/current /home/arm/afldb-releases/previous
ls -la /home/arm/backups/ ; du -sh /home/arm/backups/* ; ls /home/arm/backups/afldb | wc -l
sha256sum /etc/caddy/Caddyfile; caddy version; ls -la /var/log/caddy/                # 14 Nov: 4f6972ec…7af036, 2.11.4
```

These read-only database checks run as `afldb_backup` in a `READ ONLY` transaction, through the same subshell pattern as
procedure 01 §5:
- `SELECT max(year) FROM seasons;` (14 Nov: 2026)
- `SELECT max(id) FROM matches;` (below about 20,000)
- the slug checks in `run2/caddy357/scripts/slugstats.mjs:5-10` (0 bad rows expected)
- `SELECT count(*) FROM admin_invites WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > now();` (columns per
  `src/db/migrations/030_admin_invites.sql:23-25`)
- `SELECT datname, pg_size_pretty(pg_database_size(datname)), numbackends FROM pg_stat_database WHERE datname LIKE 'afldb_prod%' OR datname = 'afldb_restore_test';`

### R0. Post-7R3 backup and an off-host copy (closes F-01; prerequisite of R6)
- **Target.** Host `afldb-prod`, user `arm`. New directory `/home/arm/backups/afldb-post7r3-<STAMP>`. Off-host copy to a new
  0700 directory on streamanator (or the D-HO-3 host), staged through the workstation as D1v was (sitting `:63`), with the
  staging copy deleted afterwards. No `sudo`.
- **Commands:**
  ```
  STAMP=$(date -u +%Y%m%dT%H%M%SZ); D=/home/arm/backups/afldb-post7r3-$STAMP
  cd /home/arm/projects/afldb && bash tools/maintenance/backup.sh --dir "$D" --keep 1000   # never bare (F-03)
  cd "$D" && for f in afldb_prod-*.dump; do sha256sum "$f" > "$f.sha256"; done; ls -la "$D"; cat "$D"/*.sha256
  ```
  Off-host:
  - `scp` the dump and sidecar to the staging directory, then to `/mnt/ssd/afldb-post7r3-<STAMP>/` (0700).
  - Run `sha256sum -c` there and `pg_restore --list <dump> >/dev/null`.
  - Delete the workstation staging copy.
- **Effect and interruption.** One `pg_dump` (a single MVCC snapshot, about 30 MB, seconds). No interruption. Nothing is
  pruned.
- **Recovery.** None needed. Nothing is changed.
- **Acceptance.** `backup.sh` exit 0 and "archive readable". The sidecar hash is equal on both hosts. `pg_restore --list` reads
  the off-host copy.
- **Approval text:** "I approve one backup of afldb_prod into a new directory `/home/arm/backups/afldb-post7r3-<STAMP>` with
  `--keep 1000`, and its copy to `________` (0700), staging deleted."

### R1. ISSUE-351 host patching policy (D-HO-1; procedure 02 §5-§6)
- **Target.** `/etc/needrestart/conf.d/50-afldb-hold.conf` and `/etc/apt/apt.conf.d/52-afldb-unattended`. No unit and no
  restart.
- **Commands (owner, `sudo`):**
  ```
  cd /home/arm/projects/afldb
  sha256sum deploy/host-policy/needrestart-afldb-hold.conf deploy/host-policy/apt-52-afldb-unattended.conf   # 183691d9… / 4a277b8b…
  sudo install -m 0644 -o root -g root deploy/host-policy/needrestart-afldb-hold.conf /etc/needrestart/conf.d/50-afldb-hold.conf
  sudo install -m 0644 -o root -g root deploy/host-policy/apt-52-afldb-unattended.conf /etc/apt/apt.conf.d/52-afldb-unattended
  sudo needrestart -r l                                    # list only: afldb/PostgreSQL owed, nothing restarts
  apt-config dump | grep -i -A5 'Package-Blacklist'        # the four postgresql names
  sudo unattended-upgrade --dry-run --debug 2>&1 | grep -iE 'blacklist|postgres'
  node deploy/release.mjs host-gate --strict               # as arm: "needrestart holds afldb and postgresql"
  ```
- **Effect.** Takes effect at the next apt run. Security updates continue.
- **Interruption.** None.
- **Recovery.** `sudo rm /etc/needrestart/conf.d/50-afldb-hold.conf /etc/apt/apt.conf.d/52-afldb-unattended`.
- **Acceptance.** All four checks as stated. If `needrestart -r l` would still restart `afldb` or PostgreSQL automatically,
  remove both files: the policy is then not installed.
- **The weekly window from then on** follows procedure 02 §7, with F-05 applied. After your restart, run
  `node deploy/release.mjs status --expect c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC --confirm-restart-invocation <the new InvocationID>`.
- **Approval text:** "I approve installing the needrestart hold and apt 52 per procedure 02 §5 (sha256 183691d9…/4a277b8b…),
  weekly window ________."

### R2. ISSUE-332 failure visibility, option A (Q1; procedure 04 §4, §5)
- **Target.** `arm`'s `~/.ssh/authorized_keys` on production gets one line. The owner host gets a key and an hourly job.
  Optionally the owner installs the notifier: the template, the drop-in and one `daemon-reload`.
- **Commands.**
  1. Owner host: `ssh-keygen -t ed25519 -f ~/.ssh/afldb_settle_status -C afldb-settle-status -N ''`
  2. Production, as `arm`, append:
     `command="/bin/sh /home/arm/projects/afldb/deploy/afldb-settle-failure-status.sh",restrict ssh-ed25519 AAAA… afldb-settle-status`.
     The script is in the serving checkout (sha256 `d80838cb…`). Note that a later checkout fast-forward changes what the
     key runs.
  3. Owner host, hourly: the wrapper in procedure 04 §4. It raises an alarm on rc≠0 and on any ssh failure. Keep it to
     one connection per run, with no retry loop.
  4. Optional notifier (owner, `sudo`, in this order):
     ```
     sudo install -m 644 -o root -g root deploy/afldb-settle-failure@.service /etc/systemd/system/afldb-settle-failure@.service
     sudo install -d -m 755 /etc/systemd/system/afldb-settle-afl-api.service.d
     sudo install -m 644 -o root -g root deploy/afldb-settle-afl-api.service.d/on-failure.conf /etc/systemd/system/afldb-settle-afl-api.service.d/on-failure.conf
     sudo systemctl daemon-reload
     ```
- **Interruption.** None.
- **Recovery.** Delete the `authorized_keys` line. For the notifier, remove the drop-in and run `daemon-reload`.
- **Acceptance.**
  - The forced command from the owner host prints `AFLDB_SETTLE_STATUS OK`, exit 0.
  - **One deliberate test alarm reaches your channel**: point the wrapper at a wrong host name. Until then delivery is
    unproven.
  - G0b satisfied, if adopted.
- **Approval text:** "I adopt D-332-1 option A: owner host ________, channel ________, forced-command line per procedure 04 §4;
  notifier template [yes/no]; first delivery test on ________."

### R3. ISSUE-352 backup units, attended first runs, off-host pull (Q5; `docs/backup-restore.md` §3, procedure 05)
- **Target.** `/home/arm/backups/afldb-scheduled` (0700). Five units in `/etc/systemd/system/`. `afldb_restore_test` is
  overwritten by the weekly verification. One `rrsync -ro` key line. On the owner host, a 0700 destination directory and a
  daily job.
- **Commands.** Re-derived; the checkout already holds every file (§0):
  ```
  # arm
  install -d -m 700 /home/arm/backups/afldb-scheduled
  cd /home/arm/projects/afldb && bash -n tools/maintenance/scheduled-backup.sh && sha256sum tools/maintenance/scheduled-backup.sh tools/maintenance/restore-test.sh deploy/afldb-backup*.service deploy/afldb-backup*.timer
  # owner
  sudo install -m 0644 deploy/afldb-backup.service deploy/afldb-backup.timer deploy/afldb-backup-verify.service \
    deploy/afldb-backup-verify.timer deploy/afldb-backup-failed.service /etc/systemd/system/
  sudo systemd-analyze verify /etc/systemd/system/afldb-backup.service /etc/systemd/system/afldb-backup-verify.service
  sudo systemctl daemon-reload
  sudo systemctl start afldb-backup.service          # attended; journalctl -u afldb-backup (owner)
  sudo systemctl start afldb-backup-verify.service   # attended; proves restore-test.sh on this host
  sudo -u arm env AFLDB_BACKUP_DIR=/home/arm/backups/afldb-scheduled bash tools/maintenance/scheduled-backup.sh status   # exit 0
  sudo systemctl enable --now afldb-backup.timer afldb-backup-verify.timer
  systemctl list-timers 'afldb-backup*'
  ```
  - Off-host key line on production (`arm`):
    `command="/usr/bin/rrsync -ro /home/arm/backups/afldb-scheduled",restrict ssh-ed25519 AAAA… afldb-backup-pull`.
  - Owner host, daily at about 03:10, from a checkout holding `offhost-pull.sh` (sha256 `ea48205a…`):
    `bash tools/maintenance/offhost-pull.sh arm@<production host>:/ /abs/dest/ --keep 30`. This exact ssh form was
    never run (procedure 05 §6).
  - **Retention hold (F-07).** On exit 1, read `<dest>/.retention-hold`. Quarantine any dump you reject by hand, then
    `rm <dest>/.retention-hold`. The next run prunes normally.
- **Effect.** A nightly dump at 02:20 and a Wednesday 03:30 verification (a fresh dump restored into `afldb_restore_test`,
  with idle I/O priority).
- **Interruption.** None for the site.
- **Recovery.**
  ```
  sudo systemctl disable --now afldb-backup.timer afldb-backup-verify.timer
  sudo rm /etc/systemd/system/afldb-backup*
  sudo systemctl daemon-reload
  ```
  Then remove the key line.
- **Acceptance.**
  - Both attended runs succeed and `status` exits 0.
  - The first pull verifies (`.verified-<name>`, sidecar check).
  - One restore of an off-host copy into a scratch database on the owner host.
  - Within 25 h the next nightly dump appears off-host.
  - Units are untested under systemd until this point (procedure 05 §10), so stop on the first failure.
- **Approval text:** "I approve installing the backup and verify units per backup-restore.md §3 with attended first runs, the
  `rrsync -ro` pull key, and off-host destination ________."

### R4. Combined Caddy install: ISSUE-357 deny + ISSUE-362 filter + beta headers (Q6/Q7; `run2/caddy357/README.md` §10-§11)
- **Target.** `/etc/caddy/Caddyfile`, a backup `/etc/caddy/Caddyfile.pre-combined-<stamp>`, and one graceful reload.
- **Read-only pre-checks** (in addition to the common probe):
  - `sha256sum /etc/caddy/Caddyfile` must equal the value the probe records. On 2026-11-14 that was `4f6972ec…7af036`.
    Any other value means the installed file changed: stop, and re-review the diff.
  - Owner: `sudo diff /etc/caddy/Caddyfile deploy/Caddyfile.production`. Only the three change sets may appear.
  - Slug and `max(matches.id)` checks: 0 bad rows, max id below about 20,000.
- **Commands (owner):**
  ```
  cd /home/arm/projects/afldb && sha256sum deploy/Caddyfile.production      # f00859d5c834be09f064d516ea4fa12612da379e377128e784b3523016a6086d
  B=/etc/caddy/Caddyfile.pre-combined-$(date +%Y%m%d%H%M); sudo cp -p /etc/caddy/Caddyfile "$B"; sha256sum /etc/caddy/Caddyfile "$B"
  sudo cp deploy/Caddyfile.production /etc/caddy/Caddyfile; sha256sum /etc/caddy/Caddyfile   # must equal f00859d5…086d
  sudo -u caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile             # "Valid configuration"; else restore "$B", stop
  ls -l /var/log/caddy                                                                       # every file still caddy:caddy 0600
  sudo systemctl reload caddy; systemctl status caddy --no-pager                             # graceful; never restart
  ```
- **Probes after the reload** (§10 step 6):
  - Legitimate pages return 200, or the beta gate's 307 when not admitted.
  - The deny shapes return 404 `Not Found`. `/seasons/%zz` returns 400.
  - `curl -sI` shows HSTS and CSP.
  - A real-browser load of one player page and one season page shows no CSP violation.
  - Two invite redaction probes: you read only the two newest log lines, which must show `/admin/invite/REDACTED` with no
    probe string.
- **Effect and interruption.** No outage is expected; the reload is graceful. Behaviour changes on `beta.afldb.com`:
  - a trailing slash on a protected route returns 404 instead of 308;
  - the deny body is Caddy's `Not Found`;
  - match ids are capped at 99,999;
  - slugs must match `[a-z0-9-]`;
  - new HSTS and CSP headers;
  - the logs no longer carry tokens or query strings.
- **Recovery** (single rollback): `sudo cp -p "$B" /etc/caddy/Caddyfile`, validate as `caddy`, `sudo systemctl reload caddy`,
  then repeat the legitimate-page probes and compare `sha256sum` with `"$B"`.
- **Acceptance.** Every probe as stated. Record the new installed sha256.
- **Approval text:** "I approve replacing /etc/caddy/Caddyfile with deploy/Caddyfile.production at c8d4202a (sha256
  f00859d5…086d), installed sha re-read first, one reload, per caddy357 §10-§11; the beta gate stays on."

### R5. ISSUE-362 O-1 pre-fix Caddy logs (after R4 succeeds; procedure 06 §3)
- **Target.** `/var/log/caddy/afldb-access-*.log.gz`, `/var/log/caddy/afldb-apex-*.log.gz` and the two live logs.
- **Pre-check.** The `admin_invites` live count must be 0. Otherwise revoke those invites in admin, or wait for them to
  expire.
- **Commands for option b (owner):**
  ```
  ls -la /var/log/caddy/
  sudo rm -- /var/log/caddy/afldb-access-2026-*.log.gz /var/log/caddy/afldb-apex-2026-*.log.gz
  sudo truncate -s 0 /var/log/caddy/afldb-access.log /var/log/caddy/afldb-apex.log
  ```
  Option d instead: `gpg --symmetric` the rolled files, copy them to your host, then the same `rm`.
- **Interruption.** None.
- **Recovery.** Not reversible, except from option d's archive. Not secure erasure.
- **Acceptance.** `ls -la /var/log/caddy/` shows only the live files, still `caddy:caddy 0600`. A new request writes a
  redacted line.
- **Approval text:** "After R4, I approve option ________ for the pre-fix Caddy logs per procedure 06 §3."

### R6. ISSUE-351 attended reboot (D-HO-6; procedure 03, amended by F-02 and F-06)

**Assessment of the 7R3 P4 finding.** "reboot pending (6 kernel packages); needrestart hold missing" (sitting `:52`, `:100`)
matches the 2026-11-14 state. `reboot-required.pkgs` named linux-image 138, 139, 142, 146, 147 and 149, plus `linux-base` and
`libc6`. Only 137 (running) and 149 are installed; GRUB is `hidden`/`0`/`0`; console access is unverified (procedure 03 §1).
Whether a newer kernel has arrived since is unknown, so the probe re-reads it.

The P4 warning carries **no unattended-activation risk today**, because the promoted release has had its restart. The risk
returns at every future promote, until R1.

- **Prerequisites. Each is a stop:**
  1. You have confirmed DigitalOcean console access, and recorded the date.
  2. A fallback is chosen. Either a DigitalOcean snapshot minutes before (if the panel offers it), or, only if not,
     procedure 03 §3.2(b)'s visible GRUB drop-in (never tried on this host).
  3. R0's off-host copy is verified, or R3's first pull.
  4. R1 is installed (strongly preferred).
  5. R2's pull check has been run and its output recorded **before** the reboot. A reboot erases `Result`.
  6. `release.mjs status` is clean.
  7. Daytime, outside the avoided times.
- **Commands (owner):**
  ```
  node deploy/release.mjs host-gate                                   # as arm
  sh deploy/afldb-settle-failure-status.sh; echo rc=$?                # record before the reboot
  systemctl list-timers 'afldb*' --no-pager                           # F-06: note every active afldb timer
  sudo systemctl stop afldb-settle-afl-api.timer                      # and each other active writer timer listed (afltables, brownlow, email-intake)
  systemctl is-active afldb-settle-afl-api.service afldb-settle-afltables.service afldb-email-intake.service   # all inactive
  sudo systemctl reboot
  # after boot
  uname -r                                                            # 6.8.0-149-generic (or the newest the probe listed)
  systemctl is-active postgresql@16-main afldb caddy
  sudo systemctl start afldb-settle-afl-api.timer                     # and every timer stopped above
  systemctl list-timers 'afldb*' --no-pager
  node deploy/release.mjs status --expect c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC     # restart reported as a note
  bash deploy/post-install-check.sh c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC
  sudo journalctl -b -p warning --no-pager | tail -50
  ls /var/run/reboot-required 2>&1                                    # gone
  ```
- **Expected interruption.** A full outage of the app, PostgreSQL and Caddy, from shutdown through boot to `afldb` active.
  Procedure 03 estimates 1–3 minutes plus boot time; this droplet's figure is unmeasured. The app starts after PostgreSQL
  (`Requires=`). Visitors through Cloudflare see an origin error page meanwhile. The audience is beta-gated.
- **Recovery if the host does not return within 10 minutes:**
  1. DigitalOcean console. If there is a login prompt, run `journalctl -b` and the per-unit actions in procedure 03 §6.
  2. If there is no console output, restore the snapshot. Without one, use the DigitalOcean Recovery Console to make 137 the
     default (availability unverified).
  3. If the host is unrecoverable, follow `docs/backup-restore.md` §6 procedure B from the verified off-host dump (R0 or R3).
     Host-loss RTO is unrehearsed.

  If `afldb` alone fails for a release reason: `node deploy/release.mjs rollback --attended` (to `a2e6ea99`), then your
  restart. Never restore over production as a first step.
- **Acceptance.**
  - Kernel 149 running.
  - Three units active.
  - `status --expect` PASS and `post-install-check.sh` PASS.
  - `/api/health` 200 through Caddy.
  - `reboot-required` absent.
  - The next 05:00 settle succeeds; the R2 check reads OK the next morning.
- **Approval text:** "I approve one attended reboot on ________ per procedure 03 (not hostops §6a), console access confirmed on
  ________, fallback ________."

### R7. ISSUE-352 D-HO-7: drop the stale databases (after R3's first verified off-host copy)
- **Pre-check.** The `pg_stat_database` query in the common probe lists the exact names, sizes and `numbackends`, which must
  be 0. Never touch `afldb_prod` or `afldb_restore_test`.
- **Commands (owner):** `sudo -u postgres dropdb --if-exists afldb_prod_auth_recovery`, then the same for each exact
  `afldb_prod_candidate_*` and `afldb_prod_pre_rebuild_*` name the probe printed. Optionally, first archive one encrypted
  `pg_dump -Fc` of each.
- **Interruption.** None.
- **Recovery.** None, except the optional archive.
- **Acceptance.** The probe lists only `afldb_prod` and `afldb_restore_test`.

### R8. ISSUE-350 I350 season opening (Q3; procedure 01; gate G0; recommended window 2027-02-15..03-03)
- **Target.** `afldb_prod`, written as `afldb_import` through `prod-stage.sh`. OPS root `/home/arm/ops/gap029-stages`. The
  capture goes under `/home/arm/backups/afldb/gap029-I350-<STAMP>` (`capture-prod-stage.sh:39`), which does not prune.
- **Re-derived.**
  - `R` = a published revision containing I350. `c8d4202a` qualifies (I350 stage `prod-stage.sh:66-67`;
    `seasons.json` `last_season` 2027).
  - The profile pins are unchanged: `afldb_prod`/66668/7674454702926115004, ledger 118, node v22.23.2
    (`profile.production.env`).
- **Commands.** Procedure 01 §5 verbatim with `R`: `prep R <tar sha256>`, `preflight R I350`, `capture R I350`, then the
  isolated restore and assembly on streamanator, then:
  - `plan R I350 RUN`;
  - you review and type `approve R I350 RUN <DIGEST> <STATEMENT_FILE> <EXPIRES>`;
  - `apply R I350 RUN`, once, with no retry;
  - `accept R I350 RUN`;
  - the G0 check, `season-opening-check.ts --dsn-env AFLDB_BACKUP_DATABASE_URL --expect-database afldb_prod --expect-oid 66668 --expect-sysid 7674454702926115004 --json`.

  The plan digest re-baselines at plan time. The 14 Nov `de1f574b…` is for comparison only.
- **Effect.**
  - 1 `seasons` row.
  - `last_season` 2027 on 18 clubs and 18 organisations.
  - 1 audit `import_batches` row.
  - Publicly, max season becomes 2027 after the ISR window.
- **Interruption.** None.
- **Recovery.** `reverse-opening.sql` as `afldb_owner`, only while nothing depends on 2027. Re-check its id lists against the
  plan's `changes.clubIds` and `changes.orgIds` (procedure 01 §8).
- **Acceptance.**
  - `COMMITTED_VERIFIED`.
  - The gate exits 0 `OPEN` with `identityResolvedForYear` 18.
  - G0c: the next nightly has no HALT.
- **Approval text:** "I approve opening season 2027 on production per procedure 01 with plan digest ________ on ________ (D-350-1)."

### R9. Retained-artefact deletions
One approval per row group in §4, using that row's command. No deletion runs before its stated condition.

### Suggested windows

| Sitting | Contents | Outage | Earliest |
|---|---|---|---|
| **S1 "no-outage installs"**, about 90 min, daytime | R0, then R1, R2 (test alarm), R3 (attended first runs), R4 (probes), R5 | none expected (R4 is a graceful reload) | after the Q1/Q4/Q5/Q7 answers |
| **S2 "attended reboot"** | R6 alone | the reboot | after S1 and the first R3 nightly plus pull verified (24–48 h later); console confirmed |
| **S3 "housekeeping"** | R7 and the production rows of R9 | none | after the first Wednesday verification plus an off-host copy (≤ 8 days after S1) |
| **S4 "season opening"** | R8 | none | the window chosen in Q3; by 2027-03-10 |

Caddy, host policy and reboot can share **one** window only if console access is confirmed in advance and R0's off-host copy
is verified. Even then, do the reboot **last**, after R4's probes pass, so that a failed boot is never confused with a Caddy
change. Re-run the legitimate-page probes after boot.

---

## 4. Retained-artefact inventory

**Rules applied.**
- Never delete the live release, its rollback target, or the newest verified production backup until ISSUE-352's scheduled
  backups are verified.
- "Prod data" means a copy of `afldb_prod`, including `auth_*`, `admin_invites`, audit and `data_edits`. It is marked
  **PROD-DATA**.
- The workspaces `/mnt/ssd/afldb-i371-20261121` and `/mnt/ssd/afldb-i363-20261121` belong to concurrent agents and are
  excluded. So is `/mnt/ssd/afldb-enh-20261116`, the parked enhancement.

### 4.1 Production (`afldb-prod`). Paths from records; existence and size are re-read by the common probe

| # | Path | What | Needed for | Recommendation | Deletion command (as `arm` unless noted) |
|---|---|---|---|---|---|
| P1 | `/home/arm/afldb-releases/releases/c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC` | live release | serving | **RETAIN** (never) | none |
| P2 | `…/releases/a2e6ea9995a4-aKAYwf0qC4go6JJWiHhv5` | rollback target, `previous` (sitting `:84-85`) | recovery | **RETAIN** (never while it is `previous`) | none |
| P3 | `…/releases/a3c8c67cc98f-JFf9-hXYa6xoigu5Tw4Hg` | 7R2 build, never promoted (`run7r2/sitting-exec-20261121/README.md:30,44`; `RELEASE-PACKET-7R3.md:44` "removing it is a separate owner housekeeping") | nothing | **DELETE** now | `R=/home/arm/afldb-releases; ID=a3c8c67cc98f-JFf9-hXYa6xoigu5Tw4Hg; [ "$ID" != "$(basename "$(readlink -f $R/current)")" ] && [ "$ID" != "$(basename "$(readlink -f $R/previous)")" ] && rm -rf -- "$R/releases/$ID"` |
| P4 | `…/releases/c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x`, `0f251c2daa8d-3t0xWKI76Jgna2tB8a9oN`, and any older id the probe lists (records name `a0b1080f5b98-…`, `fd48ace0c2cb-…`, `ea98a35f2061-…`, `ad245d602f6f-…` as former production releases) | superseded releases; they predate B1a and the 2026 publication | nothing planned (rollback is N-1 only) | **DELETE** in S3. Retain `c1c4b22e` only if you want an N-2 | the P3 command with each `ID` |
| P5 | `/home/arm/afldb-releases/builds/*`, e.g. `20261121T020057Z-a3c8c67cc98f-a4efa8` (`run7r2/…/p3b.log:9`) and the 7R3 build workspace | disposable build workspaces (`deploy/release.mjs:16`) | nothing | **DELETE** in S3, when no build is running | `[ ! -e /home/arm/afldb-releases/build.lock ] && rm -rf -- /home/arm/afldb-releases/builds/<name>` (lock path `<root>/build.lock`, `deploy/release.mjs:520`) |
| P6 | `/home/arm/backups/afldb-r7r3-20261121T060018Z/` | D1: dump `ec907085…b287` (29,960,512 B), sidecar, parity; proven by D1v | newest verified backup; 7R3 last-resort restore (`RELEASE-PACKET-7R3.md` §8.3) | **RETAIN** until R3 is verified (first Wednesday verification plus an off-host copy). Then optional | **PROD-DATA.** `rm -rf -- /home/arm/backups/afldb-r7r3-20261121T060018Z` |
| P7 | `/home/arm/r7r3-data-20261121T060018Z` | 7R3 evidence: target, plan, dry/apply results, `facts-*`, the first A1c FAIL (sitting `:73`, `:96-97`) | 7R3 audit trail | **RETAIN** 90 days, then delete | `rm -rf -- /home/arm/r7r3-data-20261121T060018Z` (no auth data) |
| P8 | `/home/arm/r7r3-data-20261121T072718Z` | the A1c re-run on revision 3 | 7R3 acceptance evidence | as P7 | `rm -rf -- /home/arm/r7r3-data-20261121T072718Z` |
| P9 | `/home/arm/backups/afldb-b1a-20261118T021817Z` | 6R backup: dump `7e85e8a2…`, checks (`run6r/sitting-a1-exec-20261118/README.md:112-113`) | pre-B1a recovery point, superseded by P6 | **RETAIN** until R3 is verified ("B1a-0: retain", same file `:121`), then **DELETE** | **PROD-DATA.** `rm -rf -- /home/arm/backups/afldb-b1a-20261118T021817Z` |
| P10 | `/home/arm/b1a-r6r-20261118T021817Z` | B1a runner artefacts (same file `:110-111`) | 6R audit | delete with P9 | `rm -rf -- /home/arm/b1a-r6r-20261118T021817Z` |
| P11 | `/home/arm/backups/afldb/` (90 per-operation dumps, 880 MB at 2026-11-14, procedure 05 §1), including the `gap029-<S>-<STAMP>` capture directories | per-operation and ceremony dumps; packets bind them by hash (`run6/b1a/B1A-RUNBOOK.md:46-48`) | record-bound evidence | **RETAIN** for now. After R3 is verified, decide a rule (keep the record-bound ones plus the last N) from the probe's listing | **PROD-DATA.** None proposed until listed |
| P12 | `/home/arm/ops/gap029-stages/` | ceremony runs (I336); R8 reuses this root | I350 | **RETAIN** | none |
| P13 | `/home/arm/r7-build-20261121T020057Z.log`, `/home/arm/r7r3-build-20261121T060055Z.log`, `/home/arm/b1-build-*.log` | build logs (sitting `:50`) | low | optional delete in S3 | `rm -f -- /home/arm/r7-build-20261121T020057Z.log /home/arm/b1-build-*.log` (keep the 7R3 log with P7) |
| P14 | stale databases `afldb_prod_auth_recovery`, `afldb_prod_candidate_*` ×2, `afldb_prod_pre_rebuild_*` ×2 | old recovery and rebuild copies (`hostops/README.md:208-209`) | nothing known | **DROP** per R7 (Q5 D-HO-7) | **PROD-DATA.** R7 |
| P15 | pre-fix Caddy logs | tokens, query text, IPs | none | R5 | R5 |

### 4.2 streamanator, named items (read-only, 2026-11-21 09:20Z; `du --apparent-size`)

| # | Path | Size | What (verified) | Recommendation | Deletion command |
|---|---|---|---|---|---|
| S1 | `/mnt/ssd/afldb-r7r3-20261121/d1v-20261121T060018Z` (0700) | 796M | the D1 dump copy; `sha256sum` = `ec907085…b287`, equal to production D1. Also `facts-before.txt`, `parity-prod.txt`, and the stopped `pg-verify` cluster (restored production, `secrets/` holds the local cluster password) | **PROD-DATA.** **RETAIN the dump and sidecar**: it is the only off-host copy of the newest production backup, until R0 or R3 supersedes it. **DELETE `pg-verify` now**: the dump suffices | now: `rm -rf -- /mnt/ssd/afldb-r7r3-20261121/d1v-20261121T060018Z/pg-verify` (no `postmaster.pid` present). Later: `rm -rf -- /mnt/ssd/afldb-r7r3-20261121/d1v-20261121T060018Z` |
| S2 | rest of `/mnt/ssd/afldb-r7r3-20261121` (`blk`, `cand`, `pg`, `repo.git`, `pw-base-out`, logs) | about 11G | 7R3 DEV qualification. The `pg` cluster is **RUNNING** (PID 906726, port 61470) and holds a source-only rebuild (`DEV-QUALIFICATION.md:17`). `blk` holds a build prerendered from a production-dump copy (public pages only) | **DELETE** after confirming no client on port 61470 (`ss -tnp \| grep 61470`). Keep S1 | `ssh -i ~/.ssh/afldb_dev arm@10.0.40.100 'W=/mnt/ssd/afldb-r7r3-20261121; /usr/lib/postgresql/16/bin/pg_ctl -D $W/pg/data stop -m fast; cd $W && rm -rf -- blk cand pg repo.git pw-base-out blk-npm-ci.log *.out *.fails *.t *.bundle *.sh *.sql'` (`evidence/` and `run7r3/` may stay) |
| S3 | `/mnt/ssd/afldb-bv2026-20261121` | 5.6G | ISSUE-370 rehearsal. Stopped `pg-rst` cluster with five restored databases of about 385 MB from the 18 Nov production dump (`run7r3/dev/BLOCKS-SELFTEST.md:9,14`); `private/` holds the plan and results JSON | **PROD-DATA.** ISSUE-370 is resolved: **DELETE** | `ssh … 'd=/mnt/ssd/afldb-bv2026-20261121; [ ! -e $d/pg-rst/data/postmaster.pid ] && rm -rf -- $d'` |
| S4 | `/mnt/ssd/afldb-close-20261121` | 2.1G | closeout qualification (`closeout-20261121/QUALIFICATION.md:15-20`): a schema-only cluster and a DEV AFLW extract copy. No production data | **DELETE**. Optionally keep `evidence/`, `run.log`, `rerun.log` (about 400K): the raw logs QUALIFICATION cites live only here | `ssh … 'd=/mnt/ssd/afldb-close-20261121; [ ! -e $d/pg-root/data/postmaster.pid ] && rm -rf -- $d/cand $d/base $d/cand.tgz $d/base.tgz $d/pg-root $d/aflw-real $d/aflw-scratch'` |
| S5 | `/mnt/ssd/afldb-rel7r2-20261121` | 2.4G | 7R2 qualification; its `cand` was 7R3's BASE (`run7r3/DEV-QUALIFICATION.md:15`). No production data | **DELETE** | `ssh … 'd=/mnt/ssd/afldb-rel7r2-20261121; [ ! -e $d/pg-root/data/postmaster.pid ] && rm -rf -- $d'` |
| S6 | `/mnt/ssd/afldb-b1a0-20261118T021817Z` (0700) | 29M | the 6R dump copy; `sha256sum` = `7e85e8a2…758a`, equal to the 6R record | **PROD-DATA.** **RETAIN** until R3 is verified, then **DELETE** together with P9 | `ssh … 'rm -rf -- /mnt/ssd/afldb-b1a0-20261118T021817Z'` |
| S7 | `/mnt/ssd/afldb-b1a0-verify-afldb-prod-20261118-133119-pg` | 746M | stopped cluster restored from S6 | **PROD-DATA.** **DELETE** now | `ssh … 'd=/mnt/ssd/afldb-b1a0-verify-afldb-prod-20261118-133119-pg; [ ! -e $d/data/postmaster.pid ] && rm -rf -- $d'` |
| S8 | `/mnt/ssd/afldb-b1a0-verify-rehearsal{,2}-{good,bad}-afldb-prod-20261104t021037z-pg` (4 dirs) | 4×750M | stopped clusters restored from the 4 Nov production dump (6R rehearsal) | **PROD-DATA.** **DELETE** now | `ssh … 'for d in /mnt/ssd/afldb-b1a0-verify-rehearsal*-afldb-prod-20261104t021037z-pg; do [ ! -e $d/data/postmaster.pid ] && rm -rf -- $d; done'` |
| S9 | `/mnt/ssd/afldb-rem6r-b1a-20261116` (0700) | 144M | five variants (good, bad, sha) of the 4 Nov production dump (`opta/`) | **PROD-DATA.** **DELETE** now | `ssh … 'rm -rf -- /mnt/ssd/afldb-rem6r-b1a-20261116'` |
| S10 | `/mnt/ssd/afldb-rel7-20261119` | 3.7G | Release 7 qualification (expired, not executed: `run7/sitting-exec-20261120/README.md:36`). No production data | **DELETE** | `ssh … 'd=/mnt/ssd/afldb-rel7-20261119; [ ! -e $d/pg-root/data/postmaster.pid ] && rm -rf -- $d'` |

Isolated-pg clusters: 48 data directories under `/mnt/ssd` (excluding i371 and i363). **Only one is running: S2.** Disk is
not under pressure: `/mnt/ssd` holds 375G with 516G free.

### 4.3 streamanator: other production-data holders (outside the named scope; listed so the owner can see them all)

| Path | Production dumps or restores found | Note |
|---|---|---|
| `/mnt/ssd/afldb-i336-prod-20261112T010713Z`, `…T025043Z` (0700) | I336 production captures `afldb_prod-20261112T010605Z.dump`, `…025001Z.dump` and their restore clusters | the evidence of the D-336-2 production run; delete when ISSUE-336 closes |
| `/mnt/ssd/afldb-i336-sim-20261111` (7.3G), `/mnt/ssd/afldb-i349-20261112` (9.2G) | 12 copies of 11/12 Nov captures, plus simulation clusters | ISSUE-349 is resolved; delete |
| `/mnt/ssd/afldb/from-home-arm/*` (48G), `/mnt/ssd/afldb/workspaces/*` (51G) | about 35 dumps, 19 Oct to 4 Nov (prodexec, currentshadow, blockb-prod, gap029l, gap029-sim, issue333-o2 `private/`) | governed by the 7 Nov cleanup decision D3 (`/mnt/ssd/afldb/records/cleanup-20261107/HANDOFF.md:41`); not re-decided here |
| `afldb-rem2-*`, `afldb-rem3-*`, `afldb-rem4-*`, `afldb-review-20261114T0640Z` (about 45 clusters and workspaces) | the remediation rehearsals used "isolated snapshot copies" of production (e.g. `hostops/README.md:219`, the 4 Nov snapshot `e77c307d…`) | treat as **PROD-DATA** until shown otherwise; a separate disposition pass |

### 4.4 Workstation (found during the inventory; outside the named scope)

- `D:\tmp\afldb-b1a0-20261118T021817Z\` holds the 6R staging copy of the 18 Nov production dump. The 6R record allows its
  deletion now that the verified off-host copy exists (`run6r/sitting-a1-exec-20261118/README.md:119-120`). Recommended:
  `Remove-Item -Recurse -Force 'D:\tmp\afldb-b1a0-20261118T021817Z'`.
- `D:\tmp\blockb-private\`, `blockm-a-private\`, `blockm-b-private\`, `gap016-private\` and `gap029-blockL-private\` hold
  1–2 Nov production dumps. They fall under cleanup decision D3.
- `D:\tmp\gap029-prod\runs\*\capture\` and `D:\tmp\gap029-sim\…\capture\` hold 3 Nov dumps.
- Total: 27 `*prod*.dump` files.
- **Excluded:** `D:\tmp\afldb-v2-pg16` and `D:\afldb-retained\…` are quarantined and owner-only (CLAUDE.md §11). They were
  not touched or listed.

---

## 5. Proposed text (not applied; `issues.md`, `IssuesIndex.md`, `CHANGELOG.md` and `blockers.md` are not edited here)

**`IssuesIndex.md` next actions:**
- **332:** Owner Q1 (D-332-1 option A; adopt G0/G0b/G0c). Then R2: forced-command pull key, owner-host hourly job and one
  test alarm (OWNER-PACKET §3). Dated gates follow: G0 by 2027-03-10, Opening Round 2027-03-17.
- **348:** Owner Q2: guard as the enforced gate, re-baseline at the acquisition, rulings for 5961/6784/6626. At the Nov–Dec
  re-acquisition, run `--dry-run --guard-report`, build the reviewed reconciliation, then load. Resolve on load with origins
  reviewed.
- **350:** The HALT, I350 and the check are live in `c8d4202a`. Owner Q3 (D-350-1; recommended window 2027-02-15..03-03).
  Then R8, the I350 ceremony per procedure 01, and gate G0 by 2027-03-10.
- **351:** Owner Q4 (D-HO-1 plus the weekly window; record D-HO-4; D-HO-6). R1 installs the policy, then R6 is the attended
  reboot per procedure 03, not hostops §6a, after console access is verified and an off-host backup exists. 7R3 P4 still
  warns.
- **352:** The retention-hold fix is live in `c8d4202a`. R0 first: the newest backup predates the 2026 publication. Then owner
  Q5 (D-HO-2/3/5/7) and R3 (units, attended first runs, off-host pull). Resolve on the first verified off-host copy.
- **357:** The deny is in the `c8d4202a` tree, not installed. Owner Q6 (accept the residual with the beta gate on; prune job and
  disk alert before launch). Install via R4, the combined Caddy install.
- **362:** Owner Q7 (O-3, O-1). R4 re-reads the installed Caddyfile sha first (14 Nov `4f6972ec…`), then installs `f00859d5…`.
  R5 handles the pre-fix logs after the `admin_invites` check.
- **364:** The ratchet is published and runs in preflight and `merge:ready`. Owner Q8 accepts the merge-time ratchet as O-2,
  then resolve.

**Operating-record register:** replacement rows for `docs/v2/afl-api-2027-season-operations-successor-2026-11-02.md:134`, to
apply only after the Q1 answer.

> | G0b | Before Opening Round | A failed or missing nightly is delivered to the owner (D-332-1 as amended, option A) | **Owner** | The forced-command pull check runs hourly from the owner host and one deliberate test alarm has arrived (procedure 04 §4); or a written owner record that the per-round manual check (section 3) stands in for it. |
> | G0c | The first nightly after G0 | The first nightly after the opening applies with no `season_row_missing` HALT | Operator reads, owner accepts | `c7-observe.ts` for that night, or the pull check's OK plus the unit `Result=success`, recorded in the ledger. |

**Ledger pointer (F-02):** in ISSUE-351, replace "procedure in the hostops README §6a" with "procedure
`docs/v2/evidence/remediation-20261114/run2/ops/procedures/03-pending-reboot.md` (supersedes hostops §6a)".
