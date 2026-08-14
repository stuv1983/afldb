/**
 * Line extraction and raw-mode editing for hidden terminal prompts.
 *
 * Pulled out of the admin CLI so it can be tested: a terminal delivers
 * whatever is available in one chunk, so a paste can carry a password
 * and its confirmation together, and dropping the remainder leaves the
 * second prompt waiting for input that already arrived.
 */

export const CTRL_C = 3;
export const BACKSPACE = 8;
export const DELETE = 127;

/** Consume one line from a buffer, or null if it holds no complete line. */
export function takeLine(buffer: string): { line: string; rest: string } | null {
  const index = buffer.search(/[\r\n]/);
  if (index === -1) return null;
  // Treat CRLF as one terminator, not an empty second line.
  const skip = buffer.startsWith('\r\n', index) ? 2 : 1;
  return { line: buffer.slice(0, index), rest: buffer.slice(index + skip) };
}

/**
 * Strip control codes and apply backspaces to a raw-mode line.
 *
 * In raw mode the terminal does no editing of its own, so a corrected
 * typo arrives as the wrong character followed by 0x7f.
 */
export function applyEditing(raw: string): string {
  const chars: string[] = [];
  for (const char of raw) {
    const code = char.charCodeAt(0);
    if (code === BACKSPACE || code === DELETE) chars.pop();
    else if (code >= 32) chars.push(char);
  }
  return chars.join('');
}
