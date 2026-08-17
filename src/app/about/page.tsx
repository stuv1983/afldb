import type { Metadata } from 'next';

import { Breadcrumbs } from '@/components/Breadcrumbs';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata({
  title: 'About AFLDB',
  description: 'What AFLDB is, and where its data comes from.',
  path: '/about',
});

export default function AboutPage() {
  return (
    <>
      <Breadcrumbs items={[{ label: 'About' }]} />

      <div className="page-header">
        <h1>About AFLDB</h1>
        <p className="subtitle">
          Australian Football statistics, 1897 to present.
        </p>
      </div>

      <section className="section">
        <h2>What this is</h2>
        <p>
          AFLDB is an independent hobby project: a historical statistics database for
          the VFL/AFL and, in time, the AFLW. Players, clubs, seasons, matches, venues,
          records, awards and Brownlow history are collected in one place and made
          searchable.
        </p>
      </section>

      <section className="section">
        <h2>Where the data comes from</h2>
        <p>
          The core historical dataset — match results, player statistics and club
          records back to 1897 — was assembled from{' '}
          <a href="https://afltables.com/" rel="noopener noreferrer" target="_blank">AFL Tables</a>
          {' '}through{' '}
          <a href="https://jimmyday12.github.io/fitzRoy/" rel="noopener noreferrer" target="_blank">
            fitzRoy
          </a>
          , an R package that collects and tidies published AFL data. The bulk of
          AFLDB&apos;s historical statistics exist because of that project; its license
          terms are published at{' '}
          <a
            href="https://jimmyday12.github.io/fitzRoy/LICENSE.html"
            rel="noopener noreferrer"
            target="_blank"
          >
            jimmyday12.github.io/fitzRoy/LICENSE.html
          </a>.
        </p>
        <p>Additional source material fills in what fitzRoy does not cover:</p>
        <ul className="ruled-list">
          <li><strong>Wikipedia</strong> — biographical detail, including birth dates.</li>
          <li>
            <strong>DraftGuru</strong> — national and rookie draft history from 1981,
            recruitment records and All-Australian selections.
          </li>
        </ul>
        <p>
          Source provenance and known data-quality issues are recorded row by row in
          the database itself, not hidden: a player or club a source could not be
          confidently linked to appears with its original wording rather than being
          silently dropped or guessed at.
        </p>
      </section>

      <section className="section">
        <h2>Get in touch</h2>
        <p>
          Questions, corrections or access requests: <a href="mailto:admin@afldb.com">admin@afldb.com</a>.
        </p>
      </section>
    </>
  );
}
