import { BibleReference, EOC_VERSE } from "./types";
import {
  parseInlineSpec,
  formatInlineSpec,
  inlineTokenContent,
  INLINE_TOKEN_SOURCE,
} from "./parser";

/**
 * Verse-range nudging for the interactive +/- controls (#49).
 *
 * Pure module — no `obsidian`, no network, no cache — so the whole behaviour
 * is unit-testable and can be shared by the Live Preview widget, the palette
 * commands, and (later) the ```bible code block renderer.
 */

/** Which end of the range a shift moves. */
export type ShiftTarget = "start" | "end";

/** Direction of a shift. */
export type ShiftDelta = -1 | 1;

/**
 * Nudge one end of a reference's verse range by a single verse.
 *
 * Returns `null` when the shift is not representable — which callers use both
 * to skip the edit and to render the corresponding button disabled. That covers
 * running off the front of a chapter, and reference shapes where "the" start or
 * end verse is ambiguous:
 *
 *   - whole-chapter references ("John 3") have no verse range to move
 *   - multi-chapter ranges ("John 3:16-4:3") would need the end chapter's own
 *     verse count to move safely, and rolling between chapters is out of scope
 *   - discontinuous references ("John 3:16-21,25") have no single end verse
 *
 * `numberOfVerses` is the chapter's verse count when known. It is optional
 * because ESV and link-only translations never fetch a chapter and so cannot
 * report one; when it is undefined there is no upper bound, shifts past the end
 * of the chapter are allowed, and the renderer's existing "no verses found"
 * error is what tells the user they overshot.
 *
 * When the count *is* known, extending past the last verse converts the range
 * to end-of-chapter rather than refusing, and shrinking back off `eoc` returns
 * to that same last verse — so the pair is reversible with no skipped states:
 *
 *   16-35  --+->  16-36  --+->  16-eoc  --+->  (disabled)
 *   16-35  <-−--  16-36  <-−--  16-eoc
 */
export function shiftReference(
  ref: BibleReference,
  target: ShiftTarget,
  delta: ShiftDelta,
  numberOfVerses?: number
): BibleReference | null {
  if (ref.startVerse === null) return null;
  if (ref.endChapter !== null) return null;
  if (ref.additionalVerses.length > 0) return null;

  // A count of zero or less tells us nothing usable; treat it as unknown so a
  // malformed payload degrades to "no upper bound" instead of pinning every
  // shift to verse 1.
  const lastVerse = typeof numberOfVerses === "number" && numberOfVerses > 0 ? numberOfVerses : null;

  return target === "start"
    ? shiftStart(ref, delta, lastVerse)
    : shiftEnd(ref, delta, lastVerse);
}

function shiftStart(
  ref: BibleReference,
  delta: ShiftDelta,
  lastVerse: number | null
): BibleReference | null {
  const startVerse = ref.startVerse! + delta;

  if (startVerse < 1) return null;

  // The start may not pass the end. An `eoc` range has no numeric end to
  // collide with, so only a concrete endVerse constrains it.
  if (ref.endVerse !== null && ref.endVerse !== EOC_VERSE && startVerse > ref.endVerse) return null;

  // Without an end verse the start is also the end, so the chapter bound
  // applies to it directly.
  if (lastVerse !== null && startVerse > lastVerse) return null;

  // Collapsed onto the end verse — drop the range so the reference reads
  // "John 3:17" rather than "John 3:17-17", matching shiftEnd.
  if (startVerse === ref.endVerse) return withVerses(ref, startVerse, null);

  return withVerses(ref, startVerse, ref.endVerse);
}

function shiftEnd(
  ref: BibleReference,
  delta: ShiftDelta,
  lastVerse: number | null
): BibleReference | null {
  const startVerse = ref.startVerse!;

  // Already open-ended: "+" has nowhere to go, "-" needs the real last verse to
  // come back to a concrete range.
  if (ref.endVerse === EOC_VERSE) {
    if (delta > 0) return null;
    if (lastVerse === null || lastVerse < startVerse) return null;
    // An `eoc` range that covers a single verse shrinks back to the bare verse,
    // otherwise "John 3:36-eoc" in a 36-verse chapter would be a dead end.
    if (lastVerse === startVerse) return withVerses(ref, startVerse, null);
    return withVerses(ref, startVerse, lastVerse);
  }

  // A bare verse ("John 3:16") grows into a range; it cannot shrink further.
  if (ref.endVerse === null) {
    if (delta < 0) return null;
    if (lastVerse !== null && startVerse >= lastVerse) return withVerses(ref, startVerse, EOC_VERSE);
    return withVerses(ref, startVerse, startVerse + 1);
  }

  const endVerse = ref.endVerse + delta;

  // Past the last verse of the chapter — express that as end-of-chapter rather
  // than refusing, so following a teacher off the end of a chapter still works.
  if (lastVerse !== null && endVerse > lastVerse) return withVerses(ref, startVerse, EOC_VERSE);

  // Collapsed onto the start verse — drop the range entirely so the reference
  // reads "John 3:16" rather than "John 3:16-16".
  if (endVerse === startVerse) return withVerses(ref, startVerse, null);

  if (endVerse < startVerse) return null;

  return withVerses(ref, startVerse, endVerse);
}

/**
 * Rebuild a reference with new verse bounds. `raw` is refreshed by the caller
 * via `formatReference`, so it is cleared here rather than left describing the
 * pre-shift range.
 */
function withVerses(
  ref: BibleReference,
  startVerse: number,
  endVerse: number | null
): BibleReference {
  return {
    ...ref,
    startVerse,
    endVerse,
    raw: "",
  };
}

/**
 * Rewrite a whole `{…}` token so its reference is replaced by `shifted`,
 * preserving everything else the user typed and the brace form they used —
 * a doubled `{{…}}` token stays doubled.
 *
 * Returns `null` if `token` is not a single well-formed inline token, or if its
 * contents no longer parse. Callers treat that as "leave the document alone".
 *
 * Kept here rather than inline in the Live Preview widget so the rewrite is
 * unit-testable without a CodeMirror instance.
 */
export function rewriteTokenReference(token: string, shifted: BibleReference): string | null {
  const match = new RegExp(`^(?:${INLINE_TOKEN_SOURCE})$`).exec(token);
  if (!match) return null;

  const spec = parseInlineSpec(inlineTokenContent(match).trim());
  if (!spec) return null;

  const body = formatInlineSpec({ ...spec, ref: shifted });
  // Group 1 is the doubled form's contents; group 2 the single form's.
  return match[1] !== undefined ? `{{${body}}}` : `{${body}}`;
}

/** A `{…}` token located within a single line of text. */
export interface TokenAtCursor {
  /** Column the token starts at. */
  start: number;
  /** Column just past the token's last character. */
  end: number;
  /** The token text, braces included. */
  token: string;
}

/**
 * Find the inline token containing `ch` on `line`, for the palette commands
 * (#49) — the only route to the start verse on touch devices, where there is no
 * Alt key, and the only one that works in Source mode where nothing renders.
 *
 * A cursor resting on either brace counts as inside, so the command still fires
 * when the caret sits at the edge of a token.
 */
export function findTokenAtCursor(line: string, ch: number): TokenAtCursor | null {
  const re = new RegExp(INLINE_TOKEN_SOURCE, "g");
  let match: RegExpExecArray | null;

  while ((match = re.exec(line)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (ch >= start && ch <= end) {
      // An escaped token is literal text (#28) and must not be rewritten.
      if (start > 0 && line[start - 1] === "\\") continue;
      return { start, end, token: match[0] };
    }
  }

  return null;
}
