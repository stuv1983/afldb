# tools/rebuild/draftguru/

DraftGuru acquisition, bridge-building and adjudication tooling for AFLDB-ISSUE-222. See
`AFLDB-ISSUE-222.md` and `issues.md` for the tracked issue and its stage history.

## `review_bridge_operator.py` -- local operator-adjudication GUI

### 1. Purpose

- This application records the operator's decisions for the 83-row ISSUE-222 adjudication
  pack (`docs/rebuild-manifests/draftguru/bridge-operator-adjudication-pack-20260918-v1.json`):
  44 relisting-signature rows, 2 tokenisation rows, 7 source-discrepancy rows and 30 audit rows.
- It does **not** link players, modify a database, approve Phase 3, or generate bridge v2.
- The source adjudication pack is a read-only input. This tool never opens it for writing and
  independently re-verifies its sha256 (and every hash-linked input it names) before it will
  start. Phase 3 remains PENDING until the operator completes this pack, the existing 997-row
  recheck queue and the population-scan decision table.

### 2. Prerequisites

- Run from the repository root: `D:\dev\afldb-issue-222`
- Python interpreter: `C:\Users\stuar\AppData\Local\Programs\Python\Python312\python.exe`
  (must have Tcl/Tk available to open the GUI; `--validate-only` works without it)
- Source pack path (read-only, must already exist and be byte-identical to what was
  reviewed/committed):
  `docs/rebuild-manifests/draftguru/bridge-operator-adjudication-pack-20260918-v1.json`
- Validation command (headless, no GUI, no lock, no checkpoint):

  ```powershell
  Set-Location 'D:\dev\afldb-issue-222'
  $pythonExe = 'C:\Users\stuar\AppData\Local\Programs\Python\Python312\python.exe'
  & $pythonExe tools\rebuild\draftguru\review_bridge_operator.py --validate-only
  ```

### 3. Exact launch command

```powershell
Set-Location 'D:\dev\afldb-issue-222'
$pythonExe = 'C:\Users\stuar\AppData\Local\Programs\Python\Python312\python.exe'
& $pythonExe tools\rebuild\draftguru\review_bridge_operator.py --validate-only
& $pythonExe tools\rebuild\draftguru\review_bridge_operator.py
```

Run `--validate-only` first. It proves the pack and every hash-linked input still match what
was reviewed, without opening the GUI, acquiring the review lock, or creating a checkpoint. Only
then run the plain command to open the GUI.

Once the operator has finalised all 83 decisions, independently validate the resulting verdict
artefacts (`bridge-operator-verdicts-20260918-v1.{json,csv,md}`) against the pinned,
operator-reported hashes and the immutable source pack -- headless, no GUI, no lock, no
checkpoint access, and it writes, regenerates or repairs nothing:

```powershell
& $pythonExe tools\rebuild\draftguru\review_bridge_operator.py --validate-final-output
```

It re-verifies the source pack's own sha256, the canonical JSON/CSV/Markdown hashes and sizes,
every hash-linked input, row identity/order against the pack, every decision's verdict/notes/
club-observation-acknowledgement contract, the `totals` block, and a byte-for-byte deterministic
re-render of the CSV and Markdown -- printing a concise PASS report (group/verdict/event-club
totals, negative/uncertain/operator-overridden rows for awareness) or refusing with the exact
failed invariant. It never reassesses or changes an operator verdict or acknowledgement.

If a checkpoint already exists from an older tool version, opening the GUI (or
`--migrate-checkpoint-only`, below) migrates it automatically -- see "Checkpoint schema
migration" under "Saving and resuming".

```powershell
& $pythonExe tools\rebuild\draftguru\review_bridge_operator.py --migrate-checkpoint-only
```

Loads the checkpoint, migrates it to the current schema version if needed (backing up the
pre-migration file first), prints a summary (`schema_version`, decisions recorded, and how many
rows are fully complete including any required club-observation acknowledgement), and exits --
never opens the GUI, never touches the pack.

### 4. Screen walkthrough

### 4.0 Window layout (screen-size fix, 2026-09-18)

A real operator session at a smaller screen resolution found the navigation footer pushed
entirely off-screen, with no way to reach it. The window is now three fixed regions:

- **A fixed header at the top** (never scrolls): row/group status, the three progress counters,
  verdict-count totals, the warning banner, and the group/completion filters.
- **A single whole-form scrollable middle** containing sections A-D and the collapsed
  Supporting-evidence/Advanced toggles. This is the **only** scroll region in the normal
  workflow -- there is no separate, nested scrollbar for the evidence panel any more.
- **A fixed footer at the bottom** (never scrolls, always visible, at any window size): **<
  Previous**, **Next >**, the current row position (e.g. "Row 3 of 83"), **Save checkpoint**,
  **Discard unsaved changes**, and **Finalise**. Previous and Next are never placed inside the
  scrolling content.

Within the scrollable middle: the mouse wheel scrolls the whole form (not just one
subsection); Page Up/Page Down scroll a page at a time; Home scrolls to the start of the
current row's content, End to the end of it (just above the fixed footer) -- both act on the
form's scroll position, not a text cursor, except while your cursor is inside a notes field,
where Home/End keep their ordinary text-editing meaning. Tabbing or clicking into any control
automatically scrolls it into view. The form's content is re-wrapped to the current window
width on every resize -- nothing requires horizontal scrolling, and no content is clipped at
the left edge.

The screen is organised in a fixed order within that scrollable middle:

- **A. Source evidence** -- the DraftGuru name and event details, plus **Open DraftGuru page**
  / **Copy DraftGuru URL** buttons (same line) with the exact URL shown beside them.
- **B. Retained target evidence** -- the AFL Tables / AFLDB player details, plus **Open AFL
  Tables page** / **Copy AFL Tables URL** buttons (same line) with the captured href and the
  full constructed URL shown beside them.
- **C. Identity decision** -- a plain-English relationship dropdown (see "Verdict meanings"),
  its selection status, and notes.
- **D. Event-club relationship** -- a plain-English suggestion and an explicit confirm/choose-
  different workflow (see "Event club appearance relationship").
- **Supporting comparison evidence** -- collapsed by default behind a **"Show details"** toggle
  (any remaining pack fields, machine classification, and any machine-generated recommendation,
  always clearly labelled "MACHINE-GENERATED, NOT AN OPERATOR DECISION" -- evidence to weigh,
  never a suggested answer to accept). Click to expand/collapse; nothing here is required to
  reach a decision, so it stays out of the way by default.
- Bulk action, collapsed behind an **"Advanced (bulk actions)"** toggle, off by default and
  never occupying the main review area during normal use.
- **E. Navigation** -- the fixed footer described above.

Without excessive scrolling, the normal workflow exposes: the player/event summary, the
DraftGuru and AFL Tables buttons, the identity verdict, the club-relationship suggestion and
confirmation, and the fixed navigation footer.

Notes fields (both the identity notes and the club-observation notes) start at a single
compact line and only expand when notes are required for the current choice or already
contain text -- an optional, empty notes field never occupies a large empty text area.

- **Progress counters** (top of window, three separate lines -- see "Progress counters" below):
  `Identity verdicts entered: N / 83`, `Club acknowledgements still required: M`, and
  `Fully completed rows: K / 83`. These only change once a row carries a real, explicit
  decision -- never on window open, never on navigation alone -- and the header, the filters and
  the Finalise button always use the same underlying calculation.
- **Group and group position**: the status line shows which of the four groups the current row
  belongs to (relisting / tokenisation / discrepancy / audit) and the row's position within that
  group (e.g. "Group position 12 of 44"), plus the row's immutable pack ordinal.
- **Group filter**: a dropdown above the evidence panel restricts navigation to one group, or
  `(all)` for every row in pack order.
- **"Hide fully completed rows" filter**: a checkbox that hides rows that are already fully
  complete (identity decision plus any required club-observation acknowledgement -- see below),
  so Next/Previous only step through what is left to do.
- **"Needs club-observation acknowledgement" filter**: a checkbox that restricts navigation to
  rows currently missing a required event-club-appearance-relationship acknowledgement. See
  "Event club appearance relationship" below.
- **Evidence links (Open / Copy)**: "Open DraftGuru page" and "Open AFL Tables page" launch your
  normal web browser (Python's standard `webbrowser` module) for human evidence review only --
  this tool never fetches, scrapes or requests either page itself, and a failed browser launch
  is reported in a dialog and never affects your saved verdict or notes. "Copy DraftGuru URL"
  and "Copy AFL Tables URL" put the exact URL on your clipboard; **neither URL is ever written
  into your notes automatically**. The AFL Tables URL is built from the row's captured href
  (e.g. `players/A/Andrew_Krakouer0.html` -> `https://afltables.com/afl/stats/players/A/Andrew_Krakouer0.html`)
  and, together with the DraftGuru URL, is validated for scheme and host before it is ever
  opened -- only `afltables.com`/`www.afltables.com` and `draftguru.com.au`/
  `www.draftguru.com.au` are permitted; anything else (wrong host, wrong scheme, missing or
  malformed) is refused with a clear dialog instead of being opened. A link is opened only in
  direct response to your own explicit click on its button -- never automatically, and never
  during validation or a test.
- **Identity decision (C)**: a read-only dropdown of plain-English relationship choices for the
  current group (see "Verdict meanings"), with an initial blank `Choose a verdict...` entry.
  Directly below it, a high-visibility status line always states the actual selection in words
  -- `Selected: NONE -- choose one before continuing` or `Selected: <friendly label>` -- with the
  stable stored code shown underneath in smaller text. The stored code, never the friendly
  label, is what is written to the checkpoint and the final artefact.
- **Notes field**: free text, required for a negative or uncertain choice (see "How to decide").
  Notes are saved when the field loses focus and whenever the row's decision changes.
- **Event-club relationship (D)**: a plain-English suggestion derived from retained evidence
  (never an operator decision) is shown first, with its stable stored code in smaller supporting
  text underneath. A status line states plainly whether it has been acknowledged --
  `Club-appearance acknowledgement: NOT YET CONFIRMED` until you act. Two buttons, **"Confirm
  suggested relationship"** and **"Choose a different relationship"**, are the only ways to
  record it -- nothing is ever preselected merely because it matches the suggestion. Choosing a
  different relationship reveals a friendly dropdown and a notes field (required only when your
  choice differs from the suggestion) plus a "Save observation" button. See "Event club
  appearance relationship" below.
- **Previous / Next** (fixed footer; also `Alt+Left` / `Alt+Right` from any normal control,
  including from inside a notes field -- a multiline text field never swallows these): move
  between rows in the CURRENTLY DISPLAYED filtered order (never the unfiltered pack order).
  **Previous is visibly disabled, with a status message "Already at the first displayed row.",
  when the displayed row is first in that order; Next is visibly disabled, with "Already at the
  last displayed row.", when it is last; if only one row matches the current filters, both are
  disabled with "Only one row matches the current filters."** Filtering always recalculates this
  correctly. After moving forward, Previous returns to the prior displayed row. If a pending
  club-observation edit exists in "Choose a different relationship" (see "Event club appearance
  relationship" below), both buttons are refused with a dialog -- "Cannot leave this row until
  the invalid unsaved change is corrected or discarded." for an invalid edit, or a similar
  message pointing at Save/Discard for a valid-but-unsaved one -- and keyboard focus moves to
  the field that needs attention, instead of silently saving or discarding it. Identity
  (verdict) notes still commit automatically on navigation, as before.
- **Save checkpoint** (fixed footer; also `Ctrl+S` from any normal control): writes the current
  state to the checkpoint file immediately. The tool also saves automatically after every
  verdict change, every successful club-observation save/confirm, and when the identity notes
  field loses focus -- **never** merely because the club-observation dropdown or its notes were
  edited; see "Saved acknowledgement vs. Unsaved change" under "Event club appearance
  relationship" below.
- **Discard unsaved changes** (fixed footer; also `Escape` from any normal control, after a
  confirmation dialog): abandons whatever is currently sitting unsaved in the club-observation
  controls and restores them to the last persisted value -- never touches the checkpoint, never
  deletes a previously saved verdict or acknowledgement. A no-op when there is nothing pending.
- **Finalise** (fixed footer): disabled until all 83 rows are **fully completed** -- a valid,
  correctly-noted identity decision AND every required club-observation acknowledgement
  recorded. Also refused (with the same dialog/focus behaviour as Previous/Next) while a
  pending club-observation edit exists. See "Finalisation".
- **Bulk action section** (optional, collapsed behind "Advanced (bulk actions)", disabled by
  default): see "Bulk action warning". Bulk action only ever sets the identity verdict; it never
  touches the club-observation acknowledgement, so a bulk-applied row needing one still surfaces
  in the "Needs club-observation acknowledgement" filter afterward.

### 5. Verdict meanings

The GUI shows the friendly label as the primary choice, with the stable stored code shown
underneath in smaller supporting text once selected. The stored code is the only thing ever
written to the checkpoint or the final verdict artefact -- the friendly label is presentation
only.

**Relisting rows** (44 rows):

- "Same player -- valid re-draft or re-listing" (stored: `same_person_valid_relisting`) -- the
  retained evidence describes the same player being listed/drafted again.
- "Different player -- captured AFL Tables link is wrong" (stored:
  `different_person_wrong_href`) -- DraftGuru's captured AFL Tables link identifies a different
  person.
- "Unable to determine -- withhold this link" (stored: `undetermined_withhold`) -- evidence is
  insufficient; keep the row withheld.

**Tokenisation rows** (2 rows):

- "Same player -- spelling or formatting difference only" (stored:
  `same_person_valid_href`) -- accent, spacing, apostrophe or compound-name handling explains
  the apparent difference, and retained facts identify the same person.
- "Different player -- captured AFL Tables link is wrong" (stored:
  `different_person_wrong_href`) -- the href identifies another person.
- "Unable to determine -- withhold this link" (stored: `undetermined_withhold`) -- evidence is
  insufficient.

**Source-discrepancy rows** (7 rows):

- "Same player -- approve the corrected identity" (stored: `approve_manual_curation`) --
  evidence supports the same person, but the href form cannot be automatically corrected under
  the current contract.
- "Different player -- reject the corrected identity" (stored: `reject_candidate`) -- the
  proposed corrected identity is not supported.
- "Unable to determine -- withhold this link" (stored: `undetermined_withhold`) -- evidence
  remains insufficient.

**Audit rows** (30 rows):

- "Same player -- evidence agrees" (stored: `agree`) -- source and retained target evidence
  describe the same person.
- "Different player -- evidence contradicts" (stored: `contradict`) -- evidence indicates
  different people.
- "Unable to determine" (stored: `undetermined`) -- evidence is insufficient.

### 6. How to decide

- Use name plus birth year/age, career dates, games, goals, clubs and event type together --
  never any single field alone.
- Do **not** decide from name equality alone.
- DraftGuru per-entry games are games following that listing event, not necessarily career
  games.
- A zero-game later listing does not erase an earlier career.
- Club differences alone are not contradictions (see the repository's club-lineage rules).
- **A player can be drafted again by the same club. A same-club re-draft or re-listing is still
  a valid re-draft/re-listing event.** "Re-draft" does not mean a different club drafted the
  player -- an operator reviewing this pack initially misread it that way. For relisting rows
  specifically, the GUI shows a reminder under the verdict dropdown: "This includes being
  drafted or listed again by the same club."

  Example of the general pattern (illustrative only -- this is not a claim about which named
  DraftGuru/AFL Tables record is correct for any specific pack row, and Wikipedia is never a
  canonical source for a verdict): a player plays a handful of senior games for a club in the
  late 1980s, is delisted, and is drafted again years later by that **same** club, then plays no
  further senior games after the new listing. That is still `same_person_valid_relisting` for
  the identity verdict (the retained evidence describes the same player being listed again) with
  `pre_event_only` for the separate event-club relationship (played for the club before this
  event, not afterward) -- **not** evidence of a different person, and not evidence the listing
  itself was invalid.
- When genuinely unsure, choose the group's undetermined/withhold verdict instead of guessing.
- Notes are mandatory for any negative or undetermined decision (`different_person_wrong_href`,
  `undetermined_withhold`, `reject_candidate`, `contradict`, `undetermined`); the tool refuses to
  finalise a row with a required-notes verdict and blank notes.

### 7. Event club appearance relationship

**AFL Tables club history reflects senior appearances, not every drafting/listing club.** A
player can be drafted or listed by a club and never play a senior VFL/AFL game for that club.
Separately, a player can have already played senior games for a club, be delisted, and be
re-drafted/relisted by that **same** club without ever playing another senior game after the new
listing event. AFL Tables (and the retained fitzRoy/AFLDB snapshot this tool reads) lists only
clubs a player actually represented, so either absence is entirely valid and is **never**, by
itself, evidence of a different person or proof the DraftGuru link is wrong. **Do not infer that
"the retained record only shows one club" means the event was not a re-draft** -- a genuine
same-club re-listing produces exactly that shape (one club, a gap in senior appearances around
the listing year), and is still a valid re-draft/re-listing event. Always distinguish the three
possible relationships to the event club explicitly, rather than defaulting to "not a re-draft":
played for the club **before** the event but not afterward; played for the club **after** the
event; or **never** played a senior game for the club at all.

This is captured as a field separate from the identity verdict, `event_club_observation`, one of
five **event-relative** values (compares the specific event's own year against the player's
retained career, never just whether the club appears anywhere in career history). The GUI shows
each as a plain-English choice, with the stable stored code in smaller supporting text:

- "Never played a senior game for this club" (stored: `no_senior_appearance_ever`) -- never
  played a senior game for the event club, at any time.
- "Played for this club before this event, but not afterward" (stored: `pre_event_only`) --
  played for the event club before this event, but not after it.
- "Played for this club after this event" (stored: `post_event_appearance`) -- played for the
  event club after this event (the ordinary case of a player going on to play).
- "Unable to determine from the retained evidence" (stored: `unknown`) -- retained evidence
  cannot establish the relationship (e.g. the event year falls within the whole career span,
  with no per-club season breakdown available to localise it).
- "Not applicable to this row" (stored: `not_applicable`) -- no meaningful event-club comparison
  exists for this row (tokenisation and source-discrepancy rows carry no per-row
  drafting/listing club at all).

For every row where a meaningful comparison exists, the tool shows this plain-English suggestion
first ("Suggested from retained evidence:"), never as a preselected decision, for example:

- "Never played a senior game for North Melbourne."
- "Played for Essendon before this 1990 listing, but made no senior appearance for Essendon
  after it."
- "Played for Carlton after this 1990 listing event."

**The suggestion is never a decision on its own.** Recording your own observation is an explicit
action: click **"Confirm suggested relationship"** to accept the suggestion exactly as shown, or
**"Choose a different relationship"** to record your own from the same five plain-English
choices -- this reveals a dropdown and a notes field, required only when your choice differs
from the suggestion, plus a "Save observation" button. Before either button is clicked, the
status line reads plainly `Club-appearance acknowledgement: NOT YET CONFIRMED`; nothing is ever
preselected merely because it matches the suggestion. Once recorded, the status line reads
`Confirmed: <plain-English sentence>`.

**The observation is independent of the identity verdict and never changes or preselects it.**
A relisted player correctly suggested "before this event, but not afterward" can still correctly
receive a same-person identity verdict; choose the same-person verdict whenever the identity
evidence agrees, and use this separate observation for the club-appearance question -- never
choose the "different player" identity option merely because the draft/listing club shows a
non-appearance.

**Acknowledgement requirement:** for a same-person verdict (a group's positive verdict) on a row
whose suggestion is "Never played a senior game for this club" or "Played for this club before
this event, but not afterward" -- the two relationships that could plausibly be misread as a
contradiction -- the tool requires you to record your own observation before the row counts as
complete. "Played for this club after this event", "Unable to determine from the retained
evidence" and "Not applicable to this row" never require this acknowledgement. Use the "Needs
club-observation acknowledgement" filter (see "Screen walkthrough") to find exactly which rows
still need it.

**"Saved acknowledgement:" vs. "Unsaved change -- not recorded:" (2026-09-18, revised after a
second real operator session):** a real operator session found that an in-progress selection in
"Choose a different relationship" could look identical to a genuinely saved one, and a follow-up
session found the word "Confirmed" itself read as an endorsement of whatever was shown, when it
only ever meant "this is what is currently persisted" -- so the wording changed again. The two
lines are strictly separate and can never be confused, and **neither is ever labelled or
coloured "Confirmed"**:

- The bold **`Saved acknowledgement: <sentence>`** line (green) reflects **only the last
  successfully persisted checkpoint value** -- it changes only when a save actually succeeds
  (via "Confirm suggested relationship" or "Save observation"), never merely because you changed
  the dropdown or typed in the notes field. It states plainly what is saved; it does not imply
  the operator has reviewed or endorsed it -- that judgement is yours.
- Changing the dropdown or typing notes in "Choose a different relationship" instead shows a
  separate, clearly distinct line: **`Unsaved change -- not recorded: <relationship> (click 'Save
  observation' to persist it).`** (amber) if what you currently have selected would be accepted,
  or **`Unsaved change -- not recorded: <relationship> -- <reason>.`** (red) if it would
  currently be refused -- for example, differing from the suggestion with blank notes. **An
  unpersisted or validation-failed value is never coloured or labelled as saved/confirmed.**
- If "Save observation" is refused, the last persisted confirmation is left exactly as it was;
  only the separate "Unsaved change" line identifies the invalid edit.
- **"Confirm suggested relationship"** persists the suggested relationship and, because the row
  then re-renders from that newly-persisted value, also clears any abandoned unsaved alternative
  selection and its unsaved notes.
- **"Discard unsaved changes"** restores the dropdown and notes to the last persisted value
  without touching the checkpoint -- it never deletes a previously saved verdict or
  acknowledgement, only abandons whatever is currently sitting unsaved in the controls.
- **Navigation, Finalise and closing the window never silently save or discard a pending
  club-observation edit.** If one exists, Previous/Next/Finalise/close are refused with: "Cannot
  leave this row until the invalid unsaved change is corrected or discarded." (an invalid pending
  edit) or a similar message asking you to Save or Discard first (a valid-but-unsaved one), and
  keyboard focus moves straight to the control that needs attention (the relationship dropdown
  if nothing is selected, otherwise the notes field). Use "Save observation" or "Discard unsaved
  changes" to proceed.

**Derivation details, for transparency:**

- The comparison year is the row's own captured `event_year`, taken exactly as recorded. This
  deliberately does **not** apply a "draft_year + 1" (or any other) destination-season inference
  -- that specific heuristic is already an explicitly forbidden mechanism one layer up in this
  same DraftGuru contract (`club_resolution.forbidden_mechanisms`,
  `tools/rebuild/draftguru/draftguru-contract.json`), and this tool fails closed to `unknown`
  rather than guess a boundary the data does not state.
- Club-name comparison is case/whitespace-normalised, with a small, explicit set of
  same-organization rename aliases (e.g. Kangaroos/North Melbourne). A genuine **merger** is
  deliberately never aliased -- Fitzroy's 1996 merger into the Brisbane Lions is a different
  `organization_id` in AFLDB's own data model (see `src/lib/player-matching/club-identity.ts`),
  so an event club of "Fitzroy" against retained clubs of only "Brisbane Lions" correctly derives
  `no_senior_appearance_ever`.
- It is derived fresh on every render from fields the immutable pack already carries -- never a
  network request, never a database read, and **never a manually maintained database truth**.

**Future automation note:** once draft/listing links are imported, AFLDB should derive
"drafted/listed but never played senior football for that club" (and its event-relative
variants) **at query time** from `draft_picks` versus recorded senior appearances and seasons --
not store it as a redundant Boolean column.

### 8. Saving and resuming

- Progress checkpoints automatically after every verdict change, when notes lose focus, and
  before the window closes -- there is no separate "save your work" step, though the Save
  checkpoint button and `Ctrl+S` are available to force it.
- Checkpoint path: `data/review/draftguru-bridge-operator-20260918-v1/progress.json`
  (gitignored; local to the machine and worktree it was created in).
- Closing and relaunching the tool from the same repository resumes the same review from that
  checkpoint.
- On resume, the checkpoint's recorded source-pack sha256 is compared against the pack's current
  sha256. A mismatch is refused outright -- the checkpoint will not silently attach itself to a
  different or edited pack.
- **Lock file**: `data/review/draftguru-bridge-operator-20260918-v1/review.lock` is written on
  launch and removed on clean exit. A second launch while a lock exists is refused (it reports
  the recorded pid, hostname and start time) so two sessions cannot write the same checkpoint at
  once. If a previous session did not exit cleanly (crash, killed process, forced shutdown) and
  you are certain no other review session is actually running against this checkpoint, relaunch
  with `--force-unlock` to remove the stale lock and continue. Never delete `review.lock` (or any
  other file) by hand as a shortcut -- let `--force-unlock` remove it, since that path also logs
  the removal.
- **Checkpoint schema migration**: opening the tool (or running `--migrate-checkpoint-only`)
  against a checkpoint from an older schema version migrates it forward **additively** -- every
  existing decision's verdict, notes and decided-at timestamp are preserved exactly; only a
  blank `event_club_observation` (and its notes/decided-at fields) is added where a decision
  does not already carry one. Nothing is ever cleared or reset. Before migrating, the tool writes
  a byte-verified backup of the pre-migration checkpoint next to it, named
  `progress.pre-migration-<timestamp>-<id>.json` (gitignored, same directory). Migration is
  refused outright -- with no backup written -- if the checkpoint's recorded source-pack sha256
  does not match the pack's current sha256 (the ordinary "different or edited pack" refusal
  above), and refused, rather than guessed, on any checkpoint schema version this tool version
  does not recognise.

### 9. Bulk action warning

- Disabled by default; enabling it requires ticking "Enable bulk actions for this session" for
  the current run only (it is never remembered between launches).
- Use it only after you have visibly reviewed every filtered incomplete row in the current group
  -- never because rows merely look similar to each other.
- It applies the group's single positive verdict (e.g. `same_person_valid_relisting` for
  relisting rows) to every currently filtered, undecided row in the current group. It still
  records exactly one verdict per row, the same as an individual decision, and every applied row
  is logged (operator name, group, verdict, row list, timestamp) in the checkpoint's
  `bulk_actions_log`.
- The confirmation dialog requires typing the exact phrase `I have reviewed every row in this
  group` before the Apply button is enabled. That phrase is your attestation that you reviewed
  each of the targeted rows individually before applying the bulk verdict -- not a formality to
  click through.
- Bulk action **only ever sets the identity verdict**; it never sets or touches the event-club
  appearance relationship acknowledgement. A bulk-applied row whose derivation needs
  acknowledgement (see "Event club appearance relationship") still shows up in the "Needs
  club-observation acknowledgement" filter afterward and still blocks Finalise until you record
  it individually.

### 10. Finalisation

- The Finalise button remains disabled until all 83 decisions are complete and individually
  valid (an allowed verdict for the row's group, with notes present wherever the verdict requires
  them) **and** every row whose verdict/derivation combination requires a club-observation
  acknowledgement carries one.
- Finalising re-validates everything from scratch (pack hashes, row/group counts, verdict
  validity, required notes, required club-observation acknowledgements) before writing anything,
  then writes the canonical JSON and deterministically re-derives the CSV/Markdown from that same
  document, verifying the re-render is byte-identical before returning. The final JSON is the
  canonical artefact; the CSV and Markdown are derived views of it.
- Each row in the final JSON retains the identity verdict **separately** from: the event club
  (`event_club`), the retained played-for clubs (`retained_played_clubs`), the derived
  club-absence result (`event_club_appearance_relationship_derived`) and the operator's own
  observation (`event_club_observation`, `event_club_observation_notes`). A top-level
  `event_club_observation_methodology` field states plainly that the derived value is **not a
  manually maintained database truth**. Totals also break down by derived relationship and by
  operator observation.
- Output paths:
  - `docs/rebuild-manifests/draftguru/bridge-operator-verdicts-20260918-v1.json` (canonical)
  - `docs/rebuild-manifests/draftguru/bridge-operator-verdicts-20260918-v1.csv`
  - `docs/rebuild-manifests/draftguru/bridge-operator-verdicts-20260918-v1.md`
- Finalising does **not** link players, write to any database, approve Phase 3, or generate a
  bridge v2 dataset or v2 validation sample -- it only writes the three verdict artefacts above.
- Report the generated verdict summary (totals by group and by verdict, from the finalised
  JSON/Markdown) to the issue owner before any bridge-v2 work begins.

### 11. Keyboard shortcuts

Work from any normal control (buttons, dropdowns, and the notes fields -- a multiline text
field never swallows the navigation shortcuts):

| Shortcut | Action |
|---|---|
| `Alt+Left` | Previous row (same as clicking the footer button) |
| `Alt+Right` | Next row (same as clicking the footer button) |
| `Ctrl+S` | Save checkpoint immediately |
| `Escape` | Discard the current unsaved club-observation edit, after a confirmation dialog; a no-op if nothing is pending |
| `Page Up` / `Page Down` | Scroll the whole form up/down by a page |
| `Home` | Scroll to the start of the current row's content (or move the text cursor, if focus is in a notes field) |
| `End` | Scroll to the end of the current row's content, just above the fixed footer (or move the text cursor, if focus is in a notes field) |

If an invalid unsaved club-observation edit blocks Previous/Next/Finalise/close, a dialog
explains why and keyboard focus moves straight to the control that needs attention -- see
"Saved acknowledgement vs. Unsaved change" under "Event club appearance relationship".

### 12. Manual visual test matrix (screen size / scaling)

The layout fixes above (fixed footer, whole-form scrolling, responsive width) are structural
and covered by the headless tests in `tests/python/draftguru_bridge_operator_review_contract.py`
wherever the underlying logic is a plain function (wrap-width arithmetic, navigation state,
pending-edit state). Whether the window actually **looks** correct at a given screen size is a
visual judgement a screenshot/manual check must make -- run this matrix once after any layout
change, before relying on the tool for a real review session:

| # | Configuration | Check |
|---|---|---|
| 1 | 1366x768, 100% scaling, window maximised | Fixed footer fully visible; Previous/Next/Save checkpoint/Discard unsaved changes/Finalise all visible and reachable without scrolling; no text clipped at the left edge |
| 2 | 1366x768, 100% scaling, window ~700px tall (not maximised) | Middle content area scrolls (mouse wheel and the scrollbar); footer stays fixed at the bottom; header stays fixed at the top |
| 3 | 1920x1080, 125% scaling, window maximised | Same as #1 at this DPI; labels wrap instead of clipping; no horizontal scrollbar appears |
| 4 | 1920x1080, 150% scaling, window maximised | Same as #1 at this DPI; verdict dropdown, "Confirm suggested relationship" / "Choose a different relationship" buttons and notes fields remain fully usable (not truncated, not overlapping) |
| 5 | Any size above, resize the window narrower then wider | Wrapping recalculates cleanly (no leftover stale wrap from the previous width); no horizontal scrollbar appears at any width down to the enforced minimum (760x480) |
| 6 | Any size above | Click "Show details" (supporting comparison evidence) and "Advanced (bulk actions)" -- both expand/collapse in place without breaking the fixed footer or the scroll region |
| 7 | Any size above | Tab through the controls on a row with a required notes field -- the notes field scrolls into view automatically when it receives focus |
| 8 | Any size above | Trigger an invalid unsaved club-observation edit (select a different relationship, leave notes blank, click Previous) -- confirm the dialog appears, focus moves to the notes field, and it is visible without manual scrolling |

Record the operator's pass/fail per row in the issue tracking, not in this README.

### 13. Troubleshooting

- **Command run from the wrong working directory**: the tool resolves the repository root from
  its own file location, but always `Set-Location 'D:\dev\afldb-issue-222'` first so relative
  paths in any error message are unambiguous.
- **Python executable not found**: confirm
  `C:\Users\stuar\AppData\Local\Programs\Python\Python312\python.exe` exists on this machine; if
  the interpreter has moved, locate the current repository-approved interpreter rather than
  substituting an arbitrary system Python.
- **Tkinter unavailable**: the tool prints
  `REFUSED: tkinter is not available in this Python environment` and exits without opening a
  window. `--validate-only` still works fully headless. Use a Python build with Tcl/Tk enabled to
  run the GUI.
- **Source-pack hash mismatch**: the tool refuses to start with `hash mismatch for ...`. This
  means the pack or one of its hash-linked inputs (parent bridge, afldb_test child, immutable
  sample, population-scan artefact, retained fitzRoy manifest) has changed on disk since it was
  reviewed. Do not edit the pack to "fix" this -- restore the reviewed bytes or get a corrected,
  re-reviewed pack.
- **Checkpoint belongs to another pack**: refused with "the checkpoint at this path belongs to a
  different source pack". This happens if the checkpoint directory is reused across a pack
  revision. Do not force through it -- keep the old checkpoint aside and confirm with the issue
  owner which pack the operator should actually be reviewing before continuing.
- **Active/stale lock**: see "Saving and resuming" above; use `--force-unlock` only when certain
  no other session is running.
- **Finalise disabled**: some rows are still undecided or invalid, or still need a club-
  observation acknowledgement. Use the "Hide fully completed rows" filter for the former and the
  "Needs club-observation acknowledgement" filter for the latter to find exactly which remain --
  the "Identity verdicts entered" and "Fully completed rows" counters at the top of the window
  will also disagree whenever an acknowledgement is outstanding.
- **Verdict appears visually selected when the header says none entered**: this should no longer
  happen -- the identity-decision control is a blank-by-default dropdown, not a radio-button
  group, and the status line beneath it always states the real selection in words. If you ever see
  a value showing in the dropdown or status line that you did not choose, stop and report it rather than
  continuing -- do not assume it is correct.
- **Window too small or evidence controls below the fold**: the evidence panel scrolls
  independently (mouse wheel or the scrollbar on its right edge); resize the window taller/wider
  if the verdict control, notes field or navigation buttons are not visible.
- **Checkpoint migrated unexpectedly**: this is expected the first time this tool version opens
  a checkpoint written by an older version -- see "Checkpoint schema migration" under "Saving and
  resuming". Every pre-existing verdict and note is preserved; only blank club-observation fields
  are added, and a byte-verified backup of the pre-migration file is written first. If migration
  is refused, it is because the checkpoint's recorded source-pack hash does not match the pack's
  current hash (see "Source-pack hash mismatch" above) or because the checkpoint's schema version
  is not one this tool version recognises -- in either case nothing is modified.

## Help in the application

Use the **Help -> How to use...** menu item (or the **Help** button in the toolbar) at any time
for a summary of the above: review instructions (including clicking the DraftGuru/AFL Tables
buttons and returning to the GUI before deciding), the current group's plain-English identity
choices with their stored codes, a reminder that no option is preselected, the notes
requirement, the event-club relationship and its explicit confirm/choose-different workflow and
acknowledgement requirement, the three separate progress counters (identity verdicts entered vs.
fully completed rows), the evidence-link safety rules, checkpoint/resume and schema-migration
behaviour, and finalisation behaviour, plus the path back to this README.

**In short: opening a link never records a decision, no option is preselected, and notes are required for a negative, uncertain or overridden choice.**
These three guarantees hold for every row, in every group, on every launch.

---

## `build_person_bridge_v2.py` -- bridge v2 source-evidence parent (DB-free)

### 1. What it does

Applies the COMPLETED 83-row operator adjudication (`bridge-operator-verdicts-20260918-v1.json`),
and nothing else, to the frozen v1 source-evidence parent, producing a versioned v2 parent plus a
reconciliation manifest, a withheld/rejection manifest and human-readable views. It opens no
database, makes no network request, runs no importer and issues no Git command. `operator_notes`
is provenance only: it is copied verbatim and never parsed for a target (D-9).

    python tools/rebuild/draftguru/build_person_bridge_v2.py --validate-only
    python tools/rebuild/draftguru/build_person_bridge_v2.py --write
    python tests/python/draftguru_bridge_v2_contract.py

Every output is byte-reproducible: `generated_utc` is frozen to the verdict artefact's
`review_completed_utc`, never a wall clock. All eight pinned inputs are re-hashed before and after
the run, and an existing non-identical artefact is never overwritten.

### 2. Executed 2026-09-18 (operator-reported)

The operator ran `py_compile`, the bridge-v2 contract and the four existing DraftGuru contracts
(all PASS), a pre-write `--validate-only`, a first `--write` creating all six artefacts, a
post-write `--validate-only` reproducing the counts and hashes, a second `--write` reporting all
six `identical`, and an independent `Get-FileHash` check that matched.

| Quantity | Value |
|---|---|
| population | 5,057 |
| accepted v1 → v2 | 3,564 → 3,562 (−2) |
| withheld v1 → v2 | 1,493 → 1,495 (+2) |
| unchanged / confirmed / corrected / added / removed | 3,481 / 74 / 7 / 0 / 2 |
| unaccounted | 0 |
| `child_status` | `requires --resolve-against afldb_test` |

Parent `ad25d965cba72b97be895451dc488bf03a1899421e902394baa52a620abe8e57`, `rows_sha256`
`ce7816f7905f8a758761676ce50f2673055cc0be9c5174d004fdee7931327e7f`. The remaining five artefact
hashes are recorded in `AFLDB-ISSUE-222.md` §11.14 and `issues.md`.

The net accepted change is **−2, not +81**: 74 eligible verdicts confirmed an existing mapping
without changing it, 7 corrected a target in place, and 2 rejected a mapping.

### 3. What this tool does NOT produce

It does not write `…-v2.afldb_test.json`. In this repository the `.<target>.json` sibling is a
*deployment* dataset -- the parent's `bridges[]` minus every identity not registered exactly once
on that target -- which by definition comes from `export_person_bridge.py --resolve-against`, and
that reads the target database. **That resolution has not been run for v2.** No v2 child exists, no
final v2 child accepted/withheld count is published anywhere, and Phase 3 acceptance, Phase F and
Phase 4 remain unauthorised.

## `export_person_bridge.py --resolve-against` -- the deployment child (read-only)

    python tools/rebuild/draftguru/export_person_bridge.py \
      --resolve-against afldb_test \
      --parent data/reference/draftguru-person-bridge-20260918-v2.json \
      --out data/reference/draftguru-person-bridge-20260918-v2.afldb_test.json

Reads `AFLDB_TEST_DATABASE_URL` and refuses unless its path is exactly `/afldb_test`. It opens one
connection with `default_transaction_read_only=on`, verifies both read-only settings from the
server, runs a single `SELECT` over `external_identities`/`sources`, then rolls back and closes.
Nothing is ever written to the database, and the only file written is `--out`.

Two guards fail closed before any DSN is read:

- a `kind: "deployment"` input is refused -- resolve the **parent**, never an already-resolved
  child (the v2 parent and the v1 `afldb_test` child differ by one filename suffix);
- `--out` may not be `--parent`, and an existing `--out` is refused unless `--allow-overwrite` is
  passed. A deployment child carries a wall-clock `generated_utc` and a live registration
  measurement, so a rerun is never byte-identical and an overwrite is always a deliberate decision.

## `validate_person_bridge_child.py` -- DB-free deployment-child validation (read-only)

    python tools/rebuild/draftguru/validate_person_bridge_child.py
    python tests/python/draftguru_child_validation_contract.py

Validates a resolved deployment child against its pinned lineage without a database: the
operator-reported child sha256, every pinned input hash (v2 parent, v1 parent, v1 child, v2
reconciliation manifest, operator verdicts, B3 manifest), `kind`/`target`/exporter, the
`parent_sha256` chain, the importer-equivalent schema gate, counts and partition, parent
containment, the exact v1 -> v2 transition (carry-forward count; each corrected identity via the
STRUCTURED `evidence.corrected_identity_candidate` field only; each removal; the surviving
`target_not_registered` set; no other person changing state), the registration measurement and
timestamps, and hygiene (no DSN/absolute path/credential; canonical LF bytes). It prints a
transition table for the changed persons and a `summary_sha256` so two runs can be compared.
It writes nothing. Any FAIL is exit status 1. Defaults pin the 2026-09-18 v2 `afldb_test` child;
`--expect-sha256` overrides the expected child hash, `--root` points tests at a fixture tree.

## `build_validation_sample.py` -- Phase F disjoint new-salt validation sample (DB-free)

    python tests/python/draftguru_validation_sample_contract.py
    python tools/rebuild/draftguru/build_validation_sample.py --validate-only
    python tools/rebuild/draftguru/build_validation_sample.py --write

Draws the `AFLDB-ISSUE-222.md` §3.5 item 4 revalidation stratum: frame = the v2 SOURCE-EVIDENCE
parent's `bridges[]` (never a deployment child) minus the census (every bridged National Draft
top-10 person; must equal the v1 census or the tool refuses) minus every person in the v1 review
sample (399 census + 598 random) minus, by default, the 83 operator-adjudicated pack persons
(`--include-adjudicated` keeps them); ordering `sha256(salt + "|" + player_url)` ascending, ties by
URL (identical to `--review-sample`'s formula, pinned by the contract); salt `AFLDB-ISSUE-222/v2`
(must differ from the prior salt); `n = 598` (a frame smaller than `n` is a refusal). The child
must first pass `validate_person_bridge_child.py` in the same process. Outputs
`docs/rebuild-manifests/draftguru/bridge-validation-sample-20260918-v2.{json,csv}` with the frame
accounting, zero-overlap proofs, every input and tool hash, the zero-failure bound formula and
per-row parent identity, child status and selection key -- and no verdict field. `generated_utc`
is frozen to the child's, so `--write` is idempotent; an existing non-identical output is never
overwritten (a changed input, tool or rule requires a new version and salt). Verdicts belong in a
separate versioned artefact. The sample is UNREVIEWED when written; it authorises nothing.

### Generated 2026-09-18 (operator-reported)

The operator ran `--validate-only`, a first `--write`, a post-write `--validate-only` (both
outputs identical), a second `--write` (identical) and independent PowerShell hashes that
matched: n 598, salt `AFLDB-ISSUE-222/v2`, eligible frame 2,529 (parent bridges 3,562, census
399, non-census 3,163, excluded union 634 = 597 v1-random + 63 adjudicated-pack), 582 bridged +
16 `target_not_registered` rows, all four overlaps zero, bound 0.004997. JSON `6523bad6…`, CSV
`afa2b917…`, `rows_sha256` `91be2942…`. Decisions O-5 (pack excluded), O-6 (parent-based frame)
and O-7 (reconciliation hash pinned) were confirmed. The sample is UNREVIEWED; Phase F
acceptance, Phase 3 acceptance, import and Phase 4 remain pending.

## `review_validation_sample.py` -- Phase F machine review of the v2 sample (DB-free)

    python tests/python/draftguru_validation_review_contract.py
    python tools/rebuild/draftguru/review_validation_sample.py --validate-only
    python tools/rebuild/draftguru/review_validation_sample.py --write

The Phase F review mechanism is decision O-4 revision 2, unchanged: every row is compared
offline against retained evidence by `review_person_bridge_offline.py`'s rules, then the
operator adjudicates every mandatory recheck row plus the deterministic audit. This module is
only the adapter the v2 sample needs -- it **imports** `evaluate_row`, `build_fitzroy_index`,
`build_recheck_queue` and `build_residual_report` from the v1 tool (never copies them; the v1
tool is never edited because its hash is frozen in the sample's `tool_hashes`) and applies
them to the sample's single `rows[]` stratum in sample order. Before any row is evaluated it
hash-verifies the sample JSON/CSV, the whole child lineage and every retained-evidence input the
v1 review measured, re-validates the child in-process (its `summary_sha256` must equal the
pinned `5bc5336b…`), recomputes the sample's `rows_sha256`, checks the salt, n, the four zero
overlaps, every selection key and the sample's frozen tool hashes, and checks every row's
identity and child status against the parent and child. Any disagreement is a refusal.

Outputs (all frozen to the sample's `generated_utc`, byte-reproducible, never overwritten when
different): `bridge-validation-verdicts-20260918-v2.{json,csv}`,
`bridge-validation-recheck-20260918-v2.json`, `bridge-validation-residual-20260918-v2.json`.
Each row carries the machine `outcome` (the six v1 outcomes, verbatim) **and** a separate
`deployment_status` (`bridged` / `target_not_registered` from the validated child) plus
`identity_evaluable`. A `target_not_registered` row is a terminal deployment status, not an
identity contradiction (runbook §5, §7 class 3, §9; correction handoff §10.3): no link ships and
there are no retained target facts to compare; under decision O-6 it counts toward n. The
recheck queue uses audit salt `AFLDB-ISSUE-222/audit-v2` (`--audit-salt` before the first
write; recorded in the artefact). `operator_verdict` is always null in these files.

**Operator verdicts** go in `bridge-validation-operator-verdicts-20260918-v2.json`: copy the
recheck queue, add `source_recheck_sha256` (the recheck file's sha256), `verdicts_sha256`,
`sample_sha256` and `review_completed_utc`, then fill `operator_verdict`
(`agree` / `contradict` / `undetermined`) and `reviewed_utc` on every row of classes 1-10 and
the audit; `contradict` and `undetermined` require `notes` and `evidence`. The machine outcome
is never edited; the sample and the machine artefacts are never edited.

## `validate_validation_review.py` -- independent final validator and acceptance (read-only)

    python tools/rebuild/draftguru/validate_validation_review.py
    python tools/rebuild/draftguru/validate_validation_review.py --expect-verdicts-sha256 <hex>
    python tools/rebuild/draftguru/validate_validation_review.py --require-per-row-operator-verdicts

Writes nothing. Proves: both sample hashes and `rows_sha256`; every pinned lineage input; the
child re-validated (summary `5bc5336b…`); the four review artefacts present, canonical and free
of DSN/absolute path/credential; the review header hash-linked to the sample and child; every
recorded input and tool hash still matching (a drift voids the review); exactly 598 rows in
sample order with the sample's person, identity, child status and selection key (no missing,
duplicated or extra row); identity outcome and deployment status kept distinct; totals and CSV
reconciled; the recheck queue and residual report reproduced exactly from the rows through the
v1 tool's own builders (so every contradiction, limited, unregistered, unavailable and tooling
row is surfaced, none excluded); and, when the operator artefact exists, its hash link, row
sets, verdict values, notes/evidence rules and unedited machine outcomes.

**Acceptance rule (runbook §8; `AFLDB-ISSUE-222.md` §3.5):** ACCEPTED only when every check
passed, every mandatory recheck row and every audit row has a terminal operator verdict, every
audit row is `agree`, zero genuine contradictions remain (a machine `offline_contradict` the
operator resolves to `agree` with evidence is not genuine; one the operator confirms, or any
operator `contradict`, is genuine and blocks), zero `undetermined` remain (not a pass; escalated,
never redrawn), and no `offline_unavailable` / `tooling_or_schema_error` row remains (supply the
input or fix the tool and rerun). No post-hoc exclusion, no survivor-only claim. The achieved
one-sided 95% bound is printed beside n = 598 and the observed count, both at n (O-6) and at
the identity-evaluable count (conservative), never rounded. Exit 0 = ACCEPTED; 2 = all checks
passed but NOT ACCEPTED (pending or blocked); 1 = a check failed. Two runs print an identical
`summary_sha256`. `--require-per-row-operator-verdicts` applies the stricter reading of §11.11
("operator same-person verdict required per row") -- decision O-8, operator's call.

### Machine review generated 2026-09-18 (operator-reported)

The operator ran the review and the final validator; the model ran nothing. Canonical artefacts:
`bridge-validation-verdicts-20260918-v2.json` `2caf980b…`, `.csv` `d2a5c336…`,
`bridge-validation-recheck-20260918-v2.json` `3e509021…`, `bridge-validation-residual-20260918-v2.json`
`d20a3c6f…`, machine `rows_sha256` `14d918a1…`. Outcomes over n = 598: 578 `offline_strong`,
4 `offline_limited`, 16 `target_unregistered`, 0 `offline_contradict`, 0 `offline_unavailable`,
0 `tooling_or_schema_error`; 582 identity-evaluable; deployment 582 bridged + 16
`target_not_registered`. Recheck queue: 39 mandatory distinct rows + 30 audit rows (salt
`AFLDB-ISSUE-222/audit-v2`) = exactly 69 required rows. The final validator ran clean with
`summary_sha256` `7657fd85…` and exit status 2 (correctly pending: operator artefact absent, 69 of
69 required rows without a verdict). Operator adjudication has NOT been performed.

## `review_validation_operator.py` -- Phase F operator-adjudication GUI (DB-free, network-free)

    python tests/python/draftguru_validation_operator_contract.py
    python tools/rebuild/draftguru/review_validation_operator.py --validate-only
    python tools/rebuild/draftguru/review_validation_operator.py
    python tools/rebuild/draftguru/review_validation_operator.py --status
    python tools/rebuild/draftguru/validate_validation_review.py        (after finalising)

A separate lineage from `review_bridge_operator.py` (the 83-row pack): nothing is shared or
migrated between the two checkpoints, and the earlier tool is not modified.

**What it reads (hash-verified, never written):** the recheck queue, the verdicts JSON/CSV, the
residual report and the sample, each pinned to the operator-reported 2026-09-18 hashes above; the
recheck must hash-link to the verdicts and sample on disk, `rows_sha256` must reproduce and equal
`14d918a1…`, every class ref must agree with its machine row, and the derived queue must be exactly
39 mandatory + 30 audit = 69 unique persons. Any disagreement is a refusal before the GUI opens.

**Queue:** one entry per required person -- a person in several recheck classes appears once with
every membership listed -- mandatory rows (classes 1-10) first, then the audit (class 11), each in
sample order. The footer shows "Row 7 of 69" (or "Row 3 of 12 shown (queue position 17 of 69)" when
a filter is active). Filters: completion (all / incomplete / complete), classification (mandatory /
audit), machine outcome (the six outcomes) and deployment status (bridged /
`target_not_registered`); they never reorder rows.

**Per row:** the DraftGuru person and the proposed AFL Tables identity; why the row requires review
(class labels in plain English plus flags); the MACHINE IDENTITY OUTCOME and, separately, the CHILD
DEPLOYMENT STATUS with the fixed statement that `target_not_registered` is a deployment status, not
an identity contradiction; the comparison table (names, birth-year evidence, career span, games,
clubs, identity, Stage A rows, reason codes with meanings and contradiction codes highlighted);
and the two evidence links. Wikipedia/Footywire citations are shown only when genuinely present on
the row (none is, in this review).

**Evidence links:** full URLs are displayed in selectable fields with Open and Copy buttons. The
AFL Tables URL is built from the canonical identity (`players/X/Name.html` under
`https://afltables.com/afl/stats/`; any other shape is refused). Open validates scheme and host
(`draftguru.com.au`, `afltables.com` and their `www.` forms) and then launches your own default
browser; Copy uses the clipboard. Neither creates, changes or saves a verdict, note or checkpoint.

**Verdicts:** three radio buttons with plain-English labels and the stored value beneath each --
`agree` (same human; for a withheld row, continued withholding is correct), `contradict` (a
different human: a genuine failure, blocks acceptance), `undetermined` (cannot decide: not a pass,
escalated, never redrawn, blocks acceptance). Nothing is preselected; selecting is not saving.
"Save verdict for this row" (Ctrl+S) records the verdict with a UTC `reviewed_utc` and writes the
checkpoint. `contradict` and `undetermined` require notes and at least one evidence line; on a
machine `offline_contradict` row every verdict does (the override must carry the evidence the
acceptance rule demands). Audit rows show an explicit warning and are never auto-agreed; there is
no bulk action and no default.

**Navigation and unsaved state:** Previous / Next are always visible in a fixed footer (packed
before the scrolling body so no window size can hide them), disabled only at the first / last
displayed row; Alt+Left / Alt+Right do the same; Page Up / Page Down scroll the form; the form
scrolls to the top on every row change and re-wraps to the window width on resize (minimum
900x620). Leaving a row, changing a filter, finalising or closing with an unsaved edit asks
Save / Discard / Stay; the status line under the verdict reads `UNSAVED: …` until the save
succeeds and never reports an unsaved selection as saved. A notes/evidence field losing focus
stores a draft in the checkpoint (labelled as a draft, never a verdict, never counted).

**Checkpoint and resume:** `data/review/draftguru-validation-operator-20260918-v2/progress.json`
(gitignored under `/data/*`), written atomically (temp file, fsync, replace) after every saved
verdict, on notes/evidence focus loss and before close, hash-linked to the recheck queue, verdicts
JSON/CSV, residual, sample, `rows_sha256` and the derived queue; resume is refused on any mismatch,
on an unknown schema version, on a decision outside the queue or on a decision whose recorded
machine outcome differs. `review.lock` beside it refuses a second session (`--force-unlock` only
when certain none is running). Every saved verdict survives restart.

**Finalisation:** enabled only when all 69 required rows carry a verdict satisfying the contract.
The dialog previews what the validator will conclude (contradict / undetermined / audit-not-agree
counts) and then writes exactly
`docs/rebuild-manifests/draftguru/bridge-validation-operator-verdicts-20260918-v2.json`: a copy of
the recheck queue with `source_recheck_sha256`, `review_completed_utc`, `operator_tool` and
`operator_summary` added and the per-row operator block filled (identical blocks for a person in
two classes; the machine outcome is never edited; canonical ASCII LF; refused if it would carry a
DSN, absolute path or credential). A differing existing file is never overwritten. Finalisation
imports nothing, links nothing, alters no database, accepts neither Phase F nor Phase 3 and performs
no Phase 4. Afterwards run `python tools/rebuild/draftguru/validate_validation_review.py`
(exit 0 = ACCEPTED; 2 = all checks pass, not accepted; 1 = a check failed).

**Contract:** `tests/python/draftguru_validation_operator_contract.py` (headless; also reads the real
artefacts, only, to prove the 69-row union) with a Vitest wrapper in
`tests/draftguru-acquisition.test.ts` ("DraftGuru Phase F operator-adjudication GUI").

### Phase F ACCEPTED 2026-09-18 (operator-reported)

The operator adjudicated all 69 required rows and finalised
`bridge-validation-operator-verdicts-20260918-v2.json` (sha256 `b8cf98bb…`); the final validator
reported ACCEPTANCE: ACCEPTED, `summary_sha256` `63c89265…`: 598 sampled rows, 582
identity-evaluable, 16 `target_not_registered` terminally withheld, 69/69 verdicts `agree`, 0
`contradict`, 0 `undetermined`, 0 failures; one-sided 95% upper error bound 0.4997% at n = 598
(0.5134% at n = 582). No import has been run on the strength of this; the pre-import gates below
come next.

## `bridge_import_gate.py` -- read-only pre-import PLAN and post-import VERIFY (`afldb_test` / `afldb_dev`)

    python tests/python/draftguru_import_atomicity_contract.py
    python tests/python/draftguru_import_gate_contract.py
    python tools/rebuild/draftguru/bridge_import_gate.py plan
    python tools/rebuild/draftguru/bridge_import_gate.py plan --print-manifest
    python tools/rebuild/draftguru/bridge_import_gate.py verify \
      --expect-after-sha256 <plan> --expect-picks-after-sha256 <plan> \
      --expect-newly-linked-sha256 <plan> --expect-baseline-sha256 <plan> --expect-batches-before <plan>

Both modes perform the same read and never write anything -- no artefact, no checkpoint, no
database statement other than `SELECT`. The only DSN read is `AFLDB_TEST_DATABASE_URL` (from the
environment or `.env`); its path must be exactly `/afldb_test`, and the server's
`current_database()` is checked again after connecting. The connection is opened with
`default_transaction_read_only=on` and `TimeZone=UTC`, marked read-only / REPEATABLE READ, the
server's `transaction_read_only` and `default_transaction_read_only` are asserted `on` before any
other statement, every statement passes a SELECT-only cursor wrapper, and the transaction is
rolled back and the connection closed unconditionally. The DSN and credentials are never printed;
a connection error is reported by exception class only.

**What it computes.** The accepted Stage A snapshot is re-verified and re-parsed through the
importer's own `validate()` (same sha256 checks, contracts, six-decision ledger, `load_bridge`
schema), the child is pinned to `b996c60e…` and its counts (3,468 / 1,589 = 1,493 + 94 + 2), the
v2 parent is pinned to `ad25d965…` and to the child's `parent_sha256` (it supplies the identity
each `target_not_registered` person was withheld for), and the importer's own `apply_authority()`
is replayed over the 5,057 persons with the target's registration, live `player_link_resolutions`
decisions and existing DraftGuru identities -- seeding forbidden, so a decision that would mint a
player shell is a refusal (`seed_required`). The result is the exact person / pick /
`external_identities(draftguru)` row state the importer would write (including
`replay_admin_overrides` source-owned patches), which is then compared with what is stored.

**`plan` classifies every person** as newly linked (unlinked now, bridge-linked after),
already agreeing (human-linked / bridge-linked / unlinked), conflicting (a link dropped, relinked
to a different player, or metadata rewritten), missing (would be inserted), extra (would be
deleted), duplicate / ambiguous (a bridge target registered zero or several times -- the
importer's HALT -- or one canonical player claimed by two persons), and unexpected state (any
non-link column that would change, a `dg_person_id` permutation, an `external_identities` change
outside the link columns such as another Stage A label in `notes`, a `target_not_registered`
identity that has since become registered, a manual selection that would be re-created or
rewritten, contradictory live decisions). Anything but "newly linked persons and their picks /
identity rows" is a refusal (exit 1). It prints exact post-import totals, the number of changing
persons, and five hashes over ordered content: `after_state_sha256` (every person's link state
after), `picks_after_sha256`, `newly_linked_sha256` (the ordered bridge-linked manifest
`player_url | afltables_external_id | player_id`, printed in full with `--print-manifest`),
`changes_sha256` (before/after per changing person) and `baseline_sha256` (server-side `md5`
digests of `players`, `clubs`, `sources`, non-DraftGuru `external_identities`,
`player_link_resolutions`, `data_overrides`, non-DraftGuru `draft_picks` / `draft_persons`,
`player_career_stats`, and the non-link projections of the DraftGuru rows).

**`verify` repeats the read after the import** and proves: every person's and pick's link state
equals the importer's expected state (0 changes) and the `external_identities(draftguru)` rows
match exactly; each admitted bridge resolves to the intended player with `unique` /
`draftguru_person_page_afltables_bridge` / `draftguru person-page bridge -> <identity>`; the
bridge-linked set is exactly the admitted non-decided bridges; every withheld person remains
unlinked by this bridge; Craig Somerville and David Sullivan did not re-enter and their AFL
Tables identities are reached by no DraftGuru person; no duplicate person and no canonical player
claimed twice; the stored `link_status` / `match_method` vocabulary; the newest `draftguru`
`import_batches` row is a completed `import_draftguru.py` run over 6,810 records with no error,
none is left `running`, and every DraftGuru pick carries its id; and, when passed, the plan's four
hashes and `--expect-batches-before + 1`. Both modes print a deterministic `summary_sha256`.

**Contracts:** `tests/python/draftguru_import_gate_contract.py` (scripted connection from
`tests/python/draftguru_fake_pg.py`; five-person frame; every refusal above exercised; the plan's
hashes reproduce on the post-import state; nothing written) and
`tests/python/draftguru_import_atomicity_contract.py` (drives the real `run_import()` on the
scripted connection: one commit before the first data statement, none between it and the
`completed` batch row, rollback then the `failed` row on an injected error and on `--dry-run`,
refusal before any write on a bridge/human contradiction, DraftGuru-scoped writes only). Vitest
wrappers: `tests/draftguru-acquisition.test.ts` ("DraftGuru bridge import gate") and
`tests/draftguru-import.test.ts` ("privileges and transaction"). Both need `psycopg` importable
(`tools/migration/common.py` imports it) but never connect.

**Importer correction (2026-09-18).** `import_draftguru.py` now calls `analyze()` after the
`import_batch` block, so the data writes and the `completed` batch status share one commit;
inside the block, `analyze()`'s own commit landed the data before `batch.finish("completed")`.

**Backup before the import:** `tools/maintenance/backup-afldb-test.ps1` (workstation twin of
`backup.sh`: custom format, compress 6, no-owner, partial-then-rename, `pg_restore --list`
verification, SHA-256, password in `PGPASSWORD` only, refuses any DSN not naming `afldb_test`,
writes under `D:\backups\afldb\issue-222` by default -- outside the repository).

### `--target {test, dev}` (2026-09-19, AFLDB-ISSUE-222 §11.19.15)

`--target` selects which database this gate reads, from a fixed, closed list -- `test` ->
`afldb_test` (the default; every invocation with no `--target` is unchanged), `dev` ->
`afldb_dev`. There is no PROD entry and none can be added from the command line; an unknown
target is refused before any DSN is read.

Each target reads its OWN DSN environment variable: `AFLDB_TEST_DATABASE_URL` for `test`,
**`AFLDB_DEV_DATABASE_URL`** (new) for `dev` -- deliberately never `AFLDB_IMPORT_DATABASE_URL`
(the importer's own elevated write role, whose target this gate must never silently follow if
that DSN is later repointed) and never `AFLDB_OWNER_DATABASE_URL` (documented in `.env.example`
as "used only by migrations"). `AFLDB_DEV_DATABASE_URL` is not in `.env.example` yet -- the
operator adds it there (and to `.env`) pointed at `afldb_dev` before running `--target dev`; its
path must be exactly `/afldb_dev`, checked before and again after connecting, exactly as
`afldb_test` already is. Read-only enforcement (session `default_transaction_read_only=on` +
REPEATABLE READ, the `SELECT`-only cursor wrapper, unconditional rollback-and-close, DSN/password
never printed) is identical for both targets.

`dev` has **no default `--bridge`** -- the DEV deployment child does not exist yet, and one must
be supplied explicitly:

    python tools/rebuild/draftguru/bridge_import_gate.py plan --target dev \
      --bridge data/reference/draftguru-person-bridge-20260918-v2.afldb_dev.json

    python tools/rebuild/draftguru/bridge_import_gate.py verify --target dev \
      --bridge data/reference/draftguru-person-bridge-20260918-v2.afldb_dev.json \
      --expect-after-sha256 <plan> --expect-picks-after-sha256 <plan> \
      --expect-newly-linked-sha256 <plan> --expect-baseline-sha256 <plan> --expect-batches-before <plan>

`--bridge` is refused outright if it resolves to the pinned `afldb_test` child path, so a DEV run
can never silently verify the test child instead of a real DEV one. Independently of that guard,
the child's own `target` field is checked against the selected database (`load_child`), so an
`afldb_test`-labelled child is refused under `--target dev` even via some other path, and vice
versa. `--expect-child-sha256` also has no default for `dev` (no DEV child hash is pinned yet);
pass it explicitly once a DEV child exists and its hash is known, exactly as `plan`'s own output
supplies `--expect-*` for `verify`.

The DEV deployment child itself is produced the same way the `afldb_test` one was, via
`export_person_bridge.py --resolve-against dev` (see above; that tool was already target-agnostic
and needed no change), against a real `afldb_dev` connection -- not by this gate, which never
writes a file.

**Contract coverage:** `tests/python/draftguru_import_gate_contract.py` pins the legacy/default
(no `--target`) invocation, explicit `--target test`, explicit `--target dev`, per-target DSN
environment selection, per-target database-name guards, refusal of a cross-target child artefact
in both directions, refusal of `prod`/unknown/empty target strings, a full DEV-target
`plan`->`verify` run reproducing the test-target's own hashes on the identical fixture frame, and
the CLI-level mandatory-`--bridge` / no-silent-afldb_test-reuse / no-PROD-choice guards.

### `s74-snapshot.sql` -- the AFLDB-ISSUE-222 §7.4 rollback-exercise snapshot (read-only)

Six `\copy ... TO` statements over exactly the row sets `AFLDB-ISSUE-222.md` §7.4 names for the
mandatory S0/S1/S2/S3 comparison (`draft_persons`/`draft_picks` link columns for the DraftGuru
source, every manual `source_id IS NULL` pick in full, `external_identities(draftguru)` link
columns, `player_link_resolutions`/`data_overrides` for `draft_picks` in full), each ordered by a
natural key so two snapshots of the same state are byte-identical CSVs. Writes only the six CSV
files in its working directory; issues no write to the database. This is the direct
implementation of §7.4's own text ("a comparison script for S0–S3 is proposed tooling ... the
`afldb_test` exercise may use `psql` `\copy` exports diffed offline") -- a small, tracked helper,
**not** itself a full comparison/orchestration program. It is invoked automatically, once per
snapshot stage, by `s74-rollback-exercise.ps1` below; it is not intended to be run by hand.

### `s74-rollback-exercise.ps1` -- the AFLDB-ISSUE-222 §7.4 rollback exercise (mutating, `afldb_test` only)

    powershell -ExecutionPolicy Bypass -File tools\rebuild\draftguru\s74-rollback-exercise.ps1

The full §7.4 mandatory reversal exercise, fail-closed, self-contained: connection guards (both
DSNs must parse to `127.0.0.1:55432/afldb_test`, probed read-only for `current_database()` /
`current_user`, and the TCP port reconfirmed immediately before the first mutation -- neither DSN
is ever printed); **immediately afterward, an explicit `-WhatIf` early exit** that prints
backup/import/snapshot were skipped and returns successfully, strictly before anything else runs;
a read-only snapshot working-directory preflight (`s74-snapshot-path-probe.sql`, below);
a fresh backup via `backup-afldb-test.ps1` -- invoked through `-PowerShellExe`
(`-NoProfile -ExecutionPolicy Bypass -File`), **never** a bare `pwsh` -- independently re-verified
(SHA-256 recomputed, `pg_restore --list` rerun, never merely trusted); a baseline
`bridge_import_gate.py plan` (`BASE`); a deliberate typed confirmation before anything mutates (a
second, defence-in-depth guard for an explicit `-Confirm:$false` or an interactive decline); then,
twice, `import_draftguru.py --no-seed` (reverse, no `--bridge`) → a read-only `plan` (`R1`/`R2`,
predicting the reload) → `import_draftguru.py --no-seed --bridge <child>` (load) → `verify` using
that plan's **own** printed hashes and `import_batches_before` (never recomputed, never assumed)
→ a `psql \copy` snapshot (`s74-snapshot.sql`). S0=S2 and S1=S3 are asserted by
`Get-FileHash -Algorithm SHA256` over each of the six raw files, throwing on the first mismatch;
`R1`/`R2`/both verifies are each asserted to reproduce `BASE`'s four hashes; a final `plan` proves
`import_batches` grew by exactly 4. Every snapshot, transcript and the backup manifest are written
under a fresh, must-not-already-exist directory beneath `D:\backups\afldb\issue-222` (refused if
it resolves inside the repository), so nothing is ever left as an untracked file in the worktree.
On any failure it throws immediately and attempts no automatic restore -- recovery is the tracked
three-tier procedure in `AFLDB-ISSUE-222.md` §11.19.4.

**`-PowerShellExe`** names the exact executable used to invoke `backup-afldb-test.ps1` as a child
process -- never assumed to be on `PATH` (`pwsh` in particular may not be installed at all; this
workstation has no `pwsh.exe`). Defaults to the executable for the *current* session's edition,
resolved from `$PSHOME`: Windows PowerShell → `$PSHOME\powershell.exe`; PowerShell Core →
`$PSHOME\pwsh.exe`. Required to exist and resolved to an absolute path before anything else runs.

**`-WhatIf`, precisely (fourth-pass fix):** path resolution (including evidence-directory
creation, itself a ShouldProcess-aware `New-Item` call and therefore automatically suppressed) and
the read-only connection guards are allowed to run. The script then checks `$WhatIfPreference`
explicitly, immediately after those guards, and exits before the backup, before any
`import_draftguru.py` call, and before any `psql` snapshot export. This explicit check exists
because an external process (`-PowerShellExe`) has no concept of `$WhatIfPreference` and would
otherwise run for real under `-WhatIf` -- which is exactly what happened on this workstation
before the fix: `-WhatIf` correctly suppressed directory creation and ran the read-only guards,
then continued into the backup step and invoked a bare `pwsh`, which is not installed here (no
evidence directory or backup was created only because `pwsh` happened to be absent, not because
the script refused).

**Gate-output parsing contract (sixth-pass fix).** The script reads five values off
`bridge_import_gate.py`'s own printed `plan` output, and `Get-GateValueRule` pins what each one
looks like, against the *real* transcript rather than a sample of one: the four section-7 hashes
appear **exactly once** each and must be 64 lowercase hex characters; `import_batches_before` is
printed **twice** by a successful plan -- section 3 (`193 (draftguru batches now; max id 1382)`)
and again in section 8's plan verdict (`193`) -- both from the same read-only snapshot, so repeats
are accepted for that key alone and only when every occurrence carries the identical value. Blank
and whitespace-only lines are removed for parsing only (`Get-GateParseLines`); the console echo and
the saved `*.log` transcripts keep the tool's output unchanged. A missing key, disagreeing repeats,
an unexpected repeat, a malformed value or an unpinned key all refuse. The gate itself was **not**
changed to suit the wrapper: printing that counter in both sections is the gate's own contract,
pinned by `tests/python/draftguru_import_gate_contract.py` checks 1.12a-1.12c.

**Snapshot working-directory preflight (sixth-pass addition).** `s74-snapshot-path-probe.sql` is a
one-statement read-only `\copy (SELECT 1) TO 'snapshot-path-probe.csv'`, run through the *same*
helper, psql flags and forced-read-only session as a real S0/S1/S2/S3 capture, immediately after
the `-WhatIf` exit and before the backup. `\copy` resolves its target client-side against psql's
own working directory, which the script sets per stage (both the PowerShell location and the
process working directory, which are not the same thing) -- and the captures are the only step that
first runs *after* the database has been mutated. The probe turns a wrong working directory into a
refusal while `afldb_test` is still untouched.

`tests/s74-rollback-exercise-static.test.ps1` (new, DB-free, AST-only -- run directly with
`powershell -NoProfile -ExecutionPolicy Bypass -File tests\s74-rollback-exercise-static.test.ps1`,
never wired into `npm test`, matching `tests/sync-dev-static.test.ps1`'s existing precedent) pins,
by parsing the script's `Parser::ParseFile()` AST and never executing it: no bare `pwsh` command
invocation remains; the backup is invoked through the `$PowerShellExe` variable, carrying
`-NoProfile -ExecutionPolicy Bypass -File $BackupScript`; and the first `$WhatIfPreference`
reference's source offset precedes the backup invocation's offset, with that branch confirmed to
`return`/`exit` and to never itself reference `$PowerShellExe` or the importer.

`tests/s74-rollback-exercise-gate-parsing.test.ps1` (DB-free, run the same way) extracts **only**
the script's `FunctionDefinitionAst` nodes and dot-sources just that text, so `param()`, the
connection guards, the preflight, the backup and every importer/psql call are unreachable. Its
fixture is the **byte-exact 93-line transcript of the real attempt-2 `plan`** (verified identical
to attempt 1's), including the two identical `import_batches_before` lines, the blank separators
and the `baseline: {...}` line that must never be read as `baseline_sha256`. It proves exact
parsing, whitespace-separator parity, refusal of disagreeing repeats, refusal of an *identical*
repeat of a once-only key, missing-key refusal for all five keys, five malformed-hash refusals,
seven malformed batch-count refusals (with `0` accepted), empty/absent-output refusal,
unpinned-key refusal, and that the original unfiltered-array binding defect still reproduces. It
was verified to **fail** against the fifth-pass parser and against a copy with the value-shape
check disabled, before being kept.

Full step-by-step detail, the authoritative S0/S1/S2/S3 definitions and why a script was written
instead of a longer copy/paste runbook block: `AFLDB-ISSUE-222.md` §11.19.15 item 2 (third- and
fourth-pass corrections). Syntax-checked with
`[System.Management.Automation.Language.Parser]::ParseFile()`; **never executed** by the model
(the static regression above parses it but never runs it), and must never be executed against
`afldb_dev` -- §7.4's exercise is `afldb_test`-only.

### `afldb_test` import complete and verified (2026-09-19, operator-reported)

Backup `afldb_test-20260919-051022.dump` (sha256 `aa4f1cac…`, catalogue-readable, not
restore-proven); plan `966897b9…`; import as `afldb_import|afldb_test` with authority ledger 6 /
bridge 3,465 / unmatched 1,587 / seeded 0; `verify` twice, `32cf72a5…`, VERIFY: OK — 3,470 linked
persons, 5,115 linked picks (75.11%), zero remaining changes, all 1,589 withheld persons unlinked,
the two rejected identities absent, baseline unchanged. Phase 4a acceptance is still open (see
`AFLDB-ISSUE-222.md` §11.19.9); no DEV or PROD import.

**`--dry-run` message.** `import_draftguru.py --dry-run` now states exactly what it leaves behind:
every data write rolled back, and the `import_batches` audit row retained with status `failed` and
error `DryRunComplete: ` (so a dry run advances the batch count by one -- which is why the plan is
re-run after it). The old "nothing was written" wording was wrong about that row.

## Read-only functional validation after the import

    $env:PGOPTIONS = '-c default_transaction_read_only=on'
    & "C:\Program Files\PostgreSQL\16\bin\psql.exe" -X -v ON_ERROR_STOP=1 -f tools/rebuild/draftguru/afldb_test_draft_linkage_checks.sql -d $env:AFLDB_TEST_DATABASE_URL
    npx vitest run tests/integration/draft-linkage.test.ts
    $env:AFLDB_GRIDLEY_DIAGNOSTIC = '1'; npx vitest run tests/integration/gridley-corpus.test.ts

`afldb_test_draft_linkage_checks.sql` is one `READ ONLY` transaction of SELECTs, rolled back
(`PGOPTIONS` makes the session read-only server-side as well): §6.1 both levels, §6.2 top-10
coverage by year with any unlinked-with-games names, the §6.4 controls, the §6.7 probe and the
newest batch rows. `tests/integration/draft-linkage.test.ts` proves the same facts through the
production compiler -- every expectation derived from the child, the ledger and the Stage A
manifest, never hard-coded (`AFLDB_DRAFTGURU_BRIDGE` points it at a later child) -- and that the
six draft builders and `solveCellSummary` answer on the real population. It seeds nothing and
cleans nothing up, unlike `tests/integration/grid-solver.test.ts` (wildcard season + draft
fixture, deleted in `afterAll`) and `tests/integration/draftguru-import.test.ts` (runs the
importer), which MUTATE `afldb_test` and are not verification steps for an import.

The bridge-link invariant is asserted **from the child target to the player**: the exact
`afltables_external_id` registered once under `afltables` / `afltables_profile_url`, resolving to
the person's stored `player_id`, with the bridge (or agreeing human) state. Never join
`draft_persons.player_id` back to every AFL Tables identity of the player: four canonical players
(Charlie Cameron, Jack Graham, Jack Ross, Jack Williams) legitimately carry two registered paths
under the tracked ISSUE-136 `profile_url_continuity` rules, and that join fans out onto the
continuing path (the 2026-09-19 false failure). `tests/draft-linkage-invariants.ts` holds the
invariant; multi-identity players are reported and must be rule-explained.
