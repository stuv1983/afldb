'use client';

import { useActionState } from 'react';

import { uploadSubmission, type UploadState } from '@/app/admin/upload/actions';

type DatasetOption = {
  key: string;
  title: string;
  description: string;
  requiredColumns: string[];
};

export function UploadForm({ datasets }: { datasets: DatasetOption[] }) {
  const [state, action, pending] = useActionState<UploadState, FormData>(uploadSubmission, {});

  return (
    <form action={action} style={{ display: 'grid', gap: '0.75rem', maxWidth: '32rem' }}>
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
