import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareVersions,
  decideWhatsNew,
  MAX_RELEASES_SHOWN,
  notesSince,
  parseChangelog,
} from "../src/whats-new";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const SAMPLE = `# Changelog

Intro text that belongs to no release.

## [Unreleased]

### Added

- Not shipped yet.

## [1.10.0] — 2026-10-08

### Changed

- Lone verses hide their number.

## [1.8.1] - 2026-08-12

### Added

- Searchable settings.

## 1.6.5

- Native callouts.
`;

describe("parseChangelog", () => {
  const notes = parseChangelog(SAMPLE);

  it("keeps released versions in file order and skips Unreleased", () => {
    expect(notes.map((n) => n.version)).toEqual(["1.10.0", "1.8.1", "1.6.5"]);
  });

  it("reads the date with either dash, or none", () => {
    expect(notes.map((n) => n.date)).toEqual(["2026-10-08", "2026-08-12", ""]);
  });

  it("keeps the section body without its heading", () => {
    expect(notes[0].body).toBe("### Changed\n\n- Lone verses hide their number.");
    expect(notes.some((n) => n.body.includes("Not shipped yet"))).toBe(false);
    expect(notes.some((n) => n.body.includes("Intro text"))).toBe(false);
  });

  it("parses the real CHANGELOG.md, including the version in manifest.json", () => {
    const real = parseChangelog(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8"));
    const { version } = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
    expect(real.length).toBeGreaterThan(3);
    expect(real.map((n) => n.version)).toContain(version);
    for (const n of real) expect(n.body.length).toBeGreaterThan(0);
  });
});

describe("compareVersions", () => {
  it.each([
    ["1.10.0", "1.9.0", 1],
    ["1.9.0", "1.10.0", -1],
    ["1.10.0", "1.10.0", 0],
    ["1.10.1", "1.10.0", 1],
    ["2.0.0", "1.99.99", 1],
  ])("%s vs %s", (a, b, sign) => {
    expect(Math.sign(compareVersions(a, b))).toBe(sign);
  });
});

describe("notesSince", () => {
  const notes = parseChangelog(SAMPLE);

  it("returns releases after the last seen one, newest first", () => {
    expect(notesSince(notes, "1.6.5", "1.10.0").map((n) => n.version)).toEqual(["1.10.0", "1.8.1"]);
  });

  it("never shows releases newer than the installed version", () => {
    expect(notesSince(notes, "1.6.5", "1.8.1").map((n) => n.version)).toEqual(["1.8.1"]);
  });

  it("returns nothing when the installed version has no newer notes", () => {
    expect(notesSince(notes, "1.10.0", "1.10.0")).toEqual([]);
  });

  it("with no last seen version shows only the newest installed release", () => {
    expect(notesSince(notes, null, "1.10.0").map((n) => n.version)).toEqual(["1.10.0"]);
  });

  it("covers a patch release with no changelog entry of its own", () => {
    expect(notesSince(notes, "1.8.1", "1.10.2").map((n) => n.version)).toEqual(["1.10.0"]);
  });

  it(`caps the list at ${MAX_RELEASES_SHOWN} releases`, () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ version: `1.${i}.0`, date: "", body: "x" }));
    const shown = notesSince(many, "0.1.0", "1.8.0");
    expect(shown).toHaveLength(MAX_RELEASES_SHOWN);
    expect(shown[0].version).toBe("1.8.0");
  });
});

describe("decideWhatsNew", () => {
  const base = { enabled: true, currentVersion: "1.11.0", isExistingUser: true };

  it("shows once after an update, then records the version", () => {
    expect(decideWhatsNew({ ...base, lastSeenVersion: "1.10.0" })).toEqual({ show: true, since: "1.10.0", record: true });
  });

  it("does nothing on later starts of the same version", () => {
    expect(decideWhatsNew({ ...base, lastSeenVersion: "1.11.0" })).toEqual({ show: false, since: null, record: false });
  });

  it("stays quiet on a fresh install but records the version", () => {
    expect(decideWhatsNew({ ...base, lastSeenVersion: "", isExistingUser: false })).toEqual({ show: false, since: null, record: true });
  });

  it("shows the newest release to existing users from before tracking began", () => {
    expect(decideWhatsNew({ ...base, lastSeenVersion: "" })).toEqual({ show: true, since: null, record: true });
  });

  it("respects the setting but still records, so re-enabling doesn't replay old releases", () => {
    expect(decideWhatsNew({ ...base, enabled: false, lastSeenVersion: "1.10.0" })).toEqual({ show: false, since: "1.10.0", record: true });
  });

  it("does not show after a downgrade", () => {
    expect(decideWhatsNew({ ...base, lastSeenVersion: "1.12.0" }).show).toBe(false);
  });
});
