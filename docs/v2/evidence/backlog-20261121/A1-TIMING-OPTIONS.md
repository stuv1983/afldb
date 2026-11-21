# A1 timing on Tuesday 24 November 2026: T-1 APPROVED (prepared 22 Nov, run d; decided by the owner the same day)

> **Decision.** **T-1 APPROVED** (owner decision of 2026-11-22, written, relayed by the main session): start **09:20 AEDT on Tue 24 Nov 2026**. The window change is approved: 09:20-09:30 read-only P1 + raw-head baseline; 09:30-09:55 P2 fast-forward of the production checkout to `7d92042f` exactly, P3 build, P3b; 10:00 promote, env, owner restart; A2 starts 10:30, R4 after P6 ends (about 10:45); the latest-restart rule stays 10:45. T-2 below is kept only as the record of the alternative; it is not an option on the day.
>
> **Note (2026-11-22, run e, owner decision 6 of round 4; closure LOW C-F-001).** The text above is the owner's decision, kept
> verbatim. Its "R4 after P6 ends (about 10:45)" is stated consistently as: P6 ends about 10:45-10:48; R4 is scheduled
> 11:00-11:20 (runbook §4.5 table), gated on P6 PASS, never started after 11:35. T-1 and the 10:45 latest-restart rule are unchanged
> (10:45 is the restart rule, not the P6 estimate).

**What is decided already.** You approved A1 for **10:00-10:30** and A2 for **10:30-12:00** (Melbourne time, AEDT). You do the one
production restart. Nothing below changes that approval by itself: **any work before 10:00, even read-only checks, is a change to
the window and runs only if you say yes.** Source: `ATTENDED-PLAN-A1-A2-20261124.md` §1-§3 and §4.5.

**Why there is a choice.** Building the release takes about 15-25 minutes. Build, switch, your two environment lines, the
restart and the checks do not all fit in 10:00-10:30. Either part of the work starts before 10:00 (T-1) or A1 runs past 10:30 (T-2).
The site keeps serving the current release (`c8d4202a`) until the moment of your restart, in both options.

## Option T-1 (pre-window build from 09:20)

| Clock | Step | Who | What the site serves |
|---|---|---|---|
| 09:20-09:30 | W0-W2: read-only checks (workstation Git; production status, environment counts, baseline of page heads) | Claude | current release, unchanged |
| 09:30-09:32 | P2: move the server's checkout to the release commit (files on disk only) | Claude | current release, unchanged |
| 09:32-09:57 | P3 build (the server works harder for about 20 minutes; nothing new is served), P3b check | Claude | current release, unchanged |
| 09:55 | Decision: build not passed yet → it may continue; the switch must happen by 10:15 | — | — |
| 10:00-10:03 | P4 switch the release link (the running site does not change until the restart) | Claude | current release |
| 10:03-10:08 | E1-E3: you add the two lines to `.env` | **You** | current release |
| **about 10:08** | **RESTART** | **You** | **new release `7d92042f` from here** |
| 10:10-10:18 | P5 acceptance, page-head check, public smoke | Claude | new release |
| 10:18-10:48 | P6 observation (30 minutes, runs in the background) | Claude | new release |
| **A2 starts 10:30** | R1, R2 (+ hourly job), then R4 at about 11:00 after P6 passes, R5 restriction, R3 to about 12:00 | You + Claude | new release |

## Option T-2 (everything from 10:00)

| Clock | Step | Who | What the site serves |
|---|---|---|---|
| 09:20-09:30 | W0-W2 read-only checks (still before 10:00: also needs your yes; they can move to 10:00 at the cost of about 8 minutes) | Claude | current release |
| 10:00-10:02 | P2 checkout move | Claude | current release |
| 10:02-10:27 | P3 build (about 15-25 minutes), P3b | Claude | current release |
| 10:27-10:30 | P4 switch the release link | Claude | current release |
| 10:30-10:35 | E1-E3: your two `.env` lines | **You** | current release |
| **about 10:32-10:38** | **RESTART** (after the approved A1 slot) | **You** | **new release from here** |
| 10:38-10:45 | P5, page-head check, public smoke | Claude | new release |
| 10:45-11:15 | P6 observation | Claude | new release |
| **A2 starts about 10:45** | R1, R2, R4 at about 11:15 (just before the 11:35 cut-off), R5 restriction, R3 to about 12:15 (**overruns A2 by about 15 minutes**) | You + Claude | new release |

## Rules that apply to both

- **Latest restart: 10:45.** If the restart cannot happen by 10:45, stop before the switch (the site is unchanged) and reschedule A1.
- **Build not passed:** under T-1 a failed build can still be retried once (cause understood) if it fails early enough to finish by the 10:15 switch limit; under T-2 a failed or slow build means stop
  before the switch (decision at 10:35) and reschedule. A2 can still run (it does not depend on A1).
- **R4 is never started after 11:35** and only after P6 passes. R5's restriction follows R4.

## What each option risks

| | T-1 | T-2 |
|---|---|---|
| Change to your approval | Yes: 09:20-10:00 work (read-only checks, checkout move, build) before the window | Smaller: only the 09:20-09:30 read-only checks (or none, if they move to 10:00); but the restart lands **after** 10:30, outside the A1 slot |
| Load on the live site | About 20 minutes of build load 09:32-09:57 while the site serves normally (P1 checks at least 2.1 GB free memory first) | The same build load, 10:02-10:27 |
| Restart | About 10:08, inside the slot, with 37 minutes of margin to 10:45; an early build failure can be retried | About 10:32-10:38, 7-13 minutes of margin to 10:45; no room for a build retry |
| Checks after the restart | All complete inside A1, P6 ends about 10:48 | P5/S9 by about 10:45, P6 ends about 11:15 |
| A2 | Full 90 minutes; R4 about 11:00, well before 11:35 | Starts about 10:45; R4 squeezed against 11:35; R3 overruns to about 12:15 |
| If something goes wrong | Rollback inside the morning with time to verify | Rollback and A2 compete for the same time |

## Recommendation (accepted: T-1)

**T-1.** It is the only option that gives the checks enough time: the restart lands inside your 10:00-10:30 slot with a 37-minute
margin to the 10:45 limit, an early build failure can still be retried, every acceptance check and the 30-minute observation finish before R4 needs them,
and A2 keeps its full 90 minutes (R4 well before its 11:35 cut-off). Its cost is that the read-only checks, the checkout move and the
build happen between 09:20 and 10:00, before the window you approved; the site serves exactly what it serves now until your restart
at about 10:08. If you prefer not to extend the window, T-2 works only when the build is quick (under about 20 minutes) and accepts a
restart after 10:30 and a short A2 overrun.

**Answered 22 Nov: T-1, start 09:20.** The session does not ask again; the pre-window work 09:20-10:00 is approved.
