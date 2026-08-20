'use client';

import { useActionState, useState } from 'react';

import { AdminSection } from '@/app/admin/AdminSection';
import { ImageField, type ImageOption } from '@/app/admin/content/ImageField';
import { saveSiteContent, type ContentState } from '@/app/admin/content/actions';
import {
  APEX_METRICS,
  APEX_SECTIONS,
  CONTENT_LIMITS,
  isSectionVisible,
  newBlockId,
  type ApexContent,
  type ApexFeature,
  type ApexNote,
  type ApexSectionId,
  type ApexStat,
  type SiteFooter,
} from '@/lib/site-content';
import { type PageIntros } from '@/lib/site-settings';

/**
 * The whole of /admin/content: one form, one Save, which also publishes.
 *
 * Both documents are edited in React state and submitted as one JSON field
 * each. The server re-parses them through `parseApexContent` and
 * `parseSiteFooter` regardless, so this editor is a convenience and never the
 * validation — the same contract the settings form and its question builder
 * already have.
 *
 * The ordering of the sections below follows the page itself, top to bottom,
 * with the footer first because it is the part that appears on every page of
 * the application rather than only on the apex. Each is an `AdminSection`, so
 * it folds and stays folded: this screen is the longest form in the
 * application and finding the hero used to mean scrolling past the footer.
 * The fields inside a folded section are still in the DOM and still submit —
 * see the note on `<details>` in AdminSection.
 */

const cardStyle = {
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  background: 'var(--bg-subtle)',
  padding: '0.7rem',
  marginBottom: '0.5rem',
} as const;

const rowStyle = {
  display: 'flex',
  gap: '0.3rem',
  marginLeft: 'auto',
} as const;

function move<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** The move/remove cluster every repeating block carries. */
function BlockControls({
  index,
  count,
  label,
  onMove,
  onRemove,
}: {
  index: number;
  count: number;
  label: string;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <span style={rowStyle}>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => onMove(-1)}
        disabled={index === 0}
        aria-label={`Move ${label} up`}
      >
        ↑
      </button>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => onMove(1)}
        disabled={index === count - 1}
        aria-label={`Move ${label} down`}
      >
        ↓
      </button>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
      >
        Remove
      </button>
    </span>
  );
}

const SECTION_LABELS = new Map<ApexSectionId, string>(
  APEX_SECTIONS.map((section) => [section.id, section.label]),
);

export function ContentEditor({
  content: initialContent,
  footer: initialFooter,
  pageIntros: initialPageIntros,
  imageOptions: initialOptions,
}: {
  content: ApexContent;
  footer: SiteFooter;
  pageIntros: PageIntros;
  imageOptions: ImageOption[];
}) {
  const [state, action, saving] = useActionState<ContentState, FormData>(saveSiteContent, {});
  const [content, setContent] = useState<ApexContent>(initialContent);
  const [footer, setFooter] = useState<SiteFooter>(initialFooter);
  const [pageIntros, setPageIntros] = useState<PageIntros>(initialPageIntros);
  const [options, setOptions] = useState<ImageOption[]>(initialOptions);

  /** Add a freshly uploaded image to every picker's list of choices. */
  function registerUpload(option: ImageOption) {
    setOptions((previous) => [
      option,
      ...previous.filter((existing) => existing.src !== option.src),
    ]);
  }

  const setHero = (patch: Partial<ApexContent['hero']>) =>
    setContent((previous) => ({ ...previous, hero: { ...previous.hero, ...patch } }));
  const setMeta = (patch: Partial<ApexContent['meta']>) =>
    setContent((previous) => ({ ...previous, meta: { ...previous.meta, ...patch } }));
  const setHeader = (patch: Partial<ApexContent['header']>) =>
    setContent((previous) => ({ ...previous, header: { ...previous.header, ...patch } }));
  const setPair = (patch: Partial<ApexContent['pair']>) =>
    setContent((previous) => ({ ...previous, pair: { ...previous.pair, ...patch } }));

  const setFeatures = (items: ApexFeature[]) =>
    setContent((previous) => ({ ...previous, features: { ...previous.features, items } }));
  const setNotes = (items: ApexNote[]) =>
    setContent((previous) => ({ ...previous, notes: { ...previous.notes, items } }));
  const setStats = (stats: ApexStat[]) => setHero({ stats });

  const updateFeature = (index: number, patch: Partial<ApexFeature>) =>
    setFeatures(content.features.items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  const updateNote = (index: number, patch: Partial<ApexNote>) =>
    setNotes(content.notes.items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  const updateStat = (index: number, patch: Partial<ApexStat>) =>
    setStats(content.hero.stats.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  const moveSection = (index: number, direction: -1 | 1) =>
    setContent((previous) => ({ ...previous, sections: move(previous.sections, index, direction) }));
  const toggleSection = (id: ApexSectionId) =>
    setContent((previous) => ({
      ...previous,
      sections: previous.sections.map((section) => (
        section.id === id ? { ...section, visible: !section.visible } : section
      )),
    }));

  /** "Hidden" beside a section heading, so a folded editor still says so. */
  const hiddenNote = (id: ApexSectionId) =>
    (isSectionVisible(content, id) ? undefined : 'hidden on the published page');

  return (
    <form action={action}>
      {/* Both documents ride along as JSON; the server owns their shape. */}
      <input type="hidden" name="content" value={JSON.stringify(content)} />
      <input type="hidden" name="footer" value={JSON.stringify(footer)} />
      <input type="hidden" name="pageIntros" value={JSON.stringify(pageIntros)} />

      {state.message && <p className="notice">{state.message}</p>}
      {/* pre-wrap: a failed publish's message carries the shell that repairs
          it, over several lines. */}
      {state.error && <p className="notice notice-pre" role="alert">{state.error}</p>}

      {/* ---------------------------------------------------------------- */}
      <AdminSection id="apex-sections" title="Sections — what the page shows, and in what order">
        <p className="section-note">
          Each band of <code>afldb.com</code>, in the order it is published. Hide one and it
          is left out of the page entirely — the words and pictures stay here, so switching
          it back on restores what was written rather than a blank. A band with nothing in
          it publishes nothing whether or not it is ticked.
        </p>

        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {content.sections.map((section, index) => (
            <li key={section.id} style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <label style={{ cursor: 'pointer', display: 'flex', gap: '0.45rem', alignItems: 'baseline' }}>
                  <input
                    type="checkbox"
                    checked={section.visible}
                    onChange={() => toggleSection(section.id)}
                  />
                  {' '}{SECTION_LABELS.get(section.id) ?? section.id}
                </label>
                <span style={rowStyle}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => moveSection(index, -1)}
                    disabled={index === 0}
                    aria-label={`Move ${SECTION_LABELS.get(section.id) ?? section.id} up`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => moveSection(index, 1)}
                    disabled={index === content.sections.length - 1}
                    aria-label={`Move ${SECTION_LABELS.get(section.id) ?? section.id} down`}
                  >
                    ↓
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ul>

        <p className="muted" style={{ fontSize: '0.78rem', marginTop: '0.5rem' }}>
          The masthead and the footer are not in this list: they are the frame the page sits
          in rather than bands of it, and both are edited below.
        </p>
      </AdminSection>

      {/* ---------------------------------------------------------------- */}
      <AdminSection id="page-intros" title="Page Introductions">
        <p className="section-note">
          The introductory text shown at the top of various application pages.
        </p>

        <div style={{ marginTop: '0.75rem' }}>
          <label htmlFor="intro-records">Records Page Intro</label>
          <textarea
            id="intro-records"
            rows={2}
            value={pageIntros.records}
            maxLength={2000}
            onChange={(event) => setPageIntros((prev) => ({ ...prev, records: event.target.value }))}
          />
        </div>

        <div style={{ marginTop: '0.75rem' }}>
          <label htmlFor="intro-brownlow">Brownlow Medal Page Intro</label>
          <textarea
            id="intro-brownlow"
            rows={4}
            value={pageIntros.brownlow}
            maxLength={2000}
            onChange={(event) => setPageIntros((prev) => ({ ...prev, brownlow: event.target.value }))}
          />
          <span className="muted" style={{ fontSize: '0.78rem' }}>
            Leave a blank line to split into multiple paragraphs.
          </span>
        </div>

        <div style={{ marginTop: '0.75rem' }}>
          <label htmlFor="intro-clubs">Clubs Page Intro</label>
          <textarea
            id="intro-clubs"
            rows={3}
            value={pageIntros.clubs}
            maxLength={2000}
            onChange={(event) => setPageIntros((prev) => ({ ...prev, clubs: event.target.value }))}
          />
        </div>

        <div style={{ marginTop: '0.75rem' }}>
          <label htmlFor="intro-draft">Draft Page Intro</label>
          <textarea
            id="intro-draft"
            rows={2}
            value={pageIntros.draft}
            maxLength={2000}
            onChange={(event) => setPageIntros((prev) => ({ ...prev, draft: event.target.value }))}
          />
        </div>
      </AdminSection>

      {/* ---------------------------------------------------------------- */}
      <AdminSection id="footer" title="Footer — every page">
        <p className="section-note">
          The colophon at the bottom of every page of the site <em>and</em> of the
          coming-soon page at <code>afldb.com</code>. There is one of them, so the two
          cannot drift apart. Plain text: the contact address below becomes the only
          link.
        </p>

        <ul style={{ listStyle: 'none', margin: '0 0 0.75rem', padding: 0 }}>
          {footer.lines.map((line, index) => (
            <li key={index} style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'baseline' }}>
                <span className="muted" style={{ fontSize: '0.72rem' }}>
                  Paragraph {index + 1}
                </span>
                <BlockControls
                  index={index}
                  count={footer.lines.length}
                  label={`paragraph ${index + 1}`}
                  onMove={(direction) => setFooter((previous) => ({
                    ...previous, lines: move(previous.lines, index, direction),
                  }))}
                  onRemove={() => setFooter((previous) => ({
                    ...previous, lines: previous.lines.filter((_, i) => i !== index),
                  }))}
                />
              </div>
              <textarea
                rows={2}
                value={line}
                maxLength={CONTENT_LIMITS.footerLineChars}
                aria-label={`Footer paragraph ${index + 1}`}
                onChange={(event) => setFooter((previous) => ({
                  ...previous,
                  lines: previous.lines.map((existing, i) => (
                    i === index ? event.target.value : existing
                  )),
                }))}
                style={{ marginTop: '0.4rem' }}
              />
            </li>
          ))}
        </ul>

        <button
          type="button"
          className="btn btn-secondary"
          disabled={footer.lines.length >= CONTENT_LIMITS.maxFooterLines}
          onClick={() => setFooter((previous) => ({ ...previous, lines: [...previous.lines, ''] }))}
        >
          Add paragraph
        </button>

        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))', marginTop: '1rem' }}>
          <div>
            <label htmlFor="footer-contact">Contact address</label>
            <input
              id="footer-contact"
              type="email"
              value={footer.contactEmail}
              maxLength={CONTENT_LIMITS.emailChars}
              onChange={(event) => setFooter((previous) => ({
                ...previous, contactEmail: event.target.value,
              }))}
            />
            <span className="muted" style={{ fontSize: '0.78rem' }}>
              Rendered as “Contact: …”. Leave empty to drop the line entirely.
            </span>
          </div>
          <div>
            <label htmlFor="footer-about">“About this data” link text</label>
            <input
              id="footer-about"
              value={footer.aboutLinkText}
              maxLength={CONTENT_LIMITS.labelChars}
              onChange={(event) => setFooter((previous) => ({
                ...previous, aboutLinkText: event.target.value,
              }))}
            />
            <span className="muted" style={{ fontSize: '0.78rem' }}>
              Appended to the first paragraph, linking to <code>/about</code>. Site pages
              only — the apex has no such page, so it omits this. Empty for no link.
            </span>
          </div>
        </div>
      </AdminSection>

      {/* ---------------------------------------------------------------- */}
      <AdminSection
        id="apex-hero"
        title="Coming soon — masthead and hero"
        note={hiddenNote('hero')}
      >
        <p className="section-note">
          The top of <code>afldb.com</code>. The button’s wording is set here; whether it
          appears at all, and what it asks, live on{' '}
          <a href="/admin/settings">Settings</a> — the button is drawn only while the
          early-access form is open.
        </p>

        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))' }}>
          <div>
            <label htmlFor="brand">Masthead</label>
            <input
              id="brand"
              value={content.header.brand}
              maxLength={CONTENT_LIMITS.labelChars}
              onChange={(event) => setHeader({ brand: event.target.value })}
            />
          </div>
          <div>
            <label htmlFor="tagline">Beside the masthead</label>
            <input
              id="tagline"
              value={content.header.tagline}
              maxLength={CONTENT_LIMITS.labelChars}
              onChange={(event) => setHeader({ tagline: event.target.value })}
            />
          </div>
        </div>

        <div style={{ marginTop: '0.75rem' }}>
          <label htmlFor="eyebrow">Eyebrow</label>
          <input
            id="eyebrow"
            value={content.hero.eyebrow}
            maxLength={CONTENT_LIMITS.labelChars}
            placeholder="Coming soon"
            onChange={(event) => setHero({ eyebrow: event.target.value })}
          />
        </div>

        <div style={{ marginTop: '0.75rem' }}>
          <label htmlFor="heading">Headline</label>
          <input
            id="heading"
            value={content.hero.heading}
            maxLength={CONTENT_LIMITS.headingChars}
            onChange={(event) => setHero({ heading: event.target.value })}
          />
          <span className="muted" style={{ fontSize: '0.78rem' }}>
            The page’s only <code>h1</code>. Emptying it restores the built-in wording
            rather than publishing a page with no heading.
          </span>
        </div>

        <div style={{ marginTop: '0.75rem' }}>
          <label htmlFor="lede">Opening paragraph</label>
          <textarea
            id="lede"
            rows={4}
            value={content.hero.lede}
            maxLength={CONTENT_LIMITS.ledeChars}
            onChange={(event) => setHero({ lede: event.target.value })}
          />
          <span className="muted" style={{ fontSize: '0.78rem' }}>
            Leave a blank line between paragraphs to split it in two.
          </span>
        </div>

        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))', marginTop: '0.75rem' }}>
          <div>
            <label htmlFor="ctaLabel">Button wording</label>
            <input
              id="ctaLabel"
              value={content.hero.ctaLabel}
              maxLength={CONTENT_LIMITS.labelChars}
              onChange={(event) => setHero({ ctaLabel: event.target.value })}
            />
            <span className="muted" style={{ fontSize: '0.78rem' }}>
              On the button that opens the request form, and on the mailto fallback below
              it. Cannot be empty — a button with no words is not a button.
            </span>
          </div>
          <div>
            <label htmlFor="requestEmail">Fallback request address</label>
            <input
              id="requestEmail"
              type="email"
              value={content.hero.requestEmail}
              maxLength={CONTENT_LIMITS.emailChars}
              onChange={(event) => setHero({ requestEmail: event.target.value })}
            />
            <span className="muted" style={{ fontSize: '0.78rem' }}>
              Only used by visitors with JavaScript disabled, who get a mailto link
              instead of the form.
            </span>
          </div>
        </div>
      </AdminSection>

      {/* ---------------------------------------------------------------- */}
      <AdminSection
        id="apex-stats"
        title="Hero statistics"
        note={hiddenNote('hero')}
      >
        <p className="section-note">
          Each figure is read from the database when the page is published, so it can
          never drift out of date the way the hand-typed snapshot used to. Type
          something into “Fixed value” to override one; clear the box to hand it back
          to the database. Remove every figure to drop the strip.
        </p>

        <ul style={{ listStyle: 'none', margin: '0 0 0.75rem', padding: 0 }}>
          {content.hero.stats.map((stat, index) => (
            <li key={stat.id} style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'baseline' }}>
                <span className="muted" style={{ fontSize: '0.72rem' }}>
                  Figure {index + 1}
                </span>
                <BlockControls
                  index={index}
                  count={content.hero.stats.length}
                  label={stat.label || `figure ${index + 1}`}
                  onMove={(direction) => setStats(move(content.hero.stats, index, direction))}
                  onRemove={() => setStats(content.hero.stats.filter((_, i) => i !== index))}
                />
              </div>

              <div
                className="grid"
                style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', marginTop: '0.4rem' }}
              >
                <div>
                  <label htmlFor={`stat-label-${stat.id}`}>Caption</label>
                  <input
                    id={`stat-label-${stat.id}`}
                    value={stat.label}
                    maxLength={CONTENT_LIMITS.labelChars}
                    onChange={(event) => updateStat(index, { label: event.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor={`stat-metric-${stat.id}`}>Figure</label>
                  <select
                    id={`stat-metric-${stat.id}`}
                    value={stat.metric}
                    onChange={(event) => updateStat(index, {
                      metric: event.target.value as ApexStat['metric'],
                    })}
                  >
                    {APEX_METRICS.map((metric) => (
                      <option key={metric.value} value={metric.value}>
                        {metric.label} (live)
                      </option>
                    ))}
                    <option value="custom">Fixed text only</option>
                  </select>
                </div>
                <div>
                  <label htmlFor={`stat-value-${stat.id}`}>
                    {stat.metric === 'custom' ? 'Value' : 'Fixed value (override)'}
                  </label>
                  <input
                    id={`stat-value-${stat.id}`}
                    value={stat.value}
                    maxLength={CONTENT_LIMITS.labelChars}
                    placeholder={stat.metric === 'custom' ? 'e.g. 1897' : 'live'}
                    onChange={(event) => updateStat(index, { value: event.target.value })}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>

        <button
          type="button"
          className="btn btn-secondary"
          disabled={content.hero.stats.length >= CONTENT_LIMITS.maxStats}
          onClick={() => setStats([...content.hero.stats, {
            id: newBlockId('stat'), label: '', metric: 'players', value: '',
          }])}
        >
          Add figure
        </button>

        <div style={{ marginTop: '1rem', maxWidth: '24rem' }}>
          <label htmlFor="statsLabel">Description of the strip</label>
          <input
            id="statsLabel"
            value={content.hero.statsLabel}
            maxLength={CONTENT_LIMITS.labelChars}
            onChange={(event) => setHero({ statsLabel: event.target.value })}
          />
          <span className="muted" style={{ fontSize: '0.78rem' }}>
            Read aloud by a screen reader to introduce the figures; never shown.
          </span>
        </div>
      </AdminSection>

      {/* ---------------------------------------------------------------- */}
      <AdminSection id="apex-screenshots" title="Screenshots">
        <p className="section-note">
          Every slot may be left empty. An empty wide shot publishes no wide shot; empty
          both halves of the pair and that band disappears too — which is the same thing
          as unticking it above, reached from whichever end you happen to be at.
        </p>

        <ImageField
          label="Wide shot, under the hero"
          optional
          help={isSectionVisible(content, 'wideShot')
            ? undefined
            : 'This band is switched off in Sections, so it will not be published.'}
          value={content.wideShot}
          options={options}
          onChange={(image) => setContent((previous) => ({ ...previous, wideShot: image }))}
          onUploaded={registerUpload}
        />

        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(20rem, 1fr))' }}>
          <div>
            <ImageField
              label="Pair, left"
              optional
              value={content.pair.light}
              options={options}
              onChange={(image) => setPair({ light: image })}
              onUploaded={registerUpload}
            />
            <label htmlFor="lightCaption">Caption</label>
            <input
              id="lightCaption"
              value={content.pair.lightCaption}
              maxLength={CONTENT_LIMITS.labelChars}
              onChange={(event) => setPair({ lightCaption: event.target.value })}
            />
          </div>
          <div>
            <ImageField
              label="Pair, right (phone)"
              optional
              value={content.pair.mobile}
              options={options}
              onChange={(image) => setPair({ mobile: image })}
              onUploaded={registerUpload}
            />
            <label htmlFor="mobileCaption">Caption</label>
            <input
              id="mobileCaption"
              value={content.pair.mobileCaption}
              maxLength={CONTENT_LIMITS.labelChars}
              onChange={(event) => setPair({ mobileCaption: event.target.value })}
            />
          </div>
        </div>
      </AdminSection>

      {/* ---------------------------------------------------------------- */}
      <AdminSection
        id="apex-features"
        title="“What it does” cards"
        note={hiddenNote('features')}
      >
        <div style={{ marginBottom: '0.75rem', maxWidth: '24rem' }}>
          <label htmlFor="features-heading">Section heading</label>
          <input
            id="features-heading"
            value={content.features.heading}
            maxLength={CONTENT_LIMITS.headingChars}
            onChange={(event) => setContent((previous) => ({
              ...previous, features: { ...previous.features, heading: event.target.value },
            }))}
          />
        </div>

        <ul style={{ listStyle: 'none', margin: '0 0 0.75rem', padding: 0 }}>
          {content.features.items.map((feature, index) => (
            <li key={feature.id} style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'baseline' }}>
                <span className="muted" style={{ fontSize: '0.72rem' }}>
                  Card {index + 1}
                </span>
                <BlockControls
                  index={index}
                  count={content.features.items.length}
                  label={feature.heading || `card ${index + 1}`}
                  onMove={(direction) => setFeatures(move(content.features.items, index, direction))}
                  onRemove={() => setFeatures(content.features.items.filter((_, i) => i !== index))}
                />
              </div>

              <div style={{ marginTop: '0.4rem' }}>
                <label htmlFor={`feature-heading-${feature.id}`}>Heading</label>
                <input
                  id={`feature-heading-${feature.id}`}
                  value={feature.heading}
                  maxLength={CONTENT_LIMITS.headingChars}
                  onChange={(event) => updateFeature(index, { heading: event.target.value })}
                />
              </div>

              <div style={{ marginTop: '0.5rem' }}>
                <label htmlFor={`feature-body-${feature.id}`}>Text</label>
                <textarea
                  id={`feature-body-${feature.id}`}
                  rows={3}
                  value={feature.body}
                  maxLength={CONTENT_LIMITS.bodyChars}
                  onChange={(event) => updateFeature(index, { body: event.target.value })}
                />
              </div>

              <div style={{ marginTop: '0.5rem' }}>
                <ImageField
                  label="Card image"
                  optional
                  value={feature.image}
                  options={options}
                  onChange={(image) => updateFeature(index, { image })}
                  onUploaded={registerUpload}
                />
              </div>
            </li>
          ))}
        </ul>

        <button
          type="button"
          className="btn btn-secondary"
          disabled={content.features.items.length >= CONTENT_LIMITS.maxFeatures}
          onClick={() => setFeatures([...content.features.items, {
            id: newBlockId('feature'), heading: '', body: '', image: null,
          }])}
        >
          Add card
        </button>
        {content.features.items.length >= CONTENT_LIMITS.maxFeatures && (
          <span className="muted" style={{ marginLeft: '0.5rem', fontSize: '0.78rem' }}>
            {CONTENT_LIMITS.maxFeatures} is the maximum.
          </span>
        )}
      </AdminSection>

      {/* ---------------------------------------------------------------- */}
      <AdminSection
        id="apex-notes"
        title="“Built like a record book” notes"
        note={hiddenNote('notes')}
      >
        <div style={{ marginBottom: '0.75rem', maxWidth: '24rem' }}>
          <label htmlFor="notes-heading">Section heading</label>
          <input
            id="notes-heading"
            value={content.notes.heading}
            maxLength={CONTENT_LIMITS.headingChars}
            onChange={(event) => setContent((previous) => ({
              ...previous, notes: { ...previous.notes, heading: event.target.value },
            }))}
          />
        </div>

        <ul style={{ listStyle: 'none', margin: '0 0 0.75rem', padding: 0 }}>
          {content.notes.items.map((note, index) => (
            <li key={note.id} style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'baseline' }}>
                <span className="muted" style={{ fontSize: '0.72rem' }}>Note {index + 1}</span>
                <BlockControls
                  index={index}
                  count={content.notes.items.length}
                  label={note.heading || `note ${index + 1}`}
                  onMove={(direction) => setNotes(move(content.notes.items, index, direction))}
                  onRemove={() => setNotes(content.notes.items.filter((_, i) => i !== index))}
                />
              </div>

              <div style={{ marginTop: '0.4rem' }}>
                <label htmlFor={`note-heading-${note.id}`}>Heading</label>
                <input
                  id={`note-heading-${note.id}`}
                  value={note.heading}
                  maxLength={CONTENT_LIMITS.headingChars}
                  onChange={(event) => updateNote(index, { heading: event.target.value })}
                />
              </div>

              <div style={{ marginTop: '0.5rem' }}>
                <label htmlFor={`note-body-${note.id}`}>Text</label>
                <textarea
                  id={`note-body-${note.id}`}
                  rows={3}
                  value={note.body}
                  maxLength={CONTENT_LIMITS.bodyChars}
                  onChange={(event) => updateNote(index, { body: event.target.value })}
                />
              </div>
            </li>
          ))}
        </ul>

        <button
          type="button"
          className="btn btn-secondary"
          disabled={content.notes.items.length >= CONTENT_LIMITS.maxNotes}
          onClick={() => setNotes([...content.notes.items, {
            id: newBlockId('note'), heading: '', body: '',
          }])}
        >
          Add note
        </button>
      </AdminSection>

      {/* ---------------------------------------------------------------- */}
      <AdminSection id="apex-meta" title="Search and sharing">
        <p className="section-note">
          What search engines list and what a shared link looks like. The canonical
          URL is <code>https://afldb.com/</code> and is set in code, not here: a typo
          in it would be invisible on the page and expensive in the index.
        </p>

        <div>
          <label htmlFor="meta-title">Browser and search-result title</label>
          <input
            id="meta-title"
            value={content.meta.title}
            maxLength={CONTENT_LIMITS.metaTitleChars}
            onChange={(event) => setMeta({ title: event.target.value })}
          />
        </div>

        <div style={{ marginTop: '0.75rem' }}>
          <label htmlFor="meta-description">Search-result description</label>
          <textarea
            id="meta-description"
            rows={3}
            value={content.meta.description}
            maxLength={CONTENT_LIMITS.metaDescriptionChars}
            onChange={(event) => setMeta({ description: event.target.value })}
          />
        </div>

        <div style={{ marginTop: '0.75rem' }}>
          <label htmlFor="og-title">Shared-link title</label>
          <input
            id="og-title"
            value={content.meta.ogTitle}
            maxLength={CONTENT_LIMITS.metaTitleChars}
            onChange={(event) => setMeta({ ogTitle: event.target.value })}
          />
          <span className="muted" style={{ fontSize: '0.78rem' }}>
            Empty falls back to the title above.
          </span>
        </div>

        <div style={{ marginTop: '0.75rem' }}>
          <label htmlFor="og-description">Shared-link description</label>
          <textarea
            id="og-description"
            rows={2}
            value={content.meta.ogDescription}
            maxLength={CONTENT_LIMITS.metaDescriptionChars}
            onChange={(event) => setMeta({ ogDescription: event.target.value })}
          />
        </div>

        <div style={{ marginTop: '0.75rem' }}>
          <ImageField
            label="Shared-link image"
            optional
            help="What appears when the link is posted to a chat or a social network.
              Leave it empty and the link shares as plain text instead of a card."
            value={content.meta.ogImage}
            options={options}
            onChange={(image) => setMeta({ ogImage: image })}
            onUploaded={registerUpload}
          />
        </div>

        <div>
          <label htmlFor="schema-description">Structured-data description</label>
          <textarea
            id="schema-description"
            rows={3}
            value={content.meta.schemaDescription}
            maxLength={CONTENT_LIMITS.metaDescriptionChars}
            onChange={(event) => setMeta({ schemaDescription: event.target.value })}
          />
          <span className="muted" style={{ fontSize: '0.78rem' }}>
            The machine-readable summary in the page’s JSON-LD block. Usually a longer,
            plainer version of the search description.
          </span>
        </div>
      </AdminSection>

      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', margin: '1.25rem 0' }}>
        <button className="btn" type="submit" disabled={saving}>
          {saving ? 'Saving and publishing…' : 'Save and publish'}
        </button>
        <a className="btn btn-secondary" href="/admin/content/preview" target="_blank" rel="noreferrer">
          Preview last saved →
        </a>
      </div>
    </form>
  );
}
