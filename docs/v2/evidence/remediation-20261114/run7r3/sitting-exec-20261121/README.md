# Release 7R3 sitting record (Saturday 21 November 2026, 17:00–20:30 AEDT)

Packet: `../RELEASE-PACKET-7R3.md`. `CAND` = `c8d4202a4cb3cf0ccdd1cad01e1227a1610c2d76`. `PREP` = `4f5fc9c9e6a695fdd302b6359785c463875fc74f`.
Manifest `SHA256SUMS` sha256 `e0cb9b9c6f2e33f0cab734263ff6fb50faca5fb729135475b1498bcc8ff59951`.

Excerpts only: no dump content, no DSN, no cookie, no secret.

## Owner statements (verbatim)

### Approval R7R3 (received 21 Nov 2026, ≈16:53 AEDT)

> Approval R7R3: I approve the full §11 statement you presented for Saturday 21 November 2026, 17:00–20:30 AEDT.
>
> I approve publishing PREP 4f5fc9c9e6a695fdd302b6359785c463875fc74f to origin/main by fast-forward and executing the attended 7R3 release and data change for candidate c8d4202a4cb3cf0ccdd1cad01e1227a1610c2d76. The approved SHA256SUMS digest is e0cb9b9c6f2e33f0cab734263ff6fb50faca5fb729135475b1498bcc8ff59951.
>
> I approve D-370-1 with these 14 IDs: 6841, 5480, 13246, 6667, 11041, 3295, 12205, 6746, 12869, 4004, 10282, 940, 1108, 3292.
>
> Start at 17:00 AEDT. Follow §11 Parts A–C and the packet's stop and recovery conditions. After P4 reports PROMOTED, identify the production host and wait for me to restart afldb. After D1 backup, D1v restore proof and the D2 live read-only plan, show me the counts, full live digest and actor candidates. Wait for my explicit digest and actor-ID confirmation before the dry run and single D4 commit.
>
> I will publish 2026 myself at /admin/brownlow/2026 and report my signed-in observation. Complete A1, the binding P10 at least 65 minutes after publication, and A3 Playwright checks. Record the actual outcome and publish the records-only commit by fast-forward. Keep ISSUE-370 open until live acceptance is verified.

### §6.1 browser readiness (before P4)

> confirming https://beta.afldb.com/players/scott-pendlebury-11724 renders @ 4:65pm

(Recorded verbatim; "4:65pm" read as ≈16:56 AEDT.)

### S6 restart

> afldb restarted on afldb-prod

(Unit active since Sat 2026-11-21 17:17:12 AEDT, InvocationID `0f8ca9f3c9104a1b98547c2b7a56398f`, NRestarts 0, as read by P9.)

### Digest review and actor (§6.3)

> I confirm the 2026 attachment plan digest is 100c112f400a492906cbc2a5c3886243c15d412eb62f84d50f17c63ae1f76aa7 and my actor ID is 1.
>
> Proceed in the approved 7R3 packet order. Once P8 passes, run D3 against afldb_prod. If D3 passes with the same digest and counts, I authorise one D4 attachment commit. Stop on any mismatch or failure. Report the D4 result and wait for me to publish 2026 in Super Admin.

## Step log (UTC; AEDT = UTC+11)

`STAMP` = `20261121T060018Z`. Production host `afldb-prod` (SSH alias `afldb`, user `arm`).

| Step | Time (UTC) | Result line(s) | Notes |
|---|---|---|---|
| PREP push | 06:00:09 | `4484a6d0..4f5fc9c9 main` | fast-forward; `ls-remote` = PREP |
| P0 | 06:00:18 | ls-remote = HEAD = PREP; run7r3 porcelain 0; `SHA256SUMS` files OK; manifest sha `e0cb9b9c…9951` | PASS |
| P1 | 06:00:25 | `P1 RESULT PASS` | links as §1; checkout `a3c8c67c`; 7R2 artefact present, unpromoted; 2026 `pending\|669\|0`, `9522\|621\|1242\|0`, unpublished, no mirror; `AFLDB_WORKERS=2`; apt-daily timer 18:09:58 AEDT noted |
| P2 | 06:00:44 | `P2 RESULT PASS` | 26 `CAND..PREP` paths all records; deltas 186/44 equal the reviewed hashes; checkout ff `a3c8c67c..c8d4202a`; node_modules match the lock |
| P3 | 06:00:55 | `BUILD_EXIT=0`, `RELEASE READY c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC` | log `/home/arm/r7r3-build-20261121T060055Z.log`; build 220 s |
| P3b | 06:05:26 | `P3b RESULT BUILD PASS c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC` | BUILD_ID `aATnIlFOIQjq2z5oDdoHC`; VERIFY PASS 13002 files; links untouched |
| P4 | 06:05:39 | `HOST GATE PASS`; `P4 RESULT PROMOTED 2026-11-21T06:05:44Z` | warnings: reboot pending (6 kernel packages); needrestart hold missing. previous = `a2e6ea99…` |
| S6 | 06:17:12 | owner restart | see above |
| P9 | 06:17:49 | `P9 RESULT S7+S8 PASS` | `POST-INSTALL CHECK PASS`; 0 journal error lines; 1 old Cloudflare cache HIT of the previous immutable asset, origin 404 |
| S9 | 06:17:57 | `S9 RESULT PASS` | |
| P10a | 06:18:03 | `P10 RESULT pending PASS (11 pages x 8 samples, anon control)` | VERDICT samples 88, bad 0 |
| A3a | 06:18:50 | `OWNER-BROWSER-A3 pending`: `pass: true`, 11/11 | Playwright MCP browser, already admitted; the one console error is the expected `/brownlow/2026` 404 |
| P8 | 06:18:21 → 06:48:21 | `P8 RESULT OBSERVATION PASS (4 ticks)` | InvocationID `0f8ca9f3…` constant, NRestarts 0, health ok, page 200 with the pending label ×2 and old label ×0 on every tick; final `STATUS PASS` |
| D1 | 06:18:27 | `D1 RESULT DUMP CAPTURED …/afldb_prod-20261121-171827.dump sha256 ec907085f0b8ca2e13c7686e4c572cb412cc2517ba31361e9a25305ff7fab287 (unproven until D1v)` | 29,960,512 bytes; header `afldb_prod`; dump holds pending 669 / 9522 unattached; parity captured |
| A1a | 06:19:03 | `A1 RESULT before PASS` | identity `afldb_prod\|66668\|7674454702926115004` |
| D2 target | 06:19:10 | `D RESULT target PASS` | `localhost:5432 afldb_prod afldb_import 16/main 66668 7674454702926115004`; `target.json` sha256 `b670063e20d0017762f1c4b5f86cc0538734d2a7586f018ae0b8556985c6ac1b`; `ACTOR-CANDIDATE 1 super_admin` |
| D2 plan | 06:19:16 | `PLAN season=2026 rows=9522 positive=621 votes=1242 matches=207/207 attach=9522 mirror=9522 digest=100c112f400a492906cbc2a5c3886243c15d412eb62f84d50f17c63ae1f76aa7`; `D RESULT plan PASS` | plan file sha256 `b7cd98e10e197fcc1184c2ba2dbb24f6d6a5ef6e3b885bf15a96efe826b41697` |
| D1v | 06:20:07 | `VERDICT PASS backup proven by a fresh disposable restore` | streamanator `/mnt/ssd/afldb-r7r3-20261121/d1v-20261121T060018Z` (0700), staged through `D:\tmp\afldb-r7r3-20261121T060018Z\` (deleted); restore 7 s; parity 9/9; facts 24/24; plan digest equal; dry run PASS; cluster stopped, copy retained for the owner |
| D3 | 06:48:31 | `APPLY DRY-RUN (rolled back) season=2026 attached=9522 mirrored=9522 unattached_after=0 mirror_after=9522 audit=- digest=100c112f…76aa7`; `D RESULT dry PASS` | after P8 PASS, as the owner directed; digest and actor 1 as stated by the owner; result file sha256 `775f687b633316a1e07ca6662af636ac235bc58f807131a269430c6f56e2675f` |
| **D4** | 06:48:49 | `APPLY COMMITTED season=2026 attached=9522 mirrored=9522 unattached_after=0 mirror_after=9522 audit=205 digest=100c112f…76aa7`; `D RESULT commit PASS` | the single authorised commit; **audit id 205**; result file sha256 `1dff2aad1ce58e9a090ee4358627495a517d69936f37577bf72578469b7b816f` |
| A1b | 06:49:09 | `A1 RESULT attached PASS` | `brv2026 9522\|621\|1242\|9522\|207`; 207/207 match sets; mirror `9522\|621\|1242`; round↔match diffs 0 per player and per cell; Pendlebury `17151:2,17247:3`; still pending, no season rows, unpublished; every other season unchanged |
| P10b | 06:49:31 | `P10 RESULT pending PASS (11 pages x 8 samples, anon control)` | the attachment is not public |
| PUB (owner) | 07:06:27.994 | owner: "Season 2026 published: 183 polling players, 1242 votes, 1 medallist." and "The form shows 'Ineligible players (0 marked)'" | authority 2026: revision 2, published_revision 2, published_by 1, published_at 2026-11-21T07:06:27.994Z (18:06:27 AEDT); audit **206** `publish`, rowCount 183, votes 1242, winners [9910], **ineligible []**, note "2026 official count verified under Release 7R3. Eligibility decision D-370-1" |
| A1c | 07:08:02 | `A1 RESULT published FAIL (1)`: `FAIL bsv2026 = 183\|1242\|1\|0 (expected 183\|1242\|1\|14)` | every other line PASS: winner Nick Daicos 47; round = match = season (0 diffs); `pss2026 complete\|669\|669\|1242`; coverage complete ×3; published; other seasons unchanged |
| audit read | 07:08:38 | ad-hoc read-only query (backup role, read-only transaction) | saved ineligible ids: **none**. All 14 D-370-1 ids are season rows with their votes and `is_ineligible = false`. Missing: 6841, 5480, 13246, 6667, 11041, 3295, 12205, 6746, 12869, 4004, 10282, 940, 1108, 3292. Unexpected: none. **Paused for the owner's Super Admin correction (§8.3 item 1)**; P10c/P10d/A3b not started |
| correction prep | 07:14–07:15 | owner signed in to admin in the Playwright MCP browser; Claude ticked the 14 and entered the owner's note, then revealed the Confirm step **without clicking Confirm publish** | read-back: heading "Ineligible players (14 marked)", 14 checked (names and votes match D-370-1 §3), form hidden ids exactly `940,1108,3292,3295,4004,5480,6667,6746,6841,10282,11041,12205,12869,13246` (missing none, unexpected none), expectedRevision 2, note verbatim; confirm text "This writes 2026's public Brownlow total from 207 accounted matches…" |
| PUB-2 (owner) | 07:26:25.496 | owner: "I clicked Confirm publish at 6:26pm. The confirmation said 'Correcting revision 2: applying the 14 approved ineligible players under D-370-1. Vote totals and medallist verified.'" (the page's status notice read "Season 2026 published: 183 polling players, 1242 votes, 1 medallist." with "(14 marked)") | authority 2026 revision 3, published_revision 3, published_by 1; audit **207** `publish` rev 3, 183 rows, 1242 votes, winners [9910], ineligible **exactly** `940,1108,3292,3295,4004,5480,6667,6746,6841,10282,11041,12205,12869,13246`; season rows `is_ineligible` = exactly those 14 |
| A1c (re-run) | 07:27:2x | `A1 RESULT published PASS` | new data dir `/home/arm/r7r3-data-20261121T072718Z` (0700) seeded with the original `facts-before.txt` (same sha256), per §8.3; `bsv2026 183\|1242\|1\|14`, winner Nick Daicos 47, ineligible = the 14 with their votes, all reconciliations 0, other seasons unchanged. The first A1c FAIL file stays in the first data dir as evidence |
| P10c (informational) | 07:27:31 | `P10 RESULT published FAIL (8 bad samples, anon true)`: only `brownlow-2026` (`won false`); every other check PASS, including the 14 marked ineligible on `/brownlow/2026` and Pendlebury 5 / Daicos 47 | cause, read in the owner's browser: the cached `/brownlow/2026` page body is correct ("Won by Nick Daicos with 47 votes", Winner badge, standings, 14 marked) but its **head is stale from the 404 era**: `<title>Page not found \| AFLDB</title>` and the site-default description. P10's won-regex matches the winner sentence only in the metadata description (the body wraps the name in a link), so it caught the stale head. 2025's head and every other checked page's title are correct. Binding P10d at ≥ 08:31:25Z decides whether the hourly regeneration corrects it |
| OWNER-BROWSER (Pendlebury) | ≈07:34:36 (before P10d) | owner: "Pendlebury 2026 shows 5, no tooltip" | §6.5 observation, recorded separately from the automated results; given before the binding P10d, so the /brownlow/2026 look is still to come after it |
| P10d (**binding**) | 08:31:41 | `P10 RESULT published PASS (11 pages x 8 samples, anon control)` | ≥ 65 min after audit 207 (07:26:25Z; earliest 08:31:25Z). VERDICT samples 88, bad 0, `pass:true`; `brownlow-2026` PASS, so the head now carries the published metadata; ineligible = the 14 slug-ids; anon 307 to `/beta?from=…` |
| A3b pre-check | 08:31:56 → 08:32:36 | owner's Playwright MCP browser | the first full navigation to `/brownlow/2026` (network, 200, 24,426 bytes) **still had the stale head** (`Page not found \| AFLDB`, site-default description) over the correct body. Within seconds: 6/6 no-store fetches, 3/3 navigations and then 24/24 fetches carried "2026 Brownlow Medal — Winner, Votes & Leaderboard \| AFLDB" and "…Won by Nick Daicos with 47 votes.". Consistent with stale-while-revalidate: that request reached the worker whose hourly entry had just expired, was served the old entry once and triggered the regeneration (`AFLDB_WORKERS=2`, per-worker cache). Not a rollback trigger |
| A3b | 08:33:18 | `OWNER-BROWSER-A3 published`: `pass: true`, 11/11 | Pendlebury 2026 BV 5 (no title), game log R8=3 R21=2 sum 5, 17247 BV 3, 17151 BV 2; Daicos 47, game-log sum 47; `/seasons/2026` 25 blocks, Pendlebury [3,2]; `/brownlow` row `2026 \| Nick Daicos \| Collingwood \| 47`; `/brownlow/2026` won-sentence, Daicos 47 Winner, Smith 36, Bontempelli 34, Pendlebury 5, "Recorded ineligible" rows **exactly** the 14; 2025 controls intact |
| OWNER-BROWSER (§6.5, after P10d) | ≈08:40 (reply received; logged 09:07) | owner, verbatim: "I hovered over Pendlebury's 2026 BV cell on https://beta.afldb.com/players/scott-pendlebury-11724. It showed 5 with no tooltip. https://beta.afldb.com/brownlow/2026 browser title is 2026 Brownlow Medal - Winner, Votes & Leaderboard \| AFLDB. a heading of 2026 Brownlow Medal with a subheading of Won by Nick Daicos with 47 votes · 2026 season, and the Full vote count" | recorded separately from every automated result |

## Outcome

**Release 7R3 executed; ISSUE-370 accepted on the live site.**
- Production serves `c8d4202a4cb3-aATnIlFOIQjq2z5oDdoHC` (revision `c8d4202a`, BUILD_ID `aATnIlFOIQjq2z5oDdoHC`) since the owner's restart at
  06:17:12Z; previous `a2e6ea99…` retained for rollback.
- 2026 attached by the single D4 commit (audit 205, digest `100c112f…76aa7`), then published by the owner. The authoritative publication is
  **revision 3** (audit 207, 2026-11-21T07:26:25.496Z), with the 14 D-370-1 ids ineligible. Revision 2 (audit 206, 07:06:27.994Z)
  carried an empty list because the form submitted no ids; it was corrected by the owner's re-publication under §8.3 item 1. No vote changed.
- Acceptance (§7.3): A1c PASS (re-run on revision 3), binding P10d PASS, A3b PASS, and the owner's §6.5 observation recorded.

**Finding (tracked as AFLDB-ISSUE-371).** After publication `/brownlow/2026` served the correct body under the head of the earlier 404
(`Page not found | AFLDB`, site-default description): every P10c sample at 07:27:31Z, and one browser navigation at 08:31:56Z, after which every
request was correct. Self-healing within the hourly ISR window; no data effect.

**Retained, for the owner to dispose of:**
- production: backup `/home/arm/backups/afldb-r7r3-20261121T060018Z/`; data directories `/home/arm/r7r3-data-20261121T060018Z` (holds the
  first A1c FAIL) and `/home/arm/r7r3-data-20261121T072718Z`; the never-promoted 7R2 release `a3c8c67cc98f-JFf9-hXYa6xoigu5Tw4Hg`;
- streamanator: the D1v copy and its stopped cluster `/mnt/ssd/afldb-r7r3-20261121/d1v-20261121T060018Z`, and the earlier prod-dump copies in
  the stopped `/mnt/ssd/afldb-bv2026-20261121/pg-rst` cluster (both hold production data, including auth tables);
- P4 warnings: a reboot is pending (6 kernel packages) and the needrestart hold is missing (ISSUE-351 territory).
