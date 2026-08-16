'use client';

import { useState } from 'react';

import { AdminSection } from '@/app/admin/AdminSection';
import { EARLY_ACCESS_PRESETS } from '@/lib/early-access-presets';
import {
  EARLY_ACCESS_LIMITS,
  isChoiceType,
  slugifyQuestionId,
  type EarlyAccessQuestion,
  type EarlyAccessQuestionType,
} from '@/lib/site-settings';

/**
 * The early-access question builder, and the notification settings beside it.
 *
 * Rendered inside the one `<form>` of /admin/settings, so it submits with
 * everything else. The question list is edited in React state and carried as
 * one hidden JSON field: the server re-parses it through
 * `parseEarlyAccessQuestions` regardless, so this editor is a convenience and
 * never the validation — the same contract the layout editor above it has.
 *
 * Ids are the thing to be careful with. An answer is stored under its
 * question's id, so editing a LABEL keeps every past answer readable while
 * changing an id orphans them. The id is therefore generated once, from the
 * first label typed, and then shown read-only rather than tracking the label.
 */

const TYPE_LABELS: { value: EarlyAccessQuestionType; label: string; help: string }[] = [
  { value: 'short', label: 'Short text', help: 'One line.' },
  { value: 'long', label: 'Long text', help: 'A few sentences.' },
  { value: 'select', label: 'Choice', help: 'One of the options below.' },
  { value: 'multi', label: 'Select all that apply', help: 'Any number of the options below.' },
];

export function EarlyAccessSettings({
  open,
  intro,
  questions: initialQuestions,
  notify,
  notifyTo,
  smtpConfigured,
}: {
  open: boolean;
  intro: string;
  questions: EarlyAccessQuestion[];
  notify: boolean;
  notifyTo: string;
  smtpConfigured: boolean;
}) {
  const [questions, setQuestions] = useState<EarlyAccessQuestion[]>(initialQuestions);

  function update(index: number, patch: Partial<EarlyAccessQuestion>) {
    setQuestions((previous) => previous.map(
      (question, i) => (i === index ? { ...question, ...patch } : question),
    ));
  }

  function add() {
    setQuestions((previous) => {
      if (previous.length >= EARLY_ACCESS_LIMITS.maxQuestions) return previous;
      // A placeholder id, replaced by one derived from the label the first
      // time the label is edited while it is still untouched.
      return [...previous, {
        id: '',
        label: '',
        type: 'short' as const,
        required: false,
      }];
    });
  }

  function remove(index: number) {
    setQuestions((previous) => previous.filter((_, i) => i !== index));
  }

  function move(index: number, direction: -1 | 1) {
    setQuestions((previous) => {
      const next = [...previous];
      const target = index + direction;
      if (target < 0 || target >= next.length) return previous;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  const full = questions.length >= EARLY_ACCESS_LIMITS.maxQuestions;

  const asked = new Set(questions.map((question) => question.id));

  /**
   * Opt a suggested question in or out.
   *
   * Removing one stops it being asked; it never deletes an answer already
   * given to it, and adding it back restores the same id, so its history
   * reunites with it. That is the whole reason presets carry fixed ids.
   */
  function togglePreset(preset: EarlyAccessQuestion, on: boolean) {
    setQuestions((previous) => {
      if (!on) return previous.filter((question) => question.id !== preset.id);
      if (previous.some((question) => question.id === preset.id)) return previous;
      if (previous.length >= EARLY_ACCESS_LIMITS.maxQuestions) return previous;
      // A copy, so editing it afterwards cannot write back into the catalogue.
      return [...previous, { ...preset, options: preset.options ? [...preset.options] : undefined }];
    });
  }

  function toggleGroup(group: typeof EARLY_ACCESS_PRESETS[number], on: boolean) {
    setQuestions((previous) => {
      if (!on) {
        const ids = new Set(group.questions.map((question) => question.id));
        return previous.filter((question) => !ids.has(question.id));
      }
      const next = [...previous];
      for (const preset of group.questions) {
        if (next.some((question) => question.id === preset.id)) continue;
        if (next.length >= EARLY_ACCESS_LIMITS.maxQuestions) break;
        next.push({ ...preset, options: preset.options ? [...preset.options] : undefined });
      }
      return next;
    });
  }

  return (
    <AdminSection id="settings-early-access" title="Early access requests">
      <p className="section-note">
        The form behind the “Request early access” button on{' '}
        <code>afldb.com</code>. A request never admits anybody by itself — it queues a
        row for review at <a href="/admin/access">Access</a>, where approving it
        allowlists the email through the normal path.
      </p>

      <label style={{ display: 'block', margin: '0 0 1rem', cursor: 'pointer' }}>
        <input
          type="checkbox"
          name="earlyAccessOpen"
          value="on"
          defaultChecked={open}
          style={{ marginRight: '0.45rem' }}
        />
        Accept requests
        <span className="muted" style={{ marginLeft: '0.4rem', fontSize: '0.78rem' }}>
          Unticked, the button disappears from the page and the endpoint refuses
          submissions.
        </span>
      </label>

      <div style={{ marginBottom: '1.25rem' }}>
        <label htmlFor="earlyAccessIntro">Intro text</label>
        <textarea
          id="earlyAccessIntro"
          name="earlyAccessIntro"
          rows={3}
          maxLength={EARLY_ACCESS_LIMITS.introChars}
          defaultValue={intro}
        />
        <span className="muted" style={{ fontSize: '0.78rem' }}>
          Shown above the form. Left empty, the built-in wording is used.
        </span>
      </div>

      <h3 style={{ fontSize: '0.95rem', marginBottom: '0.35rem' }}>Questions</h3>
      <p className="section-note" style={{ marginTop: 0 }}>
        Email address is always asked and is not listed here: approving a request
        allowlists that address, so the flow has no meaning without it. Name is always
        asked and always optional. Editing a question’s wording keeps its previous
        answers; removing it hides the question but never deletes what people wrote.
      </p>

      <input
        type="hidden"
        name="earlyAccessQuestions"
        value={JSON.stringify(questions)}
      />

      <details
        style={{
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '0.6rem 0.7rem',
          marginBottom: '0.85rem',
        }}
      >
        <summary style={{ cursor: 'pointer', fontSize: '0.9rem' }}>
          Suggested questions
          <span className="muted" style={{ marginLeft: '0.4rem', fontSize: '0.78rem' }}>
            {asked.size > 0
              ? `${EARLY_ACCESS_PRESETS.flatMap((group) => group.questions)
                .filter((preset) => asked.has(preset.id)).length} of `
              : ''}
            {EARLY_ACCESS_PRESETS.reduce((total, group) => total + group.questions.length, 0)}{' '}
            ready-made questions to tick on or off
          </span>
        </summary>

        <p className="section-note" style={{ marginTop: '0.6rem' }}>
          Ticking one adds it to the list below, where it can be reworded, reordered or
          made required like any other. Unticking stops it being asked but never
          deletes an answer already given to it — the ids are fixed, so ticking it
          again later reunites the question with its history.
        </p>

        {EARLY_ACCESS_PRESETS.map((group) => {
          const chosen = group.questions.filter((preset) => asked.has(preset.id)).length;
          return (
            <div key={group.id} style={{ marginBottom: '0.9rem' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                <h4 style={{ fontSize: '0.88rem', margin: '0.5rem 0 0.15rem' }}>
                  {group.title}
                </h4>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => toggleGroup(group, chosen < group.questions.length)}
                >
                  {chosen < group.questions.length ? 'Add all' : 'Remove all'}
                </button>
              </div>
              <p className="muted" style={{ fontSize: '0.78rem', margin: '0 0 0.35rem' }}>
                {group.help}
              </p>

              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {group.questions.map((preset) => {
                  const on = asked.has(preset.id);
                  return (
                    <li key={preset.id} style={{ padding: '0.12rem 0' }}>
                      <label style={{ cursor: 'pointer', display: 'flex', gap: '0.45rem', alignItems: 'baseline' }}>
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={!on && full}
                          onChange={(e) => togglePreset(preset, e.target.checked)}
                        />
                        <span>
                          {preset.label}
                          <span className="muted" style={{ marginLeft: '0.4rem', fontSize: '0.75rem' }}>
                            {TYPE_LABELS.find((type) => type.value === preset.type)?.label}
                            {preset.options ? ` · ${preset.options.length} options` : ''}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </details>

      <ul style={{ listStyle: 'none', margin: '0 0 0.75rem', padding: 0 }}>
        {questions.map((question, index) => (
          <li
            key={index}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              background: 'var(--bg-subtle)',
              padding: '0.7rem',
              marginBottom: '0.5rem',
            }}
          >
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline' }}>
              <span
                className="muted"
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}
                title="The key answers are stored under. Fixed once set."
              >
                {question.id || '(new)'}
              </span>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.3rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label={`Move “${question.label || 'question'}” up`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => move(index, 1)}
                  disabled={index === questions.length - 1}
                  aria-label={`Move “${question.label || 'question'}” down`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => remove(index)}
                  aria-label={`Remove “${question.label || 'question'}”`}
                >
                  Remove
                </button>
              </span>
            </div>

            <div style={{ marginTop: '0.5rem' }}>
              <label htmlFor={`ea-label-${index}`}>Question</label>
              <input
                id={`ea-label-${index}`}
                value={question.label}
                maxLength={EARLY_ACCESS_LIMITS.labelChars}
                placeholder="What would you use AFLDB for?"
                onChange={(e) => {
                  const label = e.target.value;
                  // Only ever assign an id while the question is new. Once it
                  // has one, answers may already be keyed by it.
                  update(index, question.id
                    ? { label }
                    : { label, id: label.trim() ? slugifyQuestionId(label) : '' });
                }}
              />
            </div>

            <div style={{ marginTop: '0.5rem' }}>
              <label htmlFor={`ea-help-${index}`}>Hint (optional)</label>
              <input
                id={`ea-help-${index}`}
                value={question.help ?? ''}
                maxLength={EARLY_ACCESS_LIMITS.helpChars}
                onChange={(e) => update(index, { help: e.target.value })}
              />
            </div>

            <div
              className="grid"
              style={{
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                marginTop: '0.5rem',
              }}
            >
              <div>
                <label htmlFor={`ea-type-${index}`}>Answer type</label>
                <select
                  id={`ea-type-${index}`}
                  value={question.type}
                  onChange={(e) => update(index, {
                    type: e.target.value as EarlyAccessQuestionType,
                  })}
                >
                  {TYPE_LABELS.map((type) => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
              </div>
              <div style={{ alignSelf: 'end' }}>
                <label style={{ cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={question.required}
                    onChange={(e) => update(index, { required: e.target.checked })}
                    style={{ marginRight: '0.45rem' }}
                  />
                  Required
                </label>
              </div>
            </div>

            {isChoiceType(question.type) && (
              <div style={{ marginTop: '0.5rem' }}>
                <label htmlFor={`ea-options-${index}`}>Options, one per line</label>
                <textarea
                  id={`ea-options-${index}`}
                  rows={Math.min(12, Math.max(3, (question.options ?? []).length + 1))}
                  value={(question.options ?? []).join('\n')}
                  onChange={(e) => update(index, {
                    options: e.target.value.split('\n'),
                  })}
                />
                <span className="muted" style={{ fontSize: '0.78rem' }}>
                  A choice with no options is dropped on save — it could not be answered.
                  {question.type === 'multi'
                    && ' Answers are stored as a list, so each tick stays a separate fact.'}
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>

      <button
        type="button"
        className="btn btn-secondary"
        onClick={add}
        disabled={full}
      >
        Add question
      </button>
      {full && (
        <span className="muted" style={{ marginLeft: '0.5rem', fontSize: '0.78rem' }}>
          {EARLY_ACCESS_LIMITS.maxQuestions} is the maximum.
        </span>
      )}

      <h3 style={{ fontSize: '0.95rem', margin: '1.5rem 0 0.35rem' }}>Notification</h3>
      <p className="section-note" style={{ marginTop: 0 }}>
        {smtpConfigured
          ? 'An SMTP relay is configured on this server.'
          : 'No SMTP relay is configured on this server, so nothing can be sent yet. '
            + 'Set AFLDB_SMTP_* in .env. Requests are still saved and reviewable either way.'}
      </p>

      <label style={{ display: 'block', margin: '0 0 0.6rem', cursor: 'pointer' }}>
        <input
          type="checkbox"
          name="earlyAccessNotify"
          value="on"
          defaultChecked={notify}
          disabled={!smtpConfigured}
          style={{ marginRight: '0.45rem' }}
        />
        Email me each new request
      </label>

      <div style={{ maxWidth: '24rem' }}>
        <label htmlFor="earlyAccessNotifyTo">Send to</label>
        <input
          id="earlyAccessNotifyTo"
          name="earlyAccessNotifyTo"
          type="email"
          defaultValue={notifyTo}
          maxLength={200}
        />
      </div>
    </AdminSection>
  );
}
