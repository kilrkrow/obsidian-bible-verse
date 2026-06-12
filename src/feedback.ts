// ---------------------------------------------------------------------------
// In-plugin "Send feedback" — opens a GitHub issue form with the user's
// version info pre-filled. No telemetry: nothing is sent until the user
// clicks, and the browser opens the form for them to review and submit.
// ---------------------------------------------------------------------------
import { apiVersion, Platform, Setting } from "obsidian";

const REPO = "kilrkrow/obsidian-bible-verse";

function osLabel(): string {
  if (Platform.isMacOS) return "macOS";
  if (Platform.isWin) return "Windows";
  if (Platform.isLinux) return "Linux";
  if (Platform.isIosApp) return "iOS (mobile)";
  if (Platform.isAndroidApp) return "Android (mobile)";
  return "Unknown";
}

/** Build a prefilled bug-report URL. Field keys must match the `id`s in bug.yml. */
export function bugReportUrl(pluginVersion: string): string {
  const params = new URLSearchParams({
    template: "bug.yml",
    "plugin-version": pluginVersion,
    "obsidian-version": apiVersion, // running Obsidian version, exported by the API
    os: osLabel(),
  });
  return `https://github.com/${REPO}/issues/new?${params.toString()}`;
}

/** Build the feature/idea issue URL. */
export function ideaUrl(): string {
  return `https://github.com/${REPO}/issues/new?template=feature.yml`;
}

// Settings tab: call this inside BibleVerseSettingTab.display().
// `this.plugin.manifest.version` gives the installed plugin version.
export function addFeedbackSetting(containerEl: HTMLElement, pluginVersion: string): void {
  new Setting(containerEl)
    .setName("Send feedback")
    .setDesc("Report a bug (version info pre-filled) or suggest an idea on GitHub.")
    .addButton((btn) =>
      btn
        .setButtonText("Report a bug")
        .setCta()
        .onClick(() => window.open(bugReportUrl(pluginVersion))),
    )
    .addExtraButton((btn) =>
      btn
        .setIcon("lightbulb")
        .setTooltip("Suggest an idea")
        .onClick(() => window.open(ideaUrl())),
    );
}
