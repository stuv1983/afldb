import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { submitNlFeedbackForm } from '@/app/search/feedback-action';
import { recordNlFeedback } from '@/db/queries/nl/feedback';

vi.mock('@/db/queries/nl/feedback', () => ({
  recordNlFeedback: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@/lib/auth/session', () => ({
  requestIp: vi.fn(async () => '127.0.0.1'),
}));

describe('NL answer feedback boundary', () => {
  it('keeps the Server Action form owned by the server component boundary', () => {
    const serverComponent = readFileSync('src/components/NlAnswerFeedback.tsx', 'utf8');
    const clientControls = readFileSync('src/components/NlAnswerFeedbackControls.tsx', 'utf8');

    expect(serverComponent).not.toContain("'use client'");
    expect(serverComponent).toContain('action={submitNlFeedbackForm}');
    expect(serverComponent).toContain('name="clientRef"');
    expect(serverComponent.match(/<form\b/g)).toHaveLength(1);
    expect(serverComponent).not.toMatch(/import\s+\{[^}]*useActionState/);
    expect(serverComponent).not.toMatch(/\buseActionState\(/);

    expect(clientControls).toContain("'use client'");
    expect(clientControls).toContain('Did AFLDB understand this question?');
    expect(clientControls).toContain('name="verdict"');
    expect(clientControls).not.toContain('<form');
    expect(clientControls).not.toMatch(/import\s+\{[^}]*useActionState/);
    expect(clientControls).not.toMatch(/\buseActionState\(/);
  });

  it('keeps the plain Server Action form entrypoint submittable', async () => {
    const formData = new FormData();
    formData.set('clientRef', '3f2504e0-4f89-41d3-9a0c-0305e82c3301');
    formData.set('verdict', 'correct');

    await submitNlFeedbackForm(formData);

    expect(recordNlFeedback).toHaveBeenCalledWith({
      clientRef: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      verdict: 'correct',
      expectedAnswer: '',
    });
  });
});
