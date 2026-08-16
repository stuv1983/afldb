'use client';

import { useActionState, useState } from 'react';

import { EarlyAccessSettings } from '@/app/admin/settings/EarlyAccessSettings';
import { saveSiteSettings, type SettingsState } from '@/app/admin/settings/actions';
import {
  AFLW_LEADER_CATEGORIES,
  GRID_AUDIENCES,
  homeSection,
  type HomeLayout,
  type HomeSectionId,
  type SiteSettings,
} from '@/lib/site-settings';

/**
 * The whole of /admin/settings: one form, one Save.
 *
 * The layout editor is a small sibling of `ReorderableSections` — same drag
 * handle, same keyboard arrows — but it reorders a list of names rather than
 * the sections themselves, and its result is submitted rather than kept in
 * localStorage. The reader's own per-page order (that component) and the
 * site's published order (this one) are deliberately separate: a reader
 * rearranging their own view must not rewrite what every visitor sees.
 */
export function SettingsForm({
  settings,
  recordOptions,
  smtpConfigured,
}: {
  settings: SiteSettings;
  /** Career record categories, labelled server-side from RECORD_CATEGORIES. */
  recordOptions: { value: string; label: string }[];
  /** Whether AFLDB_SMTP_* is set, so the form can say why sending is off. */
  smtpConfigured: boolean;
}) {
  const [state, action, saving] = useActionState<SettingsState, FormData>(saveSiteSettings, {});
  const [layout, setLayout] = useState<HomeLayout>(settings.homeLayout);

  function move(id: HomeSectionId, direction: -1 | 1) {
    setLayout((previous) => {
      const order = [...previous.order];
      const i = order.indexOf(id);
      const j = i + direction;
      if (i < 0 || j < 0 || j >= order.length) return previous;
      [order[i], order[j]] = [order[j], order[i]];
      return { ...previous, order };
    });
  }

  function drop(draggedId: HomeSectionId, targetId: HomeSectionId) {
    setLayout((previous) => {
      const from = previous.order.indexOf(draggedId);
      const to = previous.order.indexOf(targetId);
      if (from < 0 || to < 0 || from === to) return previous;
      const order = previous.order.filter((id) => id !== draggedId);
      order.splice(order.indexOf(targetId) + (from < to ? 1 : 0), 0, draggedId);
      return { ...previous, order };
    });
  }

  function toggle(id: HomeSectionId, shown: boolean) {
    setLayout((previous) => ({
      ...previous,
      hidden: shown
        ? previous.hidden.filter((other) => other !== id)
        : [...previous.hidden, id],
    }));
  }

  const [dragging, setDragging] = useState<HomeSectionId | null>(null);

  return (
    <form action={action}>
      {state.message && <p className="notice">{state.message}</p>}
      {state.error && <p className="notice" role="alert">{state.error}</p>}

      <input type="hidden" name="order" value={layout.order.join(',')} />

      <section className="section">
        <h2>Home page</h2>
        <p className="section-note">
          Applies to both the AFL front page and the AFLW one, which carry the same
          layout. Untick to hide a section; drag the handle — or focus it and press
          ↑ / ↓ — to reorder. The two panel sections sit side by side when they are
          next to each other in this list.
        </p>

        <ul style={{ listStyle: 'none', margin: '0 0 1rem', padding: 0 }}>
          {layout.order.map((id, i) => {
            const section = homeSection(id);
            if (!section) return null;
            const shown = !layout.hidden.includes(id);
            return (
              <li
                key={id}
                onDragOver={(e) => { e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); if (dragging) drop(dragging, id); }}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.6rem',
                  padding: '0.55rem 0.7rem',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  marginBottom: '0.4rem',
                  background: dragging === id ? 'var(--bg-hover)' : 'var(--bg-subtle)',
                }}
              >
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`Reorder ${section.label}. Position ${i + 1} of ${layout.order.length}.`}
                  title="Drag, or press ↑ / ↓, to reorder"
                  draggable
                  onDragStart={(e) => {
                    setDragging(id);
                    e.dataTransfer.setData('text/plain', id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => setDragging(null)}
                  onKeyDown={(e) => {
                    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                    e.preventDefault();
                    move(id, e.key === 'ArrowUp' ? -1 : 1);
                  }}
                  style={{
                    cursor: 'grab',
                    color: 'var(--text-faint)',
                    letterSpacing: '-0.2em',
                    lineHeight: 1.6,
                  }}
                >
                  ⠿⠿
                </span>
                <label style={{ margin: 0, flex: 1, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    name="shown"
                    value={id}
                    checked={shown}
                    onChange={(e) => toggle(id, e.target.checked)}
                    style={{ marginRight: '0.45rem' }}
                  />
                  {section.label}
                  <span className="muted" style={{ display: 'block', fontSize: '0.75rem' }}>
                    {section.help}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          <div>
            <label htmlFor="homeRecord">Record of the week (AFL)</label>
            <select id="homeRecord" name="homeRecord" defaultValue={settings.homeRecord}>
              {recordOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="aflwLeaders">Record of the week (AFLW)</label>
            <select id="aflwLeaders" name="aflwLeaders" defaultValue={settings.aflwLeaders}>
              {AFLW_LEADER_CATEGORIES.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>Grid solver</h2>
        <p className="section-note">
          Who may reach <code>/grid-solver</code>. Everything above super admin is a
          publication decision: the page runs real queries against the whole record,
          so widening this widens what an unauthenticated visitor can ask the database.
        </p>
        {GRID_AUDIENCES.map((option) => (
          <label key={option.value} style={{ display: 'block', margin: '0 0 0.4rem', cursor: 'pointer' }}>
            <input
              type="radio"
              name="gridAudience"
              value={option.value}
              defaultChecked={settings.gridAudience === option.value}
              style={{ marginRight: '0.45rem' }}
            />
            {option.label}
            <span className="muted" style={{ marginLeft: '0.4rem', fontSize: '0.78rem' }}>
              {option.help}
            </span>
          </label>
        ))}
      </section>

      <EarlyAccessSettings
        open={settings.earlyAccessOpen}
        intro={settings.earlyAccessIntro}
        questions={settings.earlyAccessQuestions}
        notify={settings.earlyAccessNotify}
        notifyTo={settings.earlyAccessNotifyTo}
        smtpConfigured={smtpConfigured}
      />

      <button className="btn" type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Save settings'}
      </button>
    </form>
  );
}
