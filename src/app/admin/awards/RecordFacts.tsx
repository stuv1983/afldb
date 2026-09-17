import Link from 'next/link';

import {
  IDENTITY_NOTICE, PROVENANCE_LABELS, PROVENANCE_NOTES, type HonourDomain,
} from '@/app/admin/awards/labels';
import type { HonourOverrideRow, HonourProvenance, HonourStatus } from '@/db/queries/admin-awards';

/**
 * The read-only head of every awards detail page (AFLDB-ISSUE-165 §6.3,
 * §6.4): what this record asserts, who owns it, whether it stands, and what
 * replaced it or it replaced.
 *
 * A Server Component with no actions of its own, so an Admin holding only
 * `data.awards.read` sees exactly this and nothing else, and a Super Admin
 * sees it above the panels.
 *
 * IDENTITY IS SHOWN, NEVER OFFERED AS A FIELD. Every fact under "What this
 * record asserts" is identity-bearing, and the notice beside it says why it is
 * not editable and what to do instead. The refusal exists in the mutation
 * contract regardless; showing the reason here means a refusal is never the
 * first an administrator hears of the rule.
 *
 * THE ROW ID IS NOT THE IDENTITY. `id` is a database row number that a rebuild
 * and a promotion both renumber, which is exactly why the durable record is
 * named by the natural key shown beside it. It is printed only so an operator
 * can quote it in a message, labelled as what it is.
 */
export function RecordFacts({
  domain, rowId, entityKey, provenance, sourceKey, sourceRecordId,
  status, statusReason, updatedAt, identity, overrides,
}: {
  domain: HonourDomain;
  rowId: number;
  entityKey: string | null;
  provenance: HonourProvenance;
  sourceKey: string | null;
  sourceRecordId?: string | null;
  status: HonourStatus;
  statusReason: string | null;
  updatedAt: string;
  /** The identity-bearing facts, in the order they read as a sentence. */
  identity: Array<{ label: string; value: React.ReactNode }>;
  overrides: HonourOverrideRow[];
}) {
  const lifecycle = overrides.find((o) => o.fieldGroup === 'lifecycle');
  const record = overrides.find((o) => o.fieldGroup === 'record');
  const correction = overrides.find((o) => o.fieldGroup === 'correction');
  const replacedBy = lifecycle?.overrideValues?.replaced_by_key;
  const replaces = record?.overrideValues?.replaces_key;

  return (
    <>
      <section className="section">
        <div className="split-head">
          <h2>What this record asserts</h2>
          <span className="badge">{status === 'void' ? 'Void' : 'Active'}</span>
        </div>
        <div className="table-wrap">
          <table>
            <tbody>
              {identity.map((fact) => (
                <tr key={fact.label}>
                  <th scope="row">{fact.label}</th>
                  <td>{fact.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: '0.85rem' }}>{IDENTITY_NOTICE}</p>
      </section>

      <section className="section">
        <h2>Provenance &amp; state</h2>
        <div className="table-wrap">
          <table>
            <tbody>
              <tr>
                <th scope="row">Owned by</th>
                <td>
                  <span className="badge">{PROVENANCE_LABELS[provenance]}</span>
                  {sourceKey && <> <span className="muted">{sourceKey}</span></>}
                </td>
                <th scope="row">Source record</th>
                <td style={{ whiteSpace: 'normal', wordBreak: 'break-all' }}>
                  {sourceRecordId ?? '—'}
                </td>
              </tr>
              <tr>
                <th scope="row">Durable identity</th>
                <td style={{ whiteSpace: 'normal', wordBreak: 'break-all' }}>
                  {entityKey ?? <span className="muted">none — this record cannot be recorded durably</span>}
                </td>
                <th scope="row">Database row</th>
                <td>
                  #{rowId} <span className="muted" style={{ fontSize: '0.8rem' }}>
                    (renumbered by a rebuild; not a stable identifier)
                  </span>
                </td>
              </tr>
              <tr>
                <th scope="row">Status</th>
                <td>
                  {status === 'void' ? 'Void' : 'Active'}
                  {statusReason && <> — {statusReason}</>}
                </td>
                <th scope="row">Last changed</th>
                <td>{updatedAt}</td>
              </tr>
              <tr>
                <th scope="row">Durable records held</th>
                <td colSpan={3}>
                  {overrides.length === 0
                    ? <span className="muted">none — this record is exactly what its source loaded</span>
                    : overrides.map((o) => o.fieldGroup).join(', ')}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: '0.85rem' }}>{PROVENANCE_NOTES[provenance]}</p>
        {correction && (
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            A correction is recorded against this record and is re-applied after every reload and
            every rebuild.
          </p>
        )}
      </section>

      {(replacedBy || replaces) && (
        <section className="section">
          <h2>Replacement</h2>
          {typeof replacedBy === 'string' && (
            <p>
              This {domain === 'winners' ? 'record' : 'entry'} was voided and replaced. The record
              that replaced it is{' '}
              <span style={{ wordBreak: 'break-all' }}><code>{replacedBy}</code></span>.
            </p>
          )}
          {typeof replaces === 'string' && (
            <p>
              This record replaced{' '}
              <span style={{ wordBreak: 'break-all' }}><code>{replaces}</code></span>, which was
              voided in the same change.
            </p>
          )}
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Both halves are named by their durable natural keys, never by a row id, because a
            rebuild or a promotion renumbers the rows but not the facts.
          </p>
        </section>
      )}
    </>
  );
}

/** The "back to the list" line every detail and create page carries. */
export function AwardsCrumb({ href, label }: { href: string; label: string }) {
  return <p className="eyebrow"><Link href={href}>← {label}</Link></p>;
}
