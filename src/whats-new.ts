// ---------------------------------------------------------------------------
// "What's new" after an update. The notes come from CHANGELOG.md, bundled into
// main.js at build time, so the changelog stays the one place release notes are
// written. Everything here is pure (no Obsidian runtime) so it can be tested;
// the modal lives in whats-new-modal.ts.
// ---------------------------------------------------------------------------

export interface ReleaseNote {
  version: string;
  /** Release date as written in the heading, or "" when there is none. */
  date: string;
  /** The section's Markdown, without its `## [x.y.z]` heading. */
  body: string;
}

/** At most this many releases are shown at once, newest first. */
export const MAX_RELEASES_SHOWN = 5;

// `## [1.10.0] — 2026-10-08`, `## 1.10.0`, `## [1.10.0]`. "Unreleased" and any
// other non-version heading is skipped.
const HEADING = /^##\s+\[?v?(\d+\.\d+\.\d+)\]?(?:\s*[—–-]\s*(.+?))?\s*$/;

/** Split a Keep-a-Changelog style file into one entry per released version. */
export function parseChangelog(markdown: string): ReleaseNote[] {
  const notes: ReleaseNote[] = [];
  let current: { version: string; date: string; lines: string[] } | null = null;
  const flush = () => {
    if (current) notes.push({ version: current.version, date: current.date, body: current.lines.join("\n").trim() });
  };
  for (const line of markdown.split(/\r?\n/)) {
    if (/^##\s/.test(line)) {
      flush();
      const m = HEADING.exec(line);
      current = m ? { version: m[1], date: m[2] ?? "", lines: [] } : null;
    } else if (current) {
      current.lines.push(line);
    }
  }
  flush();
  return notes;
}

/** Compare dotted numeric versions. Negative when a < b, 0 when equal. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Releases after `since` up to and including `current`, newest first. With no
 * `since` (an existing user from before the version was tracked) only the
 * newest release at or below `current` is returned.
 */
export function notesSince(notes: ReleaseNote[], since: string | null, current: string): ReleaseNote[] {
  const eligible = notes
    .filter((n) => compareVersions(n.version, current) <= 0)
    .sort((a, b) => compareVersions(b.version, a.version));
  if (since === null) return eligible.slice(0, 1);
  return eligible.filter((n) => compareVersions(n.version, since) > 0).slice(0, MAX_RELEASES_SHOWN);
}

export interface WhatsNewState {
  /** The "Show what's new after updates" setting. */
  enabled: boolean;
  /** Version the user last saw, "" when never recorded. */
  lastSeenVersion: string;
  currentVersion: string;
  /** False on a fresh install: no saved settings and no verse cache. */
  isExistingUser: boolean;
}

export interface WhatsNewDecision {
  /** Open the pop-up. */
  show: boolean;
  /** Passed to notesSince; null means "only the newest release". */
  since: string | null;
  /** Save currentVersion as the last seen version. */
  record: boolean;
}

/**
 * Decide what to do at startup. The current version is always recorded once it
 * changes, even with the pop-up turned off or on a fresh install, so turning the
 * setting back on later doesn't replay old releases.
 */
export function decideWhatsNew(state: WhatsNewState): WhatsNewDecision {
  const { enabled, lastSeenVersion, currentVersion, isExistingUser } = state;
  if (lastSeenVersion === currentVersion) return { show: false, since: null, record: false };
  if (!lastSeenVersion) {
    // Never tracked: either a fresh install (nothing to tell them about yet) or
    // someone updating from a version before this feature existed.
    return { show: enabled && isExistingUser, since: null, record: true };
  }
  const isUpgrade = compareVersions(currentVersion, lastSeenVersion) > 0;
  return { show: enabled && isUpgrade, since: lastSeenVersion, record: true };
}
