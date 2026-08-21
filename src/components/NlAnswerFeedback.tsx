import { submitNlFeedbackForm } from '@/app/search/feedback-action';
import { NlAnswerFeedbackControls } from '@/components/NlAnswerFeedbackControls';

/**
 * Server-rendered feedback form under a natural-language answer.
 *
 * The form action stays on the server side so the initial HTML owns the
 * Server Action fields without hydrating a `useActionState` form boundary.
 * The small client child keeps the reveal/dismiss/pending affordances.
 */
export function NlAnswerFeedback({ clientRef }: { clientRef: string }) {
  return (
    <form
      action={submitNlFeedbackForm}
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
      <NlAnswerFeedbackControls />
      <noscript>
        <span className="muted" style={{ flexBasis: '100%', fontSize: '0.8rem' }}>
          The No button records that the question was misread. To add what the answer should
          have been, enable JavaScript.
        </span>
      </noscript>
    </form>
  );
}
