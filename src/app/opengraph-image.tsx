import { ImageResponse } from 'next/og';

/**
 * The site's share card.
 *
 * Every link to AFLDB was previously unbranded — no icon, no image — on a
 * site whose metadata is otherwise careful. This is the masthead lockup at
 * card size: gold on ink, inside the same 1px rule the favicon carries.
 *
 * The wordmark is NOT set in Newsreader. Satori needs font binaries, and
 * `next/font` only emits woff2 into .next, which it cannot read; supplying
 * the serif would mean fetching it from Google at build time and making
 * every deploy depend on that request. The frame, palette and letterspacing
 * carry the identity instead. Swap in the real face here if the font is
 * ever vendored as ttf/otf.
 */
export const alt = 'AFLDB — Australian Football statistics, 1897 to present';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const INK = '#090a0b';
const GOLD = '#d1ad55';
const PAPER = '#e8e5de';
const MUTED = '#aaa69d';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          background: INK,
          padding: 72,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            flex: 1,
            border: `1px solid ${GOLD}`,
            padding: '0 72px',
          }}
        >
          <div
            style={{
              fontSize: 24,
              letterSpacing: 8,
              textTransform: 'uppercase',
              color: GOLD,
            }}
          >
            1897 — Present
          </div>

          <div
            style={{
              fontSize: 148,
              letterSpacing: 20,
              fontWeight: 700,
              color: PAPER,
              marginTop: 24,
            }}
          >
            AFLDB
          </div>

          <div
            style={{
              width: 96,
              height: 2,
              background: GOLD,
              marginTop: 36,
            }}
          />

          <div
            style={{
              fontSize: 34,
              color: MUTED,
              marginTop: 36,
              lineHeight: 1.35,
            }}
          >
            Every player. Every game. Since 1897.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
