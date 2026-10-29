/**
 * AFLDB-ISSUE-316 C2 — successor activation and deactivation, separate from the rollover apply.
 *
 * The rollover apply (`tools/db/rollover-season.ts --apply`) installs a successor's documents and leaves it
 * INACTIVE. This tool is the only writer of the activation state, the closed SUCCESSOR_LADDER_TUPLES_JSON
 * table in tools/db/rebuild-test.ts, and it changes nothing else. The rules and the states (A pre-apply,
 * B applied/inactive, C activated, D deactivated = B) are in `src/lib/rollover/successor-activation.ts`.
 *
 * REVIEW-FIRST IS THE DEFAULT. Without `--apply` it judges everything and writes nothing: that dry run is
 * also the post-apply inspection of the inactive state. Every invocation, in order:
 *
 *   1. refuses while a rollover apply journal or a staged activation file is pending;
 *   2. binds the authority to the pinned change set (whole-file SHA-256), its season, profile and tuple;
 *   3. binds HEAD exactly, and the production source commit as its ancestor (`git rev-parse`,
 *      `git merge-base --is-ancestor`, read-only);
 *   4. binds the migration set in src/db/migrations;
 *   5. classifies the working tree as B or C from bytes alone (every change-set pin, the rollover date in
 *      the applied register and AFL Tables switch, and both rebuild-test.ts pins), refusing anything else;
 *   6. runs the rebuild's own validators (`validateProposedRebuildState`) over the ACTIVATED state, which
 *      must resolve exactly the bound profile and row count, and over the INACTIVE state, which must refuse
 *      the profile;
 *   7. prints the exact before/after table and pins;
 *   8. with `--apply` only, writes that one file (staged, read back, re-judged, renamed, read back).
 *
 * It opens no database connection, runs no migration, rebuild, census or rollover, and deploys nothing.
 * A second activation, or deactivating an inactive successor, refuses.
 *
 * Usage:
 *
 *   npx tsx tools/db/successor-activation.ts \
 *     --authority artifacts/rollover/successor-activation.json \
 *     --transition-change-set artifacts/rollover/transition-change-set.json [--apply]
 *
 * Deactivation is the same command with an authority whose action is "deactivate". It reverses only the
 * table; reversing the apply is the rollover's own recovery route. Reverting the activation commit, when
 * that commit changes exactly tools/db/rebuild-test.ts, is the equivalent Git route.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CONTRACT_PATH, REGISTER_PATH, RolloverRefused, SEASONS_PATH,
} from '../../src/lib/rollover/season-rollover';
import {
  STATE_DOCUMENT_PATHS,
  sha256Hex,
  type FileIo,
} from '../../src/lib/rollover/transition-change-set';
import { readSuccessorLadderTuplesJson } from '../../src/lib/rollover/ladder-successor';
import {
  MIGRATIONS_DIR,
  activationPendingProblem,
  applyActivationWrite,
  assertCommitBinding,
  assertMigrationBinding,
  bindActivationChangeSet,
  classifyActivationState,
  migrationSetState,
  parseActivationAuthority,
  planActivationWrite,
  type ActivationAuthority,
  type ClassifiedState,
} from '../../src/lib/rollover/successor-activation';
import { validateActivationStates } from './rollover-proposed-state';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function readRepoBytes(path: string): Buffer | null {
  const absolute = join(REPO_ROOT, path);
  return existsSync(absolute) ? readFileSync(absolute) : null;
}

const repoIo: FileIo = {
  read: readRepoBytes,
  write: (path, content) => writeFileSync(join(REPO_ROOT, path), content, 'utf8'),
  rename: (from, to) => renameSync(join(REPO_ROOT, from), join(REPO_ROOT, to)),
  remove: (path) => rmSync(join(REPO_ROOT, path), { force: true }),
};

/** An operator-supplied file, never outside the repository. */
function readEvidence(path: string, what: string): Buffer {
  const absolute = resolve(REPO_ROOT, path);
  const rel = relative(REPO_ROOT, absolute);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new RolloverRefused(`${what} (${path}) is outside the repository.`);
  if (!existsSync(absolute)) throw new RolloverRefused(`${what} does not exist: ${path}`);
  return readFileSync(absolute);
}

function parseArgv(argv: string[]): { authority: string; changeSet: string; apply: boolean } {
  const values: Record<string, string> = {};
  let apply = false;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--apply') {
      if (apply) throw new RolloverRefused('--apply was given more than once.');
      apply = true;
    } else if (flag === '--authority' || flag === '--transition-change-set') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new RolloverRefused(`${flag} needs a value.`);
      if (flag in values) throw new RolloverRefused(`${flag} was given more than once.`);
      values[flag] = value;
      i += 1;
    } else {
      throw new RolloverRefused(`Unknown argument ${JSON.stringify(flag)}. Usage: --authority <file> `
        + '--transition-change-set <file> [--apply]');
    }
  }
  if (!values['--authority'] || !values['--transition-change-set']) {
    throw new RolloverRefused('Both --authority and --transition-change-set are required.');
  }
  return { authority: values['--authority'], changeSet: values['--transition-change-set'], apply };
}

/** Read-only Git: HEAD, and whether the source commit is its ancestor. */
function gitBinding(authority: ActivationAuthority): { head: string; sourceIsAncestor: boolean } {
  const head = execFileSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', authority.sourceCommit, head], { cwd: REPO_ROOT });
  if (ancestry.error || (ancestry.status !== 0 && ancestry.status !== 1)) {
    throw new RolloverRefused(`git merge-base --is-ancestor could not decide (exit ${String(ancestry.status)}); `
      + 'the source-commit binding cannot be verified.');
  }
  return { head, sourceIsAncestor: ancestry.status === 0 };
}

function migrationFiles(): Array<{ name: string; text: string }> {
  return readdirSync(join(REPO_ROOT, MIGRATIONS_DIR))
    .filter((name) => name.endsWith('.sql'))
    .map((name) => ({ name, text: readFileSync(join(REPO_ROOT, MIGRATIONS_DIR, name), 'utf8') }));
}

/**
 * The rebuild's own validators over the working-tree documents with a given rebuild-test.ts. The ACTIVATED
 * state must resolve exactly the bound profile and count; the INACTIVE state must refuse the profile.
 */
function proveStates(classified: ClassifiedState, authority: ActivationAuthority, expectedRows: number): string[] {
  const text = (path: string): string => {
    const bytes = readRepoBytes(path);
    if (bytes === null) throw new RolloverRefused(`${path} does not exist.`);
    return bytes.toString('utf8');
  };
  const contract = JSON.parse(text(CONTRACT_PATH)) as { datasets?: { ladder?: { accepted_witness?: { manifest?: unknown } } } };
  const manifest = contract.datasets?.ladder?.accepted_witness?.manifest;
  if (typeof manifest !== 'string') throw new RolloverRefused('The applied contract names no ladder witness manifest.');
  const { active } = validateActivationStates({
    register: text(REGISTER_PATH), seasons: text(SEASONS_PATH), contract: text(CONTRACT_PATH),
    aflApi: text(STATE_DOCUMENT_PATHS.aflApi), afltables: text(STATE_DOCUMENT_PATHS.afltables),
    witnessManifest: text(manifest),
  }, classified.inactiveText, classified.activeText, authority.profile, expectedRows);
  return [
    `activated state: the rebuild's validators resolve ${active.ladderProfile}, club_seasons ${active.expectedRows}, `
      + `${active.finalChecks.length} final-validation checks built (SQL not run)`,
    'inactive state: the rebuild\'s validators refuse the installed profile (Unsupported ladder expectation)',
  ];
}

function main(argv: string[]): number {
  const pending = activationPendingProblem(repoIo);
  if (pending !== null) throw new RolloverRefused(pending.join('\n  '));
  const args = parseArgv(argv);

  const authority = parseActivationAuthority(readEvidence(args.authority, 'The activation authority').toString('utf8'));
  const { changeSet, tuple } = bindActivationChangeSet(authority, readEvidence(args.changeSet, 'The transition change set'));
  const git = gitBinding(authority);
  assertCommitBinding(authority, git);
  const migrations = migrationSetState(migrationFiles());
  assertMigrationBinding(authority, migrations);

  const judge = () => classifyActivationState({ authority, changeSet, tuple, readRepo: readRepoBytes });
  const classified = judge();
  const proofs = proveStates(classified, authority, tuple.expected_rows);
  const write = planActivationWrite(authority.action, classified);

  console.log(`\nAFLDB-ISSUE-316 — successor ${authority.action.toUpperCase()} ${args.apply ? 'APPLY' : 'DRY RUN'}`);
  console.log(`  decision                  ${authority.decision}`);
  console.log(`  profile                   ${authority.profile} (season ${authority.season}, rollover ${authority.rolloverDate})`);
  console.log(`  HEAD                      ${git.head} (source ${authority.sourceCommit} is an ancestor)`);
  console.log(`  change set                ${authority.changeSetSha256} (every pinned file holds its pinned bytes)`);
  console.log(`  tuple                     ${authority.tupleSha256}`);
  console.log(`  migrations                ${migrations.count} files, last ${migrations.last}, ${migrations.setSha256}`);
  console.log(`  state now                 ${write.from === 'activated' ? 'C activated' : 'B applied, INACTIVE'}`);
  for (const line of proofs) console.log(`  - ${line}`);
  console.log(`\n  ${write.path}`);
  console.log(`    before ${sha256Hex(write.before)}  table '${readSuccessorLadderTuplesJson(write.before)}'`);
  console.log(`    after  ${sha256Hex(write.after)}  table '${readSuccessorLadderTuplesJson(write.after)}'`);
  console.log(`  state after               ${write.to === 'activated' ? 'C activated' : 'B/D applied, INACTIVE'}`);

  if (!args.apply) {
    console.log('\nDRY RUN — nothing was written. Re-run with --apply to write exactly this one change.');
    return 0;
  }
  applyActivationWrite(repoIo, write, () => {
    assertCommitBinding(authority, gitBinding(authority));
    assertMigrationBinding(authority, migrationSetState(migrationFiles()));
    if (judge().state !== write.from) throw new RolloverRefused('The activation state changed after it was judged; nothing was written.');
  });
  console.log(`\nWROTE ${write.path} only. Commit it alone, so that reverting that commit is the ${authority.action === 'activate' ? 'deactivation' : 'reactivation'} route.`);
  return 0;
}

try {
  process.exit(main(process.argv.slice(2)));
} catch (error) {
  if (error instanceof RolloverRefused) {
    console.error(`\nSUCCESSOR ACTIVATION REFUSED\n  ${error.message}\n`);
    process.exit(2);
  }
  throw error;
}
