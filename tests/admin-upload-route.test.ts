/**
 * The CSV upload route (`/admin/upload/stage`, AFLDB-ISSUE-303, D-303-1).
 *
 * The form promises a 5 MB file; the Server Action it used to post to accepts 1 MB
 * (Next's `serverActions.bodySizeLimit` default, multipart included), so a 1-5 MB file
 * failed at the framework with a generic error. The decision (D-303-1 option c) is a
 * dedicated Route Handler with its own bound, which leaves the global action limit
 * alone and takes over the three jobs the framework did for an action: CSRF, the size
 * bound and, unchanged, authentication and authorisation.
 *
 * These cases drive the REAL route handler and the REAL request helpers with a mocked
 * session and a mocked staging pipeline, so they prove every decision the route makes
 * before it stages anything, and what it stages. They do not prove the framework's
 * body buffering or a real browser's `Origin`: the file's last describe pins the
 * statically checkable facts instead. No database.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireCapability: vi.fn(),
  audit: vi.fn(),
  stageSubmission: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({
  requireCapability: mocks.requireCapability,
  audit: mocks.audit,
}));
vi.mock('@/lib/ingest/pipeline', () => ({
  MAX_UPLOAD_BYTES: 5 * 1024 * 1024,
  stageSubmission: mocks.stageSubmission,
}));

import { POST } from '@/app/admin/upload/stage/route';
import {
  declaredLengthCheck,
  maxUploadBodyBytes,
  readBoundedBody,
  sameOriginRefusal,
  UPLOAD_ENVELOPE_SLACK_BYTES,
} from '@/lib/ingest/upload-request';

const MIB = 1024 * 1024;
const MAX_FILE = 5 * MIB;
const URL_ = 'https://dev.afldb.example/admin/upload/stage';
const SAME_ORIGIN = {
  host: 'dev.afldb.example',
  origin: 'https://dev.afldb.example',
  'sec-fetch-site': 'same-origin',
};
const ADMIN = { id: 7, email: 'uploader@example.test' };

/** A real multipart body, as bytes plus the content type that names its boundary. */
async function multipart(fileBytes: Uint8Array, dataset = 'match_results', name = 'results.csv') {
  const form = new FormData();
  form.set('dataset', dataset);
  form.set('file', new File([fileBytes as BlobPart], name, { type: 'text/csv' }));
  const response = new Response(form);
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get('content-type')!,
  };
}

const csvOf = (size: number) => {
  const head = Buffer.from('home,away\n');
  return new Uint8Array(Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length), 0x61)]));
};

function request(
  body: Uint8Array | ReadableStream<Uint8Array>,
  contentType: string,
  headers: Record<string, string> = SAME_ORIGIN,
  declare?: number | null,
): Request {
  const all: Record<string, string> = { ...headers, 'content-type': contentType };
  if (declare !== null && declare !== undefined) all['content-length'] = String(declare);
  return new Request(URL_, {
    method: 'POST',
    headers: all,
    body: body as BodyInit,
    ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
  } as RequestInit);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireCapability.mockResolvedValue(ADMIN);
  mocks.audit.mockResolvedValue(undefined);
  mocks.stageSubmission.mockResolvedValue({ ok: true, submissionId: 41, rowCount: 3, duplicate: false });
});

describe('a file between 1 MB and 5 MB is staged (the defect)', () => {
  it('stages a 1.5 MB CSV byte for byte and answers where the review page is', async () => {
    const csv = csvOf(Math.round(1.5 * MIB));
    const { bytes, contentType } = await multipart(csv);
    const response = await POST(request(bytes, contentType, SAME_ORIGIN, bytes.length));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true, submissionId: 41, duplicate: false, redirectTo: '/admin/submissions/41',
    });
    expect(mocks.stageSubmission).toHaveBeenCalledTimes(1);
    const [dataset, filename, content, adminId] = mocks.stageSubmission.mock.calls[0];
    expect([dataset, filename, adminId]).toEqual(['match_results', 'results.csv', 7]);
    expect(Buffer.compare(content, Buffer.from(csv))).toBe(0);
    expect(mocks.audit).toHaveBeenCalledWith('upload.staged',
      { dataset: 'match_results', filename: 'results.csv', submissionId: 41, rows: 3 },
      { userId: 7, label: 'uploader@example.test' });
  });

  it('stages a file of exactly 5 MiB, and refuses one byte more', async () => {
    const exact = await multipart(csvOf(MAX_FILE));
    expect((await POST(request(exact.bytes, exact.contentType, SAME_ORIGIN, exact.bytes.length))).status).toBe(200);
    expect(mocks.stageSubmission).toHaveBeenCalledTimes(1);

    mocks.stageSubmission.mockClear();
    const over = await multipart(csvOf(MAX_FILE + 1));
    const response = await POST(request(over.bytes, over.contentType, SAME_ORIGIN, over.bytes.length));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'The file exceeds the 5 MB limit.' });
    expect(mocks.stageSubmission).not.toHaveBeenCalled();
  });

  it('records a duplicate and a rejection with the same audit events as the old action', async () => {
    const { bytes, contentType } = await multipart(csvOf(200));
    mocks.stageSubmission.mockResolvedValueOnce({ ok: true, submissionId: 9, rowCount: 1, duplicate: true });
    expect(await (await POST(request(bytes, contentType))).json())
      .toMatchObject({ ok: true, duplicate: true, redirectTo: '/admin/submissions/9' });
    expect(mocks.audit).toHaveBeenLastCalledWith('upload.duplicate', expect.objectContaining({ submissionId: 9 }), expect.anything());

    mocks.stageSubmission.mockResolvedValueOnce({ ok: false, error: 'Missing column: away' });
    const rejected = await POST(request(bytes, contentType));
    expect(rejected.status).toBe(422);
    expect(await rejected.json()).toEqual({ error: 'Missing column: away' });
    expect(mocks.audit).toHaveBeenLastCalledWith('upload.rejected',
      { dataset: 'match_results', filename: 'results.csv', error: 'Missing column: away' },
      { userId: 7, label: 'uploader@example.test' });
  });

  it('answers a request with no file, no multipart body or an invalid length with a plain 400', async () => {
    const form = new FormData();
    form.set('dataset', 'match_results');
    const noFile = new Response(form);
    const noFileBytes = new Uint8Array(await noFile.arrayBuffer());
    const noFileResponse = await POST(request(noFileBytes, noFile.headers.get('content-type')!));
    expect(noFileResponse.status).toBe(400);
    expect(await noFileResponse.json()).toEqual({ error: 'Choose a CSV file.' });

    const notMultipart = await POST(request(new Uint8Array([1, 2, 3]), 'text/plain'));
    expect(notMultipart.status).toBe(400);
    expect(await notMultipart.json()).toEqual({ error: 'Malformed upload.' });

    const { bytes, contentType } = await multipart(csvOf(100));
    const badLength = await POST(new Request(URL_, {
      method: 'POST',
      headers: { ...SAME_ORIGIN, 'content-type': contentType, 'content-length': '12abc' },
      body: bytes as BodyInit,
    }));
    expect(badLength.status).toBe(400);
    expect(mocks.stageSubmission).not.toHaveBeenCalled();
  });
});

describe('authentication and authorisation are unchanged', () => {
  it('asks for the legacy-intake capability and stages nothing when it throws', async () => {
    const { bytes, contentType } = await multipart(csvOf(100));
    mocks.requireCapability.mockRejectedValueOnce(new Error('NEXT_REDIRECT /admin/login'));
    await expect(POST(request(bytes, contentType))).rejects.toThrow('NEXT_REDIRECT /admin/login');
    expect(mocks.requireCapability).toHaveBeenCalledWith('acquisition.legacyIntake');
    expect(mocks.stageSubmission).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('checks the session before reading any of the body', async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { pulled += 1; controller.enqueue(new Uint8Array(1024)); },
    }, { highWaterMark: 0 });
    mocks.requireCapability.mockRejectedValueOnce(new Error('NEXT_REDIRECT /admin/login'));
    await expect(POST(request(stream, 'multipart/form-data; boundary=x'))).rejects.toThrow('NEXT_REDIRECT');
    expect(pulled).toBe(0);
  });
});

describe('CSRF: a cross-site request is refused before the session is consulted', () => {
  const cases: Array<[string, Record<string, string>]> = [
    ['a cross-site Sec-Fetch-Site', { ...SAME_ORIGIN, 'sec-fetch-site': 'cross-site' }],
    ['a same-site (sibling) Sec-Fetch-Site', { ...SAME_ORIGIN, 'sec-fetch-site': 'same-site' }],
    ['a foreign Origin with no Sec-Fetch-Site', { host: SAME_ORIGIN.host, origin: 'https://evil.example' }],
    ['a missing Origin', { host: SAME_ORIGIN.host }],
    ['an opaque Origin', { host: SAME_ORIGIN.host, origin: 'null' }],
    ['an unparseable Origin', { host: SAME_ORIGIN.host, origin: 'not a url' }],
    ['an Origin on another port', { host: SAME_ORIGIN.host, origin: 'https://dev.afldb.example:8443' }],
    ['no host at all', { origin: SAME_ORIGIN.origin }],
  ];
  for (const [label, headers] of cases) {
    it(`refuses ${label}`, async () => {
      const { bytes, contentType } = await multipart(csvOf(100));
      const response = await POST(request(bytes, contentType, headers));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'This upload did not come from this site.' });
      expect(mocks.requireCapability).not.toHaveBeenCalled();
      expect(mocks.stageSubmission).not.toHaveBeenCalled();
    });
  }

  it('accepts the proxied form: the public host arrives as X-Forwarded-Host, the Origin matches it', () => {
    const headers = new Headers({
      origin: 'https://dev.afldb.example', 'x-forwarded-host': 'dev.afldb.example', host: '127.0.0.1:3100',
    });
    expect(sameOriginRefusal(headers)).toBeNull();
    // The first forwarded value is the client-facing one, as in Next's own check.
    expect(sameOriginRefusal(new Headers({
      origin: 'https://dev.afldb.example', 'x-forwarded-host': 'dev.afldb.example, proxy.internal',
    }))).toBeNull();
    // A forwarded host that is not the Origin's is refused even if Host agrees with the Origin.
    expect(sameOriginRefusal(new Headers({
      origin: 'https://dev.afldb.example', 'x-forwarded-host': 'evil.example', host: 'dev.afldb.example',
    }))).not.toBeNull();
  });

  it('accepts a request with no Sec-Fetch-Site (an older browser) when the Origin matches', () => {
    expect(sameOriginRefusal(new Headers({ origin: 'https://dev.afldb.example', host: 'dev.afldb.example' }))).toBeNull();
  });
});

describe('the size bound holds whatever the client declares', () => {
  it('refuses a declared length over the file limit plus the envelope without reading the body', async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { pulled += 1; controller.enqueue(new Uint8Array(1024)); },
    }, { highWaterMark: 0 });
    const declared = maxUploadBodyBytes(MAX_FILE) + 1;
    const response = await POST(request(stream, 'multipart/form-data; boundary=x', SAME_ORIGIN, declared));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'The file exceeds the 5 MB limit.' });
    expect(pulled).toBe(0);
    expect(mocks.stageSubmission).not.toHaveBeenCalled();
  });

  it('stops reading a chunked body that never declares a length, one chunk past the bound at most', async () => {
    const CHUNK = 64 * 1024;
    let pulled = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      // Finite on purpose (about 13 MiB): a read with no bound then fails an assertion
      // instead of never returning.
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(CHUNK));
        if (pulled >= 200) controller.close();
      },
      cancel() { cancelled = true; },
    });
    const response = await POST(request(stream, 'multipart/form-data; boundary=x'));
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    // The bound is 5 MiB + 16 KiB: nothing like the unbounded stream was consumed.
    expect(pulled * CHUNK).toBeLessThanOrEqual(maxUploadBodyBytes(MAX_FILE) + 2 * CHUNK);
    expect(mocks.stageSubmission).not.toHaveBeenCalled();
  });

  it('ignores a declared length that lies low: the read bound still applies', async () => {
    const big = new Uint8Array(maxUploadBodyBytes(MAX_FILE) + 1);
    const response = await POST(request(big, 'multipart/form-data; boundary=x', SAME_ORIGIN, 100));
    // The runtime may reconcile the declared length with the body or not; either way it is refused.
    expect([400, 413]).toContain(response.status);
    expect(mocks.stageSubmission).not.toHaveBeenCalled();
  });
});

describe('the request helpers on their own', () => {
  it('declaredLengthCheck: absent is ok, non-numeric is invalid, over the bound is too large', () => {
    const bound = maxUploadBodyBytes(MAX_FILE);
    expect(bound).toBe(MAX_FILE + UPLOAD_ENVELOPE_SLACK_BYTES);
    expect(declaredLengthCheck(new Headers(), bound)).toEqual({ kind: 'ok' });
    expect(declaredLengthCheck(new Headers({ 'content-length': String(bound) }), bound)).toEqual({ kind: 'ok' });
    expect(declaredLengthCheck(new Headers({ 'content-length': String(bound + 1) }), bound)).toEqual({ kind: 'too_large' });
    for (const bad of ['-1', '1.5', '1e6', ' ', 'abc', '0x10']) {
      expect(declaredLengthCheck(new Headers({ 'content-length': bad }), bound), bad).toEqual({ kind: 'invalid' });
    }
  });

  it('readBoundedBody: returns the bytes in order, an empty body as empty, and null past the bound', async () => {
    const stream = (parts: number[][]) => new ReadableStream<Uint8Array>({
      start(controller) { for (const p of parts) controller.enqueue(new Uint8Array(p)); controller.close(); },
    });
    expect(Array.from((await readBoundedBody({ body: stream([[1, 2], [3], [4, 5]]) }, 5))!)).toEqual([1, 2, 3, 4, 5]);
    expect(await readBoundedBody({ body: stream([[1, 2], [3], [4, 5]]) }, 4)).toBeNull();
    expect(await readBoundedBody({ body: null }, 4)).toEqual(new Uint8Array(0));
    expect((await readBoundedBody({ body: stream([]) }, 0))!.length).toBe(0);
  });
});

describe('what is pinned statically (the framework and the browser are not exercised here)', () => {
  const root = process.cwd();
  const read = (relative: string) => readFileSync(join(root, relative), 'utf8').replace(/\r\n/g, '\n');
  const route = read('src/app/admin/upload/stage/route.ts');
  const code = route.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  it('the route checks the origin first, then the session, then the bound, then reads the body', () => {
    const order = [
      "sameOriginRefusal(request.headers)",
      "await requireCapability('acquisition.legacyIntake')",
      'declaredLengthCheck(request.headers, MAX_BODY_BYTES)',
      'await readBoundedBody(request, MAX_BODY_BYTES)',
      'formData()',
      'await stageSubmission(',
    ].map((needle) => code.indexOf(needle));
    expect(order.every((i) => i > -1), JSON.stringify(order)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The body is never read by anything but the bounded reader before the session is checked.
    expect(code.indexOf('request.formData')).toBe(-1);
    expect(code.indexOf('request.json')).toBe(-1);
    expect(code.indexOf('request.arrayBuffer')).toBe(-1);
  });

  it('the limit is the pipeline\'s own 5 MiB, and the global Server Action limit is untouched', () => {
    expect(read('src/lib/ingest/pipeline.ts')).toContain('export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;');
    expect(code).toContain('maxUploadBodyBytes(MAX_UPLOAD_BYTES)');
    // D-303-1 option (c): raising the project-wide limit was the alternative that was NOT chosen.
    expect(read('next.config.ts')).not.toMatch(/bodySizeLimit/);
  });

  it('the form posts to the route, and the 1 MB Server Action it replaced is gone', () => {
    const form = read('src/app/admin/upload/UploadForm.tsx');
    expect(form).toContain("fetch('/admin/upload/stage'");
    expect(form).toContain("credentials: 'same-origin'");
    expect(form).not.toContain('useActionState');
    expect(form).not.toContain('@/app/admin/upload/actions');
    expect(() => read('src/app/admin/upload/actions.ts')).toThrow();
  });

  it('the page still gates on the same capability the route enforces', () => {
    expect(read('src/app/admin/upload/page.tsx')).toContain("await requireCapability('acquisition.legacyIntake')");
  });
});
