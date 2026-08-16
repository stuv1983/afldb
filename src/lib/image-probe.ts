/**
 * Identify an uploaded image from its own bytes, and read its dimensions.
 *
 * Two jobs, and the first is the important one:
 *
 *   1. VALIDATION. The upload's `Content-Type` and file extension are both
 *      client-supplied and neither is evidence of anything. A file is accepted
 *      here only if its leading bytes are a format this understands, and the
 *      MIME type stored against it is the one derived from those bytes — so a
 *      script named `shot.webp` and declared `image/webp` is rejected rather
 *      than written into the published directory and later served with an
 *      image content type.
 *
 *   2. DIMENSIONS. The published `<img>` carries width and height so the
 *      browser reserves the space before the bytes arrive. Reading them from
 *      the header keeps that promise honest without asking a super admin to
 *      measure their own screenshots, and without a native image dependency —
 *      `sharp` is in this tree only as an unused optional dependency of Next
 *      (see the note in package.json) and nothing here should start relying
 *      on it.
 *
 * Header parsing only: no decoding, no allocation proportional to the image,
 * and a truncated or corrupt file returns null rather than throwing.
 */

export type ImageFormat = {
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  /** The extension the stored file is given, regardless of what was uploaded. */
  ext: 'png' | 'jpg' | 'webp';
};

export type ProbedImage = ImageFormat & {
  width: number;
  height: number;
};

/** Dimensions beyond this are a malformed header rather than a screenshot. */
const MAX_DIMENSION = 20000;

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(bytes[offset + i] ?? 0);
  return out;
}

function plausible(width: number, height: number): boolean {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height)
    && width > 0 && height > 0
    && width <= MAX_DIMENSION && height <= MAX_DIMENSION;
}

// --- PNG ---

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function probePng(bytes: Uint8Array, view: DataView): ProbedImage | null {
  if (bytes.length < 24) return null;
  if (PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) return null;
  // The first chunk of a PNG is required to be IHDR, which carries the size
  // in its first eight bytes.
  if (ascii(bytes, 12, 4) !== 'IHDR') return null;

  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  return plausible(width, height)
    ? { mime: 'image/png', ext: 'png', width, height }
    : null;
}

// --- JPEG ---

/**
 * Frame markers that carry the size. Every SOFn except the three markers in
 * that numeric range which mean something else entirely: C4 is a Huffman
 * table, C8 is a JPEG extension and CC is an arithmetic-coding table.
 */
function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf
    && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function probeJpeg(bytes: Uint8Array, view: DataView): ProbedImage | null {
  if (bytes.length < 4) return null;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;

  // Walk the segment chain to the frame header. Bounded by the file length,
  // and every step advances, so a corrupt length cannot loop forever.
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      // Fill bytes are legal between segments; anything else is corruption.
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Standalone markers carry no length field.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    const length = view.getUint16(offset + 2, false);
    if (length < 2) return null;

    if (isStartOfFrame(marker)) {
      const height = view.getUint16(offset + 5, false);
      const width = view.getUint16(offset + 7, false);
      return plausible(width, height)
        ? { mime: 'image/jpeg', ext: 'jpg', width, height }
        : null;
    }
    // Start of scan: entropy-coded data follows and there is no frame header
    // after it worth chasing.
    if (marker === 0xda) return null;

    offset += 2 + length;
  }
  return null;
}

// --- WebP ---

/**
 * Three container variants, all inside the same RIFF wrapper:
 *
 *   VP8   lossy      dimensions in the keyframe header, 14 bits each
 *   VP8L  lossless   14 bits each, packed little-endian and stored minus one
 *   VP8X  extended   24-bit canvas size, also stored minus one
 *
 * The screenshots this project publishes are lossy WebP, but an admin can
 * upload any of the three and all are legitimate.
 */
function probeWebp(bytes: Uint8Array, view: DataView): ProbedImage | null {
  if (bytes.length < 30) return null;
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return null;

  const chunk = ascii(bytes, 12, 4);
  const webp = (width: number, height: number): ProbedImage | null => (
    plausible(width, height) ? { mime: 'image/webp', ext: 'webp', width, height } : null
  );

  if (chunk === 'VP8 ') {
    // The uncompressed data chunk opens with a 3-byte frame tag followed by
    // the 3-byte start code; the dimensions sit immediately after it.
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return webp(
      view.getUint16(26, true) & 0x3fff,
      view.getUint16(28, true) & 0x3fff,
    );
  }

  if (chunk === 'VP8L') {
    if (bytes[20] !== 0x2f) return null;
    const packed = view.getUint32(21, true);
    return webp(
      (packed & 0x3fff) + 1,
      ((packed >>> 14) & 0x3fff) + 1,
    );
  }

  if (chunk === 'VP8X') {
    const uint24 = (offset: number) => (bytes[offset] ?? 0)
      | ((bytes[offset + 1] ?? 0) << 8)
      | ((bytes[offset + 2] ?? 0) << 16);
    return webp(uint24(24) + 1, uint24(27) + 1);
  }

  return null;
}


/**
 * Identify `bytes` as PNG, JPEG or WebP and read its dimensions.
 * Returns null for anything else, including a truncated or corrupt header.
 */
export function probeImage(bytes: Uint8Array): ProbedImage | null {
  if (bytes.length < 16) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return probePng(bytes, view)
    ?? probeWebp(bytes, view)
    ?? probeJpeg(bytes, view);
}

/**
 * Turn a super admin's chosen name into the stored file name.
 *
 * The result is both a file name under the published `img/u/` directory and a
 * URL segment on a public page, so it is reduced to an unambiguous slug and
 * given the extension that matches the SNIFFED format — never the one that
 * was uploaded. `photo.png.webp` and `../../etc/passwd` both come out as
 * ordinary slugs; migration 037 re-checks the result with a CHECK constraint.
 */
export function mediaFileName(requested: string, format: ImageFormat): string {
  const stem = requested
    .toLowerCase()
    .replace(/\.(webp|png|jpe?g)$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 48)
    .replace(/[-.]+$/, '');

  // A name of nothing at all still has to be unique and legal.
  const safe = stem || `image-${Date.now().toString(36)}`;
  return `${safe}.${format.ext}`;
}
