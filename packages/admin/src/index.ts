/**
 * @afldb/admin — AFLDB V2 restricted administration services (docs/v2/plan.md §3 D1, D8, D9).
 *
 * May import @afldb/domain and @afldb/db. Re-exports the existing Admin Centre capability policy
 * (AFLDB-ISSUE-155), which every audited admin service will check.
 */
export {
  hasCapability,
  type Capability,
  type CapabilityRole,
  type CapabilityViewer,
} from '@/lib/auth/capabilities';
