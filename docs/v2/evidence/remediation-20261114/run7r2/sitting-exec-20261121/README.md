# Release 7R2 sitting, Saturday 21 November 2026 (13:00–15:00 AEDT window)

Packet: `run7r2/RELEASE-PACKET-7R2.md`. Executed by Claude over Windows OpenSSH (`C:/Windows/System32/OpenSSH/ssh.exe afldb`),
one connection per step; the owner performs every restart. Block transcripts are beside this file (`*.log`).

## 1. Approval (owner, verbatim, received 2026-11-21 ~01:45Z)

> Approval R7R2: I approve publishing PREP (the records-only commit adding release packet 7R2) to origin/main by fast-forward, and the attended production release of a3c8c67cc98fc35e963795e331e7217a24ccf1e0 per release packet 7R2 (docs/v2/evidence/remediation-20261114/run7r2/RELEASE-PACKET-7R2.md, SHA256SUMS sha256 78b655fdaf25a38dff386103264ef92abcb12bd0f84ef2346f78dd22b342a90b, origin/main pin PREP = 4484a6d09ffa3d38c6dfd992ff41a7163fe458c6) on Saturday 21 November 2026, 13:00–15:00 AEDT. PREP pins the reviewed procedure; the serving checkout and the build target a3c8c67c exactly.
>
> Claude runs, over Windows OpenSSH, one connection per step, the packet 7 §5 sequence with the 7R2 blocks: P0–P2, P3, P4, then the S7/S8 checks, the public smoke, the P10 after page checks and the 30-minute observation.
>
> I perform sudo systemctl restart afldb myself, attest its InvocationID only if S7 shows the apt coincidence, and report my signed-in browser observations of the 2026 BV cell and of 2026 Brownlow votes on the season, match and game-log pages.
>
> On a packet 7 §8 trigger, roll back to a2e6ea9995a4-aKAYwf0qC4go6JJWiHhv5, with my restart.
>
> No database write, reversal, restore or B1a step.
>
> Afterwards, record the outcome in a records-only commit and publish it by fast-forward.
>
> Stop if P1 reads anything other than packet 7 §4 expects.

## 2. Execution

| Step | UTC | Result | Transcript |
|---|---|---|---|
| P0 | 02:00:23 | PASS. Workstation pins and manifest `78b655fd…` verified; PREP published by fast-forward `a3c8c67c..4484a6d0`; live tip `4484a6d0` | `p0.log` |
| P1 | 02:00:32 | PASS. `current` a2e6ea99, `previous` c1c4b22e, checkout a2e6ea99 clean on main, origin/main = PREP, no locks, settle/apt idle (next settle Sun 05:03 AEDT, next apt-daily 18:09 AEDT), MemAvailable 2823 MB, 44 G free, node v22.23.2, 2026: 669 rows pending with NULL votes, season complete, InvocationID `fabd985f…` NRestarts 0 | `p1.log` |
| P2 | 02:00:47 | PASS. Delta 149 paths = reviewed sha256 `b2d0b698…`; CAND..PREP 18 paths, docs/trackers only; fast-forward to `a3c8c67c`; node_modules match the lock | `p2.log` |
| P3 | 02:00:57–02:05:32 | BUILD_EXIT=0, log `/home/arm/r7-build-20261121T020057Z.log` | `p3.log` |
| P3b | 02:05:45 | PASS. `NEW_ID a3c8c67cc98f-JFf9-hXYa6xoigu5Tw4Hg`, BUILD_ID `JFf9-hXYa6xoigu5Tw4Hg`, VERIFY PASS (13002 files), links untouched. First attempt (02:05) stopped at its own argument check before doing anything: Git Bash rewrote the `/home/arm/…` argument into a Windows path for the native `ssh.exe`. Re-sent with `MSYS_NO_PATHCONV=1` | `p3b.log`, `p3b-attempt1-msys-pathconv.log` |
| §6.1 browser readiness | ~02:10 | **UNVERIFIED.** The owner was unavailable and asked Claude to check via the Playwright MCP in an existing signed-in session. That server failed to connect in this session (and is not granted under CLAUDE.md §15), and Claude holds no signed-in browser session. No substitute was used: minting a beta claim for the public route would bypass the P10 discipline (claims stay on loopback). The pre-promote baseline is therefore `OWNER-BROWSER-READINESS: NOT CONFIRMED` | — |

## 3. HOLD at P3 (owner, 2026-11-21)

> Hold Release 7R2 at P3. Do not promote or restart under the current packet. Record my owner browser observation: on Scott
> Pendlebury's player page, the 2026 BV cell displayed "Not yet awarded". That confirms the displayed text, but I dispute its
> correctness. The 2026 season finished in September and the Brownlow was awarded on Monday 21 September 2026. I can see 2026
> votes on the season page, but the 2026 results appear to be missing from https://beta.afldb.com/brownlow.

The sitting stops after P3b. **P4 (promote), S7/S8, the public smoke, P10 and the 30-minute observation were not run, and
there was no restart.** State left by the sitting:
- production serves `a2e6ea9995a4-aKAYwf0qC4go6JJWiHhv5`, unchanged;
- the serving checkout is fast-forwarded to `a3c8c67c` (P2);
- release `a3c8c67cc98f-JFf9-hXYa6xoigu5Tw4Hg` is built, verified and unpromoted (P3/P3b).

No database write was made. Approval R7R2 is not used further. The disposition of the built release and of the checkout
belongs to the revised packet.

**Why the 7R2 acceptance criteria need review.** P10 `after` requires the D-365-W text "Results not loaded" on 2026 cells.
Its controls require `/brownlow/2026` = 404 and the season page's no-votes text, and §9/§11 expect the owner to see no 2026
vote number. Those criteria pass only while 2026 is unpublishable, so they would certify the state the owner disputes as
success. The owner's observation was taken on the serving `a2e6ea99`, whose interim ISSUE-365 wording claims the season is
still in progress. Investigation, fix and production action: AFLDB-ISSUE-370 (`issues/open/AFLDB-ISSUE-370.md` on branch
`claude/brownlow-2026-publication-20261121`).
