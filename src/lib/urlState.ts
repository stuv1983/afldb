/**
 * Compact, shareable URL-token encoding: JSON -> base64url, for any
 * search/builder tool that keeps its whole state in one query parameter.
 *
 * Isomorphic on purpose -- both query-builder-spec.ts and
 * grid-solver-spec.ts are imported by Client Component forms as well as
 * server code, so this carries no server-only import and no Node
 * `Buffer` (a global the browser bundle does not have). Encoding goes
 * through TextEncoder/TextDecoder and the browser-standard btoa/atob,
 * both of which Node has provided as globals since v16.
 *
 * Originally lived inside query-builder-spec.ts alone; extracted once a
 * second spec module needed the identical trio rather than a second copy.
 */

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(token: string): Uint8Array | null {
  try {
    const padded = token.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** Encodes `value` as JSON then base64url. Throws if the JSON exceeds `maxChars`. */
export function encodeUrlState(value: unknown, maxChars: number): string {
  const json = JSON.stringify(value);
  if (json.length > maxChars) {
    throw new Error('State is too large to share as a URL.');
  }
  return toBase64Url(new TextEncoder().encode(json));
}

/**
 * Decodes a token produced by `encodeUrlState`, or returns null for
 * anything malformed -- oversized, not valid base64url, not valid UTF-8,
 * or not valid JSON. Callers still validate the parsed shape themselves;
 * this only gets them from "URL token" to "some JSON value" safely.
 */
export function decodeUrlState(token: string, maxChars: number): unknown | null {
  if (!token || token.length > maxChars) return null;
  const bytes = fromBase64Url(token);
  if (!bytes) return null;
  let json: string;
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}
