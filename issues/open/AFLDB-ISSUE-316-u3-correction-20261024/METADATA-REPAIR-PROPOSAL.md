# ISSUE-316 / ISSUE-255 — audit metadata repair proposal (2026-10-24)

**PROPOSAL ONLY. No production write is authorised or executed by this document.**
The canonical correction is accepted and must never be repeated. U3 is unconfirmed; U4 remains Route B;
production remains NO-GO. No census, seal/rollover, successor activation, apply, deployment, rebuild or push.

## Exact target and value

- Database identity: afldb_prod, OID 66668, system ID 7674454702926115004, host afldb-prod.
- Existing record: public.data_edits, id **94**; table_name matches; row_id **17214**;
  field_group match_sheet; original admin_user_id **1**; created_at **2026-10-24T11:28:46.203865Z**.
- Column: **note**. Current value: **SQL NULL**, independently re-read at 11:46:45.164537Z.
- Proposed value: exactly the following **967 characters**, without surrounding formatting or a trailing newline.
  UTF-8 SHA-256 of that value: **3d2d25ea4919dcdc1cfd8fcaa1b2ede6941e10ab0d07404fa0e2279fcc33621d**. The unchanged original file
  [DECISION_NOTE.authorised-pending.txt](DECISION_NOTE.authorised-pending.txt) is the authority for the text.

> AFLDB-ISSUE-316 / U3 owner-adjudicated correction: Remove only Brayden Fiorini (player_id 2121), Essendon (club_id 6), from match 17214 (2026 round 4, 2026-03-28), canonical row 705437. Inserted by canonical application 20834, AFL API batch 32, on 2026-09-27T21:11:30.460661Z. This is the historical unused-emergency defect adjudicated under AFLDB-ISSUE-255: EMERG, 0% time on ground, all ordinary statistics zero. Retained source payload SHA-256 828744dee7dea294f7afe819508fdc8ba0d38786cf6afc356c7fb5d2af7706a5. The hash-bound J2 AFL Tables baseline omits this appearance, contains the other 23 Essendon participants, and contains Fiorini only in rounds 2 and 3. Preserve originating observations, payload/version, batch and canonical-application history; retain durable removal authority and recompute required derived statistics through the audited Match Sheet workflow. Brownlow 2026 is excluded; U4 remains Route B and the 9,522 round-vote rows remain untouched.

Associated authority **public.data_overrides.id=93** must remain byte-for-byte unchanged, including active status,
identity key, actor, timestamps and override_values {"present":false}. It has **no note/reason column**.
Do not add a reason into its payload: that would change the durable removal decision's representation.

## Why an exceptional repair needs separate approval

Current and deployed UI/action/removal/audit sources agree (hashes retained). The real authenticated Match Sheet
exposes input name=note, labelled “Verification / Audit note (optional)”, in the save form, limit 2,000 characters.
The action trims it and passes it to saveMatchSheet; the required audit insert uses input.note. Blank/missing input
becomes NULL. No removal-specific discard exists in the inspected source. The 967-character note fits the limit.

The authenticated audit history is a reader and has no amendment control. Its one POST form is the shared sign-out
form (the audit route source is read-only); it is not an audit editor. The generic Data Editor allowlists players,
matches and draft_picks, not data_edits. The bounded source scan of src TypeScript files found the central audit
INSERT and SELECT readers, and no supported audit-note repair/append endpoint. Do not use Match Details notes,
Return to source, another Match Sheet Save, or a fabricated ordinary edit to add this note.

The original submitted FormData is unavailable. Chat possession of the note does not prove entry into the field.
The cause remains **unestablished**; neither an application defect nor operator omission is proven. No separate
product issue or regression test is justified by the present evidence. If the operator confirms omission, record a
procedural failure; if reliable evidence establishes accepted nonblank input was lost, register a separate product
issue and extend the closest existing action/integration regression suite before a product fix.

## Proposed transaction and audit mechanism — design, not executable SQL

1. Obtain independent review and a new explicit owner approval for this exact exceptional metadata repair.
   An authorised operator uses a suitably privileged existing role; do not grant UPDATE to the application/import role.
2. In one short transaction, prove the production identity above; take an exclusive row lock on data_edits 94 and
   a shared row lock on data_overrides 93. Compare **every column** to the retained JSON; require note IS NULL,
   the exact single-removal old/new values, original actor/time and authority identity/presence. Any drift aborts.
3. Fill only data_edits 94.note with the exact hash-checked text above. Require exactly one affected row.
   Preserve id, original actor, original created_at, old_values and new_values; never rewrite the removal event's time.
4. In the **same transaction**, append one required data_edits audit row on parent matches / row_id 17214,
   field_group **audit_note_repair**, with the actual approved repair actor and repair timestamp. Its old_values
   records target audit id 94, authority id 93 and note:null; new_values records the same references, exact new note,
   approval/review reference and reason “owner-approved repair of omitted correction decision note”. Its own note
   explicitly identifies this as metadata-only repair and links the approval. Do not pretend this is a second removal.
   The parent matches record is an audit reference only; do not UPDATE matches.
5. Read back both metadata records, assert the write set and every excluded-state fingerprint, then commit exactly once.
   Failed assertions/audit insert abort the whole transaction. After commit, independently SELECT the records and
   excluded-state fingerprints in a fresh read-only transaction. Ambiguity stops for adjudication; never retry blindly.

The application/import role's INSERT-only audit contract is documented in audit-log.ts. This session's backup-role
information_schema privilege listing returned no visible grant rows, so it is **not a complete production ACL audit**.
The implementation review must confirm the executing role and actual grants; no privilege change is proposed.

## Proof of excluded data and verification required by the reviewer

The entire proposed production write set is: **UPDATE one column on audit row 94; INSERT one repair-audit row and its
normal audit ID sequence advance**. There are no canonical, derived or authority DML statements and no calls to
saveMatchSheet, recomputation, triggers, maintenance or source settlement. Catalog inspection found **no user triggers
on data_edits or data_overrides, and no rewrite rules on data_edits**. Confirm those facts afresh before execution.
The foreign key on the new audit actor checks auth_users; it does not update it. This is the structural proof that
canonical and derived data cannot be changed by this bounded transaction, subject to independently reviewing the
actual executable statements and confirming catalog state.

Bind exact before/after fingerprints for audit 94 excluding note, full authority 93, originating application 20834,
match 17214 and its period rows, the affected player-match rows and full affected derived rows, player spans, relevant
club-season rows and Brownlow representations. Reuse accepted canonical-count/key evidence; do **not** launch a census.
Any additional broad read outside the correction contract needs separate scope. Do not expose credentials in evidence.

## Rollback

Before commit: ordinary transaction ROLLBACK restores the NULL note and prevents the repair-audit insertion.
An allocated sequence value may remain consumed; never reset the sequence.
After commit: rollback is a **new separately approved audited metadata transaction**, conditional on row 94.note
still equalling the exact repaired value and all other original fields being unchanged. Restore only note to NULL,
append an audit_note_repair_reversal row linked to the repair and its approval, and retain the repair audit permanently.
Do not delete audit history, change authority 93 or restore Fiorini's appearance. No canonical rollback is relevant.

## Independent review requirement and standing

A reviewer independent of the repair author/executor must check exact identity/guards/value hash, one-row cardinality,
role/ACL, no triggers/rules with side effects, the two-statement metadata write set, mandatory same-transaction audit,
fingerprints, failure handling and rollback. This document is **not** that independent approval and contains no executable
production SQL. After that review, the owner must separately authorise the implementation and execution mechanism.
Alternatively the owner may separately adjudicate the missing note without a repair. Neither has happened here.
U3 remains unconfirmed. U4 Route B; Brownlow untouched. Production NO-GO.
