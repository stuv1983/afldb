/**
 * The CSV upload route (`/admin/upload/stage`) after AFLDB V2 Stage 5 retired it
 * (V2-GAP-013, docs/v2/legacy-disposition.md L1).
 *
 * Originally AFLDB-ISSUE-303 (D-303-1): a dedicated Route Handler took the documented 5 MB
 * file that the 1 MB Server Action refused, and did CSRF, the size bound and authorisation
 * itself. AFLDB V2 removed the path (CSV never reaches a runtime table), so the route now keeps
 * only the two checks that stood in front of the old behaviour -- the same-origin check and
 * `requireCapability('acquisition.legacyIntake')`, in that order -- and then answers HTTP 410
 * with the typed refusal and one audit row. It never reads the body and never stages anything.
 *
 * These cases drive the REAL route handler, the REAL request helpers and the REAL refusal helper
 * with a mocked session and a mocked staging pipeline (asserted never called). No database.
 * The request helpers (`upload-request.ts`) are retained library code and keep their own tests.
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

/** A body stream that counts how often it is pulled: zero means nothing was read. */
function countingStream() {
  const state = { pulled: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { state.pulled += 1; controller.enqueue(new Uint8Array(1024)); },
  }, { highWaterMark: 0 });
  return { state, stream };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireCapability.mockResolvedValue(ADMIN);
  mocks.audit.mockResolvedValue(undefined);
  mocks.stageSubmission.mockResolvedValue({ ok: true, submissionId: 41, rowCount: 3, duplicate: false });
});

describe('an authorised caller gets the typed refusal (HTTP 410) and nothing is staged', () => {
  it('answers a well-formed 1.5 MB upload with 410 and the retirement refusal', async () => {
    const { bytes, contentType } = await multipart(csvOf(Math.round(1.5 * MIB)));
    const response = await POST(request(bytes, contentType, SAME_ORIGIN, bytes.length));

    expect(response.status).toBe(410);
    const body = await response.json() as { refused: boolean; code: string; surface: string; error: string };
    expect(body).toMatchObject({ refused: true, code: 'legacy_retired', surface: 'admin.csv_upload' });
    expect(body.error).toMatch(/retired/i);
    expect(body.error).toMatch(/operations\/awards/);
    expect(mocks.stageSubmission).not.toHaveBeenCalled();
  });

  it('writes exactly one audit row for the refusal, naming the surface and the export', async () => {
    const { bytes, contentType } = await multipart(csvOf(200));
    await POST(request(bytes, contentType));

    expect(mocks.audit).toHaveBeenCalledExactlyOnceWith(
      'admin.legacy_retired_refused',
      { surface: 'admin.csv_upload', export: 'POST' },
      { userId: 7, label: 'uploader@example.test' },
    );
  });

  it('still refuses with 410 when the audit write fails', async () => {
    mocks.audit.mockRejectedValue(new Error('audit insert failed'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { bytes, contentType } = await multipart(csvOf(200));

    const response = await POST(request(bytes, contentType));

    expect(response.status).toBe(410);
    expect(JSON.stringify(await response.json())).not.toContain('audit insert failed');
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });

  it('refuses the same way for a malformed body, an oversized declared length or no file at all', async () => {
    const { bytes, contentType } = await multipart(csvOf(100));
    const cases = [
      request(new Uint8Array([1, 2, 3]), 'text/plain'),
      request(bytes, contentType, SAME_ORIGIN, maxUploadBodyBytes(MAX_FILE) + 1),
      request(new Uint8Array(0), 'multipart/form-data; boundary=x'),
    ];
    for (const req of cases) {
      const response = await POST(req);
      expect(response.status).toBe(410);
    }
    expect(mocks.stageSubmission).not.toHaveBeenCalled();
  });

  it('reads none of the request body, whatever it declares', async () => {
    const small = countingStream();
    expect((await POST(request(small.stream, 'multipart/form-data; boundary=x'))).status).toBe(410);
    expect(small.state.pulled).toBe(0);

    const declaredHuge = countingStream();
    const response = await POST(request(
      declaredHuge.stream, 'multipart/form-data; boundary=x', SAME_ORIGIN, maxUploadBodyBytes(MAX_FILE) + 1,
    ));
    expect(response.status).toBe(410);
    expect(declaredHuge.state.pulled).toBe(0);
  });
});

describe('authentication and authorisation are unchanged', () => {
  it('asks for the legacy-intake capability and refuses nothing, audits nothing, when it throws', async () => {
    const { bytes, contentType } = await multipart(csvOf(100));
    mocks.requireCapability.mockRejectedValueOnce(new Error('NEXT_REDIRECT /admin/login'));
    await expect(POST(request(bytes, contentType))).rejects.toThrow('NEXT_REDIRECT /admin/login');
    expect(mocks.requireCapability).toHaveBeenCalledWith('acquisition.legacyIntake');
    expect(mocks.stageSubmission).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('checks the session before reading any of the body', async () => {
    const { state, stream } = countingStream();
    mocks.requireCapability.mockRejectedValueOnce(new Error('NEXT_REDIRECT /admin/login'));
    await expect(POST(request(stream, 'multipart/form-data; boundary=x'))).rejects.toThrow('NEXT_REDIRECT');
    expect(state.pulled).toBe(0);
  });

  it('turns an under-privileged session away exactly as the page does (a redirect, not a 410)', async () => {
    mocks.requireCapability.mockRejectedValueOnce(new Error('NEXT_REDIRECT /admin'));
    const { bytes, contentType } = await multipart(csvOf(100));
    await expect(POST(request(bytes, contentType))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.audit).not.toHaveBeenCalled();
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
      expect(mocks.audit).not.toHaveBeenCalled();
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

describe('the request helpers on their own (retained library code)', () => {
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

  it('the route checks the origin first, then the session, then refuses; it never reads the body', () => {
    const order = [
      'sameOriginRefusal(request.headers)',
      "await requireCapability('acquisition.legacyIntake')",
      "refuseRetiredAdminRoute('admin.csv_upload'",
    ].map((needle) => code.indexOf(needle));
    expect(order.every((i) => i > -1), JSON.stringify(order)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const bodyRead of [
      'request.formData', 'request.json', 'request.text', 'request.arrayBuffer', 'request.body',
      'readBoundedBody', 'formData()', 'stageSubmission',
    ]) {
      expect(code.indexOf(bodyRead), bodyRead).toBe(-1);
    }
  });

  it('imports neither the ingest pipeline nor the dataset registry', () => {
    expect(route).not.toMatch(/ingest\/pipeline|ingest\/datasets/);
  });

  it('the form and the 1 MB Server Action it replaced are gone, and the global action limit is untouched', () => {
    expect(() => read('src/app/admin/upload/UploadForm.tsx')).toThrow();
    expect(() => read('src/app/admin/upload/actions.ts')).toThrow();
    expect(read('next.config.ts')).not.toMatch(/bodySizeLimit/);
  });

  it('the page still gates on the capability the route enforces, and renders a notice, not a form', () => {
    const page = read('src/app/admin/upload/page.tsx');
    expect(page).toContain("await requireCapability('acquisition.legacyIntake')");
    expect(page).toMatch(/retired/i);
    expect(page).not.toMatch(/<form|<input|UploadForm|ingest\/datasets|ingest\/pipeline/);
  });
});
