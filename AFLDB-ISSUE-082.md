# AFLDB-ISSUE-082 — `confirmUnlinked` lock/re-check repair

> **Approved:** 2026-08-25
> **Status:** Implementation runbook — approved, not yet implemented.
> **Planned implementation session:**
> Platform: Antigravity CLI (`agy`)
> Model: Claude Sonnet 4.6 (Thinking)
> Effort: High
> Mode: Default
> Session: FRESH

---

## 1. Defect Summary

`confirmUnlinked` can record a `confirmed_unlinked` audit decision that contradicts an applied link. The reverse is also true: a stale `resolveLink` can silently contradict an applied `confirmed_unlinked` decision. For draft picks, this creates a fatal contradiction (`LinkDecisionLoss`) that breaks the draft importer during reload.

## 2. Confirmed Two-Way Race

**The race is real in both directions.**

The reverse-order race produces exactly the contradictory sibling-decision state that ISSUE-078 refuses:
1. `confirmUnlinked(pick A)` acquires the shared `draft_person` lock, records `confirmed_unlinked`, and deliberately leaves the target unresolved. It commits.
2. A waiting `resolveLink(pick B)` wakes, acquires the same lock, sees the target is still unresolved, links the person, and records `linked`.

Row-lock serialization alone prevents concurrent interleaving but does not prevent semantic contradictions because `confirmUnlinked` preserves the `unresolved` state.

## 3. Final Logical Identity

The logical identity that must be protected is the **`draft_person`** (for draft picks) or the target row itself (for non-draft targets). Identity and decisions for draft targets are person-grained.

## 4. Exact Logical-Decision Classification Type

The helper must accurately represent all four potential states to ensure a contradictory pre-existing state fails closed rather than silently choosing a winner.

```typescript
type LogicalDecision =
  | { type: 'none' }
  | { type: 'linked'; playerId: number }
  | { type: 'confirmed_unlinked' }
  | { type: 'contradictory' };
```

## 5. Exact Non-Draft Decision Algorithm

For a non-draft target, the logical decision is simply the latest action for that target:

```typescript
  // Non-draft
  const [row] = await tx<{ action: string; playerId: number | null }[]>`
    SELECT action, player_id AS "playerId"
      FROM player_link_resolutions
     WHERE target_table = ${targetTable}
       AND target_id = ${targetId}
     ORDER BY created_at DESC, id DESC
     LIMIT 1
  `;
  if (!row) return { type: 'none' };
  if (row.action === 'linked') return { type: 'linked', playerId: row.playerId! };
  return { type: 'confirmed_unlinked' };
```

## 6. Exact Draft-Person Decision Query/Algorithm

For draft persons, the classification mirrors the exact effective-decision semantics in `import_draft.py`. It obtains the latest decision for **each** sibling pick, and if the set contains contradictory actions, it returns `'contradictory'`.

```typescript
async function classifyLogicalDecision(
  tx: Tx,
  targetTable: LinkTargetTable,
  targetId: number,
  draftPersonId: number | null,
): Promise<LogicalDecision> {
  if (targetTable === 'draft_picks' && draftPersonId) {
    // Obtain the newest decision for each sibling pick of the locked person
    const rows = await tx<{ action: string; playerId: number | null }[]>`
      SELECT DISTINCT ON (r.target_id)
             r.action, r.player_id AS "playerId"
        FROM player_link_resolutions r
        JOIN draft_picks p ON p.id = r.target_id
       WHERE p.draft_person_id = ${draftPersonId}
         AND r.target_table = 'draft_picks'
       ORDER BY r.target_id, r.created_at DESC, r.id DESC
    `;
    if (rows.length === 0) return { type: 'none' };

    const actions = new Set(rows.map(r => r.action));
    const linkedPlayers = new Set(rows.filter(r => r.action === 'linked').map(r => r.playerId));

    // Mirror import_draft.py's ambiguity/contradiction check
    if (actions.size > 1 || linkedPlayers.size > 1) {
      return { type: 'contradictory' };
    }

    if (actions.has('linked')) {
      return { type: 'linked', playerId: [...linkedPlayers][0]! };
    }

    return { type: 'confirmed_unlinked' };
  }

  // (Non-draft algorithm follows here)
}
```

## 7. Duplicate-Confirmation Policy

There is no deliberate post-confirmation workflow in the normal resolution UI. Once a target is `confirmed_unlinked`, it disappears from the queue. Any duplicate `confirmUnlinked` submission is a stale browser submission.

- `none` → allow → append exactly one `confirmed_unlinked` row.
- `confirmed_unlinked` → reject as already confirmed / stale. Write nothing.
- `linked` → reject (handled primarily by `lockUnresolvedTarget`).
- `contradictory` → fail closed with a distinct integrity error. Write nothing.

This guarantees that two concurrent confirmations will safely leave exactly one durable confirmation row without artificially escalating audit counts.

## 8. Existing Contradiction Handling

If a pre-existing contradictory draft-person decision state is found, it must NOT be automatically repaired or silently resolved. It must fail closed with an admin-facing error distinct from ordinary stale errors.

Conceptually: `"This draft identity has conflicting existing link decisions and cannot be changed until reviewed."`

## 9. Exact `resolveLink` Transaction Flow

```typescript
    const applied = await importSql.begin(async (tx) => {
      const target = await lockUnresolvedTarget(tx, input.targetTable, input.targetId);
      if (!target) return 'already_resolved';

      const decision = await classifyLogicalDecision(
        tx, input.targetTable, input.targetId, target.draftPersonId
      );
      if (decision.type === 'contradictory') return 'contradictory';
      if (decision.type === 'confirmed_unlinked') return 'stale_unlinked';
      if (decision.type === 'linked') return 'already_resolved';

      await applyLockedLink(
        tx, input.targetTable, input.targetId, input.playerId, target.draftPersonId
      );
      await recordLinkedResolution(tx, { ...input, previousStatus: target.previousStatus });
      return 'applied';
    });

    if (applied === 'already_resolved') {
      return { ok: false, error: 'No unresolved row with that id — it may already be linked.' };
    }
    if (applied === 'contradictory') {
      return { ok: false, error: 'This draft identity has conflicting existing link decisions and cannot be changed until reviewed.' };
    }
    if (applied === 'stale_unlinked') {
      return { ok: false, error: 'This target was already confirmed unlinked and cannot be linked from a stale form.' };
    }
    return { ok: true };
```

## 10. Exact `createPlayerAndResolveLink` Transaction Flow

The target MUST be locked and semantic classification MUST occur **BEFORE** the player insertion.

```typescript
    const result = await importSql.begin(async (tx) => {
      const target = await lockUnresolvedTarget(tx, input.targetTable, input.targetId);
      if (!target) return 'already_resolved';

      const decision = await classifyLogicalDecision(
        tx, input.targetTable, input.targetId, target.draftPersonId
      );
      if (decision.type === 'contradictory') return 'contradictory';
      if (decision.type === 'confirmed_unlinked') return 'stale_unlinked';
      if (decision.type === 'linked') return 'already_resolved';

      const player = await createPlayerInTransaction(tx, input.player);

      await applyLockedLink(
        tx, input.targetTable, input.targetId, player.id, target.draftPersonId
      );
      await recordLinkedResolution(tx, { ...input, playerId: player.id, previousStatus: target.previousStatus });
      return { ok: true as const, player };
    });

    if (result === 'already_resolved') {
      return { ok: false, error: 'No unresolved row with that id — it may already be linked.' };
    }
    // (stale and contradictory checks identical to resolveLink)
```

## 11. Exact `confirmUnlinked` Transaction Flow

Rewritten from the `authSql` path to use an import-role transaction:

```typescript
    const confirmed = await importSql.begin(async (tx) => {
      const target = await lockUnresolvedTarget(tx, input.targetTable, input.targetId);
      if (!target) return 'already_resolved';

      const decision = await classifyLogicalDecision(
        tx, input.targetTable, input.targetId, target.draftPersonId
      );
      if (decision.type === 'contradictory') return 'contradictory';
      if (decision.type === 'confirmed_unlinked') return 'stale_unlinked';
      if (decision.type === 'linked') return 'already_resolved';

      await tx`
        INSERT INTO player_link_resolutions
              (target_table, target_id, action, player_id, previous_status,
               admin_user_id, note)
        VALUES (${input.targetTable}, ${input.targetId}, 'confirmed_unlinked', NULL,
                ${target.previousStatus}::link_status, ${input.adminUserId},
                ${(input.note ?? '').trim().slice(0, 2000) || null})
      `;
      return 'confirmed';
    });
    // (return matching ResolveResult responses)
```

## 12. Exact Transaction-Scoped Helper Structure

To allow a real concurrency regression test to control two independent database transactions, we will extract narrow transaction-scoped helpers that accept the `Tx` object and own NO connection lifecycle themselves:

- `classifyLogicalDecision(tx, targetTable, targetId, draftPersonId)`
- `resolveLockedLink(tx, input)`: Encapsulates `lockUnresolvedTarget`, `classifyLogicalDecision`, `applyLockedLink`, and `recordLinkedResolution`.
- `confirmLockedUnlinked(tx, input)`: Encapsulates `lockUnresolvedTarget`, `classifyLogicalDecision`, and the `INSERT`.

The existing exported `resolveLink` and `confirmUnlinked` will act as public wrappers that provision the `importSql.begin` connection and pass `tx` to the helpers.

## 13. Admin-Facing Stale/Integrity Errors

- Contradictory: `"This draft identity has conflicting existing link decisions and cannot be changed until reviewed."`
- Stale Unlinked (resolve): `"This target was already confirmed unlinked and cannot be linked from a stale form."`
- Stale Unlinked (confirm): `"This target was already confirmed unlinked by another admin."`

## 14. ISSUE-080 Interaction

The `(717275, 1)` transaction-scoped advisory-lock protocol belongs to the honour-team identity writers hardened by ISSUE-080. `confirmUnlinked` remains purely audit-only. It does not clear `player_id` or change honour-team identity/status. Therefore, ISSUE-082 does NOT join that advisory-lock protocol. If this repair ever required an honour-team unlink/identity mutation, that would be a HALT condition requiring ISSUE-080's lock protocol.

## 15. Exact Implementation File Set

- `src/db/queries/player-links.ts`
- `src/app/admin/player-links/actions.ts`
- `tests/player-link-mutations.test.ts`
- `tests/integration/player-link-concurrency.test.ts` (NEW)
- `issues.md`, `IssuesIndex.md`, `CHANGELOG.md`

## 16. Complete Unit-Test Matrix

Extend `tests/player-link-mutations.test.ts` to assert:
- **`confirmUnlinked`**: Uses `AFLDB_IMPORT_DATABASE_URL`; uses one import-role transaction; no `authSql`; locks/re-reads before semantic lookup; fresh unresolved succeeds; locked state supplies `previous_status` (form `previousStatus` ignored); target missing rejects; target linked rejects; existing `confirmed_unlinked` rejects without INSERT; contradictory draft fails closed; successful confirmation writes exactly ONE resolution row; no target UPDATE occurs; draft classification is person-grained; simultaneous confirmation leaves one durable row.
- **`resolveLink`**: Semantic classification occurs after lock and before target mutation; `confirmed_unlinked` rejects; contradictory draft rejects; no mutation/audit insert on rejection.
- **`createPlayerAndResolveLink`**: Lock happens first; semantic classification happens before player creation; stale action creates NO player; contradictory state creates NO player.
- **Action contract**: `confirmUnlinked` server action no longer forwards/trusts form-supplied `previousStatus`.

## 17. Deterministic Database-Backed Concurrency-Test Design

File: `tests/integration/player-link-concurrency.test.ts`
Database: `AFLDB_TEST_DATABASE_URL`
Safety gate: parsed database name MUST end in `_test`

*Note: This test does not prove `afldb_import` role parity (which remains ISSUE-083 and out of scope). Production implementation continues to use `AFLDB_IMPORT_DATABASE_URL`.*

**Test Setup:** One `draft_person`, two sibling `draft_picks`.
**Coordination:** The test must use two independent PostgreSQL connections against the guarded `_test` database and coordinate deterministically using PostgreSQL lock evidence.

For each interleaving:
1. Begin T1.
2. T1 explicitly acquires the authoritative `draft_persons` row using `SELECT ... FOR UPDATE`.
3. Record T1 backend PID using `SELECT pg_backend_pid()`.
4. Begin T2 and record T2 backend PID.
5. Start the REAL transaction-scoped helper in T2 so it reaches and waits on the same logical row lock.
6. Prove that T2 is blocked by T1 using PostgreSQL lock evidence (e.g. bounded polling on `SELECT pg_blocking_pids(<T2 backend pid>)`). Arbitrary sleeps must not be the proof.
7. While T1 still owns the lock, execute T1's REAL transaction-scoped helper. (Re-acquiring the same row lock within the same transaction is valid).
8. Commit T1.
9. Await T2.
10. Assert T2 wakes, re-reads the committed state, and rejects the contradictory operation.

**Interleaving A (resolve lock first):**
- T1 (resolve) acquires lock.
- T2 (confirm sibling) blocks.
- T1 commits link.
- T2 wakes, reads resolved state, rejects.
- *Assertion: Linked state exists; no contradictory confirmation was appended.*

**Interleaving B (confirm lock first):**
- T1 (confirm) acquires lock.
- T2 (resolve) blocks.
- T1 commits `confirmed_unlinked`.
- T2 wakes, acquires lock, classifies logical decision as `confirmed_unlinked`, rejects.
- *Assertion: Confirmation exists; no target mutation or linked decision was committed.*

**Interleaving C (confirm vs confirm):**
- Prove exact duplicate suppression via the same blocking PID coordination.
- *Assertion: Exactly one effective `confirmed_unlinked` action exists for the logical identity.*

## 18. Privileges

Current migration `068` already grants `SELECT ON player_link_resolutions TO afldb_import`. Migration `066` provides the necessary `INSERT` and sequence privileges. The required `afldb_import` locking access to target tables remains unchanged.

## 19. Migration Decision

**NO migration required.**

## 20. Validation Sequence

1. `npx vitest run tests/player-link-mutations.test.ts`
2. `npx vitest run tests/integration/player-link-concurrency.test.ts`
3. `npx tsc --noEmit`
4. `npm run build`

## 21. Full HALT Conditions

HALT and report if:
1. Current code materially contradicts the final approved runbook.
2. A schema migration becomes necessary unexpectedly.
3. Required `afldb_import` privileges are absent or require a new privilege design.
4. The repair requires clearing `player_id`, changing target status, or any other new target-row unlink mutation (particularly involving `honour_team_members`).
5. Draft-person identity semantics differ materially from this plan.
6. The safe repair requires broad changes outside the player-link mutation subsystem.
7. Testing exposes an independent defect rather than a consequence of ISSUE-082.
8. Implementation would require weakening an existing integrity invariant.
9. Implementation would require name-based draft identity.
10. A pre-existing contradictory draft-person decision state is found and cannot safely be treated as an ordinary stale-form condition.
11. The real concurrency regression cannot be made deterministic without test-only production hooks or disproportionate architectural changes.
12. Existing ISSUE-078 decision classification materially differs from the assumptions above.
13. An intended deliberate override/reopen workflow is discovered that materially changes the semantic policy.

## 22. Ledger/Changelog Completion Actions

After implementation and validation:
- `issues.md`: Mark AFLDB-ISSUE-082 resolved; set resolved date, root cause, implementation, and validation; preserve concurrency findings; remove from Open Issues table; decrement open-issue count.
- `IssuesIndex.md`: Remove AFLDB-ISSUE-082; decrement count.
- `CHANGELOG.md`: Add behavior change under `Unreleased`.

## 23. Final Invariant

> A player-link decision may change only inside the same `afldb_import` transaction that:
> 1. acquires the authoritative logical-identity lock (`draft_person` or non-draft row);
> 2. re-reads the target's authoritative current link state;
> 3. classifies the current logical audit decision while still holding that lock;
> 4. proves the proposed action does not contradict an already committed decision;
> 5. performs any target mutation and audit append atomically.
>
> For draft picks, the logical identity and decision classification are draft-person-grained even though one real admin action continues to write one audit row naming the submitted draft pick.
>
> A `confirmed_unlinked` decision remains audit-only. No target `player_id` or status is cleared or otherwise mutated by `confirmUnlinked`.

## 24. Fresh Implementation-Session Handoff

Upon approval, the user will trigger a FRESH implementation session to execute this runbook.
