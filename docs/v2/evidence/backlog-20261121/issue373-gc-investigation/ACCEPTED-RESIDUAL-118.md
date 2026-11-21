# ISSUE-373 accepted residual: the 118 G-c findings over 113 distinct cells (generated 2026-11-22, run d)

Generated mechanically from `failing-cells-118.csv` (sha256 of the committed LF blob `ab7c94ab02601df85c17f0a801dd8ab1db7163767fde6e78912387b1c8c39bb1`) and `data/reference/gridley-approved-deferrals.json`
(sha256 `86d8d05c151d82b2b705f6b201164fdbf86b8ddc4a8fa10137f7649d9a9ac24a`, corpus sha256 `bb5ae25ccdbb84e2a7579f41e3984f006da201cf86b8ee4bb8499406119b504f`). Owner decision 7 of 2026-11-22 (round 3): option 1, record the accepted residual and
resolve ISSUE-373. **Any G-c finding not listed here (a different board/cell, category or Gridley player) is NEW and needs its own
explanation: its own issue or owner decision.** N7 is unchanged and keeps failing on exactly this list.

## Reconciliation

| | Findings | Distinct cells |
|---|---|---|
| A. `unsupported` = approved deferrals (ISSUE-118 §23.36 W.2/W.3, decided 2026-09-05) | 78 | 78 (equal, cell for cell, to the 78 cells of `gridley-approved-deferrals.json`) |
| B. `criterion disagreement` = approved brother disagreements (D-GAP029-21, D-GAP029-D3, D-GAP029-D4W) | 40 | 35 |
| Total | **118** | **113** |

Why 118 findings but 113 cells: the two sets share no cell (A and B are disjoint), and inside B five cells carry **two** findings each,
one for Jarryd Lyons and one for Jimmy Webster (two different Gridley players AFLDB omits from the same brother cell):
board 920 cell 2-2, board 964 cell 2-1, board 990 cell 2-2, board 1073 cell 2-2, board 1109 cell 2-2. So 78 + 40 = 118 findings; 78 + (40 - 5) = 78 + 35 = 113 distinct cells.

## A. The 78 approved deferrals (by board and cell)

| # | Board | Cell | Row | Col | Unsupported criterion | Approval |
|---|---|---|---|---|---|---|
| 1 | 16 | 0-2 | RI | tasmanian | tasmanian | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 2 | 16 | 1-2 | BL | tasmanian | tasmanian | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 3 | 16 | 2-2 | 2000s | tasmanian | tasmanian | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 4 | 17 | 0-2 | HW | intrulesplayer | intrulesplayer | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 5 | 17 | 1-2 | GW | intrulesplayer | intrulesplayer | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 6 | 17 | 2-2 | pick1 | intrulesplayer | intrulesplayer | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 7 | 27 | 0-2 | BL | intrulesplayer | intrulesplayer | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 8 | 27 | 1-2 | ES | intrulesplayer | intrulesplayer | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 9 | 27 | 2-2 | coleman | intrulesplayer | intrulesplayer | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 10 | 47 | 0-2 | RI | spoils5season | spoils5season | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 11 | 47 | 1-2 | GW | spoils5season | spoils5season | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 12 | 47 | 2-2 | PA | spoils5season | spoils5season | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 13 | 57 | 0-2 | goals100career | nfl | nfl | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 14 | 57 | 1-2 | 2000s | nfl | nfl | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 15 | 57 | 2-2 | games100orless | nfl | nfl | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 16 | 59 | 2-0 | irish | BL | irish | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 17 | 59 | 2-1 | irish | 2010s | irish | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 18 | 59 | 2-2 | irish | finals1 | irish | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 19 | 96 | 1-0 | recruitedByDodoro | games200 | recruitedByDodoro | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 20 | 96 | 1-1 | recruitedByDodoro | finals1 | recruitedByDodoro | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 21 | 96 | 1-2 | recruitedByDodoro | clubLeadingGoalKicker | recruitedByDodoro | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 22 | 111 | 2-0 | irish | ME | irish | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 23 | 111 | 2-1 | irish | clubs1 | irish | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 24 | 111 | 2-2 | irish | grandfinals1 | irish | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 25 | 121 | 2-0 | intrulesplayer | WB | intrulesplayer | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 26 | 121 | 2-1 | intrulesplayer | RI | intrulesplayer | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 27 | 121 | 2-2 | intrulesplayer | 2000s | intrulesplayer | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 28 | 130 | 2-0 | recruitedByDodoro | ES | recruitedByDodoro | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 29 | 130 | 2-1 | recruitedByDodoro | GW | recruitedByDodoro | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 30 | 130 | 2-2 | recruitedByDodoro | clubs2+ | recruitedByDodoro | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 31 | 194 | 0-2 | allAus1990s | intrulesplayer | intrulesplayer | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 32 | 194 | 1-2 | allAus2000s | intrulesplayer | intrulesplayer | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 33 | 194 | 2-2 | allAus2010s | intrulesplayer | intrulesplayer | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 34 | 225 | 0-0 | WC | season2024player | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 35 | 225 | 1-0 | KA | season2024player | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 36 | 225 | 2-0 | WB | season2024player | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 37 | 227 | 0-0 | CA | season2024player | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 38 | 227 | 1-0 | marc-murphy-teammate-4944 | season2024player | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 39 | 227 | 2-0 | height180 | season2024player | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 40 | 228 | 0-1 | SY | season2024player | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 41 | 228 | 1-1 | keidean-coleman-teammate-4374 | season2024player | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 42 | 228 | 2-1 | disposals20grandfinal | season2024player | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 43 | 229 | 0-1 | GE | season2024player | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 44 | 229 | 1-1 | zach-merrett-teammate-7459 | season2024player | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 45 | 229 | 2-1 | brownlowTop10 | season2024player | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 46 | 234 | 0-1 | allAus2x | season2024player | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 47 | 234 | 1-1 | rory-laird-teammate-6333 | season2024player | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 48 | 234 | 2-1 | disposalstop10season | season2024player | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 49 | 241 | 0-1 | captain | season2024player | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 50 | 241 | 1-1 | toby-greene-teammate-6998 | season2024player | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 51 | 241 | 2-1 | goalstop10season | season2024player | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 52 | 302 | 0-2 | disposals35 | season2024player | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 53 | 302 | 1-2 | ben-keays-teammate-621 | season2024player | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 54 | 302 | 2-2 | draw | season2024player | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 55 | 368 | 0-2 | clubbestfairest | season2024player | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 56 | 368 | 1-2 | harry-sheezel-teammate-3108 | season2024player | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 57 | 368 | 2-2 | disposals35 | season2024player | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 58 | 390 | 0-0 | season2024player | CW | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 59 | 390 | 0-1 | season2024player | SY | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 60 | 390 | 0-2 | season2024player | premier1x | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 61 | 411 | 0-1 | allAus1953 | season2024player | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 62 | 411 | 1-1 | marcus-bontempelli-teammate-4950 | season2024player | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 63 | 411 | 2-1 | disposals30-goals2 | season2024player | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 64 | 421 | 0-1 | goals3final | season2024player | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 65 | 421 | 1-1 | isaac-heeney-teammate-3302 | season2024player | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 66 | 421 | 2-1 | disposals30final | season2024player | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 67 | 440 | 0-0 | SY | season2024player | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 68 | 440 | 1-0 | BL | season2024player | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 69 | 440 | 2-0 | allAus1953 | season2024player | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 70 | 487 | 0-1 | captain | season2024player | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 71 | 487 | 1-1 | toby-greene-teammate-6998 | season2024player | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 72 | 487 | 2-1 | goalstop10season | season2024player | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 73 | 560 | 0-2 | allAus1990s | intrulesplayer | intrulesplayer | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 74 | 560 | 1-2 | allAus2000s | intrulesplayer | intrulesplayer | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 75 | 560 | 2-2 | allAus2010s | intrulesplayer | intrulesplayer | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 76 | 928 | 0-0 | season2024player | CW | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 77 | 928 | 0-1 | season2024player | SY | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |
| 78 | 928 | 0-2 | season2024player | premier1x | season2024player | gridley-approved-deferrals.json (ISSUE-118 W.2/W.3, 2026-09-05) |

## B. The 40 approved brother disagreements (by board and cell; * = one of the five two-finding cells)

| # | Board | Cell | Row | Col | Partner criterion | Gridley player AFLDB omits | Approval |
|---|---|---|---|---|---|---|---|
| 1 | 562 | 2-1 | brother | BL | BL | Jarryd Lyons (g3746) | D-GAP029-21 (Lyons, 21) |
| 2 | 564 | 2-2 | brother | games150 | games150 | Jarryd Lyons (g3746) | D-GAP029-21 (Lyons, 21) |
| 3 | 606 | 2-2 | brother | 2020s | 2020s | Jarryd Lyons (g3746) | D-GAP029-21 (Lyons, 21) |
| 4 | 624 | 2-0 | brother | GC | GC | Jarryd Lyons (g3746) | D-GAP029-21 (Lyons, 21) |
| 5 | 624 | 2-2 | brother | 2020s | 2020s | Jarryd Lyons (g3746) | D-GAP029-21 (Lyons, 21) |
| 6 | 682 | 2-1 | brother | marks10match | marks10match | Jarryd Lyons (g3746) | D-GAP029-21 (Lyons, 21) |
| 7 | 682 | 2-2 | brother | prelimfinals1 | prelimfinals1 | Jarryd Lyons (g3746) | D-GAP029-21 (Lyons, 21) |
| 8 | 693 | 1-0 | brother | games100 | games100 | Jarryd Lyons (g3746) | D-GAP029-21 (Lyons, 21) |
| 9 | 728 | 2-2 | brother | 2010s | 2010s | Jarryd Lyons (g3746) | D-GAP029-21 (Lyons, 21) |
| 10 | 774 | 2-1 | brother | prelimfinals1 | prelimfinals1 | Jarryd Lyons (g3746) | D-GAP029-21 (Lyons, 21) |
| 11 | 774 | 2-2 | brother | games100 | games100 | Jarryd Lyons (g3746) | D-GAP029-21 (Lyons, 21) |
| 12 | 779 | 2-0 | brother | AD | AD | Jarryd Lyons (g3746) | D-GAP029-21 (Lyons, 21) |
| 13 | 779 | 2-1 | brother | handballs20 | handballs20 | Jarryd Lyons (g3746) | D-GAP029-21 (Lyons, 21) |
| 14 | 779 | 2-2 | brother | games150 | games150 | Jarryd Lyons (g3746) | D-GAP029-21 (Lyons, 21) |
| 15 | 784 | 2-0 | brother | GC | GC | Jarryd Lyons (g3746) | D-GAP029-21 (Lyons, 21) |
| 16 | 784 | 2-2 | brother | 2010s | 2010s | Jarryd Lyons (g3746) | D-GAP029-21 (Lyons, 21) |
| 17 | 792 | 2-1 | brother | disposals25 | disposals25 | Jarryd Lyons (g3746) | D-GAP029-21 (Lyons, 21) |
| 18 | 797 | 2-1 | brother | BL | BL | Jarryd Lyons (g3746) | D-GAP029-21 (Lyons, 21) |
| 19 | 805 | 2-0 | brother | BL | BL | Jarryd Lyons (g3746) | D-GAP029-21 (Lyons, 21) |
| 20 | 819 | 2-1 | brother | marks10match | marks10match | Jarryd Lyons (g3746) | D-GAP029-21 (Lyons, 21) |
| 21 | 819 | 2-2 | brother | prelimfinals1 | prelimfinals1 | Jarryd Lyons (g3746) | D-GAP029-21 (Lyons, 21) |
| 22 | 920 | 2-0 | brother | GC | GC | Jarryd Lyons (g3746) | D-GAP029-D3 (Lyons 2026 boards, 11) |
| 23 | 920 | 2-2* | brother | 2020s | 2020s | Jarryd Lyons (g3746) | D-GAP029-D3 (Lyons 2026 boards, 11) |
| 24 | 920 | 2-2* | brother | 2020s | 2020s | Jimmy Webster (g3989) | D-GAP029-D4W (Webster, 8) |
| 25 | 929 | 2-2 | brother | goalscareerlessthan20 | goalscareerlessthan20 | Jimmy Webster (g3989) | D-GAP029-D4W (Webster, 8) |
| 26 | 964 | 2-1* | brother | marks10match | marks10match | Jarryd Lyons (g3746) | D-GAP029-D3 (Lyons 2026 boards, 11) |
| 27 | 964 | 2-1* | brother | marks10match | marks10match | Jimmy Webster (g3989) | D-GAP029-D4W (Webster, 8) |
| 28 | 964 | 2-2 | brother | prelimfinals1 | prelimfinals1 | Jarryd Lyons (g3746) | D-GAP029-D3 (Lyons 2026 boards, 11) |
| 29 | 990 | 2-1 | brother | goalscareerlessthan20 | goalscareerlessthan20 | Jimmy Webster (g3989) | D-GAP029-D4W (Webster, 8) |
| 30 | 990 | 2-2* | brother | 2020s | 2020s | Jarryd Lyons (g3746) | D-GAP029-D3 (Lyons 2026 boards, 11) |
| 31 | 990 | 2-2* | brother | 2020s | 2020s | Jimmy Webster (g3989) | D-GAP029-D4W (Webster, 8) |
| 32 | 1015 | 2-0 | brother | AD | AD | Jarryd Lyons (g3746) | D-GAP029-D3 (Lyons 2026 boards, 11) |
| 33 | 1015 | 2-1 | brother | BL | BL | Jarryd Lyons (g3746) | D-GAP029-D3 (Lyons 2026 boards, 11) |
| 34 | 1073 | 2-2* | brother | 2020s | 2020s | Jarryd Lyons (g3746) | D-GAP029-D3 (Lyons 2026 boards, 11) |
| 35 | 1073 | 2-2* | brother | 2020s | 2020s | Jimmy Webster (g3989) | D-GAP029-D4W (Webster, 8) |
| 36 | 1109 | 2-1 | brother | woodenspoon | woodenspoon | Jimmy Webster (g3989) | D-GAP029-D4W (Webster, 8) |
| 37 | 1109 | 2-2* | brother | finals1 | finals1 | Jarryd Lyons (g3746) | D-GAP029-D3 (Lyons 2026 boards, 11) |
| 38 | 1109 | 2-2* | brother | finals1 | finals1 | Jimmy Webster (g3989) | D-GAP029-D4W (Webster, 8) |
| 39 | 1114 | 2-1 | brother | finals10 | finals10 | Jarryd Lyons (g3746) | D-GAP029-D3 (Lyons 2026 boards, 11) |
| 40 | 1114 | 2-2 | brother | grandfinals1 | grandfinals1 | Jarryd Lyons (g3746) | D-GAP029-D3 (Lyons 2026 boards, 11) |
