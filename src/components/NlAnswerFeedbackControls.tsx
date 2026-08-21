'use client';

import { useState } from 'react';

import { NL_FEEDBACK_MAX_LENGTH } from '@/search/nl/feedback-spec';

export function NlAnswerFeedbackControls() {
  const [choice, setChoice] = useState<'none' | 'incorrect'>('none');
  const [dismissed, setDismissed] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  if (dismissed) return null;

  if (submitted) {
    return (
      <p className="muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
        Thanks - that goes straight to the people improving search.
      </p>
    );
  }

  return (
    <>
      <span className="muted" style={{ fontSize: '0.85rem' }}>
        Did AFLDB understand this question?
      </span>

      <button
        type="submit"
        name="verdict"
        value="correct"
        onClick={() => setSubmitted(true)}
        style={{ fontSize: '0.85rem' }}
      >
        Yes
      </button>

      <button
        type="submit"
        name="verdict"
        value="incorrect"
        onClick={(event) => {
          if (choice === 'none') {
            event.preventDefault();
            setChoice('incorrect');
          } else {
            setSubmitted(true);
          }
        }}
        style={{ fontSize: '0.85rem' }}
      >
        No
      </button>

      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="muted"
        aria-label="Dismiss this question"
        style={{ fontSize: '0.85rem', background: 'none', border: 'none', cursor: 'pointer' }}
      >
        Dismiss
      </button>

      {choice === 'incorrect' && (
        <div style={{ flexBasis: '100%', marginTop: '0.4rem' }}>
          <label
            htmlFor="nl-feedback-expected"
            className="muted"
            style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem' }}
          >
            What should the answer have been? (optional)
          </label>
          <textarea
            id="nl-feedback-expected"
            name="expectedAnswer"
            rows={3}
            maxLength={NL_FEEDBACK_MAX_LENGTH}
            placeholder="e.g. it should have been Tony Lockett's 1997 season, not his career total"
            style={{ width: '100%', fontSize: '0.85rem' }}
          />
          <p className="muted" style={{ fontSize: '0.75rem', marginTop: '0.3rem' }}>
            Please don't include anything personal - this is stored anonymously.
          </p>
        </div>
      )}
    </>
  );
}
