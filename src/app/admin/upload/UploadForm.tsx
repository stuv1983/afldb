'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

type DatasetOption = {
  key: string;
  title: string;
  description: string;
  requiredColumns: string[];
};

type UploadState = { error?: string };

const SESSION_ENDED = 'Your session may have ended. Reload the page and sign in again.';

/**
 * Posts the CSV to `/admin/upload/stage`, a Route Handler, rather than to a Server
 * Action: Server Actions accept 1 MB and this form promises 5 MB (AFLDB-ISSUE-303).
 * The markup is unchanged from the Server Action form; only where it posts differs.
 */
export function UploadForm({ datasets }: { datasets: DatasetOption[] }) {
  const router = useRouter();
  const [state, setState] = useState<UploadState>({});
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setState({});
    try {
      const response = await fetch('/admin/upload/stage', {
        method: 'POST',
        body: new FormData(event.currentTarget),
        credentials: 'same-origin',
      });
      // A session that has ended is answered with a redirect to the sign-in page, which
      // fetch follows to HTML: anything that is not this route's JSON is that case.
      const isJson = (response.headers.get('content-type') ?? '').includes('application/json');
      const body = isJson
        ? await response.json().catch(() => null) as { error?: string; redirectTo?: string } | null
        : null;
      if (response.ok && body?.redirectTo) {
        router.push(body.redirectTo);
        return;
      }
      setState({ error: body?.error ?? (isJson ? 'The upload failed.' : SESSION_ENDED) });
    } catch {
      setState({ error: 'The upload could not be sent. Check your connection and try again.' });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'grid', gap: '0.75rem', maxWidth: '32rem' }}>
      <label>
        Dataset
        <select name="dataset" required style={{ width: '100%' }}>
          {datasets.map((d) => (
            <option key={d.key} value={d.key}>{d.title}</option>
          ))}
        </select>
      </label>
      <label>
        CSV file
        <input name="file" type="file" accept=".csv,text/csv" required
          style={{ width: '100%' }} />
      </label>
      <button className="btn" type="submit" disabled={pending}>
        {pending ? 'Staging…' : 'Stage for review'}
      </button>
      {state.error && <p className="notice" role="alert">{state.error}</p>}
    </form>
  );
}
