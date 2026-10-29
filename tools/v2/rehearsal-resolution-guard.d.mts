import type * as fs from 'node:fs';
/** Refuses a guarded process whose policy binds a native-closure auditor that is not enforcing in it. */
export function assertNativeEnforcement(
  data: { native_auditor?: string; native_auditor_sha256?: string; native_policy_sha256?: string },
  env?: Readonly<Record<string, string | undefined>>, io?: Pick<typeof fs, 'readFileSync' | 'statSync'>,
): void;
export function installResolutionGuard(data: unknown): Promise<void>;
