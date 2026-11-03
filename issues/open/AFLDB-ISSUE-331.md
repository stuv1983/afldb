# AFLDB-ISSUE-331 — current runbook and owner decision packet (prepared 2026-11-03)

**State: OPEN.** Local-isolated-test environment incident. The original disappearance is **cause UNKNOWN, no actor
attributed, uncertainty accepted by the owner (D-331-1, 2026-11-01)**. Two later quarantine breaches (2026-11-01 evening;
2026-11-03) are separate, confirmed events. Authoritative entry: `issues.md` (ISSUE-331). Incident record:
`docs/v2/issue331-incident-assessment-2026-11-01.md` (sections 1-8). This runbook supersedes every "next action" and
"owner decides" statement elsewhere that predates 2026-11-03.

**Prepared against:** local `main` at `cc7b10c4` (GAP-029 closure, published). **Revised 2026-11-04** after the owner's
decisions D-331-6 to D-331-11 (recorded in section 13, which also carries the corrections that override earlier wording
here). As of this revision the Windows-side preservation is done and the retirement sequence is prepared; **the two
`wsl --unregister` commands have not been run** (the owner runs them).

**Boundaries observed in preparing it:** no WSL command of any kind (not even enumeration); no boot, mount, internal
inspection, hashing, copying, export, unregistering or deletion of any quarantined store; no host, database, credential,
service, timer or production operation; frozen P/H/EXEC, backups, `.codex/`, archived source and parked ISSUE-327
untouched. Only repository files were read and edited. No secret was read, printed or written; this document contains
none (hash prefixes and public identifiers only).

---

## 1. Completed versus unresolved

### 1.1 Completed (do not repeat)

| Item | Evidence |
|---|---|
| Bounded read-only assessment; facts F1-F6, hypotheses H1-H3 unproven; cause UNKNOWN | assessment sections 1-3 |
| Owner disposition D-331-1 to D-331-5 (accepted uncertainty; quarantine; unregister deferred; future-test rule; closed) | assessment section 5 (2026-11-01) |
| Recovery environment established and verified (manifest `b32809e8…b033`; fresh credentials on the recovery copy only) | `docs/v2/gap006-release-readiness-2026-11-01.md` "Incident and recovery" |
| Authentic Brownlow inputs re-obtained from DEV and verified (consistent with the record, not a proven historical full-hash match); 8/8 on the final candidate | same document; `docs/v2/evidence/gap006-brownlow-cases-20261101/` |
| **Replacement Linux qualification** on `streamanator` in fresh disposable workspaces (Node v22.23.2, PostgreSQL 16.15 from the host package; workspaces `afldb-v2-qual-20261101T095239Z` at `2134e2fd` and `…T103404Z` at `e0f6c7bc`; local evidence copy `D:\tmp\afldb-qual-linux-20261101\evidence-linux`) | `docs/v2/master-execution-sequence-2026-11-01.md` section 8.2 ("the authorised record"; it replaces 8.1) |
| First quarantine breach recorded (distro used as a Linux host); its results labelled nonconforming-environment results, not release qualification | assessment section 6; master sequence 8.1 banner |
| Second quarantine breach recorded; the "I wrote nothing" claim withdrawn; Windows-side metadata shows the store changed | assessment section 7 |
| Later work (GAP-029 S1-S4, Brownlow, ISSUE-316 closure) used non-quarantined environments; GAP-029 closed and published at `cc7b10c4` | handoffs and `CHANGELOG.md`; no result depends on the quarantined store |
| No executable reference to the quarantined distro: `tools/`, `tests/`, `deploy/` and `package.json` were searched for its name and base directory (both spellings, case-sensitive); nothing found | this preparation |

### 1.2 Unresolved

| # | Item | Class (section 2) | Needs |
|---|---|---|---|
| U1 | Original disappearance, 2026-10-31 session initiator, deleter | accepted uncertainty | nothing (no new lead) |
| U2 | Quarantined distro `AFLDB-V2-Rehearsal-20261020` still exists, boots on any accidental `wsl` use, holds a restored production-derived copy and exposed/unknown credentials | retention; prevention; credentials | decisions D-331-7, D-331-9 |
| U3 | Dangling registration `AFLDB-V2-BrownlowExport-20261028` (base absent) | prevention (hygiene) | decision D-331-8 |
| U4 | Whether to retrieve `/home/rehearsal/qual-evidence-20261101/` | retention | decision D-331-6 (recommend: no) |
| U5 | Credential position: exposed passwords of 2026-10-28 never retired; several unknowns | credentials | decision D-331-10 |
| U6 | No loaded, binding written rule; no technical guard | prevention | decisions D-331-9, optionally A-4 |

---

## 2. What genuinely remains, by class

### A. Accepted uncertainty about the original incident
The disappearance of `secrets/`, `download/` and `dist/` from the isolated root, the removal of the export copy's base, and
the F6 absences remain unattributed. The owner accepted this. **No specific new lead exists.** One speculative lead was
considered and is **not recommended** (section 5): guest-side traces of the 2026-10-31 10:36 session (19.2 GB written).
**Action: none.** It is not a closure condition.

### B. Evidence and sensitive-data retention
What exists, and what each is for:

| Store | What it holds | Evidential value still needed? |
|---|---|---|
| `D:\afldb-v2-rehearsal-20261020\ext4.vhdx` (51,433,701,376 bytes at last read, 2026-11-03 14:53; metadata CHANGED since the earlier record; whether by a start is not established, see section 13.2) | the 2026-10-20 rehearsal distro; production-derived databases (2026-10-20 production restore "with auth tables"; a production backup restored again on 2026-11-01 evening); a new cluster and workspace of 2026-11-01; `/home/rehearsal/qual-evidence-20261101/` | **No.** It is not a baseline (D-331-2); its release-qualification results are superseded (8.2); the template and Brownlow inputs were re-obtained |
| `previous-reviewed.tar` (117,606,400), `v2-reviewed.tar` (207,329,280), `shortcut.ico` in the same base directory | undocumented residue of the 2026-10-20 import (purpose not recorded; presumed import sources); unchanged since 2026-10-20 | **Unknown.** Treat as possibly the only copies, and as potentially sensitive. **Preserved 2026-11-04** in `D:\afldb-retained\issue331-20261104` (section 13.3) |
| `D:\tmp\afldb-v2-pg16` (original isolated root, quarantined) | intact data directory; old role verifiers; `secrets/` is gone | Comparison value only (cold-backup manifest) |
| `D:\tmp\afldb-gap006-recovery-20261101\` (`incident/`, `cold-backup/`, `root/`, `dist-extract/`) | recovery environment and cold backup | Yes: sanctioned by D-331-4 |
| Claude Code transcripts of 2026-10-28 and the model provider's processing | plaintext of the 2026-10-28 disclosure | Session history only |

### C. Prevention of another quarantine breach
Both breaches have the same shape, from their own records: a session wanted a Linux environment, found the registered
distro, and used it. Breach 2's record says it started the distro "to look for a Linux environment". The prohibition
(D-331-2) lives only in `docs/v2/` records and `issues.md`; **`CLAUDE.md` does not mention WSL, the distro or
streamanator-as-the-Linux-target**, and no project `.claude/settings*.json` exists. A fresh session therefore starts with
neither the rule nor the sanctioned alternative. Section 6.

### D. Exposed credentials that may still authenticate anywhere
Inventory in section 4. Conclusion in one line: **the only places the 2026-10-28 exposed passwords are known to
authenticate are verifier copies inside the quarantined distro; the export copy's verifier copy is gone with its disk.**
Whether they authenticate anywhere else is **unverified** (reuse was not compared; generation was
`randomBytes(24)` per cluster). A missing copy does not retire a credential; retiring the last verifier copy does.

---

## 3. Key analytical point: invalidation and evidence deletion cannot be fully separated for the quarantined store

For a PostgreSQL password the only things that make it "authenticate" are verifier copies in live-capable data directories.
For the quarantined distro, the only ways to invalidate its credentials are:

1. **Retire the store** (P-2). Unregistering removes the registered distribution and its accessible disk, and with them the
   verifier copies on that disk. It is **not** secure erasure, **not** a password rotation and **not** proof that the
   credentials authenticate nowhere (reuse, other copies and recoverable deleted bytes are unknown: K-U1, K-U4, K-U7,
   K-U8). It also removes the store as evidence. This is the only path that does not need a start.
2. **Rotate offline inside it.** Needs a boot and a write to the store: forbidden by D-331-2 and contradicts keeping it
   byte-unchanged. (`isolated-pg rotate-credentials` also needs a live listener and the marker rightly refuses it.)
3. **Rotate on a copy.** Leaves the original's verifiers intact; invalidates nothing.

So the packet separates the two **decisions** rather than pretending the mechanisms are independent: D-331-6 settles
whether the store has any evidential value left (recommend: none beyond what is already recorded); D-331-7 then retires
it, which removes the known verifier copies on that disk as a consequence, not as a cleanup. Deleting transcripts is a
third, separate act (D-331-10) and is **not** needed for that: once the known verifier copies are removed, the transcript
plaintext is not known to authenticate anywhere (subject to K-U1, K-U7 and K-U8, which are unknown, not disproved).

---

## 4. Credential inventory (secret-free)

No value, hash of a value, DSN or verifier appears here. "Verifier copy" means PostgreSQL's stored password verifier
(`pg_authid`) in a data directory. Status words: **EVIDENCED** (a record shows it), **NOT EVIDENCED**, **UNKNOWN**.

| ID | Category / accounts | Known copies | Intended environment | Replacement or retirement | Dependencies | Remaining verification or owner action |
|---|---|---|---|---|---|---|
| **K1** | PostgreSQL role passwords of the frozen original's cluster `afldb_v2_isolated`, 127.0.0.1:55434 in netns `afldb-v2-rehearsal`; role set and count **not recorded** in the records read; generated by `isolated-pg` `roles` | verifier copies and `secrets/` inside `ext4.vhdx`; **plaintext disclosed 2026-10-28** (operator session output; transcripts under `C:\Users\stuar\.claude\projects\D--dev-afldbV2\`, most likely `d2922e67-….jsonl`; provider processing) | local workstation only, loopback/netns, stopped distro; neither DEV nor production | **NOT EVIDENCED.** Release-decision package 4.3 proposed containment and rotation; it was never executed. The original was deliberately **left unmarked** (no `CREDENTIALS-EXPOSED` marker) to keep the disk unwritten | none in code (searched). The distro itself | Retire the store (P-2) and verify absence. **UNKNOWN:** whether the cluster auto-starts at boot (no record; neither breach records a cluster start) |
| **K2** | Export copy's cluster, 127.0.0.1:55471: **same** role passwords as K1 | verifier copy was on the copy's disk, which is **deleted** (F3; base absent 2026-11-01 01:29 and again 20:11). Marker `CREDENTIALS-EXPOSED` written 2026-10-28, never re-verified | as K1 | **EVIDENCED as to the live copy:** the file is absent. **NOT EVIDENCED as to residue:** deletion is not secure wipe; recoverability of the disk's bytes from free space on `C:` was not assessed. Registration still exists | none | P-1 (remove the registration). Optional, not prepared: free-space wipe if recoverability matters to the owner |
| **K2b** | Export copy's second cluster, 127.0.0.1:55473, fresh credentials, used for B1 attempt 3 | same (deleted) disk | as K1 | Not exposed per the 2026-10-28 record (separate fresh credentials) | none | none beyond K2 |
| **K3** | Disclosure copies of K1/K2 plaintext (not a credential store) | the 2026-10-28 transcripts; the conversation as processed by the model provider | n/a | Not retired; **not alterable by deletion** for the provider side. Local transcript deletion destroys session history and is the owner's own act | none | **Not required** for invalidation once K1's known verifier copies are removed (section 3). Owner decision D-331-10 |
| **K4** | The six dedicated credentials (five AFLDB roles plus the dedicated superuser) of the Windows isolated root `D:\tmp\afldb-v2-pg16`, rotated 2026-10-20 on ownership-verified 127.0.0.1:55433 (new logins passed, old rejected, `28P01`) | verifier copies in the root's intact `data\`; plaintext was in `secrets\` (deleted 2026-11-01, F4); the rotation record says no credentials were retained in evidence | local workstation, loopback, stopped, quarantined | Rotation **EVIDENCED (2026-10-20)**. Exposure since: **NOT EVIDENCED** (the 2026-10-28 disclosure concerned the WSL clusters). Whether post-rotation plaintext was ever printed: **UNKNOWN** | none | None required. Retained under D-331-2; delete the root when the cold-backup comparison is no longer wanted (D-331-4) |
| **K5** | Cold backup of K4's data | `D:\tmp\afldb-gap006-recovery-20261101\cold-backup\` (manifest `b32809e8…b033`) | local, stopped | as K4 | none | as K4 |
| **K6** | Recovery environment credentials (fresh 2026-11-01, set in single-user mode, no listener) | restricted-ACL directory outside Git; "never printed" per the record | local workstation, loopback; sanctioned environment (D-331-4) | Exposure **NOT EVIDENCED**. ACL and non-disclosure **not re-verified** in this preparation (no filesystem inspection outside the repository was authorised) | Windows rollback/serving probes and any `isolated-pg` flow that uses that root | Optional owner-run ACL read (section 7, P-0 item 5). If ever exposed: `isolated-pg rotate-credentials` (a live listener is allowed there; there is no marker) |
| **K7** | Credentials of the in-distro qualification cluster `/home/rehearsal/qual-pg-20261101`, 127.0.0.1:55490 (2026-11-01), plus the in-distro workspace | inside `ext4.vhdx`; any transcript printing of them is **UNKNOWN** (the breach session's transcript was not read) | inside the quarantined distro | **NOT EVIDENCED**; goes with the registered disk | none | Removed with the registered disk by P-2 (not secure erasure); verify absence |
| **K8** | Streamanator disposable clusters (verification 55464; qualification workspaces under `/mnt/ssd/afldb-v2-qual-*`, including 55493): fresh `roles.json` per cluster | host filesystem, `arm`-owned | DEV host, disposable | The 2026-10-28 record checked 55464's file by name only; exposure **NOT EVIDENCED** for all; not individually examined | none | Out of ISSUE-331. Retention housekeeping stays with the owner (item U15 of the ISSUE-316 readiness decision, not carried by a current issue; see K9) |
| **K9** | ISSUE-316 credential incident (2026-10-23): disposable `afldb_owner`-class passwords of the V3 (:55773) and V4 (:55774) rehearsal clusters, logged by the harness sampler | V3/V4 logs incl. one record in `e8-shutdown.log`; DEV originals mode-700; the three `C:` originals had inherited access, now removed (icacls), hashes unchanged | disposable, stopped, marked `CREDENTIALS-EXPOSED` (tool refuses everything but `stop`/`status`) | Not rotated (U15 "disposable V3/V4 credential rotation", housekeeping). Not reused (V3 ≠ V4; no match with 10 other retained roots or the DEV `.env`, checked 2026-10-24) | none | **Adjacent, separate incident; no action under ISSUE-331.** Listed so it is not mistaken for covered. Owner may fold it into housekeeping |
| **K10** | Production and DEV application/database credentials, `.env` files, SSH keys | n/a | production, DEV | **Not implicated.** No record shows any isolated cluster was ever given them. **Not compared** (that would mean reading secrets). Uniqueness vs the K1/K2 passwords is therefore **unverified**; the only support is random generation | n/a | None. **No production exposure is claimed or inferred** |
| **K11** | Production-derived authentication data in the quarantined store: per migration 023, `auth_users.password_hash` (scrypt) and `auth_users.totp_secret` (plaintext Base32), plus `auth_sessions.token_hash` (sha256, not replayable) and invite/reset token hashes (migrations 030, 040) | present **if** the restores carried populated auth tables (record: "2026-10-20 production restore with auth tables"; production backup restored again 2026-11-01). Contents **unverified** (cannot be inspected). Production backups also exist elsewhere on this workstation (outside this issue) | quarantined distro | n/a — this is data retention, not a leaked credential. Custody evidence: stored on the owner's workstation; **no evidence any unauthorised party read it** | none | Removed with the accessible disk by P-2 for this copy (not secure erasure). A production authenticator reset is a separate production operation; **not recommended on this evidence** (D-331-10) |

### 4.1 Unknowns stated explicitly

- **K-U1.** Whether the 2026-10-28 exposed passwords are reused by any live cluster. Not compared; no evidence of reuse.
- **K-U2.** Whether the K1 cluster starts at distro boot (autostart) — the two breach records bound only file metadata.
- **K-U3.** Whether K7 or post-rotation K4 plaintext was ever printed into a transcript.
- **K-U4.** Residual recoverability of K2's deleted disk bytes.
- **K-U5.** Whether K11's auth rows are populated in the store, and whether production admin passwords or TOTP secrets
  have changed since 2026-10-20.
- **K-U6.** Which unrelated WSL distributions exist on this machine and which is the default. Deliberately **not**
  enumerated here (no WSL command; no registry enumeration of other environments). It matters for section 6 and P-0.
  (2026-11-04 update: a targeted registry read matched the two AFLDB names in memory and printed no other name; it counted
  three registrations in total and found neither target to be the default. The third registration remains unidentified
  by design.)
- **K-U7.** Whether `previous-reviewed.tar`, `v2-reviewed.tar` or `shortcut.ico` contain any credential, verifier or
  production-derived data. Their purpose is undocumented and they were deliberately not opened. Because they are preserved,
  **no assertion is made that every verifier copy was destroyed.**
- **K-U8.** Whether other copies of the K1/K2 passwords or verifiers exist (backups, copies, caches, recoverable deleted
  bytes on any volume). Not assessed.

### 4.2 Registration facts used

Registered name `AFLDB-V2-Rehearsal-20261020`, `HKCU\Software\Microsoft\Windows\CurrentVersion\Lxss\{0cb6e2c4-5caa-4c0b-ba1e-25953010be02}`,
BasePath `D:/afldb-v2-rehearsal-20261020`, Version 2, State 1, default uid 0. Registered name
`AFLDB-V2-BrownlowExport-20261028`, BasePath `\\?\C:\afldb-v2-brownlow-export-20261028` (absent), State 1.

---

## 5. Recommendation: does retrieving evidence from the quarantined distro serve any remaining requirement?

**No. Recommend D-331-6: waive the export; make retirement independent of it.**

1. **Qualification evidence.** `/home/rehearsal/qual-evidence-20261101/` came from a nonconforming environment. It cannot be
   cited by any approval (master sequence 8.1 banner). It is replaced by section 8.2, retained on `streamanator`
   and copied to `D:\tmp\afldb-qual-linux-20261101\evidence-linux`. The headline results (typecheck, 557 focused tests,
   C4b 36/36, labels 24/24) and the fixes it found are already committed in `CHANGELOG.md`, the master sequence and
   commit messages. The files add nothing a reviewer may use.
2. **Incident evidence.** The breach is established by committed records, not by guest contents. The disappearance (Windows
   side) cannot be shown by anything inside an ext4 guest.
3. **The one speculative lead.** The 2026-10-31 10:36 session wrote 19.2 GB into the original; guest shell history, journal
   or `wtmp` might name what ran. Against pursuing it: the owner accepted the uncertainty; the store's Windows-side
   metadata has changed since (breach 1 used it as a Linux host; breach 2 is evidenced only as a metadata change, section
   13.2), and any start would churn journal replay, `wtmp`, logs and caches; reading it needs either a boot (a third
   breach) or a copy of a 51 GB store plus a no-journal read-only mount on the copy (a new, larger sensitive-data copy
   and two new WSL commands); the best case is a process name, not an actor. **Not recommended.** If the owner nevertheless
   wants it, it needs a fresh, separately written procedure and approval (not prepared here; it is not "genuinely
   necessary").
4. **Cost and risk of exporting.** It creates a second copy of a production-derived store with unknown contents and
   exposed credentials, and an owner-run boot would be a further write to a store whose quarantine rule exists to stop
   writes.
5. **Therefore** no export is a prerequisite for retirement or for closure. The one cheap thing worth keeping is the
   Windows-side metadata of the final state, taken by P-0 immediately before retirement (no hashing; D-331-2).

---

## 6. Preventing another accidental use

### 6.1 Written prohibition (policy; enforces nothing by itself)

- **W1 (recommended, needs owner approval because it changes the binding contract):** add the section below to
  `CLAUDE.md` (AFLDB part, after §11). Its purpose is to put both the rule and the sanctioned alternative into every
  session's context. Exact text:

  > ## Quarantined local stores (ISSUE-331)
  > The WSL distribution `AFLDB-V2-Rehearsal-20261020` (registry GUID `{0cb6e2c4-5caa-4c0b-ba1e-25953010be02}`, base
  > `D:/afldb-v2-rehearsal-20261020`), the stale registration `AFLDB-V2-BrownlowExport-20261028` and the original isolated
  > root `D:\tmp\afldb-v2-pg16` are quarantined (D-331-2). Never start, enter, mount, hash, copy, export, unregister or
  > delete them, never open them through `\\wsl$\…` or `\\wsl.localhost\…`, and never run a `wsl` command to "look for a
  > Linux environment". Linux for tests is the DEV host `streamanator` (fresh disposable workspaces, no sudo, per
  > `docs/v2/master-execution-sequence-2026-11-01.md` section 8.2). If that is unavailable, stop and ask. Only the owner
  > changes this section. Record: `issues/open/AFLDB-ISSUE-331.md`.

  After P-2 is carried out, the same section is rewritten in the past tense ("retired on <date>") and the prohibition
  reduces to "never re-import or re-register a distribution with these names".
- **W2 (optional):** a short Claude auto-memory note restating W1. Weaker than W1 (per-user, per-machine); listed for
  completeness. Not written in this preparation.

### 6.2 Technical enforcement (distinct from W1; each states its reach)

| ID | Mechanism | Reach | Preserves unrelated environments? | Established? |
|---|---|---|---|---|
| **T0** | **Retirement (P-2)**: the registration and disk no longer exist | everything: Claude, Codex, the owner, Explorer's "Linux" entry, shortcuts | n/a (only the quarantined item goes) | Mechanism established; effect on the two residue tarballs is **not** (P-2 step 3) |
| **T1** | A name-scoped Claude Code `PreToolUse` hook (draft in section 6.3): blocks tool calls that combine the distro's name, GUID or base path with a WSL/Hyper-V/hash/copy/delete verb, or name it through a `\\wsl$` / `\\wsl.localhost` path | Claude Code sessions in this project only | **Yes**, by construction: it keys on the distro's own identifiers, not on `wsl` as such | **No.** Unexecuted and unreviewed; the first step is a harmless `echo`-test |
| **T2** | NTFS ACL deny on `ext4.vhdx`, or the read-only attribute | any process incl. WSL | yes | **No.** What WSL does when it cannot open the disk is not established, and changing a quarantined file's security descriptor is itself a change to the store. **Not prepared.** Would need a test on a throwaway distro first (owner-run) |
| **T3** | Blanket `deny` for `Bash(wsl*)` / `PowerShell(wsl*)` | Claude Code only | **No** — blocks unrelated distributions | Rejected |
| **T4** | Make an unrelated distro the WSL default | bare `wsl <cmd>` and `wsl` with no `-d` | changes the default for everything | Only if P-0 shows the quarantined distro **is** the default; owner's decision then |

**Honest limits of T1.** It is an accident guard, not a security boundary: variable indirection (`wsl -d $d`), a script
that reads the name from a file, `wsl` with no `-d` when the quarantined distro is the default, other agents (Codex), the
owner's own shells, Windows Terminal profiles and Explorer's Linux entry are all outside it. T0 is the only measure that
closes those.

**Recommendation:** adopt W1 and T0. Install T1 **only if** retirement is deferred (D-331-7 "not yet"), as a stopgap.

### 6.3 Draft T1 (NOT installed, NOT executed, NOT syntax-checked)

`.claude/settings.json` (new file) and `.claude/hooks/quarantine-guard.mjs` (new file). Install only after approval A-4,
read it first, and test with `echo`:

```json
{ "hooks": { "PreToolUse": [ { "matcher": "Bash|PowerShell|Read|Glob|Grep|Edit|Write",
  "hooks": [ { "type": "command", "command": "node .claude/hooks/quarantine-guard.mjs" } ] } ] } }
```

```js
// Accident guard for the ISSUE-331 quarantined stores. Not a security boundary.
import { readFileSync } from 'node:fs';
let input; try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }
const tool = String(input.tool_name || ''); const ti = input.tool_input || {};
const norm = (s) => s.toLowerCase().replace(/\\/g, '/');
const ID = /afldb-v2-rehearsal-20261020|0cb6e2c4-5caa-4c0b-ba1e-25953010be02|afldb-v2-brownlowexport-20261028/;
const UNC = /\/\/wsl(\$|\.localhost)\/afldb-v2-(rehearsal|brownlowexport)/;
const VERB = /\bwsl(\.exe)?\b|mount-vhd|mount-diskimage|get-filehash|certutil|sha\d*sum|copy-item|\bcp\b|move-item|\bmv\b|remove-item|\brm\b|robocopy|xcopy/;
let hit = false;
if (tool === 'Bash' || tool === 'PowerShell') {
  const cmd = norm(String(ti.command || ''));
  hit = UNC.test(cmd) || (ID.test(cmd) && VERB.test(cmd));
} else {
  const paths = norm([ti.file_path, ti.path, ti.glob].filter((x) => typeof x === 'string').join('\n'));
  hit = UNC.test(paths) || ID.test(paths);
}
if (hit) { console.error('Blocked by ISSUE-331: quarantined store. Ask the owner (issues/open/AFLDB-ISSUE-331.md).'); process.exit(2); }
process.exit(0);
```

Known weaknesses to review before installing: the verb list is a heuristic and can over- or under-match; read tools are
blocked on anything under the quarantined base directory, including the two residue tarballs; exit code 2 as "block"
and the `matcher` syntax must be confirmed against the installed Claude Code version. Test commands (these only print text, they start nothing): an `echo` of a `wsl -d <quarantined name>`
string must be blocked; an `echo` of `wsl -d SomeOtherName` must not.

---

## 7. Procedures (all owner-run; Claude edits only repository files afterwards)

Per `CLAUDE.md` §9 the owner executes shell commands. A command is given only where its target and effect are
established; otherwise the step says "not prepared".

### P-0 — Read-only pre-check and final metadata snapshot (owner, PowerShell)

- **Target:** Windows-side metadata of the two registrations and the quarantined base directory. No distro is started.
  No hashing.
- **Prerequisites:** none. Do it immediately before P-1/P-2, and again after, in the same console.
- **Commands (each read-only):**
  1. `$g='{0cb6e2c4-5caa-4c0b-ba1e-25953010be02}'; Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss\$g" | Select-Object DistributionName,BasePath,State,Version`
  2. `Get-ChildItem 'D:\afldb-v2-rehearsal-20261020' -Force | Select-Object Name,Length,LastWriteTime`
  3. `Get-Process wsl,wslhost,vmmem,vmmemWSL,vmwp -ErrorAction SilentlyContinue | Select-Object Name,Id` (expect no output; `wslservice` alone is normal)
  4. `Test-Path 'C:\afldb-v2-brownlow-export-20261028'` (expect `False`)
  5. Optional (K6): `icacls` on the recovery environment's secrets directory, read-only, to confirm it is still restricted to the owner. The directory is the restricted-ACL one named in the recovery
     records (its path is deliberately not repeated here; this preparation did not open `PROVENANCE.txt`).
  6. `wsl --list --verbose` — enumerates registrations, states and the default (shown as `*`). It does not start a distribution. It is the owner's act, not Claude's (K-U6).
- **Expected:** registration present with the recorded BasePath, State 1; `ext4.vhdx` no smaller than 51,433,701,376 bytes with a last write at or after 2026-11-03 12:59:20 (a later write means changed metadata, not necessarily a start, and no initiator is inferred from it: report it, and do not proceed to P-2 until it is recorded); no WSL processes; the export base absent; the default distro identified.
- **Service implications:** none. **Recovery limits:** not applicable (no change).
- **Verification:** the owner pastes the output; Claude records it without echoing more than the figures.

### P-1 — Remove the dangling `AFLDB-V2-BrownlowExport-20261028` registration (decision D-331-8)

- **Target:** exactly that registration (BasePath `\\?\C:\afldb-v2-brownlow-export-20261028`, absent on disk).
- **Scope:** the registration key only. Nothing on disk exists to delete.
- **Prerequisites:** P-0 items 3 and 4 as expected; D-331-8 recorded by the owner.
- **Command:** `wsl --unregister AFLDB-V2-BrownlowExport-20261028`
- **Expected result:** exit 0 and the registry key for that name disappears. **Not established:** whether `--unregister`
  succeeds when the disk file is already missing. If it errors, stop and report the exact message. **No registry
  hand-edit procedure is prepared** (effect not established).
- **Verification (read-only):** `Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss' | ForEach-Object { $p = Get-ItemProperty $_.PSPath; [pscustomobject]@{Key=$_.PSChildName;Name=$p.DistributionName;Base=$p.BasePath} }` shows no row with that name and still shows the quarantined original's row.
- **Service implications:** none; no distribution runs; other registrations untouched.
- **Recovery limits:** nothing of value is lost (disk and credentials already gone). Re-creating it would need a new import.
- **Credential effect:** removes the last trace of K2 as a registration. K2's verifier copy was already gone with the disk;
  K-U4 (recoverability from free space) is unchanged.

### P-2 — Retire the quarantined original `AFLDB-V2-Rehearsal-20261020` (decision D-331-7; irreversible)

- **Target:** that registration, GUID `{0cb6e2c4-5caa-4c0b-ba1e-25953010be02}`, BasePath `D:/afldb-v2-rehearsal-20261020`,
  and its `ext4.vhdx`.
- **Scope:** one registration and one disk. **Not** the Windows isolated root, the recovery directory, the transcripts,
  `streamanator` or any production/DEV item. Removal of the known verifier copies (K1, K7) and of the store's contents
  (K11 copy) on the accessible disk happens together by nature (section 3); that is why D-331-6 is decided first.
- **Prerequisites (all must hold):**
  1. D-331-6 and D-331-7 recorded; P-0 clean and its output saved (this is the final metadata snapshot).
  2. No WSL process running; nothing else uses the distro (searched: no tool, test or deploy file references it).
  3. **Residue tarballs.** `previous-reviewed.tar`, `v2-reviewed.tar` and `shortcut.ico` live in the same base directory.
     What `--unregister` does to non-disk files in BasePath is **not established**, and their purpose is unrecorded
     (possibly archived source). **Discrepancy found and resolved 2026-11-04:** the original step named three loose files
     but its `Move-Item` covered only two (`shortcut.ico` was omitted). All three were preserved by the owner-authorised
     Windows-side preparation described in section 13.3 (same-volume move, hashes before and after, owner-restricted
     directory), and the guarded sequence in section 13.4 re-verifies all three before it unregisters anything.
  4. If the owner prefers to retain the store as evidence instead: stop; use section 6.2 T1 as a stopgap and record
     the residual exposure (closure path B, section 9).
- **Command:** `wsl --unregister AFLDB-V2-Rehearsal-20261020`
- **Expected result:** the registration key `{0cb6e2c4-…}` is removed; `ext4.vhdx` is deleted from
  `D:\afldb-v2-rehearsal-20261020`. Free space on `D:` will probably rise, but that is **informational only and not a pass
  criterion** (it need not rise by the VHDX's logical length). The base directory may or may not remain; either is
  acceptable. No deletion of the directory is part of this procedure.
- **Verification (read-only):** (a) registry key absent, `Test-Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss\{0cb6e2c4-5caa-4c0b-ba1e-25953010be02}"` is `False`; (b) `Test-Path 'D:\afldb-v2-rehearsal-20261020\ext4.vhdx'` is `False`; (c) the preserved files exist with the recorded lengths and SHA-256; (d) no WSL processes; (e) the P-1 registry listing no longer shows the name. (The earlier item (f), "free space rose by about the VHDX size", is **withdrawn** as a success criterion; free space is reported for information only.)
- **Service implications:** none for the repository, DEV or production; other distributions untouched; `wslservice` keeps
  running. A leftover Explorer/Start-menu shortcut (suggested by `shortcut.ico`) may remain; harmless.
- **Recovery limits:** **none.** No other copy of the store is known (the owner declined the backup/export route). The
  deleted bytes are not securely wiped and may remain in `D:` free space until overwritten (K-U4); if irretrievability
  matters, a free-space wipe is a separate operation, **not prepared** (slow, volume-wide, effect on other tooling not
  assessed).
- **Credential effect (record only after verification):** K1, K7 and the K11 copy on the accessible disk move from
  "verifier/data copy exists in a quarantined store" to "registered distribution and accessible disk removed (evidence:
  owner-run output a-e)". This is **not** secure erasure, password rotation or proof of global invalidation. Password
  reuse, other copies and recoverable deleted bytes stay **unknown** (K-U1, K-U4, K-U8), and the preserved, unexamined
  tarballs (K-U7) mean no claim is made that every verifier copy was destroyed. K3 (transcripts, provider) is unchanged;
  it is recorded as "not known to authenticate anywhere", not as "invalid" or "unique".

### P-3 — Written prohibition (decision D-331-9)
Claude edits `CLAUDE.md` with the exact text of W1 after approval, commits locally, no push. No shell effect.

### P-4 — Interim technical guard (approval A-4; conditional on D-331-7 = "not yet")
Claude creates the two files of section 6.3 after the owner has reviewed them, commits locally, no push. Test with `echo`.
Remove when P-2 is done.

### Not prepared (no genuine necessity, or effect not established)
- Evidence export/boot/copy of the quarantined distro (section 5).
- ACL/read-only attribute on `ext4.vhdx` (T2).
- Deleting the Windows isolated root, the cold backup or the recovery directory (retention decision, D-331-4; not a closure condition).
- Deleting or redacting transcripts (owner's own act, D-331-10).
- Free-space wiping; V3/V4 credential rotation (K9); any production or DEV operation; `streamanator` cleanup (K8).

---

## 8. Recommended owner decisions (proposed; none recorded)

| ID | Question | Recommendation | Why |
|---|---|---|---|
| **D-331-6** | Is retrieving evidence from the quarantined distro required before retiring it? | **No. Waive.** | Section 5: nothing in it is citable, the replacement qualification is complete, and a boot/copy adds risk and sensitive copies |
| **D-331-7** | Retire the quarantined original (P-2)? | **Yes, after P-0 and the tarball move.** | It is the only measure that stops a third breach for all actors, removes the last known verifier copies on the accessible disk (not proof the passwords authenticate nowhere), and removes a production-derived store. Lifts D-331-3's deferral **for this registration only** |
| **D-331-8** | Unregister the dangling export registration (P-1)? | **Yes.** | No disk; removes a misleading entry. Lifts D-331-3's deferral for this registration only |
| **D-331-9** | Adopt the written rule W1 in `CLAUDE.md`? | **Yes.** Install T1 only if D-331-7 is "not yet" | Both breaches lacked the rule and the sanctioned alternative in context |
| **D-331-10** | Accept the credential position (section 4) and the listed non-actions? | **Yes**: no production exposure is claimed; the unknowns K-U1 to K-U6 are accepted as stated; transcripts are left alone; the Windows isolated root and cold backup stay quarantined; K9 stays housekeeping; no production authenticator action | Each non-action either has no evidence behind it or does not change what can authenticate |
| **D-331-11** | Close ISSUE-331 on the conditions of section 9? | **Yes**, once D-331-6 to D-331-10 are recorded and the chosen operations verified | Everything else is either done or accepted |

---

## 9. Closure conditions

**Path A (recommended: retire).** Close when all hold:
1. D-331-6 to D-331-10 recorded by the owner, in the owner's words, in the assessment record.
2. P-1 and P-2 carried out by the owner and verified (P-2 checks a-f); outcome and the owner's pasted evidence summarised in the assessment record; K1, K2, K7, K11 rows updated by Claude from that evidence.
3. W1 adopted (or the owner records that it is declined).
4. The unknowns K-U1 to K-U6 are listed in the closing record as accepted, not as resolved.
5. `issues.md`, `IssuesIndex.md` and the Open Issues table are synchronised and the entry states: cause UNKNOWN, accepted; retention and prevention actions done; credentials: the registered distribution and its accessible disk (the known verifier copies) removed; this is not secure erasure, rotation or proof of global invalidation; plaintext remains in transcripts and provider processing; reuse, other copies, recoverable bytes and the contents of the preserved tarballs unknown; uniqueness not claimed.
6. No further breach recorded between decision and closure.

**Path B (retain the store).** Close when instead: the owner records D-331-7 = "retain", accepts K1/K7/K11 as **present and inert while stopped** (exposed, not retired), W1 is adopted, T1 is installed and tested, and the residual is written into the closing record verbatim. This path does **not** retire any credential and must not be worded as if it did.

**Not closure conditions:** an export; establishing the cause or actor; deleting transcripts; deleting the Windows isolated root or recovery directory; V3/V4 rotation (K9); any production or DEV action; secure wiping.

---

## 10. Approval text (paste to decide; edit nothing except to strike what you withhold)

**A-1 — decisions and the two unregistrations (Path A):**

```text
ISSUE-331 decisions (owner, <date>):
D-331-6: Do not retrieve evidence from AFLDB-V2-Rehearsal-20261020. Retirement does not depend on an export.
D-331-7: Retire AFLDB-V2-Rehearsal-20261020 by wsl --unregister, which I will run myself after the pre-check and after
  moving previous-reviewed.tar and v2-reviewed.tar out of its base directory. This lifts D-331-3's deferral for this
  registration only. I understand it is irreversible and that deleted bytes are not securely wiped.
D-331-8: Remove the stale registration AFLDB-V2-BrownlowExport-20261028 by wsl --unregister, which I will run myself.
  This lifts D-331-3's deferral for this registration only.
Claude records my pasted pre-check and verification output in the assessment record and updates the credential
inventory rows K1, K2, K7, K11 from it. No other store, host, database, credential, service or production item is
covered. I run every command; Claude runs no WSL command.
```

**A-2 — written rule:**

```text
D-331-9: Add the "Quarantined local stores (ISSUE-331)" section from issues/open/AFLDB-ISSUE-331.md section 6.1 to
CLAUDE.md exactly as written. Claude may make that edit and commit it locally; no push.
```

**A-3 — credential position and non-actions:**

```text
D-331-10: I accept the credential inventory in issues/open/AFLDB-ISSUE-331.md section 4 with unknowns K-U1 to K-U6 as
stated. I do not claim or infer production or DEV credential exposure. I leave the 2026-10-28 transcripts as they are, keep
D:\tmp\afldb-v2-pg16 and the cold backup quarantined, and leave K9 (V3/V4) to housekeeping. No rotation, deletion or
production action is requested under this decision.
```

**A-4 — interim guard (only if D-331-7 is "not yet"):**

```text
Install the quarantine guard hook from issues/open/AFLDB-ISSUE-331.md section 6.3 after I have reviewed it. Claude creates
.claude/settings.json and .claude/hooks/quarantine-guard.mjs, tests it with echo-only commands, and commits locally;
no push. The hook is removed when AFLDB-V2-Rehearsal-20261020 is retired.
```

**A-5 — closure (after A-1 to A-3 are carried out and verified):**

```text
D-331-11: Close ISSUE-331 under Path A of issues/open/AFLDB-ISSUE-331.md section 9, with the original disappearance
recorded as cause UNKNOWN, accepted. Move this runbook to issues/closed/ and synchronise issues.md, IssuesIndex.md and
the Open Issues table.
```

---

## 11. Record discrepancies found while preparing this (not resolved; not material to the decisions)

1. The incident record gives the isolated root's postmaster as `127.0.0.1:55432`; the rotation and visual-review records
   say the root's cluster is `127.0.0.1:55433` and that 55432 is an SSH tunnel to DEV that must never be used. One is a
   typo; which was not determined. It does not change any decision here.
2. The ISSUE-316 readiness decision lists the V3/V4 credential rotation as U15 housekeeping, but ISSUE-316 is resolved and
   ISSUE-332 does not carry U15. It is currently owned by no issue (K9).
3. Role counts for the WSL clusters (K1, K2) are not recorded in the records read.

## 12. Preserved and untouched

Frozen P/H/EXEC, backups, `.codex/`, archived source, parked ISSUE-327, every quarantined store, the recovery and
Brownlow-artefact directories, transcripts, and all production/DEV items. Local `main` was `cc7b10c4` at the start; the
only changes are the documentation files listed in the commit that carries this runbook. Nothing is pushed.

---

## 13. Owner decisions and corrections (2026-11-04)

### 13.1 Decisions recorded (owner, 2026-11-04)

| ID | Decision (owner's words, condensed) |
|---|---|
| **D-331-6** | No retrieval of evidence from inside the quarantined distro is required. Replacement qualification is complete. |
| **D-331-7** | Retire `AFLDB-V2-Rehearsal-20261020` after verified preservation and preflight. The owner understands unregistering irreversibly removes its data. |
| **D-331-8** | Remove the dangling `AFLDB-V2-BrownlowExport-20261028` registration, subject to freshly verified identity and an absent base directory. |
| **D-331-9** | Add the quarantine rule and the sanctioned Linux alternative to both `CLAUDE.md` and `AGENTS.md`. Keep the original Windows isolated root quarantined after WSL retirement. No hook installation (T1/A-4 not adopted). |
| **D-331-10** | Accept the listed credential unknowns as unresolved residuals. No production or DEV exposure is inferred, and no production credential operation is authorised. |
| **D-331-11** | Conditional closure authorised only after the owner's retirement output is verified and the corrected closure conditions are satisfied. |

### 13.2 Corrections to this packet (override any earlier wording above)

1. **What unregistering is.** `wsl --unregister` removes the registered distribution and its accessible disk. It is **not**
   secure erasure, **not** a password rotation and **not** proof of global credential invalidation.
2. **What stays unknown.** Password reuse (K-U1), other copies (K-U8) and recoverable deleted bytes (K-U4) are explicitly
   unknown. The three undocumented loose files are treated as potentially sensitive; because they are preserved, **no
   assertion may be made that every verifier copy was destroyed** (K-U7).
3. **Metadata is not an initiator.** A later write to `ext4.vhdx` establishes changed file metadata, not necessarily another
   boot, and no initiator is inferred. The assessment record's section 7 heading ("was started again") should be read with
   this in mind; its own evidence is the metadata change.
4. **No free-space criterion.** Free space on `D:` is not required to rise by the VHDX's full logical length, and no free-space
   figure is a success criterion. It is reported for information only.
5. **Preservation discrepancy resolved.** P-2 step 3 named three loose files but its `Move-Item` covered two. All three are
   covered by section 13.3.

### 13.3 Windows-side preparation (owner-authorised, executed 2026-11-04; no WSL command, `ext4.vhdx` not read, hashed, copied or mounted)

- **Prechecks (metadata and registry only).** Base directory `D:\afldb-v2-rehearsal-20261020` is a plain directory (no reparse
  point) holding `ext4.vhdx` (51,433,701,376 bytes, last write 2026-11-03 12:59:20 local, identical to the last record),
  the three loose files and nothing else. A one-off attributes-only exclusive open of `ext4.vhdx` succeeded (no data access), but that is **not relied on** and does not establish the disk is unused. `wsl.exe`/`wslhost` were not running; `vmmem` and `vmwp` were running and are **neither attributed to nor excluded from** this distribution. Running state is established only by the owner-run `wsl.exe --list --running --quiet` inside the script (section 13.4). Registry: three registrations in total; the two named targets matched by name in memory, no other
  name printed. `AFLDB-V2-Rehearsal-20261020` is `{0cb6e2c4-5caa-4c0b-ba1e-25953010be02}`, BasePath `D:/afldb-v2-rehearsal-20261020`,
  State 1, Version 2, not the default. `AFLDB-V2-BrownlowExport-20261028` is `{5d15f6f7-e202-48ea-883c-bd02b63bc84a}`, BasePath
  `\\?\C:\afldb-v2-brownlow-export-20261028` (absent on disk), State 1, Version 2, not the default.
  `D:` had 78,145,851,392 bytes free before.
- **Preservation.** Resolved paths confirmed, no reparse redirection, destination absent. SHA-256 recorded before the move, then
  a same-volume `Move-Item` (no `-Force`, no overwrite, no deletion), then SHA-256, length and last-write time re-checked: all
  three match. Archives were not extracted and no contents were printed.

  | File | Length | SHA-256 (before = after) |
  |---|---|---|
  | `previous-reviewed.tar` | 117,606,400 | `01305E34510AE60BBB3259542BF9B643185E440D54192D2A7435D6C620A5494B` |
  | `v2-reviewed.tar` | 207,329,280 | `60401CEC49F044D2EACC308DB8ADBF2523D44F0EA0D5376A5F07A6457E87EBB3` |
  | `shortcut.ico` | 5,430 | `E2FBBE078F5CECB21DAFA968CE3B4012F6F8C99752AAEDC1225100D6DF21293B` |

  Destination `D:\afldb-retained\issue331-20261104` (and its new parent `D:\afldb-retained`): inheritance removed, full control
  for the owner account only. The three files had inherited ACLs (SYSTEM, Administrators, owner); an ACL-only `icacls /reset`
  made them inherit the restricted directory's ACL (owner only). Content untouched. Remaining in the base directory:
  `ext4.vhdx` only.

### 13.4 Guarded retirement script (owner runs it; Claude runs no WSL command)

**File:** `issues/open/AFLDB-ISSUE-331-retire-wsl.ps1` (11,671 bytes, LF, ASCII). **SHA-256:**
`00E30792384F6F115F6BDBFC91ED7CFD87CA0B9A23B385E3895C26935FFA3020`. This runbook no longer embeds the script; the file is
the single source (a copy here would drift). Revision 2 (2026-11-04) replaces the first draft, which is withdrawn.

**What it runs against WSL, and nothing else:** `wsl.exe --list --running --quiet` (read-only; authorised only when the owner
runs this script) and `wsl.exe --unregister <exact target name>` at most twice, once per target, never retried. It never
stops, terminates or shuts down any distribution, and never repairs the registry or deletes anything else. `$WslExe` is
`%SystemRoot%\System32\wsl.exe`.

**Running-state gate (revision 2).** The earlier exclusive-open probe and the inference about `vmmem`/`vmwp` are removed.
The query's output is captured privately (never printed), the native exit code is checked immediately, the output must be
a plain list of distribution names (anything else is ambiguous), and both exact target names must be absent
(case-insensitive). Failure of any kind stops the script. Unrelated names are never printed (only a count). The extra
conservative `wsl`/`wslhost` process check is kept. Fail-closed consequence to expect: if this WSL version prints prose
such as "There are no running distributions." under `--quiet`, the script stops as ambiguous and nothing is changed.

**Gates** (registrations by name, GUID, BasePath, State 1, Version 2 and total count; neither target the default; export base
absent; `ext4.vhdx` at its pinned length and last-write, not a reparse point, and the sole item in the base directory; the
three preserved files re-hashed; running state) are run: at the start, after the typed `RETIRE` confirmation, and immediately
before **each** unregister. Before P-2 the pinned VHDX identity and sole-file condition are required again, and the export
registration must be gone.

**Failure handling.** On any failure it prints `STOPPED`, a `STATE:` line giving the exact P-1 and P-2 outcomes
(`not run`, `succeeded`, `FAILED (exit N)`, `attempted, outcome not confirmed`, ...), a `PARTIAL:` line when P-1 succeeded and P-2
did not (or when P-2 returned 0 but verification failed), and a read-only state snapshot, then exits **1**. It does not retry
or repair. Success exits 0 after verifying: both keys absent and no other registration removed, `ext4.vhdx` absent, the
preserved files re-hashed. Free space is informational only.

**Mocked-native tests** (`issues/open/AFLDB-ISSUE-331-retire-wsl.tests.ps1`, SHA-256
`B85EA160468AF7AC4AFFBAD5432D31479ABB43F560D2015BA6BBE3F6C775F07F`): a compiled fake `wsl.exe`, a scratch registry key and
scratch files; the real `wsl.exe` was never run and nothing real was unregistered, started, moved or deleted. The script
text under test is byte-identical to the production file outside its `#region constants` block. Result 2026-11-04:
**16 of 16 passed.** Cases: success (4 queries, export then original, only the unrelated registration left); dry run;
original running (with an unrelated distro, whose name is not printed); export running; target running with different
case; unrelated distros only (proceeds, names not printed); query exit 5; malformed output (prose; junk); registry identity
changed after confirmation; VHDX length changed after confirmation; P-1 fails (P-2 not run); P-2 fails after P-1 succeeded
(`PARTIAL`, exit 1); sole-file condition broken after P-1; VHDX length changed after P-1; confirmation declined. Every case
asserted that the only native calls were the two permitted shapes and only against the two target names. A separate dry run of
the production constants against the real registry, paths and hashes, with only `$WslExe` pointed at the fake, passed every
gate (no real WSL call). **Not tested:** the real `wsl.exe`'s output format and exit codes.

**Owner invocation** (verifies the hash, then runs; add `-DryRun` for gates only):

```powershell
$f='D:\dev\afldb\issues\open\AFLDB-ISSUE-331-retire-wsl.ps1'; if ((Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash -eq '00E30792384F6F115F6BDBFC91ED7CFD87CA0B9A23B385E3895C26935FFA3020') { & $f } else { 'HASH MISMATCH - do not run' }
```

Expected success: the gate blocks pass, you type `RETIRE`, then `OK P-1`, the gates again, `OK registry: both targets absent;
registrations 3 -> 1; no other registration removed`, `OK ext4.vhdx absent`, `OK preserved ...`, and the last line
`RESULT: RETIRED, all checks passed` (exit 0). Anything else ends in `RESULT: STOPPED (exit 1)` with the state.
### 13.5 After the owner's output (not yet done)

Verify the pasted output; update K1, K2, K7 and K11 and section 4.2 with precisely evidenced wording; rewrite the `CLAUDE.md`
and `AGENTS.md` section in the past tense; record the closing facts in the assessment record; close ISSUE-331 under the accepted
residuals (K-U1 to K-U8); move this runbook to `issues/closed/`; synchronise `issues.md`, `IssuesIndex.md` and the Open Issues
table; add a `CHANGELOG.md` entry; commit locally (no push). If the output shows a STOPPED result, none of that happens: report and
stop.
