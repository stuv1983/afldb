# Workstation hook remediation (V2-GAP-004, RISK-05) — 2026-10-19, Launch F

Evidence for the fix of the user-level Claude Code hook that created the stray
`D:\dev\afldb-afl-api-cutover\supplies`. The hook lives outside this repository
(`C:\Users\<user>\.claude\`); only the evidence and copies of the two new files are committed
here. No secret or unrelated setting is reproduced.

## 1. Root cause (reproduced, not inferred)

The five hook entries in the user `settings.json` (PreToolUse `Grep|Glob`, PostToolUse `Read`,
SessionStart `startup|resume|clear|compact`, SubagentStart `*`) all ran:

```text
cmd.exe /d /v:off /s /c '""%USERPROFILE%\.claude\hooks\cbm-<name>.cmd""'
```

Claude Code runs Windows hook commands through Git Bash. MSYS argument conversion rewrites the
POSIX-looking switches `/d`, `/s` and `/c` into drive paths, so `cmd.exe` never received `/c`: it
started **interactively** and read the hook's JSON stdin as **command lines**. The `.cmd` adapters
were never reached. Every `>`, `>>`, `<`, `|`, `&`, `&&`, `||` and `"` toggle in the payload (the
tool input; for PostToolUse `Read`, the whole file content) was parsed as cmd syntax in the
session's working directory. Interactive cmd also splits input longer than 8191 bytes, so the
remainder of a long payload ran as a second, independent command line.

Reproduction (scratch directories only, no repository or source-worktree path):

| Step | Result |
|---|---|
| `echo 'echo INJECTED> marker.txt' \| cmd.exe /d /v:off /s /c '""echo hi""'` from Git Bash | cmd banner printed, `marker.txt` created: stdin executed |
| Same with `MSYS_NO_PATHCONV=1` | no banner, no file |
| `notacommand foo > alpha > beta > gamma` through interactive cmd | only `gamma` created: cmd opens only the LAST stdout redirection target |
| The recorded payload that preceded the stray file, split at 8191 bytes, second chunk replayed through the old command | exactly one 0-byte file named `supplies` created |

The creating event, from the source session's transcripts: at 2026-10-19 09:18:47 +11:00 (UTC
22:18:47 on 10-18) the Launch A plan reviewer, working in the source worktree, ran
`Read docs/v2/evidence/baseline-failures.txt`. The PostToolUse hook's recorded stdout (written
09:18:47.733) shows the payload echoed as two command lines (8191 bytes, then 5134 bytes); the
stray file's birth time is 09:18:47.725. The file's last line is
`FAIL  tests/site-settings.test.ts > parseSiteSettings > supplies every default from an empty table`;
in the second command line, `> supplies` was the last unquoted stdout redirection, so cmd created
`supplies` (empty, because the "command" failed and wrote only to stderr).

The same hazard ran in every session that used these hooks, including the start of Launch F (four
interactive-cmd runs in `D:\dev\afldbV2` before the fix; `git status --ignored` showed no stray
file afterwards).

## 2. Fix

Before editing, a timestamped recoverable backup was made:
`C:\Users\<user>\.claude\backups\hook-remediation-20261019T161406\` (`settings.json` and the three
`.cmd` adapters, sha256 verified equal to the originals).

| File | sha256 before | sha256 after |
|---|---|---|
| `settings.json` | `16d365d1aef0b9cc6a6d43d6277ffaf2683431d12f3dd5d8fe081fe70759f504` | `0caeb42664f85678f0a5e4a3be9dd8f01af7d0be0ee98f60a1aaf21b3be31ce6` |
| `hooks/cbm-hook-runner.js` (new; copy: `cbm-hook-runner.js.txt`) | — | `95ee936fb26be3d5b0ca52c7920baf29289d998a7648f31d64410d0d3f4e6ae6` |
| `hooks/tests/cbm-hook-harness.js` (new; copy: `cbm-hook-harness.js.txt`) | — | `1e5593cb8007d402ca2ecce32bfdd8e73afd1f6d00fc384c2b890d5acbe8802b` |
| `hooks/cbm-*.cmd` (unchanged, now unreferenced) | `71d455d1…5a98`, `6d689547…ad7c`, `984c329e…003c` | unchanged |

The only change in `settings.json` is the `command` string of the seven hook entries (matchers,
events and timeouts unchanged):

```text
"C:/Program Files/nodejs/node.exe" "C:/Users/<user>/.claude/hooks/cbm-hook-runner.js" <code-discovery-gate|session-reminder|subagent-reminder>
```

The runner never invokes a shell: the command line holds only constant tokens (an absolute
`node.exe`, the runner path, a constant label), the payload is read from stdin as bytes and written
to the stdin of `codebase-memory-mcp.exe hook-augment`, which is spawned with `shell: false` and a
constant argv. It is fail-open (always exit 0, never 2) and reports a failure as one stderr line
naming the cause (binary missing, non-zero exit, timeout after 4 s, oversized stdin).

## 3. Regression harness (`cbm-hook-harness.js`)

Runs the configured command string exactly as a host would: `bash -c <command>` (Git Bash, as
Claude Code does) and Node's own `cmd.exe /d /s /c "<command>"` wrapper. For each of 18
adversarial strings (`&`, `&&`/`||`, `|`, `<`, `>`, `>>`, `2>`, `^`, `%VAR%`/`%%`, `!VAR!`,
parentheses, raw and escaped quotes, raw CR/LF newlines, `$(...)`/backticks/`;`, Unicode, an
8300-byte payload crossing the 8191 boundary, and the recorded `> parseSiteSettings > supplies`
shape), in both payload shapes (PreToolUse Grep `tool_input`, PostToolUse Read `tool_response`),
it checks a fresh canary directory (pre-seeded with `canary.txt` and a file named `supplies`) for
any created, removed or changed file, and runs the payload through two binaries:

- `findstr.exe hook-augment` as a stand-in, which echoes every payload line back: proves the
  payload reaches the binary byte-for-byte;
- the real `codebase-memory-mcp.exe hook-augment`: proves the valid path still works (exit 0, no
  stderr) and nothing in the payload is interpreted.

Plus the two failure modes (missing binary; non-zero exit) and a **negative control**: the OLD
command with `notacommand > supplies & echo PWNED>oldamp.txt` on stdin must truncate the canary
`supplies` and create `oldamp.txt` (proves the canary check sees the hazard).

Result (`harness-result.json`): **147 cases, 0 failures** — bash 72/72, cmd 72/72, failure modes
2/2, negative control 1/1 (observed: `changed supplies, created oldamp.txt`).

Live check after the change: in this session, Read and Grep calls made after the edit produced no
interactive-cmd output (every Read before it had), and no stray file appeared in either worktree.

## 4. The stray file

Deleted on 2026-10-19 after all four authorised conditions were proved:

| Condition | Evidence |
|---|---|
| untracked | `git ls-files -- supplies` empty; `git status` showed `?? supplies`; not ignored |
| empty | size 0; sha256 `e3b0c442…b855` (the empty-input digest) |
| created by the unsafe hook | §1: timestamp match to the millisecond window and exact reproduction from the recorded payload |
| referenced nowhere | `git grep` over the source finds `supplies` only as an English verb in comments and SQL text, never as a path; no untracked file mentions it |

After deletion the source worktree's `git status --porcelain` is byte-identical to the launch
snapshot `D:\tmp\afldbV2-source-snapshot-20261019\status.txt`, and the 19 frozen files still match
`sha256-worktree.txt` (19/19 OK). No other file was deleted.

## 5. Residual risk

`codebase-memory-mcp install`/`update` may rewrite these hook entries with the old cmd transport.
After any update of that tool, re-run `node C:\Users\<user>\.claude\hooks\tests\cbm-hook-harness.js`;
the negative control proves it can still see the hazard, and any `bash/*` failure means the old
transport is back. To roll back this fix, copy the backup's `settings.json` over the live one (this
restores the hazard).
