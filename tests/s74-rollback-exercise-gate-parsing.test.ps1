$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# AFLDB-ISSUE-222 §7.4 gate-output parsing regression (sixth pass).
#
# Two real attempts stopped safely in this parser, before confirmation and before any mutation:
#
#   attempt 1 (s74-20260919-issue222-final)  -- blank separator lines reached a mandatory
#                                               [string[]] parameter and PowerShell refused to bind.
#   attempt 2 (s74-20260919-issue222-retry1) -- the blank-line fix held, but the parser then refused
#                                               'import_batches_before' for appearing twice, which
#                                               is what bridge_import_gate.py's plan really prints.
#
# The fifth-pass version of this test passed while the real run failed because its fixture was
# SYNTHETIC: it printed import_batches_before once. This version fixes that at the root -- the
# fixture below is the byte-exact transcript of the preserved attempt-2 base-plan.log (identical to
# attempt 1's), so the parser is now pinned against what the tool actually emits rather than
# against an idea of it.
#
# The test never runs the script's main body: it extracts ONLY FunctionDefinitionAst nodes from the
# script's own AST and dot-sources just that text, so param(), the connection guards, the backup,
# the importer calls and every psql invocation are unreachable. No environment variable, no
# database, no external process and no network access is required.

$root = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $root 'tools\rebuild\draftguru\s74-rollback-exercise.ps1'

function Assert-True {
  param(
    [Parameter(Mandatory = $true)][bool] $Condition,
    [Parameter(Mandatory = $true)][string] $Message
  )
  if (-not $Condition) { throw $Message }
}

function Assert-Throws {
  # $ExpectedMessagePattern is optional on purpose: one case below asserts only THAT PowerShell's
  # own parameter binder refuses, and that message is localised, so matching its English text would
  # make this test fail on a non-English Windows for no good reason.
  param(
    [Parameter(Mandatory = $true)][scriptblock] $ScriptBlock,
    [Parameter(Mandatory = $true)][string] $Message,
    [string] $ExpectedMessagePattern = ''
  )
  $threw = $false
  $actualMessage = ''
  try {
    & $ScriptBlock
  }
  catch {
    $threw = $true
    $actualMessage = $_.Exception.Message
  }
  Assert-True $threw "$Message (expected a throw; none occurred)"
  if ($ExpectedMessagePattern) {
    Assert-True ($actualMessage -match $ExpectedMessagePattern) `
      "$Message (thrown message did not match /$ExpectedMessagePattern/: '$actualMessage')"
  }
}

# ---------------------------------------------------------------------------
# Extract ONLY the function definitions from the AST -- never the param() block or the top-level
# flow (connection guards, snapshot preflight, backup, importer calls), which this test must never
# execute.
# ---------------------------------------------------------------------------

$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$parseErrors)
Assert-True ($parseErrors.Count -eq 0) "s74-rollback-exercise.ps1 has $($parseErrors.Count) parse error(s)"

$functionAsts = @($ast.FindAll({ $args[0] -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false))
Assert-True ($functionAsts.Count -gt 0) 'no function definitions were found in s74-rollback-exercise.ps1'
$requiredFunctions = 'Get-GateValue', 'Get-GateValueRule', 'Get-GateParseLines', 'Read-GatePlanValues'
foreach ($name in $requiredFunctions) {
  $matchCount = @($functionAsts | Where-Object { $_.Name -eq $name }).Count
  Assert-True ($matchCount -eq 1) "expected exactly one definition of $name, found $matchCount"
}

$functionsText = ($functionAsts | ForEach-Object { $_.Extent.Text }) -join "`n`n"
. ([scriptblock]::Create($functionsText))

foreach ($name in $requiredFunctions) {
  Assert-True ($null -ne (Get-Command $name -ErrorAction SilentlyContinue)) `
    "$name was not loaded from the extracted function text"
}

# ---------------------------------------------------------------------------
# The fixture: the byte-exact stdout of the real `bridge_import_gate.py plan --target test` run
# from attempt 2, preserved at
#   D:\backups\afldb\issue-222\s74-20260919-issue222-retry1\base-plan.log
# (attempt 1's, at ...-final\base-plan.log, is identical). Reproduced here verbatim so this test is
# self-contained and does not read a file outside the repository.
#
# Note what it contains, all of which the parser must handle:
#   * TWO 'import_batches_before: 193' lines -- line 25 (section 3, with the trailing "(draftguru
#     batches now; max id ...)" detail) and line 89 (section 8's plan verdict, bare). This is the
#     repetition that stopped attempt 2.
#   * TWO 'import_batches_expected_after' lines, which this script deliberately does not consume.
#   * blank separator lines before every numbered section and before summary_sha256.
#   * a 'baseline: {...}' line that must NOT be mistaken for 'baseline_sha256'.
#   * a 'changes_sha256' line that is not one of the four values this script reads.
# ---------------------------------------------------------------------------

$RealPlanTranscript = @'
AFLDB DraftGuru bridge import gate -- plan (read-only, afldb_test only) [target=test]
  snapshot : annual-html-20260826 (42 year pages, sha256 verified)
  child    : data/reference/draftguru-person-bridge-20260918-v2.afldb_test.json b996c60e9d4de3ae...
  parent   : data/reference/draftguru-person-bridge-20260918-v2.json (parent_sha256 chain verified)

1. plan: inputs
  PASS  1.1 child sha256 pinned
  PASS  1.2 bridges[] loads through the importer's load_bridge
  PASS  1.3 no withheld person appears in bridges[]
  PASS  1.4 neither rejected identity appears in bridges[] or the parent
  PASS  1.5 every rejected person is withheld different_person_wrong_href
  PASS  1.6 every target_not_registered person has its identity in the parent

2. read-only connection
  PASS  2.1 server confirms transaction_read_only=on and default_transaction_read_only=on
  PASS  2.2 current_database() is afldb_test
  PASS  2.3 session TimeZone is UTC (digest stability)
  PASS  2.4 the target's live decisions are consistent (read_live_decisions)

3. target state
  PASS  3.1 draftguru draft_persons population is 5057
  PASS  3.2 draftguru draft_picks population is 6810
  PASS  3.3 no duplicate draftguru person url or pick key stored
  PASS  3.4 every stored draftguru pick carries its person's player_id
        import_batches_before: 193 (draftguru batches now; max id 1382)
        import_batches_expected_after: 194 (pass import_batches_before as --expect-batches-before to verify)

4. registration (importer HALT conditions and child staleness)
  PASS  4.1 every bridge target is registered exactly once (else the importer HALTs)
  PASS  4.2 no target_not_registered identity has since become registered (child not stale)
  PASS  4.3 no stored draftguru person reaches a rejected AFL Tables identity

5. the importer's decision, replayed (apply_authority, seeding forbidden)
  PASS  5.1 apply_authority completes without a HALT
  PASS  5.2 no live decision overrides the tracked ledger
  PASS  5.3 authority: bridge + decided persons in the bridge == bridges.length
  PASS  5.4 authority: ledger == the tracked ledger's decision count (+ live decisions)
  PASS  5.5 nothing would be seeded
  PASS  5.6 no canonical player is claimed by two DraftGuru persons after the import
  PASS  5.7 every expected person state is in the allowed vocabulary
  PASS  5.8 both rejected persons compute to unlinked
  PASS  5.9 every withheld person computes to unlinked-by-bridge

6. classification: stored vs expected
        persons.newly_linked: 0
        persons.already_agreeing_linked_human: 5
        persons.already_agreeing_linked_bridge: 3465
        persons.already_agreeing_unlinked: 1587
        persons.link_dropped: 0
        persons.relinked: 0
        persons.link_metadata_change: 0
        persons.unexpected_link_change: 0
        persons.missing: 0
        persons.extra: 0
        persons.nonlink_change: 0
        persons.dg_person_id_permutation: 0
        picks.missing: 0
        picks.extra: 0
        picks.link_change: 0
        picks.nonlink_change: 0
        identities.missing: 0
        identities.extra: 0
        identities.link_change: 0
        identities.other_change: 0
  PASS  6.1 no person missing from or extra to the target
  PASS  6.2 no pick missing from or extra to the target
  PASS  6.3 no conflicting link change (dropped / relinked / metadata / unexpected)
  PASS  6.4 no non-link person column would change
  PASS  6.5 dg_person_id is not permuted
  PASS  6.6 no non-link pick column would change (after active source-owned overrides)
  PASS  6.7 external_identities(draftguru): no missing/extra row, no change outside link columns
  PASS  6.8 external_identities link changes are exactly the newly linked persons
  PASS  6.9 pick link changes belong exactly to the newly linked persons
  PASS  6.10 no active manual selection would be re-created or rewritten
  PASS  6.11 newly linked + already bridge-linked == every non-decided bridge person

7. hashes and totals
        after_state_sha256: 4f0a2cc567d03f2660132a1cdde66aa5e006c5e1e848a2dc5db724bd726b469d
        picks_after_sha256: ffa7fd60a02d8caee2d9fa22b9500725e9e12fc4ca8aba1d21e94675aa400c8d
        newly_linked_sha256: 3ff560472aa38b63a9ef28d57501e31da9cdb907cf44bcf304a42140a02471e3
        changes_sha256: 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945
        baseline_sha256: 71178a54376e911d1b374d534c7006ba3097ffd631635de405eaa424c878b4a4
        changes (persons whose link state differs now vs after): 0
        totals_after: {"linked_persons": 3470, "linked_picks": 5115, "persons_by_status_method": {"resolved|draftguru_explicit_admin_decision": 5, "unique|draftguru_person_page_afltables_bridge": 3465, "unmatched|": 1586, "unmatched|draftguru_explicit_admin_decision": 1}, "pick_capability_pct": 75.11, "picks_by_status": {"resolved": 5, "unique": 5110, "unmatched": 1695}}
        baseline: {"clubs": {"count": 24, "md5": "e00c7e012447e038fb1235cff85fc197"}, "data_overrides": {"count": 0, "md5": "d41d8cd98f00b204e9800998ecf8427e"}, "draft_persons_draftguru_nonlink": {"count": 5057, "md5": "c0f0ff04335dd6e3c9e7b997d6ef108a"}, "draft_persons_not_draftguru": {"count": 0, "md5": "d41d8cd98f00b204e9800998ecf8427e"}, "draft_picks_draftguru_nonlink": {"count": 6810, "md5": "b43850bbe1afffa7611099b79cff5a7a"}, "draft_picks_not_draftguru": {"count": 0, "md5": "d41d8cd98f00b204e9800998ecf8427e"}, "external_identities_not_draftguru": {"count": 13275, "md5": "be86e7895496f850315a89e56fbdc1b2"}, "player_career_stats": {"count": 13271, "md5": "f1d2b6a93f38b91eea412c5df5abe8fd"}, "player_link_resolutions": {"count": 0, "md5": "d41d8cd98f00b204e9800998ecf8427e"}, "players": {"count": 13338, "md5": "63f26a5130e4493b38af2cc22cf168cf"}, "sources": {"count": 15, "md5": "0897945179fb6da4482be9dcd4ae961b"}}

8. plan verdict
  PASS  8.1 the only change is newly linked persons (and their picks / identity rows)
        import_batches_before: 193
        import_batches_expected_after: 194

summary_sha256: d4b1fbef305736ee8c0e70bd7cfc2fa60c48e0cbc3b6edd6af911ffd998782a9
PLAN: OK -- every check held; nothing was written
'@

$RealPlanLines = [regex]::Split($RealPlanTranscript, "\r?\n")

$EXPECTED_AFTER = '4f0a2cc567d03f2660132a1cdde66aa5e006c5e1e848a2dc5db724bd726b469d'
$EXPECTED_PICKS = 'ffa7fd60a02d8caee2d9fa22b9500725e9e12fc4ca8aba1d21e94675aa400c8d'
$EXPECTED_NEWLY = '3ff560472aa38b63a9ef28d57501e31da9cdb907cf44bcf304a42140a02471e3'
$EXPECTED_BASE = '71178a54376e911d1b374d534c7006ba3097ffd631635de405eaa424c878b4a4'
$EXPECTED_BEFORE = 193

function New-PlanLines {
  # A fresh copy of the real transcript's lines, optionally perturbed one way. Deliberately
  # untyped/List[string]-built: typing this as [string[]] would itself reject the blank separator
  # elements, which is the defect attempt 1 hit.
  param(
    [string] $DropPattern = '',
    [string] $ReplacePattern = '',
    [string] $ReplaceWith = '',
    [string] $InsertAfterFirst = '',
    [string] $InsertLine = '',
    [switch] $WhitespaceSeparators
  )
  $out = New-Object System.Collections.Generic.List[string]
  $inserted = $false
  $blankCount = 0
  foreach ($line in $script:RealPlanLines) {
    $current = $line
    if ($WhitespaceSeparators -and $current -eq '') {
      $blankCount++
      $current = if ($blankCount % 2 -eq 0) { '   ' } else { "`t" }
    }
    if ($DropPattern -and $current -match $DropPattern) { continue }
    if ($ReplacePattern -and $current -match $ReplacePattern) { $current = $ReplaceWith }
    [void]$out.Add($current)
    if ($InsertAfterFirst -and -not $inserted -and $current -match $InsertAfterFirst) {
      [void]$out.Add($InsertLine)
      $inserted = $true
    }
  }
  return , $out.ToArray()
}

function New-PlanResult {
  param($Lines)
  return [pscustomobject]@{ Output = $Lines; ExitCode = 0 }
}

# ---------------------------------------------------------------------------
# 0. The fixture really is the shape that broke attempt 2.
# ---------------------------------------------------------------------------

$real = New-PlanLines
Assert-True ($real.Count -eq 93) "the preserved transcript is 93 lines; the fixture has $($real.Count)"
$beforeLines = @($real | Where-Object { $_ -match '^\s*import_batches_before:' })
Assert-True ($beforeLines.Count -eq 2) `
  "the fixture must carry the two real import_batches_before lines, found $($beforeLines.Count)"
Assert-True (@($real | Where-Object { $_ -eq '' }).Count -ge 8) `
  'the fixture must retain the gate''s blank separator lines'
Assert-True ($real -contains '        import_batches_before: 193') `
  'the fixture must carry the bare section-8 plan-verdict form of import_batches_before'
Assert-True (@($real | Where-Object { $_ -match '^\s*baseline:' }).Count -eq 1) `
  'the fixture must carry the "baseline: {...}" line that must never be read as baseline_sha256'

# ---------------------------------------------------------------------------
# 1. The real transcript parses exactly -- including the intentionally repeated, identical
#    import_batches_before.
# ---------------------------------------------------------------------------

$values = Read-GatePlanValues -Result (New-PlanResult $real)
Assert-True ($values.after -eq $EXPECTED_AFTER) "after_state_sha256 mismatch: $($values.after)"
Assert-True ($values.picks -eq $EXPECTED_PICKS) "picks_after_sha256 mismatch: $($values.picks)"
Assert-True ($values.newly -eq $EXPECTED_NEWLY) "newly_linked_sha256 mismatch: $($values.newly)"
Assert-True ($values.base -eq $EXPECTED_BASE) "baseline_sha256 mismatch: $($values.base)"
Assert-True ($values.before -eq $EXPECTED_BEFORE) "import_batches_before mismatch: $($values.before)"
Assert-True ($values.before.GetType().Name -eq 'Int32') 'import_batches_before must parse as an int, not a string'

# ---------------------------------------------------------------------------
# 2. Whitespace-only separators are treated exactly like empty ones.
# ---------------------------------------------------------------------------

$wsValues = Read-GatePlanValues -Result (New-PlanResult (New-PlanLines -WhitespaceSeparators))
Assert-True ($wsValues.after -eq $EXPECTED_AFTER -and $wsValues.picks -eq $EXPECTED_PICKS `
    -and $wsValues.newly -eq $EXPECTED_NEWLY -and $wsValues.base -eq $EXPECTED_BASE `
    -and $wsValues.before -eq $EXPECTED_BEFORE) `
  'space-only and tab-only separator lines must parse identically to empty ones'

# ---------------------------------------------------------------------------
# 3. A repeat of import_batches_before that DISAGREES is refused.
# ---------------------------------------------------------------------------

Assert-Throws -ScriptBlock {
  Read-GatePlanValues -Result (New-PlanResult (New-PlanLines `
        -InsertAfterFirst '^\s*import_batches_before:' -InsertLine '        import_batches_before: 194'))
} -ExpectedMessagePattern "'import_batches_before' appears 3 times .* DIFFERENT values" `
  -Message 'two different import_batches_before values must refuse, never pick one'

# ---------------------------------------------------------------------------
# 4. A key contracted to appear ONCE is refused on a repeat, even an identical one. A generic
#    "duplicates are fine when they agree" rule would silently absorb a change to the gate's
#    section-7 output; only import_batches_before is contracted to repeat.
# ---------------------------------------------------------------------------

Assert-Throws -ScriptBlock {
  Read-GatePlanValues -Result (New-PlanResult (New-PlanLines `
        -InsertAfterFirst '^\s*after_state_sha256:' -InsertLine "        after_state_sha256: $EXPECTED_AFTER"))
} -ExpectedMessagePattern "'after_state_sha256' appears 2 times.*pinned contract is exactly once" `
  -Message 'an IDENTICAL duplicate of a once-only key must still refuse'

Assert-Throws -ScriptBlock {
  Read-GatePlanValues -Result (New-PlanResult (New-PlanLines `
        -InsertAfterFirst '^\s*after_state_sha256:' `
        -InsertLine '        after_state_sha256: 0000000000000000000000000000000000000000000000000000000000000000'))
} -ExpectedMessagePattern "'after_state_sha256' appears 2 times .* DIFFERENT values" `
  -Message 'a conflicting duplicate of a once-only key must refuse on the conflict'

# ---------------------------------------------------------------------------
# 5. Missing keys.
# ---------------------------------------------------------------------------

foreach ($key in 'after_state_sha256', 'picks_after_sha256', 'newly_linked_sha256', 'baseline_sha256', 'import_batches_before') {
  Assert-Throws -ScriptBlock {
    Read-GatePlanValues -Result (New-PlanResult (New-PlanLines -DropPattern "^\s*$key`:"))
  } -ExpectedMessagePattern "could not find '$key'" `
    -Message "a missing $key line must refuse clearly, not guess"
}

# ---------------------------------------------------------------------------
# 6. Malformed hashes: wrong length, non-hex, uppercase (the gate emits hexdigest(), lowercase).
# ---------------------------------------------------------------------------

foreach ($bad in ('71178a54376e911d1b374d534c7006ba3097ffd631635de405eaa424c878b4a',
    '71178a54376e911d1b374d534c7006ba3097ffd631635de405eaa424c878b4a4z',
    'ZZ178a54376e911d1b374d534c7006ba3097ffd631635de405eaa424c878b4a4',
    $EXPECTED_BASE.ToUpperInvariant(),
    'n/a')) {
  Assert-Throws -ScriptBlock {
    Read-GatePlanValues -Result (New-PlanResult (New-PlanLines `
          -ReplacePattern '^\s*baseline_sha256:' -ReplaceWith "        baseline_sha256: $bad"))
  } -ExpectedMessagePattern 'not a 64-character lowercase hexadecimal sha256' `
    -Message "a malformed baseline_sha256 ('$bad') must refuse, never be carried into an --expect-* argument"
}

# ---------------------------------------------------------------------------
# 7. Malformed batch counts: non-numeric, negative, fractional, leading zero, absurdly large.
#    Both real occurrences are replaced, so these are genuine value refusals and not duplicate
#    refusals in disguise.
# ---------------------------------------------------------------------------

foreach ($bad in 'abc', '-1', '1.5', '0193', '+193', '1e3', '9999999999') {
  Assert-Throws -ScriptBlock {
    Read-GatePlanValues -Result (New-PlanResult (New-PlanLines `
          -ReplacePattern '^\s*import_batches_before:' -ReplaceWith "        import_batches_before: $bad"))
  } -ExpectedMessagePattern 'not a non-negative integer' `
    -Message "a malformed import_batches_before ('$bad') must refuse before any [int] cast"
}

Assert-True ((Read-GatePlanValues -Result (New-PlanResult (New-PlanLines `
          -ReplacePattern '^\s*import_batches_before:' -ReplaceWith '        import_batches_before: 0'))).before -eq 0) `
  'zero is a legitimate non-negative batch count and must parse'

# ---------------------------------------------------------------------------
# 8. Output with nothing parseable at all refuses clearly instead of crashing on binding.
# ---------------------------------------------------------------------------

Assert-Throws -ScriptBlock { Read-GatePlanValues -Result (New-PlanResult @('', '   ', "`t", '')) } `
  -ExpectedMessagePattern 'no non-blank output lines' `
  -Message 'entirely blank/whitespace gate output must refuse clearly'

Assert-Throws -ScriptBlock { Read-GatePlanValues -Result (New-PlanResult $null) } `
  -ExpectedMessagePattern 'no non-blank output lines' `
  -Message 'a gate result with no output at all must refuse clearly'

# ---------------------------------------------------------------------------
# 9. The contract table is closed: a key nobody pinned cannot be parsed by accident.
# ---------------------------------------------------------------------------

Assert-Throws -ScriptBlock { Get-GateValueRule -Key 'changes_sha256' } `
  -ExpectedMessagePattern 'no declared gate-output contract' `
  -Message 'a key with no pinned multiplicity/shape contract must refuse rather than be guessed'
Assert-Throws -ScriptBlock { Get-GateValue -Lines (Get-GateParseLines -Result (New-PlanResult $real)) -Key 'summary_sha256' } `
  -ExpectedMessagePattern 'no declared gate-output contract' `
  -Message 'Get-GateValue must refuse an unpinned key even when the line is present'

# ---------------------------------------------------------------------------
# 10. The original attempt-1 defect still reproduces on the UNFILTERED array, confirming that
#     Read-GatePlanValues filtering before it calls Get-GateValue is load bearing. Only "it throws"
#     is asserted: the binder's message is localised.
# ---------------------------------------------------------------------------

Assert-Throws -ScriptBlock { Get-GateValue -Lines $real -Key 'after_state_sha256' } `
  -Message 'Get-GateValue must still reject an unfiltered array containing blank elements (proves the filtering fix is load bearing)'

Write-Output ('PASS: s74-rollback-exercise.ps1 gate-output parsing regression, pinned against the ' +
  'byte-exact preserved transcript of the real attempt-2 plan (93 lines, two identical ' +
  'import_batches_before lines, blank and whitespace-only separators): exact parse; ' +
  'whitespace-separator parity; conflicting-repeat refusal; identical-repeat refusal for ' +
  'once-only keys; missing-key refusal for all five keys; five malformed-hash refusals; seven ' +
  'malformed batch-count refusals plus zero accepted; empty/absent output refusal; unpinned-key ' +
  'refusal; and the original unfiltered-array binding defect reproduced directly')
