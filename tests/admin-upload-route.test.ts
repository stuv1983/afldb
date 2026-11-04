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
  listMedia: vi.fn(),
  countMedia: vi.fn(),
  insertMedia: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({
  requireCapability: mocks.requireCapability,
  audit: mocks.audit,
}));
vi.mock('@/lib/ingest/pipeline', () => ({
  MAX_UPLOAD_BYTES: 5 * 1024 * 1024,
  stageSubmission: mocks.stageSubmission,
}));
// AFLDB-ISSUE-334: the /admin/content image upload route's storage, asserted on (no database).
vi.mock('@/db/queries/site-content', () => ({
  listMedia: mocks.listMedia,
  countMedia: mocks.countMedia,
  insertMedia: mocks.insertMedia,
}));

import { POST as POST_MEDIA } from '@/app/admin/content/media/route';
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

/*
 * AFLDB-ISSUE-334: the /admin/content image upload Route Handler (`/admin/content/media`) is the
 * other admin Route Handler that takes a POST body, so it needs the same CSRF layer as the
 * upload route above: a Route Handler gets no Server Action origin check. These cases drive the
 * REAL media route with the REAL `sameOriginRefusal`, the REAL image probe and a mocked session
 * and media store; the session cookie (SameSite=Lax), permissions and limits are unchanged.
 */
describe('AFLDB-ISSUE-334: the content image upload route refuses a cross-site request first', () => {
  const MEDIA_URL = 'https://dev.afldb.example/admin/content/media';
  const SUPER = { id: 3, email: 'content@example.test' };

  /** A minimal PNG the real probe accepts: signature, then an IHDR chunk carrying 640x360. */
  const png = () => {
    const bytes = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
    bytes.writeUInt32BE(13, 8);
    bytes.write('IHDR', 12, 'ascii');
    bytes.writeUInt32BE(640, 16);
    bytes.writeUInt32BE(360, 20);
    return new Uint8Array(bytes);
  };

  async function imageForm(fileBytes: Uint8Array, name = 'Hero Shot.png', alt = 'A hero shot') {
    const form = new FormData();
    form.set('file', new File([fileBytes as BlobPart], name, { type: 'image/png' }));
    form.set('alt', alt);
    const response = new Response(form);
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get('content-type')!,
    };
  }

  const mediaRequest = (
    body: Uint8Array | ReadableStream<Uint8Array>, contentType: string, headers: Record<string, string> = SAME_ORIGIN,
  ) => new Request(MEDIA_URL, {
    method: 'POST',
    headers: { ...headers, 'content-type': contentType },
    body: body as BodyInit,
    ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
  } as RequestInit);

  /** A FINITE body that counts its pulls (a read of an unrefused request ends, never hangs). */
  const finiteCountingStream = () => {
    const state = { pulled: 0 };
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        state.pulled += 1;
        if (state.pulled > 4) { controller.close(); return; }
        controller.enqueue(new Uint8Array(1024));
      },
    }, { highWaterMark: 0 });
    return { state, stream };
  };

  const nothingWritten = () => {
    expect(mocks.listMedia).not.toHaveBeenCalled();
    expect(mocks.countMedia).not.toHaveBeenCalled();
    expect(mocks.insertMedia).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    mocks.requireCapability.mockResolvedValue(SUPER);
    mocks.listMedia.mockResolvedValue([]);
    mocks.countMedia.mockResolvedValue(0);
    mocks.insertMedia.mockResolvedValue(undefined);
  });

  const refused: Array<[string, Record<string, string>]> = [
    ['a cross-site Sec-Fetch-Site', { ...SAME_ORIGIN, 'sec-fetch-site': 'cross-site' }],
    ['a sibling-origin request (same-site Sec-Fetch-Site, sibling Origin)',
      { ...SAME_ORIGIN, 'sec-fetch-site': 'same-site', origin: 'https://beta.dev.afldb.example' }],
    ['a sibling Origin with no Sec-Fetch-Site', { host: SAME_ORIGIN.host, origin: 'https://beta.dev.afldb.example' }],
    ['a foreign Origin with no Sec-Fetch-Site', { host: SAME_ORIGIN.host, origin: 'https://evil.example' }],
    ['a missing Origin', { host: SAME_ORIGIN.host }],
    ['an opaque Origin', { host: SAME_ORIGIN.host, origin: 'null' }],
    ['an unparseable Origin', { host: SAME_ORIGIN.host, origin: 'not a url' }],
  ];
  for (const [label, headers] of refused) {
    it(`refuses ${label} with 403 before authenticating, parsing, storing or auditing`, async () => {
      const { bytes, contentType } = await imageForm(png());
      const response = await POST_MEDIA(mediaRequest(bytes, contentType, headers));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'This upload did not come from this site.' });
      expect(mocks.requireCapability).not.toHaveBeenCalled();
      nothingWritten();
    });
  }

  it('reads none of a refused request body', async () => {
    const { state, stream } = finiteCountingStream();
    const response = await POST_MEDIA(mediaRequest(
      stream, 'multipart/form-data; boundary=x', { host: SAME_ORIGIN.host, origin: 'https://evil.example' },
    ));
    expect(response.status).toBe(403);
    expect(state.pulled).toBe(0);
    expect(mocks.requireCapability).not.toHaveBeenCalled();
    nothingWritten();
  });

  it('a same-origin upload still asks for site.content, and a refused session stores nothing and reads no body', async () => {
    const { state, stream } = finiteCountingStream();
    mocks.requireCapability.mockRejectedValueOnce(new Error('NEXT_REDIRECT /admin'));
    await expect(POST_MEDIA(mediaRequest(stream, 'multipart/form-data; boundary=x'))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.requireCapability).toHaveBeenCalledExactlyOnceWith('site.content');
    expect(state.pulled).toBe(0);
    nothingWritten();
  });

  it('a same-origin upload is stored and audited exactly as before', async () => {
    const image = png();
    const { bytes, contentType } = await imageForm(image);
    const response = await POST_MEDIA(mediaRequest(bytes, contentType));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      name: 'hero-shot.png', mime: 'image/png', width: 640, height: 360,
      byteSize: image.length, alt: 'A hero shot', replaced: false,
    });
    expect(mocks.requireCapability).toHaveBeenCalledExactlyOnceWith('site.content');
    expect(mocks.insertMedia).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      name: 'hero-shot.png', mime: 'image/png', width: 640, height: 360, alt: 'A hero shot', uploadedBy: SUPER.id,
    }));
    expect(Buffer.from(mocks.insertMedia.mock.calls[0][0].bytes)).toEqual(Buffer.from(image));
    expect(mocks.audit).toHaveBeenCalledExactlyOnceWith('content.media_uploaded', {
      name: 'hero-shot.png', mime: 'image/png', bytes: image.length, width: 640, height: 360, replaced: false,
    }, { userId: SUPER.id, label: SUPER.email });
  });

  it('the proxied same-origin form (public host as X-Forwarded-Host) is accepted', async () => {
    const { bytes, contentType } = await imageForm(png());
    const response = await POST_MEDIA(mediaRequest(bytes, contentType, {
      origin: 'https://dev.afldb.example', 'x-forwarded-host': 'dev.afldb.example',
      host: '127.0.0.1:3100', 'sec-fetch-site': 'same-origin',
    }));
    expect(response.status).toBe(200);
    expect(mocks.insertMedia).toHaveBeenCalledOnce();
  });

  it('same-origin requests keep the existing refusals: not an image (415), over the limit (413), at the cap (409)', async () => {
    const notImage = await imageForm(new Uint8Array(Buffer.from('<script>alert(1)</script>'.padEnd(64, ' '))), 'x.png');
    expect((await POST_MEDIA(mediaRequest(notImage.bytes, notImage.contentType))).status).toBe(415);

    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(png());
    const tooBig = await imageForm(big);
    expect((await POST_MEDIA(mediaRequest(tooBig.bytes, tooBig.contentType))).status).toBe(413);

    mocks.countMedia.mockResolvedValue(40);
    const atCap = await imageForm(png());
    expect((await POST_MEDIA(mediaRequest(atCap.bytes, atCap.contentType))).status).toBe(409);

    expect(mocks.insertMedia).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
