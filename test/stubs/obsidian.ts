/**
 * Runtime stand-in for the `obsidian` module in unit tests. The real package
 * ships types only; Obsidian provides the module when the plugin loads. Only
 * what the modules under test touch at runtime is here.
 */
export class Notice {
  constructor(public message?: string) {}
}

export const apiVersion = "0.0.0-test";
export const Platform = { isMobile: false, isDesktop: true };

/** A settings row: just its element, enough for render callbacks. */
export class Setting {
  settingEl: HTMLElement;
  constructor(containerEl: HTMLElement) {
    this.settingEl = containerEl.ownerDocument.createElement("div");
    this.settingEl.className = "setting-item";
    containerEl.appendChild(this.settingEl);
  }
}

export class PluginSettingTab {
  containerEl: HTMLElement = document.createElement("div");
  constructor(public app: unknown, public plugin: unknown) {}
}
