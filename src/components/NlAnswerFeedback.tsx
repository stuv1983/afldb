'use client';

import { useActionState, useState } from 'react';

import { submitNlFeedback, type NlFeedbackState } from '@/app/search/feedback-action';
import { NL_FEEDBACK_MAX_LENGTH } from '@/search/nl/feedback-spec';

const INITIAL: NlFeedbackState = { status: 'idle' };

/**
 * "Was this search correct?" under a natural-language answer.
 *
 * Small and dismissible by design: it sits below the answer rather than
 * interrupting it, and a reader who does not care can close it and get
 * on with reading. It asks about the INTERPRETATION, not the football --
 * "did AFLDB understand you" is the thing a reader can judge from
 * looking at the page, and the thing the parser can actually be fixed
 * against.
 *
 * The "no" path asks what the answer should have been, because that free
 * text is the whole value: "wrong" tells us a row exists, "should have
 * been Tony Lockett, 1360" tells us which rule to fix.
 *
 * It degrades rather than breaking without JavaScript: it is a plain
 * <form> bound to a server action, and both buttons are real submits, so
 * a reader with scripting off still records a verdict. Only the free
 * text needs JS, because revealing it takes a first click that cancels
 * the submit -- so the no-JS path loses the prose, not the signal.
 */
export function NlAnswerFeedback({ clientRef }: { clientRef: string }) {
  const [state, formAction, pending] = useActionState(submitNlFeedback, INITIAL);
  const [choice, setChoice] = useState<'none' | 'incorrect'>('none');
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  if (state.status === 'thanks') {
    return (
      <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.75rem' }}>
        Thanks — that goes straight to the people improving search.
      </p>
    );
  }

  return (
    <form
      action={formAction}
      style={{
        marginTop: '0.9rem',
        paddingTop: '0.7rem',
        borderTop: '1px solid var(--rule, rgba(128,128,128,0.25))',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '0.5rem',
      }}
    >
      <input type="hidden" name="clientRef" value={clientRef} />

      <span className="muted" style={{ fontSize: '0.85rem' }}>
        Did AFLDB understand this question?
      </span>

      <button
        type="submit"
        name="verdict"
        value="correct"
        disabled={pending}
        style={{ fontSize: '0.85rem' }}
      >
        Yes
      </button>

      {/* Always a real submit, so that with JavaScript off this button
          records the verdict rather than doing nothing. With JavaScript
          on, the FIRST click cancels the submit and reveals the textarea
          instead; the second click sends it. That ordering is what makes
          the no-JS path a graceful degradation (verdict recorded, no
          prose) rather than a dead control. */}
      <button
        type="submit"
        name="verdict"
        value="incorrect"
        disabled={pending}
        onClick={(event) => {
          if (choice === 'none') {
            event.preventDefault();
            setChoice('incorrect');
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
            Please don’t include anything personal — this is stored anonymously.
          </p>
        </div>
      )}

      {state.status === 'error' && state.message && (
        <p className="muted" style={{ flexBasis: '100%', fontSize: '0.8rem' }}>{state.message}</p>
      )}

      <noscript>
        <span className="muted" style={{ flexBasis: '100%', fontSize: '0.8rem' }}>
          “No” records that the question was misread. To add what the answer should have been,
          enable JavaScript.
        </span>
      </noscript>
    </form>
  );
}
