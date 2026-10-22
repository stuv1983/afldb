import type * as fs from 'node:fs';
import type { spawnSync } from 'node:child_process';
export type RehearsalPair = Readonly<{
  profile: string; core_snapshot_label: string; core_manifest_sha256: string;
  core_artefact_set_sha256: string; witness_snapshot_label: string; witness_manifest_sha256: string;
  first_season: number; last_season: number; expected_rows: number;
}>;
export type RehearsalRequest = Readonly<{
  specPath: string; specSha256: string; checkpoint: string; launcherPath?: string;
  sourceRoot?: string; cwd?: string; modulePath?: string; pair?: RehearsalPair;
  target?: { database: string; adminDsn: string; importDsn: string;
    importIsOwnerSubstitution: boolean; isolated?: { port: number } };
}>;
export type VerifiedRehearsal = Readonly<{
  schema_version: 1; purpose: string; implementation_basis: string; source_subdir: 'source';
  pair: RehearsalPair;
  target: Readonly<{ database: string; host: string; port: number; cluster_name: string; database_marker: string }>;
  spec: Readonly<{ source_root: string; capture_root: string; output_root: string; temp_root: string;
    cluster_root: string; runner_options: readonly string[]; [key: string]: unknown }>;
  runtime: Readonly<{ schema_version: 1 | 2; node: string; tsx_loader: string; python: string; pg_bin: string; listener_tool: string; [key: string]: unknown }>;
  resolution: Readonly<{ files: Readonly<Record<string, string>>; node_search_roots: readonly string[];
    tsx_loader: string; esbuild_binary: string; python_stdlib: readonly string[]; python_dependencies: readonly string[]; source_root: string;
    /** Runtime record version 2 only: individually hashed executables and exact hard-link counts. */
    executables?: Readonly<Record<string, string>>; hardlink_counts?: Readonly<Record<string, number>> }>;
}>;
export function resolutionLaunch(verified: VerifiedRehearsal, io?: typeof fs): {
  nodeArgs: string[]; pythonArgs: string[]; env: Record<string, string>;
};
export function assertRehearsalResolution(verified: VerifiedRehearsal): void;
export function verifyRehearsalPackage(request: RehearsalRequest, io?: typeof fs): VerifiedRehearsal;
export function launchRehearsal(request: RehearsalRequest, spawn?: typeof spawnSync, io?: typeof fs): number;
/** Exact reviewed start-up landmarks (prefix/venv/build selection) for a canonical interpreter path. */
export function pythonStartupLandmarks(python: string): string[];
export function guardedListenerTool(
  env?: Readonly<Record<string, string | undefined>>, io?: typeof fs,
  verify?: (request: RehearsalRequest, io?: typeof fs) => VerifiedRehearsal,
  context?: { anchor: unknown; execArgv: readonly string[] },
): string | undefined;
export function freezeBinding<T>(value: T): Readonly<T>;
export function strictJson(bytes: Uint8Array): any;
export function inventoryEntries(bytes: Buffer): { path: string; sha256: string }[];
