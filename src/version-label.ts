/**
 * The plugin's name and version, shown as a small muted line at the bottom of
 * the settings tab so every build says which version is running. Read from the
 * loaded manifest at runtime, never written in by hand.
 */

/** The part of a plugin manifest the label reads. */
export interface VersionedManifest {
  name: string;
  version: string;
}

export const VERSION_LABEL_CLASS = "bible-verse-settings-version";

/** Set on the settings list that holds the version row (Obsidian 1.13+). */
export const VERSION_ITEMS_CLASS = "bible-verse-settings-version-items";

/** "Bible Verse 1.12.2". */
export function versionLabelText(manifest: VersionedManifest): string {
  return `${manifest.name} ${manifest.version}`;
}

/** Append the label to `containerEl` and return it. */
export function addVersionLabel(containerEl: HTMLElement, manifest: VersionedManifest): HTMLElement {
  return containerEl.createDiv({ cls: VERSION_LABEL_CLASS, text: versionLabelText(manifest) });
}
