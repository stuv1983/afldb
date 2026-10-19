import { CORRECTION_NOTE_MAX_LENGTH, CORRECTION_NOTE_MIN_LENGTH, COVERAGE_STATUSES } from '@afldb/domain';
import Link from 'next/link';

import {
  COVERAGE_STATUS_LABELS,
  type CoverageHealth,
  type Loaded,
  type OperationsLink,
  type PendingProposals,
  type SealedSeasonsView,
  type UnitRowView,
} from '../views';

import { LoadFailure, LoadedSection, PlainSection } from './Shared';

/**
 * The sections of `/admin/operations` (AFLDB V2 Stage 5, plan D9, ADR 0009). Each is a pure
 * function of already-loaded props, so the page can render them from live reads and the
 * capture-ready tests can render them from SYNTHETIC props (tests/fixtures/v2/operations-centre).
 * A section whose read failed shows its own notice; the others are unaffected.
 *
 * Nothing here starts, schedules or changes anything.
 */

const roleWords = (role: string): string => (role === 'super_admin' ? 'Super Admin' : role === 'admin' ? 'Admin' : role);

export function OperationsHeader({ email, role }: { email: string; role: string }) {
  return (
    <div className="page-header">
      <h1>Operations centre</h1>
      <p className="subtitle">
        Data health, sealed seasons, acquisition status, curated awards and derived results, and the
        read-only inspection tools, in one place. This page reads; it starts nothing. Every
        operation that changes data lives on its own page and shows what it will change before you submit.
      </p>
      <p className="muted">Signed in as <span className="mono">{email}</span> ({roleWords(role)}).</p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Data health
 * ------------------------------------------------------------------ */

function spanText(span: { from: number; through: number } | null): string {
  return span === null ? '—' : span.from === span.through ? String(span.from) : `${span.from}–${span.through}`;
}

export function DataHealthSection({ health }: { health: Loaded<CoverageHealth> }) {
  return (
    <LoadedSection
      id="data-health"
      title="Data health"
      what="The coverage registry"
      loaded={health}
      intro={(
        <>
          The coverage registry records, for every season and data family, where the data comes from
          and what proves it. Anything not <em>API verified</em> or <em>API partial</em> is not
          rebuildable from the AFL API. The season-by-season matrix is the repository file{' '}
          <span className="mono">docs/v2/coverage-matrix.md</span> (generated from the registry).
        </>
      )}
    >
      {(value) => (
        <>
          <div className="table-wrap">
            <table>
              <caption className="visually-hidden">Seasons covered, by family and coverage status</caption>
              <thead>
                <tr>
                  <th scope="col">Family</th>
                  {COVERAGE_STATUSES.map((status) => (
                    <th scope="col" className="num" key={status}>{COVERAGE_STATUS_LABELS[status]}</th>
                  ))}
                  <th scope="col" className="num">Seasons</th>
                  <th scope="col">Span</th>
                </tr>
              </thead>
              <tbody>
                {value.rows.map((row) => (
                  <tr key={row.family}>
                    <th scope="row">{row.label}</th>
                    {COVERAGE_STATUSES.map((status) => (
                      <td className="num" key={status}>{row.byStatus[status]}</td>
                    ))}
                    <td className="num">{row.total}</td>
                    <td className="nowrap">{row.from === null || row.through === null ? '—' : `${row.from}–${row.through}`}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">All families</th>
                  {COVERAGE_STATUSES.map((status) => (
                    <td className="num" key={status}><strong>{value.totals.byStatus[status]}</strong></td>
                  ))}
                  <td className="num"><strong>{value.totals.total}</strong></td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="section-note">
            Counts are family-seasons: a season counts once for each family it is registered under.
            {' '}{value.entryCount} registry entries.
          </p>
          <h3>Season span of each status</h3>
          <ul className="ruled-list">
            {COVERAGE_STATUSES.map((status) => (
              <li key={status}>
                <strong>{COVERAGE_STATUS_LABELS[status]}</strong>: {spanText(value.spans[status])}
                {value.totals.byStatus[status] === 0 && <span className="muted"> (none registered)</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </LoadedSection>
  );
}

/* ------------------------------------------------------------------ *
 * Sealed seasons
 * ------------------------------------------------------------------ */

function seasonList(seasons: readonly number[]): string {
  return seasons.length === 0 ? 'none' : seasons.join(', ');
}

export function SealedSeasonsSection({ seasons }: { seasons: Loaded<SealedSeasonsView> }) {
  return (
    <LoadedSection
      id="sealed-seasons"
      title="Sealed seasons"
      what="The season registry"
      loaded={seasons}
      intro={(
        <>
          A sealed season is finished, historical data. A write to one is refused unless it is an
          audited correction. The range comes from <span className="mono">data/reference/seasons.json</span>{' '}
          and is read fresh each time; if it cannot be read the seal fails closed.
        </>
      )}
    >
      {(value) => (
        <dl className="audit-kv">
          <dt>Sealed range</dt>
          <dd>{value.from}–{value.through} ({value.sealedCount} seasons sealed)</dd>
          <dt>Open inside the range</dt>
          <dd>{seasonList(value.open)}</dd>
          <dt>In progress</dt>
          <dd>{seasonList(value.inProgress)} (registry last season {value.lastSeason})</dd>
          <dt>A correction needs</dt>
          <dd>A note of {CORRECTION_NOTE_MIN_LENGTH} to {CORRECTION_NOTE_MAX_LENGTH} characters, recorded in the audit trail.</dd>
        </dl>
      )}
    </LoadedSection>
  );
}

/* ------------------------------------------------------------------ *
 * Acquisition runs
 * ------------------------------------------------------------------ */

function RunTable({ rows }: { rows: readonly UnitRowView[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Settle</th>
            <th scope="col">Service</th>
            <th scope="col">Latest committed batch</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              <td className={row.serviceMuted ? 'muted' : undefined}>{row.service}</td>
              <td className={row.batchMuted ? 'muted' : undefined}>{row.batch}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AcquisitionRunsSection({
  aflApi, aflTables,
}: {
  aflApi: Loaded<UnitRowView[]>;
  aflTables: Loaded<UnitRowView>;
}) {
  return (
    <section className="section" id="acquisition-runs" aria-labelledby="acquisition-runs-heading">
      <h2 id="acquisition-runs-heading">Acquisition runs</h2>
      <p className="section-note">
        Status only: what the host&apos;s scheduled units are doing, and the newest batch each one
        committed. Nothing here starts, stops or schedules a run. While a run is in progress the
        batch shown is the previous run&apos;s.
      </p>
      <h3>AFL API settles</h3>
      {aflApi.ok
        ? <RunTable rows={aflApi.value} />
        : <LoadFailure what="The AFL API run status" error={aflApi.error} code={aflApi.code} />}
      <h3>AFL Tables nightly settle</h3>
      <p className="section-note">
        This timer still runs on the host behind AFLDB-ISSUE-316 until the owner decision D-316-2.
        AFLDB V2 neither starts nor stops it; the row below only reports it.
      </p>
      {aflTables.ok
        ? <RunTable rows={[aflTables.value]} />
        : <LoadFailure what="The AFL Tables run status" error={aflTables.error} code={aflTables.code} />}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Curated awards and derived results
 * ------------------------------------------------------------------ */

function LinkList({ links }: { links: readonly OperationsLink[] }) {
  return (
    <ul className="ruled-list">
      {links.map((link) => (
        <li key={link.href}>
          <Link href={link.href}>{link.label}</Link>
          <span className="muted"> — {link.description}</span>
        </li>
      ))}
    </ul>
  );
}

export function CuratedDerivedSection({
  links, pending,
}: {
  links: readonly OperationsLink[];
  /** Null when the viewer may not read award proposals: the count is not shown at all. */
  pending: Loaded<PendingProposals> | null;
}) {
  return (
    <PlainSection id="curated-derived" title="Curated awards and derived results">
      <p className="section-note">
        Curated award proposals are reviewed and approved one at a time. Derived results are computed
        from the database and published as a separate, append-only record.
      </p>
      {pending !== null && (
        pending.ok
          ? (
            <p data-pending-count={pending.value.count}>
              Undecided award proposals:{' '}
              <strong>{pending.value.atLeast ? `${pending.value.count} or more` : pending.value.count}</strong>
              {' '}(proposed, validated or validation failed).
            </p>
          )
          : <LoadFailure what="The undecided proposal count" error={pending.error} code={pending.code} />
      )}
      {links.length === 0
        ? <p className="muted">Your role holds none of the curated-award capabilities.</p>
        : <LinkList links={links} />}
    </PlainSection>
  );
}

/* ------------------------------------------------------------------ *
 * Inspection tools and maintenance
 * ------------------------------------------------------------------ */

export function InspectionToolsSection({ links }: { links: readonly OperationsLink[] }) {
  return (
    <PlainSection id="inspection-tools" title="Inspection tools">
      <p className="section-note">
        Each link is shown only if your role holds the capability that opens it. Hiding a link is
        furniture; every destination checks the capability again.
      </p>
      {links.length === 0
        ? <p className="muted">Your role holds none of the inspection capabilities.</p>
        : <LinkList links={links} />}
    </PlainSection>
  );
}

export function MaintenanceSection() {
  return (
    <PlainSection id="maintenance" title="Maintenance">
      <p>
        There is no run-everything control here: each explicit operation lives on its own page, with
        what it will change, whether it can be undone and the audit entry it writes shown before you submit.
      </p>
    </PlainSection>
  );
}
