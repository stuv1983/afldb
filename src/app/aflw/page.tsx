import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AFLW',
  description: 'AFLW statistics are coming to AFLDB.',
  robots: { index: false, follow: true },
};

const SECTIONS = [
  { title: 'Players', meta: 'Career profiles and match statistics' },
  { title: 'Clubs', meta: 'Teams, lists and club records' },
  { title: 'Seasons', meta: 'Ladders, fixtures and results' },
  { title: 'Records', meta: 'Career, season and single-game leaders' },
];

export default function AflwPage() {
  return (
    <>
      <div className="page-header aflw-header">
        <p className="eyebrow">A new part of the record</p>
        <h1>AFLW is coming to AFLDB</h1>
        <p className="subtitle">
          A dedicated home for the women&apos;s competition is being prepared.
          The sections below are a preview and will become available as the data is connected.
        </p>
        <span className="aflw-status">Coming soon</span>
      </div>

      <section className="section" aria-labelledby="aflw-sections">
        <h2 id="aflw-sections">Explore AFLW</h2>
        <div className="grid aflw-grid">
          {SECTIONS.map((section) => (
            <div className="aflw-card" key={section.title}>
              <h3>{section.title}</h3>
              <p>{section.meta}</p>
              <span>Coming soon</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
