'use client';

import { startTransition, type FormEvent } from 'react';

/**
 * Submit a `useActionState` action WITHOUT React 19's automatic form reset.
 *
 * `<form action={fn}>` resets every uncontrolled field once the action settles, even when the action
 * REFUSED. A sealed-season edit without its correction note is refused (V2-GAP-006), and the reset
 * would throw away the edit the administrator had just typed, so they would have to retype all of it
 * to add one sentence. Using this as `onSubmit` keeps the fields as typed; a successful save leaves
 * them showing what was saved. The action itself, its pending state and its result are unchanged.
 */
export function keepFormOnSubmit(formAction: (formData: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const formData = new FormData(event.currentTarget, submitter);
    startTransition(() => formAction(formData));
  };
}
