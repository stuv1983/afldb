/**
 * The request-level guards of the CSV upload route (`/admin/upload/stage`,
 * AFLDB-ISSUE-303, D-303-1).
 *
 * The route exists because a Server Action cannot take the file: Next caps a
 * Server Action request body at 1 MB (`experimental.serverActions.bodySizeLimit`),
 * multipart included, and raising that is a project-wide setting that would
 * widen every action in the application. A Route Handler has no such cap, which
 * moves three jobs from the framework to this module:
 *
 *   1. CSRF. Server Actions refuse a request whose `Origin` is not the host they
 *      were served from; a Route Handler gets no such check, so it is done here,
 *      the same way (`sameOriginRefusal`). The session cookie is also
 *      `SameSite=Lax`, which already keeps it off a cross-site POST; this is the
 *      second, independent layer.
 *   2. The size bound. Nothing may be buffered past the limit, whatever the
 *      client declares (`declaredLengthRefusal`, `readBoundedBody`).
 *   3. Nothing else changes: authentication and authorisation are
 *      `requireCapability('acquisition.legacyIntake')` in the route, exactly as
 *      the page and the old action had them.
 *
 * Pure of the database and of the framework, so each rule is tested on its own.
 */

/**
 * Room for the multipart framing around the file: the boundary lines, the
 * `dataset` field and the part headers (a file name is at most a few hundred
 * bytes). A declared body larger than the file limit plus this is refused
 * before any of it is read.
 */
export const UPLOAD_ENVELOPE_SLACK_BYTES = 16 * 1024;

export function maxUploadBodyBytes(maxFileBytes: number): number {
  return maxFileBytes + UPLOAD_ENVELOPE_SLACK_BYTES;
}

/**
 * A reason to refuse the request as cross-site, or `null` when it is same-origin.
 *
 * Mirrors Next's Server Action origin check (`action-handler.js`): the `Origin`
 * header must be present and its host must equal the request's own host, taken
 * from `X-Forwarded-Host` (first value) or `Host`. A browser always sends
 * `Origin` on a multipart POST, so a missing or opaque (`null`) one is refused.
 * `Sec-Fetch-Site`, which a browser sets and a page cannot, is checked first
 * where present, and only `same-origin` passes.
 *
 * What this does not do: stop a non-browser client that forges both headers. Such
 * a client needs the admin session cookie, which is the boundary that matters.
 */
export function sameOriginRefusal(headers: Headers): string | null {
  const site = headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin') {
    return 'This upload did not come from this site.';
  }

  const origin = headers.get('origin');
  if (origin === null || origin === '' || origin === 'null') {
    return 'This upload did not come from this site.';
  }
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return 'This upload did not come from this site.';
  }

  const forwarded = headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwarded || headers.get('host')?.trim();
  if (!host || originHost !== host) {
    return 'This upload did not come from this site.';
  }
  return null;
}

export type DeclaredLength = { kind: 'ok' } | { kind: 'too_large' } | { kind: 'invalid' };

/**
 * The `Content-Length` check, before a byte of the body is read. An absent header
 * is `ok` here (a chunked body): {@link readBoundedBody} bounds that case while
 * reading. A present but non-numeric one is `invalid`.
 */
export function declaredLengthCheck(headers: Headers, maxBodyBytes: number): DeclaredLength {
  const raw = headers.get('content-length');
  if (raw === null) return { kind: 'ok' };
  if (!/^\d+$/.test(raw.trim())) return { kind: 'invalid' };
  return Number(raw) > maxBodyBytes ? { kind: 'too_large' } : { kind: 'ok' };
}

/**
 * Read the request body, stopping at `maxBytes`. Returns the bytes, or `null` when
 * the body is larger than the limit; in that case the stream is cancelled and no
 * more than one chunk past the limit has been held. A declared `Content-Length`
 * can be wrong or absent, so this is the bound that actually holds.
 */
export async function readBoundedBody(
  request: { body: ReadableStream<Uint8Array> | null },
  maxBytes: number,
): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
