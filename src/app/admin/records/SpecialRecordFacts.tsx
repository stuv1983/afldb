import Link from 'next/link';

import {
  DERIVED_NOTICE, IDENTITY_NOTICE, LINK_STATE_NOTICE, PROVENANCE_LABELS, PROVENANCE_NOTES,
} from '@/app/admin/records/labels';
import type { SpecialRecordProvenance, SpecialRecordStatus } from '@/db/queries/admin-special-records';
import { playerPath } from '@/lib/format';

/**
 * The read-only head of both special-record detail pages (AFLDB-ISSUE-167
 * §10.2): what this record asserts, where it came from, whether it stands, and
 * what it did and did not resolve to.
 *
 * A Server Component with no controls of its own. In Stage 3 that is the whole
 * page; when Stage 6 adds the correction, lifecycle and replacement panels
 * under `data.specialRecords.edit`, an Admin holding only `.read` will still
 * see exactly this and nothing else.
 *
 * IDENTITY IS SHOWN, NEVER OFFERED AS A FIELD, and so is the link state — the
 * first because a changed identity is a different record (§4), the second
 * because D-2 (2026-09-13) deferred after-siren link resolution rather than
 * letting P4 open a second authority over it. Both carry their reason beside
 * them, so neither is a silent omission.
 *
 * THE ROW ID IS NOT THE IDENTITY. `id` is a row number that a rebuild and a
 * promotion both renumber, which is exactly why the durable record is keyed on
 * `<sources.key>:<source_record_id>` instead. It is printed only so an
 * operator can quote it, labelled as what it is.
 */
export function SpecialRecordFacts({
  rowId, entityKey, provenance, sourceKey, sourceRecordId, importBatchId, importedAt,
  status, statusReason, updatedAt, identity, link,
}: {
  rowId: number;
  entityKey: string | null;
  provenance: SpecialRecordProvenance;
  sourceKey: string | null;
  sourceRecordId: string | null;
  importBatchId: string | null;
  importedAt: string;
  status: SpecialRecordStatus;
  statusReason: string | null;
  updatedAt: string;
  /** The identity-bearing facts, in the order they read as a sentence. */
  identity: Array<{ label: string; value: React.ReactNode }>;
  link: {
    status: string;
    candidateCount: number;
    playerId: number | null;
    playerSlug: string | null;
    playerDisplayName: string | null;
    playerNameRaw: string;
  };
}) {
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
                  {entityKey ?? (
                    <span className="muted">
                      none — this record has no identity a rebuild would preserve
                    </span>
                  )}
                </td>
                <th scope="row">Database row</th>
                <td>
                  #{rowId}{' '}
                  <span className="muted" style={{ fontSize: '0.8rem' }}>
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
                <th scope="row">Loaded</th>
                <td>{importedAt}</td>
                <th scope="row">Import batch</th>
                <td>{importBatchId ?? '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: '0.85rem' }}>{PROVENANCE_NOTES[provenance]}</p>
      </section>

      <section className="section">
        <h2>Player link</h2>
        <div className="table-wrap">
          <table>
            <tbody>
              <tr>
                <th scope="row">Name as the source wrote it</th>
                <td>{link.playerNameRaw}</td>
                <th scope="row">Link state</th>
                <td>
                  <span className="badge">{link.status}</span>
                </td>
              </tr>
              <tr>
                <th scope="row">Resolved player</th>
                <td>
                  {link.playerId !== null && link.playerSlug ? (
                    <Link href={playerPath(link.playerSlug, link.playerId)}>
                      {link.playerDisplayName ?? `player #${link.playerId}`}
                    </Link>
                  ) : (
                    <span className="muted">not linked</span>
                  )}
                </td>
                <th scope="row">Candidates considered</th>
                <td>{link.candidateCount}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: '0.85rem' }}>{LINK_STATE_NOTICE}</p>
        <p className="muted" style={{ fontSize: '0.85rem' }}>{DERIVED_NOTICE}</p>
      </section>
    </>
  );
}

/** The "back to the list" line every detail page carries. */
export function RecordsCrumb({ href, label }: { href: string; label: string }) {
  return <p className="eyebrow"><Link href={href}>← {label}</Link></p>;
}
